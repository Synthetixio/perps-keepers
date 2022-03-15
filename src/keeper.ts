import { Contract } from "@ethersproject/contracts";
import { chunk, orderBy } from "lodash";
import ethers, { BigNumber, utils } from "ethers";
import winston, { format, Logger, transports } from "winston";
import * as metrics from "./metrics";
import SignerPool from "./signer-pool";
import {
  TransactionReceipt,
  TransactionResponse,
} from "@ethersproject/abstract-provider";
import { wei } from "@synthetixio/wei";

function isObjectOrErrorWithCode(x: unknown): x is { code: string } {
  if (typeof x !== "object") return false;
  if (x === null) return false;
  return "code" in x;
}

const EventsOfInterest = {
  PositionLiquidated: "PositionLiquidated",
  PositionModified: "PositionModified",
};

class Keeper {
  baseAsset: string;
  futuresMarket: Contract;
  logger: Logger;
  positions: {
    [account: string]: {
      id: string;
      event: string;
      account: string;
      size: number;
      leverage: number;
    };
  };
  activeKeeperTasks: { [id: string]: boolean | undefined };
  provider:
    | ethers.providers.WebSocketProvider
    | ethers.providers.JsonRpcProvider;
  blockQueue: string[];
  blockTip: string | null;
  signerPool: SignerPool;
  network: string;

  constructor({
    futuresMarket,
    baseAsset,
    signerPool,
    network,
    provider,
  }: {
    futuresMarket: ethers.Contract;
    baseAsset: string;
    signerPool: SignerPool;
    network: string;
    provider:
      | ethers.providers.WebSocketProvider
      | ethers.providers.JsonRpcProvider;
  }) {
    this.baseAsset = baseAsset;
    this.network = network;

    // Contracts.
    this.futuresMarket = futuresMarket;

    this.logger = winston.createLogger({
      level: "info",
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.label({ label: `FuturesMarket [${baseAsset}]` }),
        format.printf(info => {
          return [
            info.timestamp,
            info.level,
            info.label,
            info.component,
            info.message,
          ]
            .filter(x => !!x)
            .join(" ");
        })
      ),
      transports: [new transports.Console()],
    });
    this.logger.info(`market deployed at ${futuresMarket.address}`);

    // The index.
    this.positions = {};

    // A mapping of already running keeper tasks.
    this.activeKeeperTasks = {};

    // A FIFO queue of blocks to be processed.
    this.blockQueue = [];

    this.blockTip = null;
    this.provider = provider;
    this.signerPool = signerPool;
  }

  static async create({
    futuresMarket,
    signerPool,
    provider,
    network,
  }: {
    futuresMarket: Contract;
    signerPool: SignerPool;
    network: string;
    provider:
      | ethers.providers.JsonRpcProvider
      | ethers.providers.WebSocketProvider;
  }) {
    const baseAssetBytes32 = await futuresMarket.baseAsset();
    const baseAsset = utils.parseBytes32String(baseAssetBytes32);

    return new Keeper({
      futuresMarket,
      baseAsset,
      signerPool,
      provider,
      network,
    });
  }
  async startProcessNewBlockConsumer() {
    // The L2 node is constantly mining blocks, one block per transaction. When a new block is received, we queue it
    // for processing in a FIFO queue. `processNewBlock` will scan its events, rebuild the index, and then run any
    // keeper tasks that need running that aren't already active.
    while (1) {
      if (!this.blockQueue.length) {
        await new Promise((resolve, reject) => setTimeout(resolve, 10));
        continue;
      }

      const blockNumber = this.blockQueue.shift();
      if (blockNumber) {
        await this.processNewBlock(blockNumber);
      }
    }
  }
  async getEvents(fromBlock: string | number, toBlock: string | number) {
    const nestedEvents = await Promise.all(
      Object.values(EventsOfInterest).map(eventName => {
        // For some reason query filters logs out stuff to the console
        return this.futuresMarket.queryFilter(
          this.futuresMarket.filters[eventName](),
          fromBlock,
          toBlock
        );
      })
    );
    return nestedEvents.flat(1);
  }
  async run({ fromBlock }: { fromBlock: string | number }) {
    const events = await this.getEvents(fromBlock, "latest");
    this.logger.log("info", `Rebuilding index from ${fromBlock} to latest`, {
      component: "Indexer",
    });
    this.logger.log("info", `${events.length} events to process`, {
      component: "Indexer",
    });
    this.updateIndex(events);

    this.logger.log("info", `Index build complete!`, { component: "Indexer" });
    this.logger.log("info", `Starting keeper loop`);
    await this.runKeepers();

    this.logger.log("info", `Listening for events`);
    this.provider.on("block", async blockNumber => {
      if (!this.blockTip) {
        // Don't process the first block we see.
        this.blockTip = blockNumber;
        return;
      }

      this.logger.log("debug", `New block: ${blockNumber}`);
      this.blockQueue.push(blockNumber);
    });

    this.startProcessNewBlockConsumer();
  }

  async processNewBlock(blockNumber: string) {
    this.blockTip = blockNumber;
    const events = await this.getEvents(blockNumber, blockNumber);

    this.logger.log("debug", `\nProcessing block: ${blockNumber}`, {
      component: "Indexer",
    });

    this.logger.log("debug", `${events.length} events to process`, {
      component: "Indexer",
    });
    await this.updateIndex(events);
    await this.runKeepers();
  }

  async updateIndex(events: ethers.Event[]) {
    events.forEach(({ event, args }) => {
      if (event === EventsOfInterest.PositionModified && args) {
        const { id, account, size, margin, lastPrice } = args;

        this.logger.log(
          "info",
          `PositionModified id=${id} account=${account}`,
          { component: "Indexer" }
        );

        if (size.eq(BigNumber.from(0))) {
          // Position has been closed.
          delete this.positions[account];
          return;
        }
        //   PositionModified(
        //     uint indexed id,
        //     address indexed account,
        //     uint margin,
        //     int size,
        //     int tradeSize,
        //     uint lastPrice,
        //     uint fundingIndex,
        //     uint fee
        // )
        // This is what's avaiable, ideally we should calculate the liq price based on margin and size maybe?

        this.positions[account] = {
          id,
          event,
          account,
          size: wei(size).toNumber(),
          leverage: wei(size)
            .mul(lastPrice)
            .div(margin)
            .toNumber(),
        };
        return;
      }
      if (event === EventsOfInterest.PositionLiquidated && args) {
        const { account, liquidator } = args;
        this.logger.log(
          "info",
          `PositionLiquidated account=${account} liquidator=${liquidator}`,
          { component: "Indexer" }
        );

        delete this.positions[account];
        return;
      }

      this.logger.info(`No handler for event ${event}`, {
        component: "Indexer",
      });
    });
  }

  async runKeepers(deps = { BATCH_SIZE: 500, WAIT: 2000, metrics }) {
    const numPositions = Object.keys(this.positions).length;
    deps.metrics.futuresOpenPositions.set(
      { market: this.baseAsset, network: this.network },
      numPositions
    );
    this.logger.log("info", `${numPositions} positions to keep`, {
      component: "Keeper",
    });

    // Get current liquidation price for each position (including funding).
    const positions = orderBy(
      Object.values(this.positions),
      ["leverage"],
      "desc"
    );
    for (const batch of chunk(positions, deps.BATCH_SIZE)) {
      await Promise.all(
        batch.map(async position => {
          const { id, account } = position;
          await this.runKeeperTask(id, "liquidation", () =>
            this.liquidateOrder(id, account)
          );
        })
      );
      await new Promise((res, rej) => setTimeout(res, deps.WAIT));
    }
  }

  async runKeeperTask(id: string, taskLabel: string, cb: () => Promise<void>) {
    if (this.activeKeeperTasks[id]) {
      // Skip task as its already running.
      return;
    }
    this.activeKeeperTasks[id] = true;

    this.logger.log("info", `running`, {
      component: `Keeper [${taskLabel}] id=${id}`,
    });
    try {
      await cb();
    } catch (err) {
      if (err && typeof err === "object" && err.toString) {
        this.logger.log("error", `error \n${err.toString()}`, {
          component: `Keeper [${taskLabel}] id=${id}`,
        });
      }
      metrics.keeperErrors.observe(
        { market: this.baseAsset, network: this.network },
        1
      );
    }
    this.logger.log("info", `done`, {
      component: `Keeper [${taskLabel}] id=${id}`,
    });

    delete this.activeKeeperTasks[id];
  }

  async liquidateOrder(
    id: string,
    account: string,
    deps = { metricFuturesLiquidations: metrics.futuresLiquidations }
  ) {
    const taskLabel = "liquidation";
    const canLiquidateOrder = await this.futuresMarket.canLiquidate(account);
    if (!canLiquidateOrder) {
      this.logger.log("info", `Cannot liquidate order`, {
        component: `Keeper [${taskLabel}] id=${id}`,
      });
      return;
    }

    this.logger.log("info", `begin liquidatePosition`, {
      component: `Keeper [${taskLabel}] id=${id}`,
    });
    let receipt: TransactionReceipt | undefined;

    try {
      await this.signerPool.withSigner(async signer => {
        const tx: TransactionResponse = await this.futuresMarket
          .connect(signer)
          .liquidatePosition(account);
        this.logger.log(
          "debug",
          `submit liquidatePosition [nonce=${tx.nonce}]`,
          { component: `Keeper [${taskLabel}] id=${id}` }
        );

        receipt = await tx.wait(1);
      });
    } catch (err) {
      deps.metricFuturesLiquidations.observe(
        { market: this.baseAsset, success: "false", network: this.network },
        0
      );

      if (isObjectOrErrorWithCode(err)) {
        // Ethers error.
        if (err.code === "NONCE_EXPIRED") {
          // We can't recover from this one yet, restart.
          this.logger.log("error", err.toString());
          process.exit(-1);
        }
      }

      throw err;
    }

    deps.metricFuturesLiquidations.observe(
      { market: this.baseAsset, success: "true", network: this.network },
      1
    );

    this.logger.log(
      "info",
      `done liquidatePosition`,
      `block=${receipt?.blockNumber}`,
      `success=${!!receipt?.status}`,
      `tx=${receipt?.transactionHash}`,
      `gasUsed=${receipt?.gasUsed}`,
      { component: `Keeper [${taskLabel}] id=${id}` }
    );
  }
}

export default Keeper;

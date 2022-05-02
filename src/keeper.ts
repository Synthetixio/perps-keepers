import { Contract } from "@ethersproject/contracts";
import { chunk } from "lodash";
import ethers, { BigNumber, utils } from "ethers";
import { Logger } from "winston";
import * as metrics from "./metrics";
import SignerPool from "./signer-pool";
import {
  TransactionReceipt,
  TransactionResponse,
} from "@ethersproject/abstract-provider";
import { wei } from "@synthetixio/wei";
import { createLogger } from "./logging";
import { getEvents } from "./keeper-helpers";

const UNIT = utils.parseUnits("1");
const LIQ_PRICE_UNSET = -1;

function isObjectOrErrorWithCode(x: unknown): x is { code: string } {
  if (typeof x !== "object") return false;
  if (x === null) return false;
  return "code" in x;
}

const EventsOfInterest = {
  PositionLiquidated: "PositionLiquidated",
  PositionModified: "PositionModified",
  FundingRecomputed: "FundingRecomputed",
};

interface Position {
  id: string;
  event: string;
  account: string;
  size: number;
  leverage: number;
  liqPrice: number;
  liqPriceUpdatedTimestamp: number;
}

class Keeper {
  baseAsset: string;
  futuresMarket: Contract;
  logger: Logger;
  positions: {
    [account: string]: Position;
  };
  activeKeeperTasks: { [id: string]: boolean | undefined };
  provider:
    | ethers.providers.WebSocketProvider
    | ethers.providers.JsonRpcProvider;
  blockQueue: Array<string>;
  blockTip: string | null;
  blockTipTimestamp: number;
  signerPool: SignerPool;
  network: string;
  volumeArray: Array<{
    tradeSizeUSD: number;
    timestamp: number;
    account: string;
  }>;
  recentVolume: number;
  assetPrice: number;

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

    this.logger = createLogger({
      componentName: `FuturesMarket [${baseAsset}]`,
    });
    this.logger.info(`market deployed at ${futuresMarket.address}`);

    // The index.
    this.positions = {};

    // A mapping of already running keeper tasks.
    this.activeKeeperTasks = {};

    // A FIFO queue of blocks to be processed.
    this.blockQueue = [];

    this.blockTip = null;
    this.blockTipTimestamp = 0;
    this.provider = provider;
    this.signerPool = signerPool;

    // volume accounting for metrics
    // this array maintains recent volume updates so that rolling
    // volume can be computed.
    this.volumeArray = [];
    this.recentVolume = 0;

    // required for sorting position by proximity of liquidation price to current price
    this.assetPrice = 0;
  }

  resetState() {
    this.activeKeeperTasks = {};
    this.positions = {};

    this.blockTip = null;
    this.blockTipTimestamp = 0;

    this.blockQueue = [];
    this.volumeArray = [];

    this.recentVolume = 0;
    this.assetPrice = 0;
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
        await this.delay(10);
        continue;
      }

      // sort in case it's unsorted for some reason
      this.blockQueue.sort();
      const blockNumber = this.blockQueue.shift();
      if (blockNumber) {
        await this.processNewBlock(blockNumber);
      }
    }
  }
  delay(ms: number) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms));
  }

  async run({ fromBlock }: { fromBlock: string | number }) {
    // ensure state is reset in case this is being invoked recursively
    this.resetState();

    try {
      const toBlock = await this.provider.getBlockNumber();
      const events = await getEvents(
        Object.values(EventsOfInterest),
        this.futuresMarket,
        { fromBlock, toBlock }
      );
      this.logger.log("info", `Rebuilding index from ${fromBlock} to latest`, {
        component: "Indexer",
      });
      this.logger.log("info", `${events.length} events to process`, {
        component: "Indexer",
      });
      await this.updateIndex(events);

      this.logger.log(
        "info",
        `VolumeQueue after sync: total ${this.recentVolume} ${
          this.volumeArray.length
        } trades:${this.volumeArray.map(
          o => `${o.tradeSizeUSD} ${o.timestamp} ${o.account}`
        )}`,
        { component: "Indexer" }
      );

      this.logger.log("info", `Index build complete!`, {
        component: "Indexer",
      });
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

      await this.startProcessNewBlockConsumer();
    } catch (err) {
      // handle anything else here by just logging it and hoping for better luck next time
      this.logger.log("error", `error \n${String(err)}`, {
        component: `keeper main`,
      });
      // wait a minute in case it's just node issues, and start again
      await this.delay(60 * 1000);
      // try again
      await this.run({ fromBlock });
    }
  }

  async processNewBlock(blockNumber: string) {
    this.blockTip = blockNumber;
    // first try to liquidate any positions that can be liquidated now
    await this.runKeepers();

    // now process new events to update index, since it's impossible for a position that
    // was just updated to be liquidatable at the same block
    const events = await getEvents(
      Object.values(EventsOfInterest),
      this.futuresMarket,
      { fromBlock: blockNumber, toBlock: blockNumber }
    );
    if (!events.length) {
      // set block timestamp here in case there were no events to update the timestamp from
      this.blockTipTimestamp = (
        await this.provider.getBlock(blockNumber)
      ).timestamp;
    }
    this.logger.log(
      "info",
      `Processing new block: ${blockNumber}, ${events.length} events to process`,
      {
        component: "Indexer",
      }
    );
    await this.updateIndex(events);
  }

  async updateIndex(
    events: ethers.Event[],
    deps = {
      totalLiquidationsMetric: metrics.totalLiquidations,
      marketSizeMetric: metrics.marketSize,
      marketSkewMetric: metrics.marketSkew,
      recentVolumeMetric: metrics.recentVolume,
    }
  ) {
    events.forEach(({ event, args, blockNumber }) => {
      if (event === EventsOfInterest.FundingRecomputed && args) {
        // just a sneaky way to get timestamps without making awaiting getBlock() calls
        // keeping track of time is needed for the volume metrics during the initial
        // sync so that we don't have to await getting block timestamp for each new block
        this.blockTipTimestamp = args.timestamp.toNumber();
        this.logger.log(
          "debug",
          `FundingRecomputed timestamp ${this.blockTipTimestamp}, blocknumber ${blockNumber}`,
          { component: "Indexer" }
        );
        return;
      }

      if (event === EventsOfInterest.PositionModified && args) {
        const { id, account, size, margin, lastPrice, tradeSize } = args;

        this.logger.log(
          "debug",
          `PositionModified id=${id} account=${account}, blocknumber ${blockNumber}`,
          { component: "Indexer" }
        );

        // keep track of volume
        this.pushTradeToVolumeQueue(tradeSize, lastPrice, account);

        if (margin.eq(BigNumber.from(0))) {
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
          size: wei(size)
            .div(UNIT)
            .toNumber(),
          leverage: wei(size)
            .abs()
            .mul(lastPrice)
            .div(margin)
            .div(UNIT)
            .toNumber(),
          liqPrice: LIQ_PRICE_UNSET, // will be updated by keeper routine
          liqPriceUpdatedTimestamp: 0,
        };

        return;
      }
      if (event === EventsOfInterest.PositionLiquidated && args) {
        const { account, liquidator } = args;
        this.logger.log(
          "debug",
          `PositionLiquidated account=${account} liquidator=${liquidator}, blocknumber ${blockNumber}`,
          { component: "Indexer" }
        );

        deps.totalLiquidationsMetric.inc({
          market: this.baseAsset,
          network: this.network,
        });
        delete this.positions[account];
        return;
      }

      this.logger.debug(`No handler for event ${event}`, {
        component: "Indexer",
      });
    });

    // update volume metrics
    this.updateVolumeMetrics(deps);

    // required for metrics and liquidations order
    // it's updated after running keepers because even if it's one-block old, it shouldn't
    // affect liquidation order too much, but awaiting this might introduce latency
    await this.updateAssetPrice();

    // update open interest metrics
    this.updateOIMetrics(deps);
  }

  pushTradeToVolumeQueue(
    tradeSize: BigNumber,
    lastPrice: BigNumber,
    account: string
  ) {
    const tradeSizeUSD = wei(tradeSize)
      .abs()
      .mul(lastPrice)
      .div(UNIT)
      .toNumber();
    // push into rolling queue
    this.volumeArray.push({
      tradeSizeUSD: tradeSizeUSD,
      timestamp: this.blockTipTimestamp,
      account: account,
    });
    // add to total volume sum, this isn't strictly needed as it will be 
    // overridden by filter and sum in updateVolumeMetrics, but it keeps it up to date, and checked in tests
    this.recentVolume += tradeSizeUSD;
  }

  updateVolumeMetrics(
    args = {
      recentVolumeMetric: metrics.recentVolume,
    }
  ) {
    const cutoffTimestamp =
      this.blockTipTimestamp - metrics.VOLUME_RECENCY_CUTOFF; // old values
    // filter only recent trades
    this.volumeArray = this.volumeArray.filter(
      v => v.timestamp > cutoffTimestamp
    );
    // sum
    this.recentVolume = this.volumeArray
      .map(v => v.tradeSizeUSD)
      .reduce((a, b) => a + b, 0);
    args.recentVolumeMetric.set(
      { market: this.baseAsset, network: this.network },
      this.recentVolume
    );
    this.logger.debug(`Recent volume: ${this.recentVolume}`, {
      component: "Indexer",
    });
  }

  async updateAssetPrice() {
    this.assetPrice = parseFloat(
      utils.formatUnits((await this.futuresMarket.assetPrice()).price)
    );
    this.logger.info(`Latest price: ${this.assetPrice}`, {
      component: "Indexer",
    });
  }

  updateOIMetrics(
    args = {
      marketSizeMetric: metrics.marketSize,
      marketSkewMetric: metrics.marketSkew,
    }
  ) {
    const marketSize = Object.values(this.positions).reduce(
      (a, v) => a + Math.abs(v.size),
      0
    );
    const marketSkew = Object.values(this.positions).reduce(
      (a, v) => a + v.size,
      0
    );

    args.marketSizeMetric.set(
      { market: this.baseAsset, network: this.network },
      marketSize * this.assetPrice
    );
    args.marketSkewMetric.set(
      { market: this.baseAsset, network: this.network },
      marketSkew * this.assetPrice
    );
  }

  // global ordering of position for liquidations by their likelihood of being liquidatable
  liquidationGroups(
    posArr: Position[],
    priceProximityThreshold = 0.05,
    maxFarPricesToUpdate = 1, // max number of older liquidation prices to update
    farPriceRecencyCutoff = 6 * 3600 // interval during which the liquidation price is considered up to date if it's far
  ) {
    // group
    const knownLiqPrice = posArr.filter(p => p.liqPrice !== LIQ_PRICE_UNSET);
    const unknownLiqPrice = posArr.filter(p => p.liqPrice === LIQ_PRICE_UNSET);

    const liqPriceClose = knownLiqPrice.filter(
      p =>
        Math.abs(p.liqPrice - this.assetPrice) / this.assetPrice <=
        priceProximityThreshold
    );
    const liqPriceFar = knownLiqPrice.filter(
      p =>
        Math.abs(p.liqPrice - this.assetPrice) / this.assetPrice >
        priceProximityThreshold
    );

    // sort close prices by liquidation price and leverage
    liqPriceClose.sort(
      (p1, p2) =>
        // sort by ascending proximity of liquidation price to current price
        Math.abs(p1.liqPrice - this.assetPrice) -
          Math.abs(p2.liqPrice - this.assetPrice) ||
        // if liq price is the same, sort by descending leverage (which should be different)
        p2.leverage - p1.leverage // desc)
    );

    // sort unknown liq prices by leverage
    unknownLiqPrice.sort((p1, p2) => p2.leverage - p1.leverage); //desc

    const outdatedLiqPrices = liqPriceFar.filter(
      p =>
        p.liqPriceUpdatedTimestamp <
        this.blockTipTimestamp - farPriceRecencyCutoff
    );
    // sort far liquidation prices by how out of date they are
    // this should constantly update old positions' liq price
    outdatedLiqPrices.sort(
      (p1, p2) => p1.liqPriceUpdatedTimestamp - p2.liqPriceUpdatedTimestamp
    ); //asc

    // first known close prices, then unknown prices yet
    return [
      liqPriceClose, // all close prices within threshold
      unknownLiqPrice, // all unknown liq prices (to get them updated)
      outdatedLiqPrices.slice(0, maxFarPricesToUpdate), // some max number of of outdated prices to reduce spamming the node and prevent self DOS when there are many positions
    ];
  }

  async runKeepers(deps = { BATCH_SIZE: 5, WAIT: 0, metrics }) {
    // make into an array and filter position 0 size positions
    const openPositions = Object.values(this.positions).filter(
      p => Math.abs(p.size) > 0
    );

    deps.metrics.futuresOpenPositions.set(
      { market: this.baseAsset, network: this.network },
      openPositions.length
    );
    this.logger.log("info", `${openPositions.length} open positions`, {
      component: "Keeper",
    });

    // order the position in groups of priority that shouldn't be mixed in same batches
    const positionGroups = this.liquidationGroups(openPositions);

    this.logger.log(
      "info",
      `${positionGroups.reduce((a, g) => a + g.length, 0)} to check`,
      {
        component: "Keeper",
      }
    );

    for (let group of positionGroups) {
      if (group.length) {
        // batch the groups to maintain internal order within groups
        for (let batch of chunk(group, deps.BATCH_SIZE)) {
          this.logger.log(
            "info",
            `Running keeper batch with ${batch.length} positions to keep`,
            {
              component: "Keeper",
            }
          );

          await Promise.all(
            batch.map(async position => {
              const { id, account } = position;
              await this.runKeeperTask(id, "liquidation", () =>
                this.liquidateOrder(id, account)
              );
            })
          );
          await this.delay(deps.WAIT);
        }
      }
    }
  }

  async runKeeperTask(id: string, taskLabel: string, cb: () => Promise<void>) {
    if (this.activeKeeperTasks[id]) {
      // Skip task as its already running.
      return;
    }
    this.activeKeeperTasks[id] = true;

    this.logger.log("debug", `running`, {
      component: `Keeper [${taskLabel}] id=${id}`,
    });
    try {
      await cb();
    } catch (err) {
      this.logger.log("error", `error \n${String(err)}`, {
        component: `Keeper [${taskLabel}] id=${id}`,
      });
    }
    this.logger.log("debug", `done`, {
      component: `Keeper [${taskLabel}] id=${id}`,
    });

    delete this.activeKeeperTasks[id];
  }

  async liquidateOrder(
    id: string,
    account: string,
    deps = {
      metricFuturesLiquidations: metrics.futuresLiquidations,
      metricKeeperChecks: metrics.keeperChecks,
    }
  ) {
    const taskLabel = "liquidation";
    // check if it's liquidatable
    const canLiquidateOrder = await this.futuresMarket.canLiquidate(account);
    // increment number of checks performed
    deps.metricKeeperChecks.inc({
      market: this.baseAsset,
      network: this.network,
    });
    if (!canLiquidateOrder) {
      // if it's not liquidatable update it's liquidation price
      this.positions[account].liqPrice = parseFloat(
        utils.formatUnits(
          (await this.futuresMarket.liquidationPrice(account)).price
        )
      );
      this.positions[account].liqPriceUpdatedTimestamp = this.blockTipTimestamp;
      this.logger.log(
        "info",
        `Cannot liquidate order, updated liqPrice ${this.positions[account].liqPrice}`,
        {
          component: `Keeper [${taskLabel}] id=${id}`,
        }
      );
      return;
    }

    this.logger.log("info", `begin liquidatePosition`, {
      component: `Keeper [${taskLabel}] id=${id}`,
    });
    let receipt: TransactionReceipt | undefined;

    await this.signerPool.withSigner(async signer => {
      try {
        const tx: TransactionResponse = await this.futuresMarket
          .connect(signer)
          .liquidatePosition(account);
        this.logger.log(
          "debug",
          `submit liquidatePosition [nonce=${tx.nonce}]`,
          { component: `Keeper [${taskLabel}] id=${id}` }
        );

        receipt = await tx.wait(1);
      } catch (err) {
        if (isObjectOrErrorWithCode(err)) {
          // Special handeling for NONCE_EXPIRED
          if (err.code === "NONCE_EXPIRED") {
            this.logger.error(err.toString());
            const nonce = signer.getTransactionCount("latest");
            this.logger.info(
              `Updating nonce for Nonce manager to nonce ${nonce}`
            );
            signer.setTransactionCount(nonce);
          }
        }

        // increment liquidation errors here so that only liquidation errors are counted
        metrics.keeperErrors.inc({
          market: this.baseAsset,
          network: this.network,
          errorMessage: String(err),
        });

        throw err;
      }
    });

    deps.metricFuturesLiquidations.inc({
      market: this.baseAsset,
      network: this.network,
    });

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

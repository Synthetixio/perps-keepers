const ethers = require("ethers");
const { BigNumber: BN } = ethers;
const { gray, blue, red, green, yellow } = require("chalk");

const DEFAULT_GAS_PRICE = "0";
const snx = require("synthetix");

async function runWithRetries(cb, retries = 3) {
  try {
    await cb();
  } catch (ex) {
    if (retries === 0) throw ex;
    else await runWithRetries(cb, retries - 1);
  }
}

class Keeper {
  // The index.
  constructor({
    proxyFuturesMarket: proxyFuturesMarketAddress,
    exchangeRates: exchangeRatesAddress,
    signerPool,
    provider,
    network
  }) {
    // Get ABIs.
    const FuturesMarketABI = snx.getSource({
      network,
      contract: "FuturesMarket",
      useOvm: true
    }).abi;
    const ExchangeRatesABI = snx.getSource({
      network,
      contract: "ExchangeRatesWithoutInvPricing",
      useOvm: true
    }).abi;

    // The index.
    this.positions = {};

    // A mapping of already running keeper tasks.
    this.activeKeeperTasks = {};

    // A FIFO queue of blocks to be processed.
    this.blockQueue = [];

    const futuresMarket = new ethers.Contract(
      proxyFuturesMarketAddress,
      FuturesMarketABI,
      provider
    );
    this.futuresMarket = futuresMarket;

    const exchangeRates = new ethers.Contract(
      exchangeRatesAddress,
      ExchangeRatesABI,
      provider
    );
    this.exchangeRates = exchangeRates;

    this.blockTip = null;
    this.provider = provider;
    this.signerPool = signerPool;
  }

  async run({ fromBlock }) {
    const events = await this.futuresMarket.queryFilter(
      "*",
      fromBlock,
      "latest"
    );
    console.log(gray(`Rebuilding index from `), `${fromBlock} ... latest`);
    console.log(gray`${events.length} events to process`);
    this.updateIndex(events);

    console.log(gray(`Index build complete!`));
    console.log(gray(`Starting keeper loop`));
    await this.runKeepers();

    console.log(
      `Listening for events on FuturesMarket [${this.futuresMarket.address}]`
    );
    this.provider.on("block", async blockNumber => {
      if (!this.blockTip) {
        // Don't process the first block we see.
        this.blockTip = blockNumber;
        return;
      }

      console.log(gray(`New block: ${blockNumber}`));
      this.blockQueue.push(blockNumber);
    });

    // The L2 node is constantly mining blocks, one block per transaction. When a new block is received, we queue it
    // for processing in a FIFO queue. `processNewBlock` will scan its events, rebuild the index, and then run any
    // keeper tasks that need running that aren't already active.
    while (1) {
      if (!this.blockQueue.length) {
        await new Promise((resolve, reject) => setTimeout(resolve, 0.001));
        continue;
      }

      const blockNumber = this.blockQueue.shift();
      await this.processNewBlock(blockNumber);
    }
  }

  async processNewBlock(blockNumber) {
    this.blockTip = blockNumber;
    const events = await this.futuresMarket.queryFilter(
      "*",
      blockNumber,
      blockNumber
    );
    const exchangeRateEvents = await this.exchangeRates.queryFilter(
      "*",
      blockNumber,
      blockNumber
    );
    console.log("");
    console.log(gray(`Processing block: ${blockNumber}`));
    exchangeRateEvents
      .filter(
        ({ event, args }) => event === "RatesUpdated" || event === "RateDeleted"
      )
      .forEach(({ event }) => {
        console.log("ExchangeRates", blue(event));
      });
    console.log("FuturesMarket", gray`${events.length} events to process`);
    this.updateIndex(events);
    await this.runKeepers();
  }

  updateIndex(events) {
    events.forEach(({ event, args }) => {
      if (event === "PositionModified") {
        const { id, account, size } = args;

        console.log(
          "FuturesMarket",
          blue("PositionModified"),
          `[id=${id} account=${account}]`
        );

        if (size.eq(BN.from(0))) {
          // Position has been closed.
          delete this.positions[account];
          return;
        }

        this.positions[account] = {
          id,
          event,
          account
        };
      } else if (event === "PositionLiquidated") {
        const { account, liquidator } = args;
        console.log(
          "FuturesMarket",
          blue("PositionLiquidated"),
          `[account=${account} liquidator=${liquidator}]`
        );

        delete this.positions[account];
      } else if (!event || event.match(/OrderSubmitted/)) {
      } else {
        console.log("FuturesMarket", blue(event), "No handler");
      }
    });
  }

  async runKeepers() {
    console.log(`${Object.keys(this.positions).length} positions to keep`);

    // Open positions.
    for (const { id, account } of Object.values(this.positions)) {
      this.runKeeperTask(`${id}-liquidation`, () =>
        this.liquidateOrder(id, account)
      );
    }
  }

  async runKeeperTask(id, cb) {
    if (this.activeKeeperTasks[id]) {
      // Skip task as its already running.
      return;
    }
    this.activeKeeperTasks[id] = true;

    console.log(gray(`KeeperTask running [id=${id}]`));
    try {
      await runWithRetries(cb);
    } catch (err) {
      console.error(
        red(`KeeperTask error [id=${id}]`),
        "\n",
        red(err.toString())
      );
    }
    console.log(gray(`KeeperTask done [id=${id}]`));

    delete this.activeKeeperTasks[id];
  }

  async liquidateOrder(id, account) {
    // console.log(
    // 	`FuturesMarket [${this.futuresMarket.address}]`,
    // 	`checking canLiquidate [id=${id}]`
    // );
    const canLiquidateOrder = await this.futuresMarket.canLiquidate(account);
    if (!canLiquidateOrder) {
      // console.log(
      // 	`FuturesMarket [${this.futuresMarket.address}]`,
      // 	`cannot liquidate order [id=${id}]`
      // );
      return;
    }

    console.log(
      `FuturesMarket [${this.futuresMarket.address}]`,
      `begin liquidatePosition [id=${id}]`
    );
    let tx, receipt;

    try {
      await this.signerPool.withSigner(async signer => {
        tx = await this.futuresMarket
          .connect(signer)
          .liquidatePosition(account, {
            gasPrice: DEFAULT_GAS_PRICE
          });
        console.log(tx.nonce);
        receipt = await tx.wait(1);
      });
    } catch (err) {
      throw err;
    }

    console.log(
      `FuturesMarket [${this.futuresMarket.address}]`,
      green(`done liquidatePosition [id=${id}]`),
      `block=${receipt.blockNumber}`,
      `success=${!!receipt.status}`,
      `tx=${receipt.transactionHash}`,
      yellow(`gasUsed=${receipt.gasUsed}`)
    );
  }
}

module.exports = Keeper;

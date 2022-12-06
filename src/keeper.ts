import { Contract, Wallet } from 'ethers';
import { chunk } from 'lodash';
import ethers, { BigNumber, utils, providers } from 'ethers';
import { Logger } from 'winston';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { wei } from '@synthetixio/wei';
import { createLogger } from './logging';
import { getEvents } from './keeper-helpers';

const UNIT = utils.parseUnits('1');
const LIQ_PRICE_UNSET = -1;

const EventsOfInterest = {
  PositionLiquidated: 'PositionLiquidated',
  PositionModified: 'PositionModified',
  FundingRecomputed: 'FundingRecomputed',
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

enum KeeperTask {
  LIQUIDATION = 'LIQUIDATION',
  DELAYED_ORDER = 'DELAYED_ORDER',
  OFFCHAIN_ORDER = 'OFFCHAIN_ORDER',
}

export class Keeper {
  baseAsset: string;
  market: Contract;
  logger: Logger;
  positions: {
    [account: string]: Position;
  };
  activeKeeperTasks: { [id: string]: boolean | undefined };
  provider: providers.BaseProvider;
  blockQueue: Array<number>;
  lastProcessedBlock: number | null;
  blockTipTimestamp: number;
  signer: Wallet;
  network: string;
  volumeArray: Array<{
    tradeSizeUSD: number;
    timestamp: number;
    account: string;
  }>;
  recentVolume: number;
  assetPrice: number;

  constructor({
    market,
    baseAsset,
    signer,
    network,
    provider,
  }: {
    market: ethers.Contract;
    baseAsset: string;
    signer: Wallet;
    network: string;
    provider: providers.BaseProvider;
  }) {
    this.baseAsset = baseAsset;
    this.network = network;

    // Contracts.
    this.market = market;

    this.logger = createLogger({
      componentName: `PerpsV2Market [${baseAsset}]`,
    });
    this.logger.info(`Market deployed at '${market.address}'`);

    // The index.
    this.positions = {};

    // A mapping of already running keeper tasks.
    this.activeKeeperTasks = {};

    // A FIFO queue of blocks to be processed.
    this.blockQueue = [];

    this.lastProcessedBlock = null;
    this.blockTipTimestamp = 0;
    this.provider = provider;
    this.signer = signer;

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

    this.lastProcessedBlock = null;
    this.blockTipTimestamp = 0;

    this.blockQueue = [];
    this.volumeArray = [];

    this.recentVolume = 0;
    this.assetPrice = 0;
  }

  static async create({
    market,
    signer,
    provider,
    network,
  }: {
    market: Contract;
    signer: Wallet;
    network: string;
    provider: providers.BaseProvider;
  }) {
    const baseAssetBytes32 = await market.baseAsset();
    const baseAsset = utils.parseBytes32String(baseAssetBytes32);

    return new Keeper({
      market,
      baseAsset,
      signer,
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

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run({ fromBlock }: { fromBlock: string | number }): Promise<void> {
    // ensure state is reset in case this is being invoked recursively
    this.resetState();

    try {
      const toBlock = await this.provider.getBlockNumber();
      const events = await getEvents(Object.values(EventsOfInterest), this.market, {
        fromBlock,
        toBlock,
      });
      this.logger.info(`Rebuilding index from ${fromBlock} to latest`, {
        component: 'Indexer',
      });
      this.logger.info(`${events.length} events to process`, {
        component: 'Indexer',
      });
      await this.updateIndex(events);

      this.logger.info(
        `VolumeQueue after sync: total ${this.recentVolume} ${
          this.volumeArray.length
        } trades:${this.volumeArray.map(o => `${o.tradeSizeUSD} ${o.timestamp} ${o.account}`)}`,
        { component: 'Indexer' }
      );

      this.logger.info('Index build complete! Starting keeper loop...', {
        component: 'Indexer',
      });
      await this.runKeepers();

      this.logger.info('Listening for events...');

      this.provider.on('block', async (blockNumber: number) => {
        if (blockNumber % Number(process.env.RUN_EVERY_X_BLOCK) !== 0) return;
        if (!this.lastProcessedBlock) {
          // Don't process the first block we see.
          this.lastProcessedBlock = blockNumber;
          return;
        }

        this.logger.debug(`New block: ${blockNumber}`);
        this.blockQueue.push(blockNumber);
      });

      await this.startProcessNewBlockConsumer();
    } catch (err) {
      // handle anything else here by just logging it and hoping for better luck next time
      this.logger.error(`Error \n${String(err)}`, {
        component: `keeper main`,
      });

      // Wait a minute and retry (may just be Node issues).
      await this.delay(60 * 1000);
      await this.run({ fromBlock });
    }
  }

  async processNewBlock(blockNumber: number): Promise<void> {
    // first try to liquidate any positions that can be liquidated now
    await this.runKeepers();

    const fromBlock = this.lastProcessedBlock ? this.lastProcessedBlock + 1 : blockNumber;

    // now process new events to update index, since it's impossible for a position that
    // was just updated to be liquidatable at the same block
    const events = await getEvents(Object.values(EventsOfInterest), this.market, {
      fromBlock: fromBlock,
      toBlock: blockNumber,
    });
    if (!events.length) {
      // set block timestamp here in case there were no events to update the timestamp from
      this.blockTipTimestamp = (await this.provider.getBlock(blockNumber)).timestamp;
    }
    this.logger.info(`Processing new block: ${blockNumber}, ${events.length} events to process`, {
      component: 'Indexer',
    });
    await this.updateIndex(events);

    // update the lastProcessedBlock
    this.lastProcessedBlock = blockNumber;
  }

  async updateIndex(events: ethers.Event[]): Promise<void> {
    events.forEach(({ event, args, blockNumber }) => {
      if (event === EventsOfInterest.FundingRecomputed && args) {
        // just a sneaky way to get timestamps without making awaiting getBlock() calls
        // keeping track of time is needed for the volume metrics during the initial
        // sync so that we don't have to await getting block timestamp for each new block
        this.blockTipTimestamp = args.timestamp.toNumber();
        this.logger.debug(
          `FundingRecomputed timestamp ${this.blockTipTimestamp}, blocknumber ${blockNumber}`,
          { component: 'Indexer' }
        );
        return;
      }

      if (event === EventsOfInterest.PositionModified && args) {
        const { id, account, size, margin, lastPrice, tradeSize } = args;

        this.logger.debug(
          `PositionModified id=${id} account=${account}, blocknumber ${blockNumber}`,
          { component: 'Indexer' }
        );

        // keep track of volume
        this.pushTradeToVolumeQueue(tradeSize, lastPrice, account);

        if (margin.eq(BigNumber.from(0))) {
          // Position has been closed.
          delete this.positions[account];
          return;
        }

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
        this.logger.debug(
          `PositionLiquidated account=${account} liquidator=${liquidator}, blocknumber ${blockNumber}`,
          { component: 'Indexer' }
        );

        delete this.positions[account];
        return;
      }

      this.logger.debug(`No handler for event ${event}`, {
        component: 'Indexer',
      });
    });

    // required for metrics and liquidations order
    // it's updated after running keepers because even if it's one-block old, it shouldn't
    // affect liquidation order too much, but awaiting this might introduce latency
    await this.updateAssetPrice();
  }

  pushTradeToVolumeQueue(tradeSize: BigNumber, lastPrice: BigNumber, account: string) {
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

  async updateAssetPrice() {
    this.assetPrice = parseFloat(utils.formatUnits((await this.market.assetPrice()).price));
    this.logger.info(`Latest price: ${this.assetPrice}`, {
      component: 'Indexer',
    });
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
      p => Math.abs(p.liqPrice - this.assetPrice) / this.assetPrice <= priceProximityThreshold
    );
    const liqPriceFar = knownLiqPrice.filter(
      p => Math.abs(p.liqPrice - this.assetPrice) / this.assetPrice > priceProximityThreshold
    );

    // sort close prices by liquidation price and leverage
    liqPriceClose.sort(
      (p1, p2) =>
        // sort by ascending proximity of liquidation price to current price
        Math.abs(p1.liqPrice - this.assetPrice) - Math.abs(p2.liqPrice - this.assetPrice) ||
        // if liq price is the same, sort by descending leverage (which should be different)
        p2.leverage - p1.leverage // desc)
    );

    // sort unknown liq prices by leverage
    unknownLiqPrice.sort((p1, p2) => p2.leverage - p1.leverage); //desc

    const outdatedLiqPrices = liqPriceFar.filter(
      p => p.liqPriceUpdatedTimestamp < this.blockTipTimestamp - farPriceRecencyCutoff
    );
    // sort far liquidation prices by how out of date they are
    // this should constantly update old positions' liq price
    outdatedLiqPrices.sort((p1, p2) => p1.liqPriceUpdatedTimestamp - p2.liqPriceUpdatedTimestamp); //asc

    // first known close prices, then unknown prices yet
    return [
      liqPriceClose, // all close prices within threshold
      unknownLiqPrice, // all unknown liq prices (to get them updated)
      outdatedLiqPrices.slice(0, maxFarPricesToUpdate), // some max number of of outdated prices to reduce spamming the node and prevent self DOS when there are many positions
    ];
  }

  async runKeepers(deps = { BATCH_SIZE: 5, WAIT: 0 }) {
    // make into an array and filter position 0 size positions
    const openPositions = Object.values(this.positions).filter(p => Math.abs(p.size) > 0);

    this.logger.info(`Found ${openPositions.length} open positions`, {
      component: 'Keeper',
    });

    // order the position in groups of priority that shouldn't be mixed in same batches
    const positionGroups = this.liquidationGroups(openPositions);

    this.logger.info(`Found ${positionGroups.reduce((a, g) => a + g.length, 0)} to check`, {
      component: 'Keeper',
    });

    for (let group of positionGroups) {
      if (group.length) {
        // batch the groups to maintain internal order within groups
        for (let batch of chunk(group, deps.BATCH_SIZE)) {
          this.logger.info(`Running keeper batch with ${batch.length} positions to keep`, {
            component: 'Keeper',
          });

          await Promise.all(
            batch.map(async position => {
              const { id, account } = position;
              await this.runKeeperTask(id, KeeperTask.LIQUIDATION, () =>
                this.liquidateOrder(id, account)
              );
            })
          );
          await this.delay(deps.WAIT);
        }
      }
    }
  }

  async runKeeperTask(id: string, taskLabel: KeeperTask, cb: () => Promise<void>) {
    const logMetadata = {
      component: `Keeper [${taskLabel}] id=${id}`,
    };

    if (this.activeKeeperTasks[id]) {
      // Skip task as its already running.
      return;
    }
    this.activeKeeperTasks[id] = true;

    this.logger.debug(`Keeper task running`, logMetadata);
    try {
      await cb();
    } catch (err) {
      this.logger.error(`error \n${String(err)}`, logMetadata);
    }
    this.logger.debug(`Keeper task complete`, logMetadata);

    delete this.activeKeeperTasks[id];
  }

  async liquidateOrder(id: string, account: string) {
    const logMetadata = {
      component: `Keeper [${KeeperTask.LIQUIDATION}] id=${id}`,
    };

    const canLiquidateOrder = await this.market.canLiquidate(account);
    if (!canLiquidateOrder) {
      // if it's not liquidatable update it's liquidation price
      this.positions[account].liqPrice = parseFloat(
        utils.formatUnits((await this.market.liquidationPrice(account)).price)
      );
      this.positions[account].liqPriceUpdatedTimestamp = this.blockTipTimestamp;
      this.logger.info(
        `Cannot liquidate order, updated liqPrice ${this.positions[account].liqPrice}`,
        logMetadata
      );
      return;
    }

    this.logger.info(`Begin liquidatePosition`, logMetadata);
    const tx: TransactionResponse = await this.market
      .connect(this.signer)
      .liquidatePosition(account);

    this.logger.info(`Submit liquidatePosition [nonce=${tx.nonce}]`, logMetadata);

    const receipt = await tx.wait(1);
    const { blockNumber, status, transactionHash, gasUsed } = receipt;
    this.logger.info(
      `done liquidatePosition`,
      `block=${blockNumber}`,
      `success=${status}`,
      `tx=${transactionHash}`,
      `gasUsed=${gasUsed}`,
      logMetadata
    );
  }
}

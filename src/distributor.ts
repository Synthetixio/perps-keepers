import { Contract, providers, Event, utils, Wallet } from 'ethers';
import { Logger } from 'winston';
import { getEvents } from './keepers/helpers';
import { Keeper } from './keepers';
import { createLogger } from './logging';
import { PerpsEvent } from './typed';
import { Metric, Metrics } from './metrics';
import { wei } from '@synthetixio/wei';

export class Distributor {
  private readonly logger: Logger;
  private readonly keepers: Keeper[] = [];
  private blockQueue: Array<number> = [];
  private lastProcessedBlock?: number;

  private readonly LISTEN_ERROR_WAIT_TIME = 60 * 1000; // 1min
  private readonly MAX_CONSUME_WAIT_TIME = 100;
  protected readonly START_TIME = Date.now();

  constructor(
    private readonly market: Contract,
    protected readonly baseAsset: string,
    private readonly provider: providers.BaseProvider,
    private readonly metrics: Metrics,
    private readonly signer: Wallet,
    private readonly fromBlock: number | string,
    private readonly runEveryXblock: number,
    private readonly runHealthcheckEveryXBlock: number
  ) {
    this.logger = createLogger(`[${baseAsset}] Distributor`);
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /* Given an array of keepers, track and include in bulk executions. */
  registerKeepers(keepers: Keeper[]) {
    keepers.forEach(keeper => this.keepers.push(keeper));
    this.logger.info('Registered keepers', { args: { n: this.keepers.length } });
  }

  private async indexKeepers(): Promise<void> {
    await Promise.all(this.keepers.map(keeper => keeper.index(this.fromBlock)));
  }

  private async updateKeeperIndexes(
    events: Event[],
    block: providers.Block,
    assetPrice: number
  ): Promise<void[]> {
    return Promise.all(this.keepers.map(keeper => keeper.updateIndex(events, block, assetPrice)));
  }

  private async executeKeepers(): Promise<void[]> {
    return Promise.all(this.keepers.map(keeper => keeper.execute()));
  }

  private async disburseToKeepers(toBlock: number): Promise<void> {
    const fromBlock = this.lastProcessedBlock ? this.lastProcessedBlock + 1 : toBlock;
    const events = await getEvents(Object.values(PerpsEvent), this.market, {
      fromBlock,
      toBlock,
      logger: this.logger,
    });
    const block = await this.provider.getBlock(toBlock);
    const assetPrice = parseFloat(utils.formatUnits((await this.market.assetPrice()).price));

    this.logger.info('Distributing to keepers', {
      args: { fromBlock, toBlock, events: events.length, assetPrice },
    });

    await this.updateKeeperIndexes(events, block, assetPrice);
    await this.executeKeepers();
  }

  private async startProcessNewBlockConsumer() {
    // The L2 node is constantly mining blocks, one block per transaction. When a new block is received, we queue it
    // for processing in a FIFO queue. `processNewBlock` will scan its events, rebuild the index, and then run any
    // keeper tasks that need running that aren't already active.
    while (1) {
      this.metrics.gauge(Metric.DISTRIBUTOR_QUEUE_SIZE, this.blockQueue.length);

      if (!this.blockQueue.length) {
        await this.delay(this.MAX_CONSUME_WAIT_TIME);
        continue;
      }

      // Sort in case it's unsorted for some reason
      this.blockQueue.sort();
      const blockNumber = this.blockQueue.shift();
      if (blockNumber) {
        this.logger.info('Found block in blockQueue!', {
          args: {
            blockNumber,
            lastProcessedBlock: this.lastProcessedBlock,
            remaining: this.blockQueue.length,
          },
        });
        await this.disburseToKeepers(blockNumber);
        this.lastProcessedBlock = blockNumber;
      }
    }
  }

  // TODO: Each keeper should have a .healthcheck call which in-essence does the same thing.
  //
  // The metric namespace can be further chunked by keeper type e.g. PerpsV2MainnetOvm/Liquidations/KeeperUpTime
  async healthcheck(): Promise<void> {
    const uptime = Date.now() - this.START_TIME;
    const balance = wei(await this.provider.getBalance(this.signer.address)).toNumber();
    this.logger.info('Performing keeper healthcheck', { args: { uptime, balance } });

    // A failure to submit metric should not cause application to halt. Instead, alerts will pick this up if it happens
    // for a long enough duration. Essentially, do _not_ force keeper to slowdown operation just to track metrics
    // for offline usage/monitoring.
    this.metrics.time(Metric.KEEPER_UPTIME, uptime);
    this.metrics.send(Metric.KEEPER_ETH_BALANCE, balance);
  }

  /* Listen on new blocks produced then subsequently bulk op. */
  async listen(): Promise<void> {
    try {
      await this.indexKeepers();
      await this.executeKeepers();

      const blockMod = this.runEveryXblock;
      const healthcheckMod = this.runHealthcheckEveryXBlock;

      this.logger.info('Begin listening for blocks 🚀...', { args: { blockMod, healthcheckMod } });
      this.provider.on('block', async (blockNumber: number) => {
        if (blockNumber % blockMod !== 0) {
          this.logger.debug('Skipping block', { args: { blockMod, blockNumber } });
          return;
        }
        if (!this.lastProcessedBlock) {
          // Don't process the first block we see.
          this.lastProcessedBlock = blockNumber;
          return;
        }
        if (blockNumber % healthcheckMod === 0) {
          await this.healthcheck();
        }

        this.blockQueue.push(blockNumber);
        this.logger.info('Storing new blockMod block...', {
          args: { blockQueueN: this.blockQueue.length, blockNumber },
        });
      });

      this.logger.info('Begin consuming blocks 🚀...', {
        args: { blockMod, healthcheckMod, waitTime: this.MAX_CONSUME_WAIT_TIME },
      });
      this.startProcessNewBlockConsumer();
    } catch (err) {
      this.logger.error(err);
      this.logger.error('Failed on listen or block consumption', {
        args: { waitTime: this.LISTEN_ERROR_WAIT_TIME },
      });
      this.metrics.count(Metric.KEEPER_ERROR);

      // Wait a minute and retry (may just be Node issues).
      await this.delay(this.LISTEN_ERROR_WAIT_TIME);
      await this.listen();
    }
  }
}

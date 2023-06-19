import { Contract, providers, Event, utils } from 'ethers';
import { Logger } from 'winston';
import { getEvents } from './keepers/helpers';
import { Keeper } from './keepers';
import { createLogger } from './logging';
import { PerpsEvent } from './typed';
import { Metric, Metrics } from './metrics';
import { uniq } from 'lodash';
import { delay } from './utils';
import { TokenSwap } from './swap';

export class Distributor {
  private readonly logger: Logger;
  private readonly keepers: Keeper[] = [];
  private lastProcessedBlock?: number;

  private readonly LISTEN_ERROR_WAIT_TIME = 15 * 1000; // 15s
  protected readonly START_TIME = Date.now();

  constructor(
    private readonly market: Contract,
    protected readonly baseAsset: string,
    private readonly provider: providers.BaseProvider,
    private readonly metrics: Metrics,
    private readonly tokenSwap: TokenSwap,
    private readonly distributorProcessInterval: number
  ) {
    this.logger = createLogger(`Distributor [${baseAsset}]`);
  }

  /* Given an array of keepers, track and include in bulk executions. */
  registerKeepers(keepers: Keeper[]) {
    keepers.forEach(keeper => this.keepers.push(keeper));
    this.logger.info('Registered keepers', { args: { n: this.keepers.length } });
  }

  private getEventsOfInterest(): PerpsEvent[] {
    return uniq(this.keepers.flatMap(k => k.EVENTS_OF_INTEREST));
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

  private async disburseToKeepers(toBlock: providers.Block): Promise<void> {
    const fromBlock = this.lastProcessedBlock ? this.lastProcessedBlock + 1 : toBlock.number;
    const blockDelta = toBlock.number - fromBlock;
    await this.metrics.gauge(Metric.DISTRIBUTOR_BLOCK_DELTA, blockDelta);

    const events = await getEvents(this.getEventsOfInterest(), this.market, {
      fromBlock,
      toBlock: toBlock.number,
      logger: this.logger,
    });
    const assetPrice = parseFloat(utils.formatUnits((await this.market.assetPrice()).price));

    this.logger.info('Distributing to keepers', {
      args: {
        keepers: this.keepers.length,
        fromBlock,
        toBlock: toBlock.number,
        blockDelta,
        events: events.length,
        assetPrice,
      },
    });

    await this.updateKeeperIndexes(events, toBlock, assetPrice);
  }

  // TODO: Each keeper should have a .healthcheck call which in-essence does the same thing.
  //
  // The metric namespace can be further chunked by keeper type e.g. PerpsV2MainnetOvm/Liquidations/KeeperUpTime
  async healthcheck(): Promise<void> {
    try {
      const uptime = Date.now() - this.START_TIME;
      this.logger.info('Performing keeper healthcheck', { args: { uptime } });

      // A failure to submit metric should not cause application to halt. Instead, alerts will pick this up if it happens
      // for a long enough duration. Essentially, do _not_ force keeper to slowdown operation just to track metrics
      // for offline usage/monitoring.
      await this.metrics.time(Metric.KEEPER_UPTIME, uptime);
    } catch (err) {
      // NOTE: We do _not_ rethrow because healthchecks aren't `await` wrapped.
      this.logger.error('Distributor healthcheck failed', err);
    }
  }

  /* Listen on new blocks produced then subsequently bulk op. */
  async listen(startBlock: providers.Block): Promise<void> {
    try {
      this.lastProcessedBlock = startBlock.number;
      await this.executeKeepers();

      this.logger.info('Begin processing blocks 🚀...', {
        args: { lastProcessedBlock: this.lastProcessedBlock },
      });
      while (true) {
        try {
          const startTime = Date.now();
          const toBlock = await this.provider.getBlock('latest');

          if (toBlock.number > this.lastProcessedBlock) {
            await this.disburseToKeepers(toBlock);
            this.lastProcessedBlock = toBlock.number;
          } else {
            this.logger.info('Latest block time is the same as previously processed', {
              args: { blockNumber: toBlock.number },
            });
          }

          await this.healthcheck();
          await this.executeKeepers();
          await this.tokenSwap.swap();

          await this.metrics.time(Metric.DISTRIBUTOR_BLOCK_PROCESS_TIME, Date.now() - startTime);
        } catch (err) {
          this.logger.error('Encountered error at distributor loop', { args: { err } });
        }
        await delay(this.distributorProcessInterval);
      }
    } catch (err) {
      this.logger.error(err);
      this.logger.error('Failed on listen or block consumption', {
        args: { waitTime: this.LISTEN_ERROR_WAIT_TIME },
      });
      await this.metrics.count(Metric.KEEPER_ERROR);

      // Wait a minute and retry (may just be Node issues).
      await delay(this.LISTEN_ERROR_WAIT_TIME);
      await this.listen(startBlock);
    }
  }
}

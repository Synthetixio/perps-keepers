import { Contract, providers, Event, utils, Wallet } from 'ethers';
import { Logger } from 'winston';
import { getEvents } from './keepers/helpers';
import { Keeper } from './keepers';
import { createLogger } from './logging';
import { PerpsEvent } from './typed';
import { Metric, Metrics } from './metrics';
import { wei } from '@synthetixio/wei';
import { uniq } from 'lodash';

export class Distributor {
  private readonly logger: Logger;
  private readonly keepers: Keeper[] = [];
  private lastProcessedBlock?: number;

  private readonly LISTEN_ERROR_WAIT_TIME = 60 * 1000; // 1min
  protected readonly START_TIME = Date.now();

  constructor(
    private readonly market: Contract,
    protected readonly baseAsset: string,
    private readonly provider: providers.BaseProvider,
    private readonly metrics: Metrics,
    private readonly signer: Wallet,
    private readonly fromBlock: number | string,
    private readonly distributorProcessInterval: number
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

  private getEventsOfInterest(): PerpsEvent[] {
    return uniq(this.keepers.flatMap(k => k.EVENTS_OF_INTEREST));
  }

  /* Perform RPC calls to fetch past event data once then pass to keepers for indexing. */
  private async indexKeepers(): Promise<number> {
    const toBlock = await this.provider.getBlockNumber();
    const events = await getEvents(this.getEventsOfInterest(), this.market, {
      fromBlock: this.fromBlock,
      toBlock,
      logger: this.logger,
    });

    this.logger.info('Rebuilding index...', {
      args: { fromBlock: this.fromBlock, toBlock, events: events.length },
    });
    await Promise.all(this.keepers.map(keeper => keeper.updateIndex(events)));

    return toBlock;
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
    this.metrics.gauge(Metric.DISTRIBUTOR_BLOCK_DELTA, blockDelta);

    const events = await getEvents(this.getEventsOfInterest(), this.market, {
      fromBlock,
      toBlock: toBlock.number,
      logger: this.logger,
    });
    const assetPrice = parseFloat(utils.formatUnits((await this.market.assetPrice()).price));

    this.logger.info('Distributing to keepers', {
      args: { fromBlock, toBlock: toBlock.number, blockDelta, events: events.length, assetPrice },
    });

    await this.updateKeeperIndexes(events, toBlock, assetPrice);
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
      this.lastProcessedBlock = await this.indexKeepers();
      await this.executeKeepers();

      this.logger.info('Begin processing blocks 🚀...', {
        args: { lastProcessedBlock: this.lastProcessedBlock },
      });
      while (1) {
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
          this.healthcheck();

          await this.executeKeepers();

          this.metrics.time(Metric.DISTRIBUTOR_BLOCK_PROCESS_TIME, Date.now() - startTime);
        } catch (err) {
          this.logger.error('Encountered error at distributor loop', { args: { err } });
        }
        await this.delay(this.distributorProcessInterval);
      }
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

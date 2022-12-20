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

  registerKeepers(keepers: Keeper[]) {
    keepers.forEach(keeper => this.keepers.push(keeper));
    this.logger.info(`Registered keepers (${this.keepers.length})`);
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

  private async disburseToKeepers(blockNumber: number): Promise<void> {
    const events = await getEvents(Object.values(PerpsEvent), this.market, {
      fromBlock: this.lastProcessedBlock ? this.lastProcessedBlock + 1 : blockNumber,
      toBlock: blockNumber,
      logger: this.logger,
    });
    const block = await this.provider.getBlock(blockNumber);
    const assetPrice = parseFloat(utils.formatUnits((await this.market.assetPrice()).price));

    await this.updateKeeperIndexes(events, block, assetPrice);
    await this.executeKeepers();
  }

  async startProcessNewBlockConsumer() {
    // The L2 node is constantly mining blocks, one block per transaction. When a new block is received, we queue it
    // for processing in a FIFO queue. `processNewBlock` will scan its events, rebuild the index, and then run any
    // keeper tasks that need running that aren't already active.
    while (1) {
      if (!this.blockQueue.length) {
        await this.delay(this.MAX_CONSUME_WAIT_TIME);
        continue;
      }

      // sort in case it's unsorted for some reason
      this.blockQueue.sort();
      const blockNumber = this.blockQueue.shift();
      if (blockNumber) {
        await this.disburseToKeepers(blockNumber);
        this.lastProcessedBlock = blockNumber;
      }
    }
  }

  async healthcheck(): Promise<void> {
    this.logger.info('Performing keeper healthcheck');
    await Promise.all([
      this.metrics.time(Metric.KEEPER_UPTIME, Date.now() - this.START_TIME),
      this.metrics.send(
        Metric.KEEPER_ETH_BALANCE,
        wei(await this.provider.getBalance(this.signer.address)).toNumber()
      ),
    ]);
  }

  async listen(): Promise<void> {
    try {
      await this.indexKeepers();
      await this.executeKeepers();

      this.logger.info(`Listening for events (modBlocks=${this.runEveryXblock})...`);

      this.provider.on('block', async (blockNumber: number) => {
        if (blockNumber % this.runEveryXblock !== 0) {
          return;
        }
        if (!this.lastProcessedBlock) {
          // Don't process the first block we see.
          this.lastProcessedBlock = blockNumber;
          return;
        }
        if (blockNumber % this.runHealthcheckEveryXBlock === 0) {
          await this.healthcheck();
        }

        this.blockQueue.push(blockNumber);
        await this.startProcessNewBlockConsumer();
      });
    } catch (err) {
      const delayWaitTime = 60 * 1000;

      this.logger.error(err);
      this.logger.error(
        `Error has occurred listening for blocks. Waiting ${delayWaitTime} before trying again`
      );

      // Wait a minute and retry (may just be Node issues).
      await this.delay(delayWaitTime);
      await this.listen();
    }
  }
}

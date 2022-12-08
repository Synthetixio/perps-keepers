import { Contract, providers, Event, utils } from 'ethers';
import { Logger } from 'winston';
import { getEvents } from './keeper-helpers';
import { Keeper } from './keepers';
import { createLogger } from './logging';
import { PerpsEvent } from './typed';

export class Distributor {
  private readonly logger: Logger;
  private readonly keepers: Keeper[] = [];
  private blockQueue: Array<number> = [];
  private lastProcessedBlock?: number;

  constructor(
    private readonly market: Contract,
    protected readonly baseAsset: string,
    private readonly provider: providers.BaseProvider,
    private readonly fromBlock: number | string,
    private readonly runEveryXblock: number
  ) {
    this.logger = createLogger(`Distributor [${baseAsset}]`);
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  registerKeeper(keepers: Keeper[]) {
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
  ): Promise<void> {
    await Promise.all(this.keepers.map(keeper => keeper.updateIndex(events, block, assetPrice)));
  }

  private async executeKeepers(): Promise<void> {
    await Promise.all(this.keepers.map(keeper => keeper.execute()));
  }

  private async dispatchKeepers(blockNumber: number): Promise<void> {
    const events = await getEvents(Object.values(PerpsEvent), this.market, {
      fromBlock: this.lastProcessedBlock ? this.lastProcessedBlock + 1 : blockNumber,
      toBlock: blockNumber,
    });
    const block = await this.provider.getBlock(blockNumber);
    const assetPrice = parseFloat(utils.formatUnits((await this.market.assetPrice()).price));

    this.logger.info(
      `New block (${blockNumber}); '${events.length}' event(s) to process ($${assetPrice})`
    );
    await this.updateKeeperIndexes(events, block, assetPrice);
    await this.executeKeepers();
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
        await this.dispatchKeepers(blockNumber);
        this.lastProcessedBlock = blockNumber;
      }
    }
  }

  async listen(): Promise<void> {
    try {
      await this.indexKeepers();
      await this.executeKeepers();

      this.logger.info('Listening for events...');

      this.provider.on('block', async (blockNumber: number) => {
        if (blockNumber % this.runEveryXblock !== 0) {
          return;
        }
        if (!this.lastProcessedBlock) {
          // Don't process the first block we see.
          this.lastProcessedBlock = blockNumber;
          return;
        }

        this.blockQueue.push(blockNumber);
        await this.startProcessNewBlockConsumer();
      });
    } catch (err) {
      this.logger.error(err);

      // Wait a minute and retry (may just be Node issues).
      await this.delay(60 * 1000);
      await this.listen();
    }
  }
}

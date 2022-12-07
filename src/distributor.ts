import { providers } from 'ethers';
import { Logger } from 'winston';
import { Keeper } from './keepers';
import { createLogger } from './logging';

export class Distributor {
  private readonly logger: Logger;
  private readonly keepers: Keeper[] = [];
  private blockQueue: Array<number> = [];
  private lastProcessedBlock?: number;

  constructor(
    private readonly provider: providers.BaseProvider,
    private readonly fromBlock: number | string,
    private readonly runEveryXblock: number
  ) {
    this.logger = createLogger({ componentName: 'Distributor' });
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  registerKeeper(keeper: Keeper) {
    this.keepers.push(keeper);
    this.logger.info(`Registered keeper '${keeper.constructor.name}' (${this.keepers.length})`);
  }

  private async indexKeepers(): Promise<void> {
    await Promise.all(this.keepers.map(keeper => keeper.index(this.fromBlock)));
  }

  private async executeKeepers(): Promise<void> {
    await Promise.all(this.keepers.map(keeper => keeper.execute()));
  }

  private async dispatchKeepers(blockNumber: number): Promise<void> {}

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
        // Get all keepers
        // Determine whether the keeper should be triggered
        // For each trigger to be triggers, call `updateIndex` with the event
        // Then trigger the keeper task. Repeat forever.

        await this.processNewBlock(blockNumber);
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

import { TransactionResponse } from '@ethersproject/providers';
import { Contract, Event, providers } from 'ethers';
import { Logger } from 'winston';
import { createLogger } from '../logging';
import { Metrics } from '../metrics';
import { SignerPool } from '../signerpool';
import { PerpsEvent } from '../typed';

export class Keeper {
  protected readonly logger: Logger;

  // Maximum number of transactions to execute in parallel per batch.
  protected readonly MAX_BATCH_SIZE = 4;

  // Wait time between batches to process the next.
  protected readonly BATCH_WAIT_TIME = 100;

  protected activeKeeperTasks: Record<string, boolean> = {};
  protected metricDimensions: Record<string, string> = {};

  readonly EVENTS_OF_INTEREST: PerpsEvent[] = [];

  constructor(
    protected readonly name: string,
    protected readonly market: Contract,
    protected readonly baseAsset: string,
    protected readonly signerPool: SignerPool,
    protected readonly provider: providers.BaseProvider,
    protected readonly metrics: Metrics,
    protected readonly network: string
  ) {
    this.metricDimensions.KeeperName = name;

    this.logger = createLogger(`${name} [${baseAsset}]`);
    this.logger.info(`Market deployed at '${market.address}'`);
  }

  /* In-place update the keeper's index based on block, event data and market asset price. */
  async updateIndex(events: Event[], block?: providers.Block, assetPrice?: number): Promise<void> {
    throw new Error('NotImplementedError');
  }

  /* Executes this keeper. It's up to the keeper to decide the context and how frequently to operate. */
  async execute(): Promise<void> {
    throw new Error('NotImplementedError');
  }

  protected async execAsyncKeeperCallback(id: string, cb: () => Promise<void>): Promise<void> {
    if (this.activeKeeperTasks[id]) {
      // Skip task as its already running.
      return;
    }

    this.activeKeeperTasks[id] = true;
    try {
      await cb();
    } catch (err) {
      this.logger.error(`Error (${id})\n${err}`);
      this.logger.error((err as Error).stack);
    }
    delete this.activeKeeperTasks[id];
  }

  protected async waitTx(tx: TransactionResponse): Promise<void> {
    const receipt = await tx.wait(1);
    const { blockNumber, status, transactionHash, gasUsed } = receipt;
    this.logger.info('Transaction completed!', {
      args: { tx: transactionHash, blockNumber, status, gasUsed },
    });
  }
}

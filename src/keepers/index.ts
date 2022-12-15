import { TransactionResponse } from '@ethersproject/providers';
import { Contract, Event, providers, Wallet } from 'ethers';
import { Logger } from 'winston';
import { createLogger } from '../logging';

export class Keeper {
  protected readonly logger: Logger;

  protected readonly MAX_BATCH_SIZE = 5;
  protected readonly BATCH_WAIT_TIME = 100;

  protected activeKeeperTasks: Record<string, boolean> = {};

  constructor(
    protected readonly name: string,
    protected readonly market: Contract,
    protected readonly baseAsset: string,
    protected readonly signer: Wallet,
    protected readonly provider: providers.BaseProvider,
    protected readonly network: string
  ) {
    this.logger = createLogger(`[${baseAsset}] ${name}`);
    this.logger.info(`Market deployed at '${market.address}'`);
  }

  async updateIndex(events: Event[], block?: providers.Block, assetPrice?: number): Promise<void> {
    new Error('NotImplementedError');
  }

  async index(fromBlock: number | string): Promise<void> {
    new Error('NotImplementedError');
  }

  async execute(): Promise<void> {
    new Error('NotImplementedError');
  }

  protected async execAsyncKeeperCallback(id: string, cb: () => Promise<void>): Promise<void> {
    if (this.activeKeeperTasks[id]) {
      // Skip task as its already running.
      return;
    }
    this.activeKeeperTasks[id] = true;

    try {
      this.logger.debug(`Keeper task running (${id})`);
      await cb();
    } catch (err) {
      this.logger.error(`Error (${id})\n${String(err)}`);
    }
    this.logger.debug(`Keeper task complete (${id})`);

    delete this.activeKeeperTasks[id];
  }

  protected async waitAndLogTx(tx: TransactionResponse): Promise<void> {
    const receipt = await tx.wait(1);
    const { blockNumber, status, transactionHash, gasUsed } = receipt;
    this.logger.info(
      `tx.wait(${transactionHash}) completed on block=${blockNumber} status=${status} gas=${gasUsed}`
    );
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

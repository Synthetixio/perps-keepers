import { Contract, Event, providers, Wallet } from 'ethers';
import { Logger } from 'winston';
import { createLogger } from '../logging';

export class Keeper {
  protected readonly logger: Logger;

  constructor(
    protected readonly market: Contract,
    protected readonly baseAsset: string,
    protected readonly signer: Wallet,
    protected readonly provider: providers.BaseProvider,
    protected readonly network: string
  ) {
    this.logger = createLogger(`[${baseAsset}] Keeper`);
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

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

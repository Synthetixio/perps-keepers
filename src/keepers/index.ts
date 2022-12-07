import { Contract, Event, providers, utils, Wallet } from 'ethers';
import { Logger } from 'winston';
import { createLogger } from '../logging';

export class Keeper {
  protected readonly logger: Logger;

  protected constructor(
    protected readonly market: Contract,
    protected readonly baseAsset: string,
    protected readonly signer: Wallet,
    protected readonly provider: providers.BaseProvider,
    protected readonly network: string
  ) {
    this.logger = createLogger({
      componentName: `PerpsV2Market [${baseAsset}]`,
    });
    this.logger.info(`Market deployed at '${market.address}'`);
  }

  static async create(
    market: Contract,
    signer: Wallet,
    network: string,
    provider: providers.BaseProvider
  ) {
    const baseAssetBytes32 = await market.baseAsset();
    const baseAsset = utils.parseBytes32String(baseAssetBytes32);
    return new Keeper(market, baseAsset, signer, provider, network);
  }

  getEventsOfInterest(): string[] {
    throw new Error('NotImplementedError');
  }

  async index(fromBlock: number | string): Promise<void> {
    new Error('NotImplementedError');
  }

  async execute(): Promise<void> {
    new Error('NotImplementedError');
  }

  async dispatch(events: Event[]): Promise<void> {
    new Error('NotImplementedError');
  }

  delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

import { providers } from 'ethers';
import { createLogger } from './logging';
import { Logger } from 'winston';
import { Metrics } from './metrics';

export class TokenSwap {
  private readonly logger: Logger;

  constructor(
    private readonly provider: providers.BaseProvider,
    private readonly metrics: Metrics
  ) {
    this.logger = createLogger(`TokenSwap`);
  }

  async swap(): Promise<void> {
    this.logger.info('Initiating swap');
    // Get the total amount of sUSD available in each signer.
    // Approve sUSD for swap if not yet approved
    // Perform swap
    // Done.
  }

  async listen(): Promise<void> {
    this.logger.info('Start TokenSwap.listen for swaps');
    // Perform a setInterval which calls `swap` on some interval.
  }
}

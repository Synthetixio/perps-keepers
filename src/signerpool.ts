import { Logger } from 'winston';
import { createLogger } from './logging';
import { NonceManager } from '@ethersproject/experimental';
import { delay } from './utils';

function isObjectOrErrorWithCode(x: unknown): x is { code: string } {
  if (typeof x !== 'object') return false;
  if (x === null) return false;
  return 'code' in x;
}

export interface WithSignerContext {
  asset: string;
  [key: string]: string | number;
}

export class SignerPool {
  private readonly ACQUIRE_SIGNER_DELAY = 10;

  private readonly signers: NonceManager[];
  private readonly pool: number[];
  private readonly logger: Logger;

  constructor(signers: NonceManager[]) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.logger = createLogger('SignerPool');
  }

  private async acquire(ctx: WithSignerContext): Promise<[number, NonceManager]> {
    this.logger.info(`[${ctx.asset}] Awaiting signer`);
    let i = this.pool.pop();

    while (i === undefined) {
      await delay(this.ACQUIRE_SIGNER_DELAY);
      i = this.pool.pop();
    }

    this.logger.info(
      `[${ctx.asset}] Acquired signer i=${i} n=${this.signers.length} idle=${this.pool.length}`
    );
    return [i, this.signers[i]];
  }

  private release(i: number, ctx: WithSignerContext) {
    this.logger.info(
      `[${ctx.asset}] Released signer i=${i} n=${this.signers.length} idle=${this.pool.length}`
    );
    this.pool.push(i);
  }

  async withSigner(
    cb: (signer: NonceManager) => Promise<void>,
    ctx: WithSignerContext
  ): Promise<void> {
    const [i, signer] = await this.acquire(ctx);

    try {
      await cb(signer);
    } catch (err) {
      if (isObjectOrErrorWithCode(err)) {
        // Special handeling for NONCE_EXPIRED
        if (err.code === 'NONCE_EXPIRED') {
          this.logger.error(err.toString());
          const nonce = signer.getTransactionCount('latest');
          this.logger.info(`[${ctx.asset}] Updating nonce for Nonce manager to nonce: '${nonce}'`);
          signer.setTransactionCount(nonce);
        }
      }
      throw err;
    } finally {
      this.release(i, ctx);
    }
  }
}

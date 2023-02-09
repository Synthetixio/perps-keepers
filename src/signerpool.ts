import { Logger } from 'winston';
import { createLogger } from './logging';
import { providers, Wallet } from 'ethers';
import { HDNode } from 'ethers/lib/utils';
import { NonceManager } from '@ethersproject/experimental';
import { delay } from './utils';
import { range } from 'lodash';

const _logger = createLogger('SignerPool');

function isObjectOrErrorWithCode(x: unknown): x is { code: string } {
  if (typeof x !== 'object') return false;
  if (x === null) return false;
  return 'code' in x;
}

export const createSigners = (
  mnemonic: string,
  provider: providers.BaseProvider,
  amount = 1
): NonceManager[] => {
  if (amount < 1) {
    throw new Error(`There must be at least one signer, '${amount}' found...`);
  }
  const masterNode = HDNode.fromMnemonic(mnemonic);
  return range(amount).map(i => {
    const wallet = new Wallet(masterNode.derivePath(`m/44'/60'/0'/0/${i}`).privateKey, provider);
    _logger.info(`Created signer ${i + 1}/${amount}`, { args: { address: wallet.address } });
    return new NonceManager(wallet).connect(provider);
  });
};

export interface WithSignerContext {
  asset: string;
  [key: string]: string | number;
}

export class SignerPool {
  private readonly ACQUIRE_SIGNER_DELAY = 100;

  private readonly signers: NonceManager[];
  private readonly pool: number[];
  private readonly logger: Logger;

  constructor(signers: NonceManager[], logger: Logger = _logger) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.logger = logger;

    this.logger.info(`Initialized pool s=${this.pool.join(',')}`);
  }

  private async acquire(ctx: WithSignerContext): Promise<[number, NonceManager]> {
    this.logger.info(`[${ctx.asset}] Awaiting signer...`);
    let i = this.pool.pop();

    while (i === undefined) {
      await delay(this.ACQUIRE_SIGNER_DELAY);
      i = this.pool.pop();
    }

    this.logger.info(`[${ctx.asset}] Acquired signer i=${i}, s=${this.pool.join(',')}`);
    return [i, this.signers[i]];
  }

  private release(i: number, ctx: WithSignerContext) {
    this.pool.push(i);
    this.logger.info(`[${ctx.asset}] Released signer i=${i}, s=${this.pool.join(',')}`);
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
        // Special handling for NONCE_EXPIRED
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

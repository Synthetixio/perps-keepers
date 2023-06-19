import { Logger } from 'winston';
import { createLogger } from './logging';
import { providers, Wallet } from 'ethers';
import { HDNode } from 'ethers/lib/utils';
import { NonceManager } from '@ethersproject/experimental';
import { wei } from '@synthetixio/wei';
import { delay } from './utils';
import { range } from 'lodash';
import { Metric, Metrics } from './metrics';

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

  private readonly pool: number[];
  private readonly logger: Logger;

  constructor(
    private readonly signers: NonceManager[],
    private readonly metrics: Metrics,
    logger: Logger = _logger
  ) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.logger = logger;

    this.logger.info('Initialized signer pool', { args: this.getLogArgs() });
  }

  getSigners(): NonceManager[] {
    return this.signers;
  }

  private getLogArgs(): Record<string, string | number> {
    return { pool: this.pool.join(','), n: this.pool.length };
  }

  private async acquire(ctx: WithSignerContext): Promise<[number, NonceManager]> {
    this.logger.info(`[${ctx.asset}] Awaiting signer...`, { args: this.getLogArgs() });
    let i = this.pool.shift();

    await this.metrics.gauge(Metric.SIGNER_POOL_SIZE, this.pool.length);
    while (i === undefined) {
      await delay(this.ACQUIRE_SIGNER_DELAY);
      i = this.pool.shift();
    }

    await this.metrics.gauge(Metric.SIGNER_POOL_SIZE, this.pool.length);
    this.logger.info(`[${ctx.asset}] Acquired signer @ index '${i}'`, { args: this.getLogArgs() });
    return [i, this.signers[i]];
  }

  private async release(i: number, ctx: WithSignerContext) {
    this.pool.push(i);
    await this.metrics.gauge(Metric.SIGNER_POOL_SIZE, this.pool.length);
    this.logger.info(`[${ctx.asset}] Released signer @ index '${i}'`, { args: this.getLogArgs() });
  }

  async withSigner(
    cb: (signer: NonceManager) => Promise<void>,
    ctx: WithSignerContext
  ): Promise<void> {
    const [i, signer] = await this.acquire(ctx);
    try {
      await cb(signer);
      const nonce = await signer.getTransactionCount('latest');
      signer.setTransactionCount(nonce);
    } catch (err) {
      if (isObjectOrErrorWithCode(err)) {
        // Special handling for NONCE_EXPIRED
        if (err.code === 'NONCE_EXPIRED') {
          this.logger.error(err.toString());
          const nonce = await signer.getTransactionCount('latest');
          this.logger.info(`[${ctx.asset}] Updating nonce for Nonce manager to nonce: '${nonce}'`);
          signer.setTransactionCount(nonce);
        }
      }
      throw err;
    } finally {
      await this.release(i, ctx);
    }
  }

  monitor(interval: number): NodeJS.Timer {
    const trackEthBalance = async () => {
      this.logger.info(`Performing signer monitor...`, { args: { interval } });
      for (const signer of this.signers) {
        const balance = wei(await signer.getBalance()).toNumber();
        const address = await signer.getAddress();
        this.logger.info(`Tracking ETH balance for signer...`, { args: { address, balance } });
        await this.metrics.gauge(Metric.KEEPER_SIGNER_ETH_BALANCE, balance);
      }
    };

    trackEthBalance();
    return setInterval(trackEthBalance, interval);
  }
}

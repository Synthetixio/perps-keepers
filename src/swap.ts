import { providers, BigNumber } from 'ethers';
import { createLogger } from './logging';
import { Logger } from 'winston';
import { SignerPool } from './signerpool';
import { Network } from './typed';
import { getSynthetixContractByName } from './utils';
import axios from 'axios';
import { NonceManager } from '@ethersproject/experimental';

export class TokenSwap {
  private readonly logger: Logger;

  private lastSwappedAt: number;
  private readonly oneInchApiBaseUrl: string;

  private readonly MAX_SWAP_SLIPPAGE = 1; // 1%
  private readonly ETH_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  constructor(
    private readonly autoSwapMinSusdAmount: number,
    private readonly autoSwapSusdInterval: number,
    private readonly autoSwapSusdEnabled: boolean,
    private readonly signerPool: SignerPool,
    private readonly provider: providers.BaseProvider,
    private readonly network: Network
  ) {
    const chainId = this.provider.network.chainId;
    this.oneInchApiBaseUrl = `https://api.1inch.io/v5.0/${chainId}`;

    this.lastSwappedAt = 0;
    this.logger = createLogger(`TokenSwap`);
  }

  private getRequestUrl(action: string, queryParams: any): string {
    return `${this.oneInchApiBaseUrl}${action}?${new URLSearchParams(queryParams).toString()}`;
  }

  private async approveSusdUsage(
    sUSDBalance: BigNumber,
    sUSDTokenAddress: string,
    signerAddress: string,
    signer: NonceManager
  ): Promise<void> {
    // Check if allownace is gte sUSD to swap.
    const allownaceRes = await axios({
      method: 'get',
      url: this.getRequestUrl('/approve/allowance', {
        tokenAddress: sUSDTokenAddress,
        walletAddress: signerAddress,
      }),
    });
    const allowance = BigNumber.from(allownaceRes.data.allowance);
    if (allowance.gte(sUSDBalance)) {
      this.logger.info('sUSD allowance approve not necessary', {
        args: {
          limit: allowance.toString(),
          signerAddress,
        },
      });
      return;
    }

    this.logger.info('Initiating sUSD token approval...', {
      args: { signerAddress },
    });

    // Build approval transaction using the 1inch API.
    const approveRes = await axios({
      method: 'get',
      url: this.getRequestUrl('/approve/transaction', { tokenAddress: sUSDTokenAddress }),
    });
    const { to, data, gasPrice } = approveRes.data;
    const rawTransaction = { to, data };

    // Estimate the gas to proceed with approval.
    const gas = await this.provider.estimateGas(rawTransaction);

    const rawApproveTransaction = {
      ...rawTransaction,
      gasPrice: BigNumber.from(gasPrice),
      gasLimit: gas,
    };

    // Sign and broadcast transaction.
    const tx = await signer.sendTransaction(rawApproveTransaction);
    await tx.wait();
    this.logger.info(`Successfully approved sUSD for trade`, {
      args: { tx: tx.hash, signerAddress },
    });
  }

  private async performSusdToEthSwap(
    sUSDBalance: BigNumber,
    sUSDTokenAddress: string,
    signerAddress: string,
    signer: NonceManager
  ): Promise<void> {
    if (sUSDBalance.lt(this.autoSwapMinSusdAmount.toString())) {
      this.logger.info('Not enough sUSD to swap', {
        args: { min: this.autoSwapMinSusdAmount, signerAddress },
      });
      return;
    }

    this.logger.info('Initiating sUSD<>ETH token swap...', {
      args: {
        signerAddress,
      },
    });

    // Build swap transaction using 1inch API.
    //
    // @see: https://docs.1inch.io/docs/aggregation-protocol/api/swap-params/
    const swapParams = {
      fromTokenAddress: sUSDTokenAddress,
      toTokenAddress: this.ETH_TOKEN_ADDRESS,
      amount: sUSDBalance.toString(),
      fromAddress: signerAddress,
      slippage: this.MAX_SWAP_SLIPPAGE,
      disableEstimate: false,
      allowPartialFill: false,
    };
    const swapRes = await axios({
      method: 'get',
      url: this.getRequestUrl('/swap', swapParams),
    });
    const { to, from, data, gasPrice } = swapRes.data.tx;

    const rawTransaction = {
      to,
      from,
      data,
      gasPrice: BigNumber.from(gasPrice),
    };

    // Estimate the gas to proceed with swap.
    const gas = await this.provider.estimateGas(rawTransaction);

    const rawSwapTransaction = {
      ...rawTransaction,
      gasPrice: BigNumber.from(gasPrice),
      gasLimit: gas,
    };

    const tx = await signer.sendTransaction(rawSwapTransaction);
    await tx.wait();
    this.logger.info('Successfully swapped sUSD<>ETH', {
      args: { tx: tx.hash, signerAddress },
    });
  }

  async swap(): Promise<void> {
    if (!this.autoSwapSusdEnabled || this.network === Network.OPT_GOERLI) {
      this.logger.debug('Swaps are disabled', {
        args: { enabled: this.autoSwapSusdEnabled, network: this.network },
      });
      return;
    }
    if (this.lastSwappedAt !== 0 && this.lastSwappedAt + this.autoSwapSusdInterval > Date.now()) {
      this.logger.debug('Not ready or enough sUSD for swap');
      return;
    }

    const sUSDContract = getSynthetixContractByName(
      'ProxyERC20sUSD',
      this.network,
      this.provider,
      'ProxyERC20'
    );

    try {
      for (const signer of this.signerPool.getSigners()) {
        const signerAddress = await signer.getAddress();
        const sUSDBalance = await sUSDContract.balanceOf(signerAddress);

        await this.approveSusdUsage(sUSDBalance, sUSDContract.address, signerAddress, signer);
        await this.performSusdToEthSwap(sUSDBalance, sUSDContract.address, signerAddress, signer);
      }

      this.lastSwappedAt = Date.now();
      this.logger.info('Swaps completed', { args: { ts: this.lastSwappedAt } });
    } catch (err) {
      this.logger.error(err);
      this.logger.error('Something went wrong swapping sUSD<>ETH. Retry later', {
        args: { lastSwappedAt: this.lastSwappedAt },
      });
    }
  }
}

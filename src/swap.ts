import { providers, BigNumber } from 'ethers';
import { createLogger } from './logging';
import { Logger } from 'winston';
import { Metrics } from './metrics';
import { SignerPool } from './signerpool';
import { Network } from './typed';
import { getSynthetixContractByName } from './utils';
import axios from 'axios';
import { NonceManager } from '@ethersproject/experimental';

export class TokenSwap {
  private readonly logger: Logger;

  private readonly oneInchBroadcastApiUrl: string;
  private readonly oneInchApiBaseUrl: string;

  private readonly ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  constructor(
    private readonly minSusdAmount: number,
    private readonly signerPool: SignerPool,
    private readonly provider: providers.BaseProvider,
    private readonly metrics: Metrics,
    private readonly network: Network
  ) {
    const chainId = this.provider.network.chainId;

    this.oneInchBroadcastApiUrl = `https://tx-gateway.1inch.io/v1.1/${chainId}/broadcast`;
    this.oneInchApiBaseUrl = `https://api.1inch.io/v5.0/${chainId}`;
    this.logger = createLogger(`TokenSwap`);
  }

  private getRequestUrl(action: string, queryParams: any): string {
    return `${this.oneInchApiBaseUrl}${action}?${new URLSearchParams(queryParams).toString()}`;
  }

  private async broadcastRawTransaction(
    rawTransaction: providers.TransactionRequest
  ): Promise<string> {
    const broadcastRes = await axios({
      method: 'post',
      url: this.oneInchBroadcastApiUrl,
      data: JSON.stringify(rawTransaction),
      headers: { 'Content-Type': 'application/json' },
    });
    return broadcastRes.data.transactionHash;
  }

  private async approveSusdUsage(
    sUSDBalance: BigNumber,
    tokenAddress: string,
    signerAddress: string,
    signer: NonceManager
  ): Promise<void> {
    // Check if allownace is gte sUSD to swap.
    const allownaceRes = await axios({
      method: 'get',
      url: this.getRequestUrl('/approve/allowance', { tokenAddress, walletAddress: signerAddress }),
    });
    const allowance = BigNumber.from(allownaceRes.data.allowance);
    if (allowance.gte(sUSDBalance)) {
      this.logger.info(`sUSD allowance approve not necessary Limit=${allowance.toString()}`);
      return;
    }

    this.logger.info('Initiating sUSD token approval');

    // Build approval transaction using the 1inch API.
    const approveRes = await axios({
      method: 'get',
      url: this.getRequestUrl('/approve/transaction', { tokenAddress }),
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
    await this.broadcastRawTransaction(rawApproveTransaction);
    this.logger.info(`Successfully approved sUSD for trade Tx='${tx.hash}'`);
  }

  async swap(): Promise<void> {
    this.logger.info('Initiating sUSD<>ETH swap');

    const sUSDContract = getSynthetixContractByName(
      'ProxyERC20sUSD',
      this.network,
      this.provider,
      'ProxyERC20'
    );

    const signer = this.signerPool.getSigners()[3];
    const signerAddress = await signer.getAddress();
    const sUSDBalance = await sUSDContract.balanceOf(signerAddress);

    await this.approveSusdUsage(sUSDBalance, sUSDContract.address, signerAddress, signer);

    // Get the total amount of sUSD available in each signer.
    // Approve sUSD for swap if not yet approved
    // Perform swap
    // Done.
  }

  async listen(interval: number): Promise<void> {
    this.logger.info('Start TokenSwap.listen for swaps');
    // Perform a setInterval which calls `swap` on some interval.
  }
}

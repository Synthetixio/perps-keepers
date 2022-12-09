import { Block } from '@ethersproject/abstract-provider';
import { BigNumber, Contract, ethers, Event, providers, utils, Wallet } from 'ethers';
import { Keeper } from '.';
import { getEvents } from './helpers';
import { DelayedOrder, PerpsEvent } from '../typed';
import { chunk } from 'lodash';
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js';

export class DelayedOffchainOrdersKeeper extends Keeper {
  // The index
  private orders: Record<string, DelayedOrder> = {};
  private pythConnection: EvmPriceServiceConnection;

  private readonly MAX_EXECUTION_ATTEMPTS = 50;

  private readonly EVENTS_OF_INTEREST: PerpsEvent[] = [
    PerpsEvent.DelayedOrderSubmitted,
    PerpsEvent.DelayedOrderRemoved,
  ];

  constructor(
    market: Contract,
    private readonly marketSettings: Contract,
    offchainEndpoint: string,
    private readonly offchainPriceFeedId: string,
    baseAsset: string,
    signer: Wallet,
    provider: providers.BaseProvider,
    network: string
  ) {
    super('DelayedOffchainOrdersKeeper', market, baseAsset, signer, provider, network);

    this.pythConnection = new EvmPriceServiceConnection(offchainEndpoint);
  }

  async updateIndex(events: Event[]): Promise<void> {
    if (!events.length) {
      return;
    }

    this.logger.info(`'${events.length}' event(s) available to index...`);
    const blockCache: Record<number, Block> = {};
    for (const evt of events) {
      const { event, args, blockNumber } = evt;

      // Event has no argument or is not an offchain event, ignore.
      if (!args || !args.isOffchain) {
        break;
      }

      switch (event) {
        case PerpsEvent.DelayedOrderSubmitted: {
          const { account, targetRoundId, executableAtTime } = args;
          this.logger.info(`New order submitted. Adding to index '${account}'`);

          // TODO: Remove this after we add `intentionTime` to DelayedOrderXXX events.
          if (!blockCache[blockNumber]) {
            blockCache[blockNumber] = await evt.getBlock();
          }
          const { timestamp } = blockCache[blockNumber];

          this.orders[account] = {
            targetRoundId: targetRoundId,
            executableAtTime: executableAtTime,
            account,
            intentionTime: timestamp,
            executionFailures: 0,
          };
          break;
        }
        case PerpsEvent.DelayedOrderRemoved: {
          const { account } = args;
          this.logger.info(`Order cancelled or executed. Removing from index '${account}'`);
          delete this.orders[account];
          break;
        }
        default:
          this.logger.debug(`No handler for event ${event} (${blockNumber})`);
      }
    }
  }

  async index(fromBlock: number | string): Promise<void> {
    this.orders = {};

    this.logger.info(`Rebuilding index from '${fromBlock}' to latest`);

    const toBlock = await this.provider.getBlockNumber();
    const events = await getEvents(this.EVENTS_OF_INTEREST, this.market, { fromBlock, toBlock });

    await this.updateIndex(events);
  }

  private async executeOrder(account: string): Promise<void> {
    if (this.orders[account].executionFailures > this.MAX_EXECUTION_ATTEMPTS) {
      this.logger.info(`Order execution exceeded max attempts '${account}'`);
      delete this.orders[account];
      return;
    }

    // Grab Pyth offchain data to sent with the executeOffchainDelayedOrder call.
    //
    // TODO: This could possibly called from the parent.
    const priceUpdateData = await this.pythConnection.getPriceFeedsUpdateData([
      this.offchainPriceFeedId,
    ]);

    try {
      this.logger.info(`Begin executeOffchainDelayedOrder(${account})`);
      const tx = await this.market.executeOffchainDelayedOrder(account, priceUpdateData);
      this.logger.info(`Submitted executeOffchainDelayedOrder(${account}) [nonce=${tx.nonce}]`);

      await this.waitAndLogTx(tx);
      delete this.orders[account];
    } catch (err) {
      this.orders[account].executionFailures += 1;
      throw err;
    }
  }

  private async getOffchainMinMaxAge(): Promise<{
    minAge: ethers.BigNumber;
    maxAge: ethers.BigNumber;
  }> {
    const bytes32BaseAsset = utils.formatBytes32String(this.baseAsset);

    const minAge = await this.marketSettings.offchainDelayedOrderMinAge(bytes32BaseAsset);
    const maxAge = await this.marketSettings.offchainDelayedOrderMaxAge(bytes32BaseAsset);

    return { minAge, maxAge };
  }

  async execute(): Promise<void> {
    const { minAge } = await this.getOffchainMinMaxAge();
    const block = await this.provider.getBlock(await this.provider.getBlockNumber());

    // Filter out orders that may be ready to execute.
    const executableOrders = Object.values(this.orders).filter(({ intentionTime }) =>
      BigNumber.from(block.timestamp)
        .sub(intentionTime)
        .gt(minAge)
    );

    // No orders. Move on.
    if (executableOrders.length === 0) {
      return;
    }

    // TODO: Convert into a generic batch execute method.
    this.logger.info(`Found '${executableOrders.length}' order(s) that can be executed`);

    for (const batch of chunk(executableOrders, this.MAX_BATCH_SIZE)) {
      this.logger.info(`Running keeper batch with '${batch.length}' orders(s) to keep`);
      const batches = batch.map(({ account }) =>
        this.execAsyncKeeperCallback(account, () => this.executeOrder(account))
      );
      await Promise.all(batches);
      await this.delay(this.BATCH_WAIT_TIME);
    }
  }
}

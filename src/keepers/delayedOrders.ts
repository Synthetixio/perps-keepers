import { Block } from '@ethersproject/abstract-provider';
import { BigNumber, Contract, Event, providers, utils, Wallet } from 'ethers';
import { Keeper } from '.';
import { getEvents } from './helpers';
import { DelayedOrder, PerpsEvent } from '../typed';

export class DelayedOrdersKeeper extends Keeper {
  // The index
  private orders: Record<string, DelayedOrder> = {};

  private readonly EVENTS_OF_INTEREST: PerpsEvent[] = [
    PerpsEvent.DelayedOrderSubmitted,
    PerpsEvent.DelayedOrderRemoved,
  ];

  constructor(
    market: Contract,
    private readonly exchangeRates: Contract,
    baseAsset: string,
    signer: Wallet,
    provider: providers.BaseProvider,
    network: string
  ) {
    super('DelayedOrdersKeeper', market, baseAsset, signer, provider, network);
  }

  async updateIndex(events: Event[]): Promise<void> {
    if (!events.length) {
      return;
    }

    this.logger.info(`'${events.length}' event(s) available to index. Performing index...`);

    const blockCache: Record<number, Block> = {};

    for (const evt of events) {
      const { event, args, blockNumber } = evt;
      if (!args) {
        return;
      }

      switch (event) {
        case PerpsEvent.DelayedOrderRemoved: {
          const { account } = args;
          this.logger.info(`Order cancelled or executed. Removing from index '${account}'`);
          delete this.orders[account];
          return;
        }
        case PerpsEvent.DelayedOrderSubmitted: {
          const { account, targetRoundId, executableAtTime } = args;
          this.logger.info(`New order submitted. Adding to index '${account}'`);

          // TODO: Remove this after we add `intentionTime` to DelayedOrderXXX events.
          if (!blockCache[blockNumber]) {
            blockCache[blockNumber] = await evt.getBlock();
          }
          const { timestamp } = blockCache[blockNumber];

          this.orders[account] = {
            targetRoundId: targetRoundId.toString(),
            executableAtTime: executableAtTime.toString(),
            account,
            intentionTime: timestamp,
            executionFailures: 0,
          };
          return;
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
    try {
      this.logger.info(`Begin executeDelayedOrder(${account})`);
      const tx = await this.market.connect(this.signer).executeDelayedOrder(account);
      this.logger.info(`Submit executeDelayedOrder() [nonce=${tx.nonce}]`);

      await this.waitAndLogTx(tx);
    } catch (err) {
      this.orders[account].executionFailures += 1;
      throw err;
    }
  }

  async execute(): Promise<void> {
    // Get the latest CL roundId
    const currentRoundId = await this.exchangeRates.getCurrentRoundId(
      utils.formatBytes32String(this.baseAsset)
    );

    const currentBlock = await this.provider.getBlock(await this.provider.getBlockNumber());

    // Filter out orders that may be ready to execute.
    const executableOrders = Object.values(this.orders).filter(
      ({ executableAtTime, targetRoundId }) => {
        return (
          currentRoundId.gte(targetRoundId) ||
          BigNumber.from(currentBlock.timestamp).gte(executableAtTime)
        );
      }
    );

    this.logger.info(`Found '${executableOrders.length}' order(s) that can be executed`);
    for (const order of executableOrders) {
      const { account } = order;
      await this.execAsyncKeeperCallback(account, () => this.executeOrder(account));
    }
  }
}

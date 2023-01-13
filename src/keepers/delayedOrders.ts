import { Block } from '@ethersproject/abstract-provider';
import { BigNumber, Contract, Event, providers, utils, Wallet } from 'ethers';
import { Keeper } from '.';
import { DelayedOrder, PerpsEvent } from '../typed';
import { chunk } from 'lodash';
import { Metric, Metrics } from '../metrics';

export class DelayedOrdersKeeper extends Keeper {
  // The index
  private orders: Record<string, DelayedOrder> = {};

  readonly EVENTS_OF_INTEREST: PerpsEvent[] = [
    PerpsEvent.DelayedOrderSubmitted,
    PerpsEvent.DelayedOrderRemoved,
  ];

  constructor(
    market: Contract,
    private readonly exchangeRates: Contract,
    baseAsset: string,
    signer: Wallet,
    provider: providers.BaseProvider,
    metrics: Metrics,
    network: string,
    private readonly maxExecAttempts: number
  ) {
    super('DelayedOrdersKeeper', market, baseAsset, signer, provider, metrics, network);
  }

  async updateIndex(events: Event[]): Promise<void> {
    if (!events.length) {
      return;
    }

    this.logger.info('Events available for index', { args: { n: events.length } });
    const blockCache: Record<number, Block> = {};
    for (const evt of events) {
      const { event, args, blockNumber } = evt;
      if (!args || args.isOffchain) {
        this.logger.debug('No args present or is off-chain, skipping', { args: { event } });
        continue;
      }

      const { account } = args;
      switch (event) {
        case PerpsEvent.DelayedOrderSubmitted: {
          const { targetRoundId, intentionTime, executableAtTime } = args;
          this.logger.info('New order submitted. Adding to index!', {
            args: { account, blockNumber },
          });

          // see: `delayedOffchainOrders`.
          let timestamp: number;
          if (!intentionTime) {
            if (!blockCache[blockNumber]) {
              blockCache[blockNumber] = await evt.getBlock();
            }
            timestamp = blockCache[blockNumber].timestamp;
          } else {
            timestamp = intentionTime.toNumber();
          }

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
          this.logger.info('Order cancelled or executed. Removing from index', {
            args: { account, blockNumber },
          });
          delete this.orders[account];
          break;
        }
        default:
          this.logger.debug('No handler found for event', {
            args: { event, account, blockNumber },
          });
      }
    }
  }

  private async executeOrder(account: string): Promise<void> {
    // Cases:
    //
    // (A) Invokes execute
    //  - The order is ready to be executed and the market allows for it
    // (B) Invokes execute and fails after n attempts and discards
    //  - We think the order is ready to be executed but on-chain, it is not
    //  - The order missed execution window. It must be cancelled
    //  - The order missed execution window. Cancellation is failing (e.g. paused)
    //  - We think the order can be executed/cancelled but the order does not exist

    const order = this.orders[account];

    if (!order) {
      this.logger.info('Account does not have any tracked orders', { args: { account } });
      return;
    }

    if (order.executionFailures > this.maxExecAttempts) {
      this.logger.info('Order execution exceeded max attempts', {
        args: { account, attempts: order.executionFailures },
      });
      delete this.orders[account];
      return;
    }

    // TODO: Remove DelayedOrders that cannot be executed (and only be cancelled).

    try {
      this.logger.info('Executing delayed order...', { args: { account } });
      const tx = await this.market.executeDelayedOrder(account);

      this.logger.info('Successfully submitted transaction, waiting for completion...', {
        args: { account, nonce: tx.nonce },
      });
      await this.waitAndLogTx(tx);
      delete this.orders[account];
    } catch (err) {
      order.executionFailures += 1;
      this.metrics.count(Metric.KEEPER_ERROR, this.metricDimensions);
      throw err;
    }
    this.metrics.count(Metric.DELAYED_ORDER_EXECUTED, this.metricDimensions);
  }

  async execute(): Promise<void> {
    try {
      // Get the latest CL roundId.
      const currentRoundId = await this.exchangeRates.getCurrentRoundId(
        utils.formatBytes32String(this.baseAsset)
      );

      const block = await this.provider.getBlock(await this.provider.getBlockNumber());

      // Filter out orders that may be ready to execute.
      const orders = Object.values(this.orders);
      const executableOrders = orders.filter(
        ({ executableAtTime, targetRoundId }) =>
          currentRoundId.gte(targetRoundId) || BigNumber.from(block.timestamp).gte(executableAtTime)
      );

      // No orders. Move on.
      if (executableOrders.length === 0) {
        this.logger.info('No delayed orders ready... skipping');
        return;
      }

      this.logger.info(
        `Found ${executableOrders.length}/${orders.length} order(s) that can be executed`
      );

      for (const batch of chunk(executableOrders, this.MAX_BATCH_SIZE)) {
        this.logger.info(`Running keeper batch with '${batch.length}' orders(s) to keep`);
        const batches = batch.map(({ account }) =>
          this.execAsyncKeeperCallback(account, () => this.executeOrder(account))
        );
        await Promise.all(batches);
        await this.delay(this.BATCH_WAIT_TIME);
      }
    } catch (err) {
      this.logger.error('Failed to execute delayed order', { args: { err } });
      this.logger.error((err as Error).stack);
    }
  }
}

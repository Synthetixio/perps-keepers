import { Block } from '@ethersproject/abstract-provider';
import { BigNumber, Contract, ethers, Event, providers, utils, Wallet } from 'ethers';
import { Keeper } from '.';
import { getEvents } from './helpers';
import { DelayedOrder, PerpsEvent } from '../typed';
import { chunk } from 'lodash';
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js';
import { Metric, Metrics } from '../metrics';

export class DelayedOffchainOrdersKeeper extends Keeper {
  // The index
  private orders: Record<string, DelayedOrder> = {};
  private pythConnection: EvmPriceServiceConnection;

  private readonly PYTH_MAX_TIMEOUT = 3000;
  private readonly PYTH_MAX_RETRIES = 5;

  private readonly EVENTS_OF_INTEREST: PerpsEvent[] = [
    PerpsEvent.DelayedOrderSubmitted,
    PerpsEvent.DelayedOrderRemoved,
  ];

  constructor(
    market: Contract,
    private readonly marketSettings: Contract,
    offchainEndpoint: string,
    private readonly offchainPriceFeedId: string,
    private readonly pythContract: Contract,
    private readonly marketKey: string,
    baseAsset: string,
    signer: Wallet,
    provider: providers.BaseProvider,
    metrics: Metrics,
    network: string,
    private readonly maxExecAttempts: number
  ) {
    super('DelayedOffchainOrdersKeeper', market, baseAsset, signer, provider, metrics, network);

    this.pythConnection = new EvmPriceServiceConnection(offchainEndpoint, {
      httpRetries: this.PYTH_MAX_RETRIES,
      timeout: this.PYTH_MAX_TIMEOUT,
    });
  }

  async updateIndex(events: Event[]): Promise<void> {
    if (!events.length) {
      return;
    }

    this.logger.info('Events available for index', { args: { n: events.length } });
    const blockCache: Record<number, Block> = {};
    for (const evt of events) {
      const { event, args, blockNumber } = evt;

      // Event has no argument or is not an offchain event, ignore.
      if (!args) {
        this.logger.debug('No args present in event, skipping', { args: { event } });
        continue;
      }

      const { account } = args;
      switch (event) {
        case PerpsEvent.DelayedOrderSubmitted: {
          const { targetRoundId, executableAtTime, intentionTime, isOffchain } = args;

          if (!isOffchain) {
            this.logger.debug('Order is not off-chain, skipping', {
              args: { account, blockNumber },
            });
            break;
          }

          this.logger.info('New order submitted. Adding to index!', {
            args: { account, blockNumber },
          });

          // Note `intentionTime` may not exist depending on the FROM_BLOCK (particularly on testnet).
          //
          // The `intentionTime` property is always just `block.timestamp` so if `intentionTime` exists
          // it will _always_ be the same as `evt.getBlock().timestamp`. Avoiding `getBlock` minimises
          // startup time as it avoids one HTTP call out to the RPC provider.
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

  async index(fromBlock: number | string): Promise<void> {
    this.orders = {};

    const toBlock = await this.provider.getBlockNumber();
    const events = await getEvents(this.EVENTS_OF_INTEREST, this.market, {
      fromBlock,
      toBlock,
      logger: this.logger,
    });

    this.logger.info('Rebuilding index...', {
      args: { fromBlock, toBlock, events: events.length },
    });
    await this.updateIndex(events);
  }

  private async executeOrder(
    account: string,
    isOrderStale: (order: DelayedOrder) => boolean
  ): Promise<void> {
    const order = this.orders[account];

    // NOTE: We pass `account` instead of `order` so that each sequential order execution can
    // check if said order still exists within `this.orders`. `delete a[b]` only removes the
    // value of key `b` from object `a`, the value (in this case order) still exists.
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

    if (isOrderStale(order)) {
      this.logger.info('Order is stale can only be cancelled', { args: { account } });
      delete this.orders[account];
      return;
    }

    try {
      this.logger.info('Fetching Pyth off-chain price data', {
        args: { feed: this.offchainPriceFeedId },
      });

      // Grab Pyth offchain data to send with the `executeOffchainDelayedOrder` call.
      const priceUpdateData = await this.pythConnection.getPriceFeedsUpdateData([
        this.offchainPriceFeedId,
      ]);
      const updateFee = await this.pythContract.getUpdateFee(priceUpdateData);

      this.logger.info('Executing off-chain order...', {
        args: { account, fee: updateFee.toString() },
      });
      const tx = await this.market.executeOffchainDelayedOrder(account, priceUpdateData, {
        value: updateFee,
      });
      this.logger.info('Successfully submitted execution transaction', {
        args: { account, nonce: tx.nonce },
      });
      await this.waitAndLogTx(tx);
      delete this.orders[account];
    } catch (err) {
      order.executionFailures += 1;
      this.metrics.count(Metric.KEEPER_ERROR);
      throw err;
    }
    this.metrics.count(Metric.OFFCHAIN_ORDER_EXECUTED);
  }

  private async getOffchainMinMaxAge(): Promise<{
    minAge: ethers.BigNumber;
    maxAge: ethers.BigNumber;
  }> {
    const bytes32BaseAsset = utils.formatBytes32String(this.marketKey);

    const minAge = await this.marketSettings.offchainDelayedOrderMinAge(bytes32BaseAsset);
    const maxAge = await this.marketSettings.offchainDelayedOrderMaxAge(bytes32BaseAsset);

    this.logger.info('Found off-chain order min/max age', {
      args: { minAge, maxAge, marketKey: this.marketKey },
    });
    return { minAge, maxAge };
  }

  async execute(): Promise<void> {
    try {
      const orders = Object.values(this.orders);

      if (orders.length === 0) {
        this.logger.info('No off-chain orders available... skipping');
        return;
      }

      const { minAge, maxAge } = await this.getOffchainMinMaxAge();
      const block = await this.provider.getBlock(await this.provider.getBlockNumber());

      // Filter out orders that may be ready to execute.
      const now = BigNumber.from(block.timestamp);
      const executableOrders = orders.filter(({ intentionTime }) =>
        now.sub(intentionTime).gt(minAge)
      );

      // No orders. Move on.
      if (executableOrders.length === 0) {
        this.logger.info('No off-chain orders ready... skipping');
        return;
      }

      const isOrderStale = (order: DelayedOrder): boolean =>
        now.gt(BigNumber.from(order.intentionTime).add(maxAge));

      this.logger.info(
        `Found ${executableOrders.length}/${orders.length} off-chain order(s) that can be executed`
      );
      for (const batch of chunk(executableOrders, this.MAX_BATCH_SIZE)) {
        this.logger.info('Running keeper batch orders', { args: { n: batch.length } });
        const batches = batch.map(({ account }) =>
          this.execAsyncKeeperCallback(account, () => this.executeOrder(account, isOrderStale))
        );
        await Promise.all(batches);
        this.logger.info(`Processed processed with '${batch.length}' orders(s) to kept`);
        await this.delay(this.BATCH_WAIT_TIME);
      }
    } catch (err) {
      this.logger.error('Failed to execute off-chain order', { args: { err } });
    }
  }
}

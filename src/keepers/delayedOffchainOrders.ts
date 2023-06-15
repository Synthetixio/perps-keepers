import { Block } from '@ethersproject/abstract-provider';
import { BigNumber, Contract, ethers, Event, providers, utils } from 'ethers';
import { Keeper } from '.';
import { DelayedOrder, PerpsEvent } from '../typed';
import { chunk } from 'lodash';
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js';
import { Metric, Metrics } from '../metrics';
import { delay } from '../utils';
import { SignerPool } from '../signerpool';
import { wei } from '@synthetixio/wei';

export class DelayedOffchainOrdersKeeper extends Keeper {
  // The index
  private orders: Record<string, DelayedOrder> = {};
  private pythConnection: EvmPriceServiceConnection;

  // An additional buffer added to minAge to avoid calling too early.
  //
  // Note: Since we don't use block.timestamp but rather Date.now, timestamps on-chain
  // may not be up to date as a result, executing a tiny bit too early (as seconds).
  private readonly MIN_AGE_BUFFER = 10;

  // An additional buffer added to maxAge to determine if an order is stale.
  private readonly MAX_AGE_BUFFER = 60 * 5; // 5mins (in seconds).

  private readonly PYTH_MAX_TIMEOUT = 3000;
  private readonly PYTH_MAX_RETRIES = 5;

  readonly EVENTS_OF_INTEREST: PerpsEvent[] = [
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
    signerPool: SignerPool,
    provider: providers.BaseProvider,
    metrics: Metrics,
    network: string,
    private readonly maxExecAttempts: number
  ) {
    super('DelayedOffchainOrdersKeeper', market, baseAsset, signerPool, provider, metrics, network);

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
          const { executableAtTime, intentionTime, isOffchain } = args;

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
            try {
              if (!blockCache[blockNumber]) {
                blockCache[blockNumber] = await evt.getBlock();
              }
              timestamp = blockCache[blockNumber].timestamp;
            } catch (err) {
              this.logger.error(`Fetching block for evt failed '${evt.blockNumber}'`, err);
              timestamp = 0;
            }
          } else {
            timestamp = intentionTime.toNumber();
          }

          this.orders[account] = {
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

  hydrateIndex(orders: DelayedOrder[]) {
    this.logger.debug('hydrating orders index from data on-chain', {
      args: {
        n: orders.length,
      },
    });

    const prevOrdersLength = Object.keys(this.orders).length;
    const newOrders: Record<string, DelayedOrder> = {};

    for (const order of orders) {
      // ...order first because we want to override any default settings with existing values so that
      // they can be persisted between hydration (e.g. status).
      newOrders[order.account] = { ...order, ...this.orders[order.account] };
    }
    this.orders = newOrders;
    const currOrdersLength = Object.keys(this.orders).length;

    if (prevOrdersLength !== currOrdersLength) {
      this.logger.info('Orders change detected', {
        args: {
          delta: currOrdersLength - prevOrdersLength,
          n: currOrdersLength,
        },
      });
    }
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

    if (order.executionFailures >= this.maxExecAttempts) {
      this.logger.info('Order execution exceeded max attempts', {
        args: { account, attempts: order.executionFailures },
      });
      delete this.orders[account];
      return;
    }

    if (isOrderStale(order)) {
      this.logger.warn('Order might be stale can only be cancelled', { args: { account } });
      delete this.orders[account];
      return;
    }

    try {
      await this.signerPool.withSigner(
        async signer => {
          this.logger.info('Fetching Pyth off-chain price data', {
            args: { feed: this.offchainPriceFeedId, account },
          });

          // Grab Pyth offchain data to send with the `executeOffchainDelayedOrder` call.
          const priceUpdateData = await this.pythConnection.getPriceFeedsUpdateData([
            this.offchainPriceFeedId,
          ]);
          const updateFee = await this.pythContract.getUpdateFee(priceUpdateData);

          // Perform one last check on-chain to see if order actually exists.
          //
          // Do this right before execution to minimise actions that could occur before this check
          // and execution.
          const order = await this.market.delayedOrders(account);
          if (order.sizeDelta.eq(0)) {
            this.logger.info('Order does not exist, avoiding execution', { args: { account } });
            delete this.orders[account];
            await this.metrics.count(Metric.DELAYED_ORDER_ALREADY_EXECUTED, this.metricDimensions);
            return;
          } else {
            this.logger.info('Order found on-chain. Continuing...', { args: { account } });
          }

          this.logger.info('Executing off-chain order...', {
            args: { account, fee: updateFee.toString() },
          });

          const market = this.market.connect(signer);
          const gasEstimation = await market.estimateGas.executeOffchainDelayedOrder(
            account,
            priceUpdateData,
            {
              value: updateFee,
            }
          );
          const gasLimit = wei(gasEstimation)
            .mul(1.2)
            .toBN();

          this.logger.info('Estimated gas with upped limits', {
            args: { account, estimation: gasEstimation.toString(), limit: gasLimit.toString() },
          });
          const tx = await market.executeOffchainDelayedOrder(account, priceUpdateData, {
            value: updateFee,
            gasLimit,
          });
          this.logger.info('Submitted transaction, waiting for completion...', {
            args: { account, nonce: tx.nonce },
          });
          await this.waitTx(tx);
          delete this.orders[account];
        },
        { asset: this.baseAsset }
      );
      await this.metrics.count(Metric.OFFCHAIN_ORDER_EXECUTED, this.metricDimensions);
    } catch (err) {
      order.executionFailures += 1;
      await this.metrics.count(Metric.KEEPER_ERROR, this.metricDimensions);
      this.logger.error('Off-chain order execution failed', {
        args: { executionFailures: order.executionFailures, account: order.account, err },
      });
      this.logger.error((err as Error).stack);
    }
  }

  private async getOffchainMinMaxAge(): Promise<{
    minAge: ethers.BigNumber;
    maxAge: ethers.BigNumber;
  }> {
    const bytes32BaseAsset = utils.formatBytes32String(this.marketKey);

    this.logger.debug('Fetching min/max ages', { args: { marketKey: this.marketKey } });
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

      // Filter out orders that may be ready to execute.
      //
      // Use `Date.now` rather than fetching the latest block. Sometimes it could fail and we
      // get `block.timestamp == undefined`. Instead, try execute anyway in the event timestamp
      // is updated on the next block.
      const now = BigNumber.from(Math.round(Date.now() / 1000));
      const executableOrders = orders.filter(({ intentionTime }) =>
        now.sub(intentionTime).gt(minAge.add(this.MIN_AGE_BUFFER))
      );

      // No orders. Move on.
      if (executableOrders.length === 0) {
        this.logger.info('No off-chain orders ready... skipping', {
          args: { pendingOrders: orders.length },
        });
        return;
      }

      const isOrderStale = (order: DelayedOrder): boolean =>
        now.gt(
          BigNumber.from(order.intentionTime)
            .add(maxAge)
            .add(this.MAX_AGE_BUFFER)
        );

      this.logger.info(
        `Found ${executableOrders.length}/${orders.length} off-chain order(s) that can be executed`,
        { args: { ts: now } }
      );
      for (const batch of chunk(executableOrders, this.MAX_BATCH_SIZE)) {
        this.logger.info('Running keeper batch orders', { args: { n: batch.length } });
        const batches = batch.map(({ account }) =>
          this.execAsyncKeeperCallback(account, () => this.executeOrder(account, isOrderStale))
        );
        await Promise.all(batches);
        this.logger.info(`Processed processed with '${batch.length}' orders(s) to kept`);
        await delay(this.BATCH_WAIT_TIME);
      }
    } catch (err) {
      this.logger.error('Failed to execute off-chain order', { args: { err } });
      this.logger.error((err as Error).stack);
    }
  }
}

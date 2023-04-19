import {
  CloudWatchClient,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { camelCase, upperFirst } from 'lodash';
import winston from 'winston';
import { KeeperConfig } from './config';
import { createLogger } from './logging';
import { Network } from './typed';

export enum Metric {
  // How long this keeper has been up and executing.
  KEEPER_UPTIME = 'KeeperUpTime',

  // Amount of ETH in the keeper address.
  KEEPER_SIGNER_ETH_BALANCE = 'KeeperSignerEthBalance',

  // A metric sent upon startup (useful to track freq of crash & restarts).
  KEEPER_STARTUP = 'KeeperStartUp',

  // When any error (liquidation or order execution) occurs.
  KEEPER_ERROR = 'KeeperError',

  // TODO: Consider tracking open promises

  // Number of blocks since the last time the distributor has index/processed blocks.
  DISTRIBUTOR_BLOCK_DELTA = 'DistributorBlockDelta',

  // Time in ms it takes to process blocks per iteration at the distributor.
  DISTRIBUTOR_BLOCK_PROCESS_TIME = 'DistributorBlockProcessTime',

  // Delayed order executed successfully.
  DELAYED_ORDER_EXECUTED = 'DelayedOrderExecuted',

  // Delayed order executed mid-processing (includes off/on chain).
  DELAYED_ORDER_ALREADY_EXECUTED = 'DelayedOrderAlreadyExecuted',

  // Offchain order executed successfully.
  OFFCHAIN_ORDER_EXECUTED = 'OffchainOrderExecuted',

  // Open position liquidated successfully.
  POSITION_LIQUIDATED = 'PositionLiquidated',

  // Number of available signers in the signer pool (0 means transactions cannot be executed).
  SIGNER_POOL_SIZE = 'SignerPoolSize',

  // TODO: Add metrics for time taken per keeper type.
}

export class Metrics {
  private readonly BASE_NAMESPACE = 'PerpsV2Keeper/';
  private readonly DEFAULT_RESOLUTION = 60; // 60s

  private readonly namespace: string;

  private constructor(
    readonly isEnabled: boolean,
    network: Network,
    private readonly logger: winston.Logger,
    private readonly cwClient?: CloudWatchClient
  ) {
    // e.g. `mainnet-ovm` = PerpsV2Keeper/MainnetOvm
    this.namespace = `${this.BASE_NAMESPACE}${upperFirst(camelCase(network))}`;
  }

  static create(isEnabled: boolean, network: Network, awsConfig: KeeperConfig['aws']): Metrics {
    const logger = createLogger('Metrics');

    logger.info('Initialising metrics', { args: { enabled: isEnabled } });

    const { accessKeyId, secretAccessKey, region } = awsConfig;
    if (!isEnabled || !accessKeyId || !secretAccessKey || !region) {
      return new Metrics(isEnabled, network, logger);
    }
    return new Metrics(
      isEnabled,
      network,
      logger,
      new CloudWatchClient({
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        region,
      })
    );
  }

  /* A simple abstracted 'putMetric' call to push gauge/count style metrics to CW. */
  async send(
    name: Metric,
    value: number,
    unit: StandardUnit = StandardUnit.None,
    dimensions?: Record<string, string>
  ): Promise<void> {
    if (!this.cwClient || !this.isEnabled) {
      this.logger.debug('Send no-op due to missing CW client', {
        args: { enabled: this.isEnabled, namespace: this.namespace },
      });
      return;
    }

    try {
      // Construct the MetricData.
      //
      // @see: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-cloudwatch/interfaces/putmetricdatacommandinput.html
      const input: PutMetricDataCommandInput = {
        MetricData: [
          {
            MetricName: name,
            Dimensions: Object.entries(dimensions ?? {}).map(([Name, Value]) => ({ Name, Value })),
            Value: value,
            StorageResolution: this.DEFAULT_RESOLUTION,
            Unit: unit,
          },
        ],
        Namespace: this.namespace,
      };
      const command = new PutMetricDataCommand(input);
      await this.cwClient.send(command);
    } catch (err) {
      // no-op the metric failure. Monitoring should not impact the normal behaviour of the application.
      this.logger.error('Failed to send metrics to CW', { args: { err } });
    }
  }

  /* Adds 1 to the `name` metric. Also commonly known as `increment`. */
  async count(name: Metric, dimensions?: Record<string, string>): Promise<void> {
    return this.send(name, 1, StandardUnit.Count, dimensions);
  }

  /* Adds `value` as a gauge metric. */
  async gauge(name: Metric, value: number, dimensions?: Record<string, string>): Promise<void> {
    return this.send(name, value, StandardUnit.Count, dimensions);
  }

  /* `endTime - startTime` assumed to be ms (* 1000 if not). */
  async time(name: Metric, value: number, dimensions?: Record<string, string>): Promise<void> {
    return this.send(name, value, StandardUnit.Milliseconds, dimensions);
  }
}

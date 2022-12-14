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

  // A metric sent upon startup (useful to track freq of crash & restarts).
  KEEPER_STARTUP = 'KeeperStartUp',

  // Amount of ETH in the keeper address.
  KEEPER_ETH_BALANCE = 'KeeperEthBalance',

  // When any error (liquidation or order execution) occurs.
  KEEPER_ERROR = 'KeeperError',

  // TODO: Consider tracking open promises

  // Length of the FIFO queue for processing received blocks.
  DISTRIBUTOR_QUEUE_SIZE = 'DistributorQueueSize',

  // Delayed order executed successfully.
  DELAYED_ORDER_EXECUTED = 'DelayedOrderExecuted',

  // Offchain order executed successfully.
  OFFCHAIN_ORDER_EXECUTED = 'OffchainOrderExecuted',

  // Open position liquidated successfully.
  POSITION_LIQUIDATED = 'PositionLiquidated',
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
  async send(name: Metric, value: number, unit: StandardUnit = StandardUnit.None): Promise<void> {
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
  async count(name: Metric): Promise<void> {
    return this.send(name, 1, StandardUnit.Count);
  }

  /* Adds `value` as a gauge metric. */
  async gauge(name: Metric, value: number): Promise<void> {
    return this.send(name, value, StandardUnit.Count);
  }

  /* `endTime - startTime` assumed to be ms (* 1000 if not). */
  async time(name: Metric, value: number): Promise<void> {
    return this.send(name, value, StandardUnit.Milliseconds);
  }
}

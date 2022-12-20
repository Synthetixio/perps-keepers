import {
  CloudWatchClient,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
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
  KEEPER_ETH_BALANCE = 'KeeperEthBalance',

  // When any error (liquidation or order execution) occurs.
  KEEPER_EXECUTION_ERROR = 'KeeperError',

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

    logger.info(`Initialising metrics with enabled=${isEnabled}...`);

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
  async send(name: Metric, value: number): Promise<void> {
    if (!this.cwClient || !this.isEnabled) {
      this.logger.debug(
        `NOOP. Missing CW client (isEnabled: ${this.isEnabled}, ${this.namespace})`
      );
      return;
    }

    // Construct the MetricData.
    //
    // @see: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-cloudwatch/interfaces/putmetricdatacommandinput.html
    const input: PutMetricDataCommandInput = {
      MetricData: [{ MetricName: name, Value: value, StorageResolution: this.DEFAULT_RESOLUTION }],
      Namespace: this.namespace,
    };
    const command = new PutMetricDataCommand(input);
    await this.cwClient.send(command);
  }

  /* Adds 1 to the `name` metric. Also commonly known as `increment`. */
  async count(name: Metric): Promise<void> {
    return this.send(name, 1);
  }
}

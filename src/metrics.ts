import {
  CloudWatchClient,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
} from '@aws-sdk/client-cloudwatch';
import { KeeperConfig } from './config';

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
  private readonly NAMESPACE = 'PERPSV2KEEPER/';

  private constructor(readonly isEnabled: boolean, private readonly cwClient?: CloudWatchClient) {}

  static create(isEnabled: boolean, awsConfig: KeeperConfig['aws']): Metrics {
    const { accessKeyId, secretAccessKey, region } = awsConfig;
    if (!isEnabled || !accessKeyId || !secretAccessKey || !region) {
      return new Metrics(isEnabled);
    }
    return new Metrics(
      isEnabled,
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
  async send(name: string, value: number): Promise<void> {
    if (!this.cwClient || !this.isEnabled) {
      return;
    }

    // Construct the MetricData.
    //
    // @see: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-cloudwatch/interfaces/putmetricdatacommandinput.html
    const input: PutMetricDataCommandInput = {
      MetricData: [{ MetricName: name, Value: value, StorageResolution: 60 }],
      Namespace: this.NAMESPACE,
    };
    const command = new PutMetricDataCommand(input);
    await this.cwClient.send(command);
  }
}

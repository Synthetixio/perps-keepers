import { ethers } from 'ethers';

export enum KeeperType {
  OffchainOrder = 'OffchainOrder',
  Liquidator = 'Liquidator',
}

export enum PerpsEvent {
  PositionModified = 'PositionModified',
  PositionLiquidated = 'PositionLiquidated',
  FundingRecomputed = 'FundingRecomputed',
  DelayedOrderSubmitted = 'DelayedOrderSubmitted',
  DelayedOrderRemoved = 'DelayedOrderRemoved',
  PositionFlagged = 'PositionFlagged',
}

export interface Position {
  id: string;
  account: string;
  size: number;
  leverage: number;
  liqPrice: number;
  liqPriceUpdatedTimestamp: number;
}

export interface DelayedOrder {
  account: string;
  executableAtTime: ethers.BigNumber;
  intentionTime: number; // Timestamp of block at which this event was triggered (submission ts).
  executionFailures: number; // Number of times this has failed to execute
}

export enum Network {
  OPT = 'optimism',
  OPT_GOERLI = 'optimism-goerli',
}

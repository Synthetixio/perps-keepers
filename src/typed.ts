export enum PerpsEvent {
  PositionModified = 'PositionModified',
  PositionLiquidated = 'PositionLiquidated',
  FundingRecomputed = 'FundingRecomputed',
  DelayedOrderSubmitted = 'DelayedOrderSubmitted',
  DelayedOrderRemoved = 'DelayedOrderRemoved',
}

export interface Position {
  id: string;
  event: string;
  account: string;
  size: number;
  leverage: number;
  liqPrice: number;
  liqPriceUpdatedTimestamp: number;
}

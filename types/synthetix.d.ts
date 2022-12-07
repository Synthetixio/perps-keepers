declare module 'synthetix' {
  function getFuturesMarkets({
    network: string,
    useOvm: boolean,
  }): {
    marketKey: string;
    asset: string;
    takerFee: string;
    makerFee: string;
    takerFeeNextPrice: string;
    makerFeeNextPrice: string;
    nextPriceConfirmWindow: string;
    maxLeverage: string;
    maxMarketValueUSD: string;
    maxFundingRate: string;
    skewScaleUSD: string;
  }[];
}

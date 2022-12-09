import { Contract, providers, Signer } from 'ethers';
import synthetix from 'synthetix';
import FuturesMarketManagerJson from '../contracts/FuturesMarketManager.json';
import PerpsV2MarketConsolidatedJson from '../contracts/PerpsV2MarketConsolidated.json';
import { Network } from './config';

interface KeeperContracts {
  exchangeRates: Contract;
  marketManager: Contract;
  marketSettings: Contract;
  markets: Record<string, Contract>;
}

export const getSynthetixPerpsContracts = async (
  network: Network,
  signer: Signer,
  provider: providers.BaseProvider
): Promise<KeeperContracts> => {
  // TODO: Use the Synthetix npm package to derive the ABI and address once merged and released.
  const futuresMarketManagerAddress = {
    [Network.GOERLI_OVM]: '0xC8440d8e46D3C06beD106C6f2F918F30182bEb06',
    [Network.MAINNET_OVM]: '',
  }[network];
  const marketManager = new Contract(
    futuresMarketManagerAddress,
    FuturesMarketManagerJson.abi,
    provider
  );

  const marketSummaries = await marketManager.allMarketSummaries();
  const markets = marketSummaries.reduce(
    (
      acc: Record<string, Contract>,
      { proxied, market, marketKey }: { proxied: boolean; market: string; marketKey: string }
    ) => {
      if (proxied) {
        acc[marketKey] = new Contract(market, PerpsV2MarketConsolidatedJson.abi, signer);
      }
      return acc;
    },
    {}
  );
  const exchangeRatesAddress = synthetix.getTarget({ network, contract: 'ExchangeRates' }).address;
  const exchangeRateAbi = synthetix.getSource({ network, contract: 'ExchangeRates' }).abi;
  const exchangeRates = new Contract(exchangeRatesAddress, exchangeRateAbi, provider);

  const marketSettingsAddress = synthetix.getTarget({ network, contract: 'PerpsV2MarketSettings' })
    .address;
  const marketSettingsAbi = synthetix.getSource({ network, contract: 'PerpsV2MarketSettings' }).abi;
  const marketSettings = new Contract(marketSettingsAddress, marketSettingsAbi, provider);

  return { exchangeRates, marketManager, marketSettings, markets };
};

// Pyth (off-chain).

// @see: https://github.com/pyth-network/pyth-js/tree/main/pyth-evm-js
const PYTH_NETWORK_ENDPOINTS: Record<Network, string> = {
  [Network.GOERLI_OVM]: 'https://xc-testnet.pyth.network',
  [Network.MAINNET_OVM]: 'https://xc-mainnet.pyth.network',
};

const PYTH_PRICE_FEED_IDS: Record<Network, Record<string, string>> = {
  // @see: https://pyth.network/developers/price-feed-ids#pyth-evm-testnet
  [Network.GOERLI_OVM]: {
    sETH: '0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6',
  },
  // @see: https://pyth.network/developers/price-feed-ids#pyth-evm-mainnet
  [Network.MAINNET_OVM]: {
    sETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  },
};

export const getPythDetails = (
  network: Network
): { priceFeedIds: Record<string, string>; endpoint: string } => ({
  endpoint: PYTH_NETWORK_ENDPOINTS[network],
  priceFeedIds: PYTH_PRICE_FEED_IDS[network],
});

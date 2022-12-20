import { Contract, providers, Signer } from 'ethers';
import synthetix from 'synthetix';
import FuturesMarketManagerJson from '../contracts/FuturesMarketManager.json';
import PerpsV2MarketConsolidatedJson from '../contracts/PerpsV2MarketConsolidated.json';
import PythAbi from '../contracts/Pyth.json';
import { Network } from './typed';

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
    [Network.GOERLI_OVM]: '0x1306e1F0eFdc84EDBE665cD9B5146C535B5B382A',
    [Network.MAINNET_OVM]: '0xdb89f3fc45A707Dd49781495f77f8ae69bF5cA6e',
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

// @see: https://docs.pyth.network/consume-data/evm
const PYTH_CONTRACT_ADDRESSES: Record<Network, string> = {
  [Network.GOERLI_OVM]: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  [Network.MAINNET_OVM]: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
};

export const getPythDetails = (
  network: Network,
  provider: providers.BaseProvider
): { priceFeedIds: Record<string, string>; endpoint: string; pyth: Contract } => ({
  endpoint: PYTH_NETWORK_ENDPOINTS[network],
  priceFeedIds: PYTH_PRICE_FEED_IDS[network],
  pyth: new Contract(PYTH_CONTRACT_ADDRESSES[network], PythAbi, provider),
});

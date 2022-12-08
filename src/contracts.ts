import { Contract, providers, Signer } from 'ethers';
import synthetix from 'synthetix';
import FuturesMarketManagerJson from '../contracts/FuturesMarketManager.json';
import PerpsV2MarketConsolidatedJson from '../contracts/PerpsV2MarketConsolidated.json';
import { KeeperSupportedNetwork } from './config';

// TODO: Use the Synthetix npm package to derive the ABI and address once merged and released.
const FUTURES_MARKET_MANAGER_ADDRESS_GOERLI_OVM = '0xC8440d8e46D3C06beD106C6f2F918F30182bEb06';
const FUTURES_MARKET_MANAGER_ADDRESS_MAINNET_OVM = '';

const getFuturesMarketManagerAddress = (network: string): string => {
  switch (network) {
    case KeeperSupportedNetwork.GOERLI_OVM:
      return FUTURES_MARKET_MANAGER_ADDRESS_GOERLI_OVM;
    case KeeperSupportedNetwork.MAINNET_OVM:
      return FUTURES_MARKET_MANAGER_ADDRESS_MAINNET_OVM;
    default:
      throw new Error(`Unsupported network '${network}'`);
  }
};

interface KeeperContracts {
  exchangeRates: Contract;
  marketManager: Contract;
  markets: Record<string, Contract>;
}

export const getSynthetixPerpsContracts = async (
  network: KeeperSupportedNetwork,
  signer: Signer,
  provider: providers.BaseProvider
): Promise<KeeperContracts> => {
  const futuresMarketManagerAddress = getFuturesMarketManagerAddress(network);
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

  return { exchangeRates, marketManager, markets };
};

import { Contract, providers, Signer } from 'ethers';
import FuturesMarketManagerJson from '../contracts/FuturesMarketManager.json';
import PerpsV2MarketConsolidatedJson from '../contracts/PerpsV2MarketConsolidated.json';

const FUTURES_MARKET_MANAGER_ADDRESS_GOERLI_OVM = '0xC8440d8e46D3C06beD106C6f2F918F30182bEb06';
const FUTURES_MARKET_MANAGER_ADDRESS_MAINNET_OVM = '';

interface GetSynthetixContractsArgs {
  network: string;
  signer?: Signer;
  provider: providers.BaseProvider;
}

interface PerpsV2Contracts {
  marketManager: Contract;
  markets: Record<string, Contract>;
}

const getFuturesMarketManagerAddress = (network: string): string => {
  switch (network) {
    case 'goerli-ovm':
      return FUTURES_MARKET_MANAGER_ADDRESS_GOERLI_OVM;
    case 'mainnet-ovm':
      return FUTURES_MARKET_MANAGER_ADDRESS_MAINNET_OVM;
    default:
      throw new Error(`Unsupported network '${network}'`);
  }
};

export const getSynthetixPerpsContracts = async ({
  network,
  signer,
  provider,
}: GetSynthetixContractsArgs): Promise<PerpsV2Contracts> => {
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
  return { marketManager, markets };
};

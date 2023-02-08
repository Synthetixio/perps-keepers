import { Contract, providers, Signer, utils } from 'ethers';
import { zipObject } from 'lodash';
import synthetix from 'synthetix';
import PerpsV2MarketConsolidatedJson from '../contracts/PerpsV2MarketConsolidated.json';
import PythAbi from '../contracts/Pyth.json';
import { createLogger } from './logging';
import { Network } from './typed';

const logger = createLogger('Utils');

interface KeeperContracts {
  exchangeRates: Contract;
  marketManager: Contract;
  marketSettings: Contract;
  markets: Record<string, { contract: Contract; asset: string }>;
  pyth: { priceFeedIds: Record<string, string>; endpoint: string; contract: Contract };
}

// @see: https://github.com/pyth-network/pyth-js/tree/main/pyth-evm-js
const PYTH_NETWORK_ENDPOINTS: Record<Network, string> = {
  [Network.OPT_GOERLI]: 'https://xc-testnet.pyth.network',
  [Network.OPT]: 'https://xc-mainnet.pyth.network',
};

// @see: https://docs.pyth.network/consume-data/evm
const PYTH_CONTRACT_ADDRESSES: Record<Network, string> = {
  [Network.OPT_GOERLI]: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  [Network.OPT]: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
};

export const networkToSynthetixNetworkName = (network: Network): string => {
  switch (network) {
    case Network.OPT:
      return 'mainnet-ovm';
    case Network.OPT_GOERLI:
      return 'goerli-ovm';
    default:
      throw new Error(`Unsupported Synthetix Network Name Mapping '${network}'`);
  }
};

const getSynthetixContractByName = (
  name: string,
  network: Network,
  provider: providers.BaseProvider
): Contract => {
  const snxNetwork = networkToSynthetixNetworkName(network);
  const abi = synthetix.getSource({ network: snxNetwork, contract: name }).abi;
  const address = synthetix.getTarget({ network: snxNetwork, contract: name }).address;

  logger.info(`Found ${name} contract at '${address}'`);
  return new Contract(address, abi, provider);
};

export const getSynthetixPerpsContracts = async (
  network: Network,
  signer: Signer,
  provider: providers.BaseProvider
): Promise<KeeperContracts> => {
  const marketManager = getSynthetixContractByName('FuturesMarketManager', network, provider);
  const exchangeRates = getSynthetixContractByName('ExchangeRates', network, provider);
  const marketSettings = getSynthetixContractByName('PerpsV2MarketSettings', network, provider);
  const perpsV2ExchangeRates = getSynthetixContractByName('PerpsV2ExchangeRate', network, provider);

  logger.info('Fetching available perps markets...');
  const marketSummaries = await marketManager.allMarketSummaries();
  const markets: KeeperContracts['markets'] = marketSummaries.reduce(
    (
      acc: KeeperContracts['markets'],
      {
        proxied,
        market,
        marketKey,
        asset,
      }: { proxied: boolean; market: string; marketKey: string; asset: string }
    ) => {
      marketKey = utils.parseBytes32String(marketKey);
      if (proxied) {
        logger.info(`Found market: '${marketKey}' @ '${market}'`);
        acc[marketKey] = {
          contract: new Contract(market, PerpsV2MarketConsolidatedJson.abi, signer),
          asset: utils.parseBytes32String(asset),
        };
      } else {
        logger.info(`Skipping market (not proxied): '${marketKey} @ '${market}`);
      }
      return acc;
    },
    {}
  );

  logger.info('Fetching Pyth price feeds for kept markets...');
  const marketValues = Object.values(markets);
  const marketAssets = marketValues.map(({ asset }) => asset);
  const marketPriceFeedIds = await Promise.all(
    marketAssets.map(
      (asset): Promise<string> =>
        perpsV2ExchangeRates.offchainPriceFeedId(utils.formatBytes32String(asset))
    )
  );
  const priceFeedIds = zipObject(marketAssets, marketPriceFeedIds);
  Object.keys(priceFeedIds).forEach(asset => {
    logger.info(`Pyth price feedId: ${asset} @ '${priceFeedIds[asset]}'`);
  });

  logger.info(`Keeping ${marketValues.length}/${marketSummaries.length} markets`);
  const pyth = {
    endpoint: PYTH_NETWORK_ENDPOINTS[network],
    priceFeedIds,
    contract: new Contract(PYTH_CONTRACT_ADDRESSES[network], PythAbi, provider),
  };
  return { exchangeRates, marketManager, marketSettings, markets, pyth };
};

export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

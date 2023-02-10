'use strict';

require('dotenv').config({
  path:
    // I would prefer to set NODE_ENV in ecosystem.config.js but the dot-env package and pm2 env configuration doesn't play nicely together
    process.env.name === 'perps-keeper-goerli'
      ? require('path').resolve(__dirname, '../.env.staging')
      : require('path').resolve(__dirname, '../.env'),
});

import logProcessError from 'log-process-errors';
import { createLogger } from './logging';
import { getConfig, KeeperConfig } from './config';
import { providers } from 'ethers';
import { getSynthetixPerpsContracts } from './utils';
import { Distributor } from './distributor';
import { LiquidationKeeper } from './keepers/liquidation';
import { DelayedOrdersKeeper } from './keepers/delayedOrders';
import { DelayedOffchainOrdersKeeper } from './keepers/delayedOffchainOrders';
import { Metric, Metrics } from './metrics';
import { Network } from './typed';
import { createSigners, SignerPool } from './signerpool';

const logger = createLogger('Application');

// 750ms.
//
// Waits `n` ms before executing the same request to the next provider ordered by priority.
export const PROVIDER_STALL_TIMEOUT = 750;
export const PROVIDER_DEFAULT_WEIGHT = 1;

export const getProvider = async (
  config: KeeperConfig['providerApiKeys'],
  network: Network
): Promise<providers.FallbackProvider> => {
  // Infura has the highest priority (indicated by the lowest priority number).
  const providersConfig: providers.FallbackProviderConfig[] = [
    {
      provider: new providers.InfuraProvider(network, config.infura),
      priority: 10,
      stallTimeout: PROVIDER_STALL_TIMEOUT,
      weight: PROVIDER_DEFAULT_WEIGHT,
    },
  ];
  if (config.alchemy) {
    logger.info('Alchemy API key provided. Adding as fallback provider');
    providersConfig.push({
      provider: new providers.AlchemyProvider(network, config.alchemy),
      priority: 20,
      stallTimeout: PROVIDER_STALL_TIMEOUT,
      weight: PROVIDER_DEFAULT_WEIGHT,
    });
  }

  // @see: https://docs.ethers.org/v5/api/providers/other/#FallbackProvider
  return new providers.FallbackProvider(providersConfig);
};

export const run = async (config: KeeperConfig) => {
  const metrics = Metrics.create(config.isMetricsEnabled, config.network, config.aws);
  metrics.count(Metric.KEEPER_STARTUP);

  const provider = await getProvider(config.providerApiKeys, config.network);
  const latestBlock = await provider.getBlock('latest');

  logger.info('Connected to node', {
    args: {
      network: config.network,
      latestBlockNumber: latestBlock.number,
      ts: latestBlock.timestamp,
    },
  });

  const signers = createSigners(config.ethHdwalletMnemonic, provider, config.signerPoolSize);
  const signer = signers[0]; // There will always be at least 1.
  const signerPool = new SignerPool(signers);

  const { markets, pyth, marketSettings, exchangeRates } = await getSynthetixPerpsContracts(
    config.network,
    signer,
    provider
  );

  const marketKeys = Object.keys(markets);
  logger.info('Creating n keeper(s) per kept market...', {
    args: { n: marketKeys.length },
  });
  for (const marketKey of marketKeys) {
    const market = markets[marketKey];
    const baseAsset = market.asset;

    logger.info('Configuring distributor/keepers for market', { args: { marketKey, baseAsset } });
    const distributor = new Distributor(
      market.contract,
      baseAsset,
      provider,
      metrics,
      config.fromBlock,
      config.distributorProcessInterval
    );

    const keepers = [];
    keepers.push(
      new LiquidationKeeper(
        market.contract,
        baseAsset,
        signerPool,
        provider,
        metrics,
        config.network
      )
    );

    // If we do not include a Pyth price feed, do not register an off-chain keeper.
    if (pyth.priceFeedIds[baseAsset]) {
      keepers.push(
        new DelayedOffchainOrdersKeeper(
          market.contract,
          marketSettings,
          pyth.endpoint,
          pyth.priceFeedIds[baseAsset],
          pyth.contract,
          marketKey,
          baseAsset,
          signerPool,
          provider,
          metrics,
          config.network,
          config.maxOrderExecAttempts
        )
      );
    } else {
      logger.debug('Not registering off-chain keeper as feed not defined', { args: { baseAsset } });
    }

    keepers.push(
      new DelayedOrdersKeeper(
        market.contract,
        exchangeRates,
        baseAsset,
        signerPool,
        provider,
        metrics,
        config.network,
        config.maxOrderExecAttempts
      )
    );
    logger.info('Registering keepers to distributor', { args: { n: keepers.length } });

    // Register all instantiated keepers. The order of importance is as follows:
    //
    // 1. Liquidations
    // 2. Delayed off-chain orders (Pyth)
    // 3. Delayed on-chain orders (CL)
    distributor.registerKeepers(keepers);
    distributor.listen();
  }
};

logProcessError({
  log(err, level) {
    logger.log(level, `${err}, ${err.stack}`);
  },
});

const config = getConfig();
run(config);

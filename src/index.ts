'use strict';

require('dotenv').config({
  path:
    // I would prefer to set NODE_ENV in ecosystem.config.js but the dot-env package and pm2 env configuration doesn't play nicely together
    process.env.name === 'perps-keeper-goerli'
      ? require('path').resolve(__dirname, '../.env.staging')
      : require('path').resolve(__dirname, '../.env'),
});

import { createLogger } from './logging';
import { getConfig, KeeperConfig } from './config';
import { providers } from 'ethers';
import { getOpenPositions, getPendingOrders, getPerpsContracts } from './utils';
import { Distributor } from './distributor';
import { LiquidationKeeper } from './keepers/liquidation';
import { DelayedOffchainOrdersKeeper } from './keepers/delayedOffchainOrders';
import { Metric, Metrics } from './metrics';
import { KeeperType } from './typed';
import { createSigners, SignerPool } from './signerpool';
import { TokenSwap } from './swap';

const logger = createLogger('Application');

// 750ms.
//
// Waits `n` ms before executing the same request to the next provider ordered by priority.
export const PROVIDER_STALL_TIMEOUT = 750;
export const PROVIDER_DEFAULT_WEIGHT = 1;

export const getProvider = (config: KeeperConfig['providerUrls']): providers.JsonRpcProvider => {
  if (config.alchemy) {
    return new providers.JsonRpcProvider(config.alchemy);
  }
  if (config.infura) {
    return new providers.JsonRpcProvider(config.infura);
  }
  throw new Error('No provider URL found');
};

export const run = async (config: KeeperConfig) => {
  const metrics = Metrics.create(config.isMetricsEnabled, config.network, config.aws);
  await metrics.count(Metric.KEEPER_STARTUP);

  const provider = getProvider(config.providerUrls);
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
  const signerPool = new SignerPool(signers, metrics);
  signerPool.monitor(config.signerPoolMonitorInterval);

  const tokenSwap = new TokenSwap(
    config.autoSwapMinSusd,
    config.autoSwapInterval,
    config.autoSwapSusdEnabled,
    signerPool,
    provider,
    config.network
  );

  const { markets, pyth, marketSettings, multicall } = await getPerpsContracts(
    config.marketKeys,
    config.network,
    config.pythPriceServer,
    signer,
    provider
  );

  const openPositionsByMarket = config.enabledKeepers.includes(KeeperType.Liquidator)
    ? await getOpenPositions(markets, multicall, latestBlock, provider)
    : {};

  const pendingOrdersByMarket = config.enabledKeepers.includes(KeeperType.OffchainOrder)
    ? await getPendingOrders(markets, multicall, latestBlock)
    : {};

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
      tokenSwap,
      config.distributorProcessInterval
    );

    const keepers = [];

    if (config.enabledKeepers.includes(KeeperType.Liquidator)) {
      const keeper = new LiquidationKeeper(
        market.contract,
        baseAsset,
        signerPool,
        provider,
        metrics,
        config.network
      );
      keeper.hydrateIndex(openPositionsByMarket[marketKey] ?? [], latestBlock);
      keepers.push(keeper);
    } else {
      logger.debug('Not registering liquidator', { args: { baseAsset } });
    }

    // If we do not include a Pyth price feed, do not register an off-chain keeper.
    if (pyth.priceFeedIds[baseAsset] && config.enabledKeepers.includes(KeeperType.OffchainOrder)) {
      const keeper = new DelayedOffchainOrdersKeeper(
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
      );
      keeper.hydrateIndex(pendingOrdersByMarket[marketKey] ?? []);
      keepers.push(keeper);
    } else {
      logger.debug('Not registering off-chain keeper as feed not defined', { args: { baseAsset } });
    }

    logger.info('Registering keepers to distributor', { args: { n: keepers.length } });

    // Register all instantiated keepers. The order of importance is as follows:
    //
    // 1. Liquidations
    // 2. Delayed off-chain orders (Pyth)
    distributor.registerKeepers(keepers);
    distributor.listen(latestBlock);
  }
};

const config = getConfig();
run(config);

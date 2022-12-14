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
import { getDefaultProvider, utils, Wallet } from 'ethers';
import { getPythDetails, getSynthetixPerpsContracts } from './utils';
import { Distributor } from './distributor';
import { LiquidationKeeper } from './keepers/liquidation';
import { DelayedOrdersKeeper } from './keepers/delayedOrders';
import { DelayedOffchainOrdersKeeper } from './keepers/delayedOffchainOrders';
import { Metric, Metrics } from './metrics';

export async function run(config: KeeperConfig) {
  const logger = createLogger('Application');
  const metrics = Metrics.create(config.isMetricsEnabled, config.network, config.aws);

  metrics.count(Metric.KEEPER_STARTUP);

  const provider = getDefaultProvider(config.providerUrl);
  logger.info('Connected to Ethereum node', { args: { providerUrl: config.providerUrl } });

  const signer = Wallet.fromMnemonic(config.ethHdwalletMnemonic).connect(provider);
  logger.info('Using keeper', { args: { address: signer.address } });

  const contracts = await getSynthetixPerpsContracts(config.network, signer, provider);
  const pyth = getPythDetails(config.network, provider);

  for (const market of Object.values(contracts.markets)) {
    const baseAsset = utils.parseBytes32String(await market.baseAsset());
    const marketKey = utils.parseBytes32String(await market.marketKey());
    const distributor = new Distributor(
      market,
      baseAsset,
      provider,
      metrics,
      signer,
      config.fromBlock,
      config.runEveryXBlock,
      config.runHealthcheckEveryXBlock
    );

    const keepers = [];
    keepers.push(
      new LiquidationKeeper(market, baseAsset, signer, provider, metrics, config.network)
    );

    // If we do not include a Pyth price feed, do not register an off-chain keeper.
    if (pyth.priceFeedIds[baseAsset]) {
      keepers.push(
        new DelayedOffchainOrdersKeeper(
          market,
          contracts.marketSettings,
          pyth.endpoint,
          pyth.priceFeedIds[baseAsset],
          pyth.pyth,
          marketKey,
          baseAsset,
          signer,
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
        market,
        contracts.exchangeRates,
        baseAsset,
        signer,
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
}

logProcessError({
  log(error, level) {
    createLogger('Errors').log(level, error.stack);
  },
});

const config = getConfig();
run(config);

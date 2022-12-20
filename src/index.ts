'use strict';

require('dotenv').config({
  path:
    // I would prefer to set NODE_ENV in ecosystem.config.js but the dot-env package and pm2 env configuration doesn't play nicely together
    process.env.name === 'perps-keeper-goerli'
      ? require('path').resolve(__dirname, '../.env.staging')
      : require('path').resolve(__dirname, '../.env'),
});

import { program } from 'commander';
import logProcessError from 'log-process-errors';
import { createLogger } from './logging';
import { getConfig, KeeperConfig } from './config';
import { getDefaultProvider, utils, Wallet } from 'ethers';
import { getPythDetails, getSynthetixPerpsContracts } from './utils';
import { Distributor } from './distributor';
import { LiquidationKeeper } from './keepers/liquidation';
import { DelayedOrdersKeeper } from './keepers/delayedOrders';
import { DelayedOffchainOrdersKeeper } from './keepers/delayedOffchainOrders';
import { Metrics } from './metrics';

logProcessError({
  log(error, level) {
    createLogger('Errors').log(level, error.stack);
  },
});

export async function run(config: KeeperConfig) {
  const logger = createLogger('Application');

  const metrics = Metrics.create(config.isMetricsEnabled, config.aws);

  const provider = getDefaultProvider(config.providerUrl);
  logger.info(`Connected to Ethereum node at '${config.providerUrl}'`);

  const signer = Wallet.fromMnemonic(config.ethHdwalletMnemonic).connect(provider);
  logger.info(`Keeper address '${signer.address}'`);

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
    distributor.registerKeepers([
      new LiquidationKeeper(market, baseAsset, signer, provider, metrics, config.network),
      new DelayedOrdersKeeper(
        market,
        contracts.exchangeRates,
        baseAsset,
        signer,
        provider,
        metrics,
        config.network,
        config.maxOrderExecAttempts
      ),
    ]);

    if (pyth.priceFeedIds[baseAsset]) {
      distributor.registerKeepers([
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
        ),
      ]);
    } else {
      logger.info(`Skipping '${baseAsset}' as off-chain price feed does not exist`);
    }

    distributor.listen();
  }
}

program
  .command('run')
  .description('Run the perps-keeper')
  .option(
    '-b, --from-block <value>',
    'rebuild the keeper index from a starting block, before initiating keeper actions.'
  )
  .option('--network <value>', 'ethereum network to connect to.')
  .option(
    '-m, --markets <value>',
    'runs keeper operations for the specified markets, delimited by a comma. Default all live markets.'
  )
  .action(arg => {
    // NOTE: At this point we're in the realm of unknown/any because of user input and zero validation (yet).
    process.env.FROM_BLOCK = arg.fromBlock ?? process.env.FROM_BLOCK;
    process.env.NETWORK = arg.network ?? process.env.NETWORK;

    // Combine all available input (env vars and user define args), validate then only use this downstream.
    const config = getConfig();
    run(config);
  });

program.parseAsync(process.argv).catch(err => {
  throw err;
});

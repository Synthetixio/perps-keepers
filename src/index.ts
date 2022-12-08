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
import { getSynthetixPerpsContracts } from './utils';
import { Distributor } from './distributor';
import { LiquidationKeeper } from './keepers/liquidation';

logProcessError({
  log(error, level) {
    createLogger('Errors').log(level, error.stack);
  },
});

export async function run(config: KeeperConfig) {
  const logger = createLogger('Run');

  const provider = getDefaultProvider(config.providerUrl);
  logger.info(`Connected to Ethereum node at '${config.providerUrl}'`);

  const signer = Wallet.fromMnemonic(config.ethHdwalletMnemonic).connect(provider);
  logger.info(`Keeper address '${signer.address}'`);

  const contracts = await getSynthetixPerpsContracts(config.network, signer, provider);

  for (const market of Object.values(contracts.markets)) {
    const baseAsset = utils.parseBytes32String(await market.baseAsset());
    const distributor = new Distributor(
      market,
      baseAsset,
      provider,
      config.fromBlock,
      config.runEveryXBlock
    );
    distributor.registerKeeper([
      new LiquidationKeeper(market, baseAsset, signer, provider, config.network),
    ]);
    distributor.listen();
  }
}

program
  .command('run')
  .description('Run the keeper')
  .option(
    '-b, --from-block <value>',
    'Rebuild the keeper index from a starting block, before initiating keeper actions.'
  )
  .option('--network <value>', 'Ethereum network to connect to.')
  .option(
    '-m, --markets <value>',
    'Runs keeper operations for the specified markets, delimited by a comma. Default all live markets.'
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

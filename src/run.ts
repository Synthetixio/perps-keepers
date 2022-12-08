import { getDefaultProvider, Wallet } from 'ethers';
import { Keeper } from './keeper';
import { Command } from 'commander';
import { createLogger } from './logging';
import { getSynthetixContracts } from './utils';
import { Distributor } from './distributor';
import { LiquidationKeeper } from './keepers/liquidation';

// TODO: Move all of this into a config manager.
export const DEFAULTS = {
  fromBlock: process.env.FROM_BLOCK || '1',
  providerUrl: 'http://localhost:8545',
  numAccounts: '1',
  network: process.env.NETWORK || 'goerli-ovm',
  runEveryXblock: Number(process.env.RUN_EVERY_X_BLOCK ?? 1),
};

const logger = createLogger({ componentName: 'Run' });

// TODO: Fix up this deps code...
export async function run(
  { fromBlockRaw = DEFAULTS.fromBlock, network = DEFAULTS.network } = {},
  deps = {
    ETH_HDWALLET_MNEMONIC: process.env.ETH_HDWALLET_MNEMONIC,
    PROVIDER_URL: process.env.PROVIDER_URL || DEFAULTS.providerUrl,
    Keeper,
    getSynthetixContracts,
  }
) {
  if (!deps.ETH_HDWALLET_MNEMONIC) {
    throw new Error('ETH_HDWALLET_MNEMONIC environment variable is not configured.');
  }

  const provider = getDefaultProvider(deps.PROVIDER_URL);
  logger.info(`Connected to Ethereum node at ${deps.PROVIDER_URL}`);

  const signer = Wallet.fromMnemonic(deps.ETH_HDWALLET_MNEMONIC).connect(provider);
  logger.info(`Keeper address '${signer.address}'`);
  const contracts = await deps.getSynthetixContracts({ network, signer, provider });

  const fromBlock = fromBlockRaw === 'latest' ? fromBlockRaw : parseInt(fromBlockRaw, 10);

  for (const market of Object.values(contracts.markets)) {
    const distributor = new Distributor(market, provider, fromBlock, DEFAULTS.runEveryXblock);
    distributor.registerKeeper([await LiquidationKeeper.create(market, signer, network, provider)]);
    distributor.listen();
  }
}

export const cmd = (program: Command) =>
  program
    .command('run')
    .description('Run the keeper')
    .option(
      '-b, --from-block <value>',
      'Rebuild the keeper index from a starting block, before initiating keeper actions.',
      DEFAULTS.fromBlock
    )
    .option('--network <value>', 'Ethereum network to connect to.')
    .option(
      '-n, --num-accounts <value>',
      'Number of accounts from the HD wallet to use for parallel tx submission. Improves performance.',
      String(DEFAULTS.numAccounts)
    )
    .option(
      '-m, --markets <value>',
      'Runs keeper operations for the specified markets, delimited by a comma. Default all live markets.'
    )
    .action(arg => run(arg));

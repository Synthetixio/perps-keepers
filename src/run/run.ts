import { NonceManager } from '@ethersproject/experimental';
import { getDefaultProvider } from 'ethers';
import snx from 'synthetix';
import { Keeper } from '../keeper';
import { SignerPool } from '../signer-pool';
import { Command } from 'commander';
import { createWallets } from './createWallets';
import { createLogger } from '../logging';
import { getSynthetixContracts } from '../utils';

export const DEFAULTS = {
  fromBlock: process.env.FROM_BLOCK || '1',
  providerUrl: 'http://localhost:8545',
  numAccounts: '1',
  network: process.env.NETWORK || 'goerli-ovm',
};

const logger = createLogger({ componentName: 'Run' });
export async function run(
  {
    fromBlockRaw = DEFAULTS.fromBlock,
    numAccounts = DEFAULTS.numAccounts,
    markets = '',
    network = DEFAULTS.network,
  } = {},
  deps = {
    ETH_HDWALLET_MNEMONIC: process.env.ETH_HDWALLET_MNEMONIC,
    NonceManager,
    SignerPool,
    Keeper,
    createWallets,
    getSynthetixContracts,
  }
) {
  if (!deps.ETH_HDWALLET_MNEMONIC) {
    throw new Error('ETH_HDWALLET_MNEMONIC environment variable is not configured.');
  }
  const allFuturesMarkets = snx
    .getFuturesMarkets({
      network,
      useOvm: true,
    })
    .map(({ marketKey }) => marketKey);

  const providerUrl = process.env.PROVIDER_URL || DEFAULTS.providerUrl;
  const marketKeys = markets ? markets.trim().split(',') : allFuturesMarkets;

  // Verify markets.
  marketKeys.forEach(marketKey => {
    if (!allFuturesMarkets.includes(marketKey)) {
      throw new Error(`No futures market for marketKey: ${marketKey}`);
    }
  });

  let fromBlock = fromBlockRaw === 'latest' ? fromBlockRaw : parseInt(fromBlockRaw);

  // Setup.
  const provider = getDefaultProvider(providerUrl);
  // deps.monitorProvider(provider, network);

  logger.info(`Connected to Ethereum node at ${providerUrl}`);

  let unWrappedSigners = deps.createWallets({
    provider,
    mnemonic: deps.ETH_HDWALLET_MNEMONIC,
    num: parseInt(numAccounts),
  });

  logger.info(`Using ${unWrappedSigners.length} account(s) to submit transactions:`);

  const signers = await Promise.all(
    unWrappedSigners.map(async (signer, i) => {
      let wrappedSigner = new deps.NonceManager(signer);

      // Each signer gets its own RPC connection.
      // This seems to improve the transaction speed even further.
      return wrappedSigner.connect(provider);
    })
  );
  signers.map(async s => console.log(await s.getAddress()));

  const signerPool = await deps.SignerPool.create({ signers });

  // Load contracts.
  const contracts = deps.getSynthetixContracts({
    network,
    provider,
    useOvm: true,
  });

  // Grab every available market contract for the supported keys.
  //
  // NOTE: the `.slice(1)` to remove the `s` prefix: sBTCPERP => BTCPERP
  const marketContracts = marketKeys.map(
    marketKey => contracts[`FuturesMarket${marketKey.slice(1)}`]
  );

  for (const marketContract of marketContracts) {
    const keeper = await deps.Keeper.create({
      network,
      futuresMarket: marketContract,
      signerPool,
      provider,
    });
    keeper.run({ fromBlock });
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

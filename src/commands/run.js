require('dotenv').config();
const ethers = require('ethers');
const { utils: { formatEther } } = ethers
const { gray, yellow } = require('chalk');
const Keeper = require('../keeper');
const { NonceManager } = require('@ethersproject/experimental');
const snx = require('synthetix')
const { getSource, getTarget } = snx
const SignerPool = require('../signer-pool');

const getFuturesMarkets = () => {
	return snx.defaults.FUTURES_ASSETS
}

const DEFAULTS = {
	fromBlock: 'latest',
	providerUrl: 'ws://localhost:8546',
	numAccounts: 10,
	markets: getFuturesMarkets().join(',')
};

const getSynthetixContracts = ({
	network,
	signer,
	provider,
	useOvm
}) => {
	const sources = getSource({ network, useOvm });
	const targets = getTarget({ network, useOvm });

	return Object.values(targets)
		.map((target) => {
			if (target.name === 'Synthetix') {
				target.address = targets.ProxyERC20.address;
			} else if (target.name === 'SynthsUSD') {
				target.address = targets.ProxyERC20sUSD.address;
			} else if (target.name === 'FeePool') {
				target.address = targets.ProxyFeePool.address;
			} else if (target.name.match(/Synth(s|i)[a-zA-Z]+$/)) {
				const newTarget = target.name.replace('Synth', 'Proxy');
				target.address = targets[newTarget].address;
			}
			return target;
		})
		.reduce((acc, { name, source, address }) => {
			acc[name] = new ethers.Contract(
				address,
				sources[source].abi,
				signer || provider || ethers.getDefaultProvider(network)
			);
			return acc;
		}, {});
};

async function run({
	fromBlock = DEFAULTS.fromBlock,
	providerUrl = DEFAULTS.providerUrl,
	numAccounts = DEFAULTS.numAccounts,
	markets = DEFAULTS.markets,
} = {}) {
	const { NETWORK, ETH_HDWALLET_MNEMONIC } = process.env;
	if (!NETWORK) {
		throw new Error('NETWORK environment variable is not configured.');
	}
	if (!ETH_HDWALLET_MNEMONIC) {
		throw new Error('ETH_HDWALLET_MNEMONIC environment variable is not configured.');
	}

	fromBlock = fromBlock === 'latest' ? fromBlock : parseInt(fromBlock);

	// Setup.
	//
	const provider = new ethers.providers.WebSocketProvider(providerUrl);
	console.log(gray(`Connected to Ethereum node at ${providerUrl}`));


	let signers = createWallets({ provider, mnemonic: ETH_HDWALLET_MNEMONIC, num: numAccounts });
	console.log(gray`Using ${signers.length} account(s) to submit transactions:`);
	signers = await Promise.all(
		signers.map(async (signer, i) => {
			let wrappedSigner = new NonceManager(signer);

			// Each signer gets its own WebSocket RPC connection.
			// This seems to improve the transaction speed even further.
			wrappedSigner = wrappedSigner.connect(new ethers.providers.WebSocketProvider(providerUrl));

			return wrappedSigner;
		})
	);
	const signerPool = new SignerPool(signers)

	// Check balances of accounts.
	const { SynthsUSD } = getSynthetixContracts({
		network: NETWORK,
		provider: provider,
		useOvm: true
	})

	for (const [i, signer] of signers.entries()) {
		// ETH.
		const balance = await signer.getBalance()
		// sUSD.
		const sUSDBalance = await SynthsUSD.balanceOf(await signer.getAddress())

		const balances = [
			['ETH', balance],
			['sUSD', sUSDBalance]
		]

		const balanceText = balances
			.map(([key, balance]) => {
				let balanceText = formatEther(balance)
				if (balance.isZero()) {
					balanceText = yellow(balanceText)
				}
				return `${balanceText} ${key}`
			})
			.join(', ')

		console.log(gray(`Account #${i}: ${await signer.getAddress()} (${balanceText})`));
	}


	// Get addresses.
	markets = markets.split(',')
	// Verify markets.
	const supportedMarkets = getFuturesMarkets({ network: NETWORK })
	markets.forEach(currencyKey => {
		if(!supportedMarkets.includes(currencyKey)) {
			throw new Error(`No futures market for currencyKey: ${currencyKey}`)
		}
	})
	
	// Load contracts.
	const marketContracts = markets.map(currencyKey => snx.getTarget({ 
		contract: `ProxyFuturesMarket${currencyKey}`, 
		network: NETWORK, 
		useOvm: true 
	}))
	const exchangeRates = snx.getTarget({ contract: "ExchangeRates", network: NETWORK, useOvm: true });

	for(let marketContract of marketContracts) {
		const keeper = new Keeper({
			network: NETWORK,
			proxyFuturesMarket: marketContract.address,
			exchangeRates: exchangeRates.address,
			signerPool,
			provider,
		});

		keeper.run({ fromBlock });
	}
	

	await new Promise((resolve, reject) => {});
}

function createWallets({ provider, mnemonic, num }) {
	const masterNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
	const wallets = [];

	for (let i = 0; i < num; i++) {
		wallets.push(
			new ethers.Wallet(masterNode.derivePath(`m/44'/60'/0'/0/${i}`).privateKey, provider)
		);
	}

	return wallets;
}

module.exports = {
	run,
	DEFAULTS,
	cmd: program =>
		program
			.command('run')
			.description('Run the keeper')
			.option(
				'-b, --from-block <value>',
				'Rebuild the keeper index from a starting block, before initiating keeper actions.',
				DEFAULTS.fromBlock
			)
			.option('-p, --provider-url <value>', 'Ethereum RPC URL', DEFAULTS.providerUrl)
			.option(
				'-n, --num-accounts <value>',
				'Number of accounts from the HD wallet to use for parallel tx submission. Improves performance.',
				DEFAULTS.numAccounts
			)
			.option(
				'-m, --markets <value>',
				'Runs keeper operations for the specified currencies. Supported values: ETH, BTC, LINK.',
				DEFAULTS.markets
			)
			.action(run),
};

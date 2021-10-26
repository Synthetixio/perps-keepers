require("dotenv").config();
const ethers = require("ethers");
const { gray, yellow } = require("chalk");
const snx = require("synthetix");
const Keeper = require("./keeper");
const { NonceManager } = require("@ethersproject/experimental");
const {
  utils: { formatEther }
} = ethers;
const { getSource, getTarget, getFuturesMarkets } = snx;
const SignerPool = require("./signer-pool");
const metrics = require("./metrics");

const futuresMarkets = getFuturesMarkets({
  // TODO: change this to mainnet when it's eventually deployed
  network: "kovan-ovm-futures",
  useOvm: true
});

const DEFAULTS = {
  fromBlock: "latest",
  providerUrl: "http://localhost:8545",
  numAccounts: 10,
  markets: futuresMarkets.map(market => market.asset).join(","),
  network: "kovan-ovm-futures"
};

// This is lifted from the synthetix-js package, since the package doesn't
// support local-ovm/kovan-ovm-futures artifacts, which impeded testing.
const getSynthetixContracts = ({ network, signer, provider, useOvm }) => {
  const sources = getSource({ network, useOvm });
  const targets = getTarget({ network, useOvm });

  return Object.values(targets)
    .map(target => {
      if (target.name === "Synthetix") {
        target.address = targets.ProxyERC20.address;
      } else if (target.name === "SynthsUSD") {
        target.address = targets.ProxyERC20sUSD.address;
      } else if (target.name === "FeePool") {
        target.address = targets.ProxyFeePool.address;
      } else if (target.name.match(/Synth(s|i)[a-zA-Z]+$/)) {
        const newTarget = target.name.replace("Synth", "Proxy");
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

function validateProviderUrl(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Provider URL must be a ws[s]:// endpoint");
  }
}

function getProvider(url) {
  const provider = new ethers.providers.WebSocketProvider({
    url,
    pollingInterval: 50,
    timeout: 1000 * 60 // 1 minute
  });

  //
  // Setup the Websocket provider to exit the process if a connection is closed.
  //
  const HEARTBEAT_TIMEOUT = 7500;
  const HEARTBEAT_INTERVAL = 10000;
  let heartbeat, heartbeatTimeout;

  provider._websocket.on("open", () => {
    heartbeat = setInterval(() => {
      provider._websocket.ping();

      // Use `WebSocket#terminate()`, which immediately destroys the connection,
      // instead of `WebSocket#close()`, which waits for the close timer.
      heartbeatTimeout = setTimeout(() => {
        provider._websocket.terminate();
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  });

  provider._websocket.on("close", () => {
    console.error("The websocket connection was closed");
    clearInterval(heartbeat);
    clearTimeout(heartbeatTimeout);
    process.exit(1);
  });

  provider._websocket.on("pong", () => {
    metrics.ethNodeUptime.set(1)
    clearInterval(heartbeatTimeout);
  });

  return provider;
}

async function run({
  fromBlock = DEFAULTS.fromBlock,
  providerUrl = DEFAULTS.providerUrl,
  numAccounts = DEFAULTS.numAccounts,
  markets = DEFAULTS.markets,
  network = DEFAULTS.network
} = {}) {
  const { ETH_HDWALLET_MNEMONIC } = process.env;
  if (!ETH_HDWALLET_MNEMONIC) {
    throw new Error(
      "ETH_HDWALLET_MNEMONIC environment variable is not configured."
    );
  }

  metrics.runServer();

  fromBlock = fromBlock === "latest" ? fromBlock : parseInt(fromBlock);

  // Setup.
  //
  validateProviderUrl(providerUrl);
  const provider = getProvider(providerUrl);
  console.log(gray(`Connected to Ethereum node at ${providerUrl}`));

  let signers = createWallets({
    provider,
    mnemonic: ETH_HDWALLET_MNEMONIC,
    num: numAccounts
  });
  console.log(gray`Using ${signers.length} account(s) to submit transactions:`);
  signers = await Promise.all(
    signers.map(async (signer, i) => {
      let wrappedSigner = new NonceManager(signer);

      // Each signer gets its own RPC connection.
      // This seems to improve the transaction speed even further.
      wrappedSigner = wrappedSigner.connect(getProvider(providerUrl));

      return wrappedSigner;
    })
  );
  const signerPool = await SignerPool.create({ signers });

  // Check balances of accounts.
  const { SynthsUSD } = getSynthetixContracts({
    network,
    provider: provider,
    useOvm: true
  });

  const signerBalances = await Promise.all(signers.map(async signer => {
    // ETH.
    const balance = await signer.getBalance();
    // sUSD.
    const sUSDBalance = await SynthsUSD.balanceOf(await signer.getAddress());

    const balances = [
      ["ETH", balance],
      ["sUSD", sUSDBalance]
    ];
    
    return balances
  }))

  for (const [i, signer] of signers.entries()) {
    const balanceText = signerBalances[i]
      .map(([key, balance]) => {
        let balanceText = formatEther(balance);
        if (balance.isZero()) {
          balanceText = yellow(balanceText);
        }
        return `${balanceText} ${key}`;
      })
      .join(", ");
    
    console.log(
      gray(`Account #${i}: ${await signer.getAddress()} (${balanceText})`)
    );
  }
  metrics.trackKeeperBalance(signers[0], SynthsUSD);

  // Get addresses.
  markets = markets.split(",");
  // Verify markets.
  const supportedAssets = futuresMarkets.map(({ asset }) => asset);
  markets.forEach(asset => {
    if (!supportedAssets.includes(asset)) {
      throw new Error(`No futures market for currencyKey: ${asset}`);
    }
  });

  // Load contracts.
  const marketContracts = markets.map(market =>
    snx.getTarget({
      contract: `ProxyFuturesMarket${market.slice(1)}`,
      network,
      useOvm: true
    })
  );
  const exchangeRates = snx.getTarget({
    contract: "ExchangeRates",
    network,
    useOvm: true
  });

  for (const marketContract of marketContracts) {
    const keeper = new Keeper({
      network,
      proxyFuturesMarket: marketContract.address,
      exchangeRates: exchangeRates.address,
      signerPool,
      provider
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
      new ethers.Wallet(
        masterNode.derivePath(`m/44'/60'/0'/0/${i}`).privateKey,
        provider
      )
    );
  }

  return wallets;
}

module.exports = {
  run,
  DEFAULTS,
  cmd: program =>
    program
      .command("run")
      .description("Run the keeper")
      .option(
        "-b, --from-block <value>",
        "Rebuild the keeper index from a starting block, before initiating keeper actions.",
        DEFAULTS.fromBlock
      )
      .option(
        "-p, --provider-url <value>",
        "Ethereum RPC URL",
        DEFAULTS.providerUrl
      )
      .option(
        "--network <value>",
        "Ethereum network to connect to.",
        "kovan-ovm-futures"
      )
      .option(
        "-n, --num-accounts <value>",
        "Number of accounts from the HD wallet to use for parallel tx submission. Improves performance.",
        DEFAULTS.numAccounts
      )
      .option(
        "-m, --markets <value>",
        "Runs keeper operations for the specified markets, delimited by a comma. Supported markets: sETH, sBTC, sLINK.",
        DEFAULTS.markets
      )
      .action(run)
};

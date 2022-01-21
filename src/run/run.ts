require("dotenv").config();
import { gray } from "chalk";
import { NonceManager } from "@ethersproject/experimental";
import snx from "synthetix";
import Keeper from "../keeper";
import SignerPool from "../signer-pool";
import { runServer as runMetricServer } from "../metrics";
import { getProvider, monitorProvider } from "../provider";
import { CommanderStatic } from "commander";
import createWallets from "./createWallets";
import logAndStartTrackingBalances from "./logAndStartTrackingBalances";

const futuresMarkets: { asset: string }[] = snx.getFuturesMarkets({
  // TODO: change this to mainnet when it's eventually deployed
  network: "kovan-ovm-futures",
  useOvm: true,
});

export const DEFAULTS = {
  fromBlock: "latest",
  providerUrl: "http://localhost:8545",
  numAccounts: "10",
  markets: futuresMarkets.map(market => market.asset).join(","),
  network: "kovan-ovm-futures",
};

export async function run(
  {
    fromBlockRaw = DEFAULTS.fromBlock,
    providerUrl = DEFAULTS.providerUrl,
    numAccounts = DEFAULTS.numAccounts,
    markets = DEFAULTS.markets,
    network = DEFAULTS.network,
  } = {},
  deps = {
    ETH_HDWALLET_MNEMONIC: process.env.ETH_HDWALLET_MNEMONIC,
    getProvider,
    monitorProvider,
    NonceManager,
    SignerPool,
    Keeper,
    createWallets,
    logAndStartTrackingBalances,
    runMetricServer,
    futuresMarkets,
  }
) {
  if (!deps.ETH_HDWALLET_MNEMONIC) {
    throw new Error(
      "ETH_HDWALLET_MNEMONIC environment variable is not configured."
    );
  }
  // Get addresses.
  const marketsArray = markets.trim().split(",");
  // Verify markets.
  const supportedAssets = deps.futuresMarkets.map(({ asset }) => asset);
  marketsArray.forEach(asset => {
    if (!supportedAssets.includes(asset)) {
      throw new Error(`No futures market for currencyKey: ${asset}`);
    }
  });

  deps.runMetricServer();

  let fromBlock =
    fromBlockRaw === "latest" ? fromBlockRaw : parseInt(fromBlockRaw);

  // Setup.
  const provider = deps.getProvider(providerUrl);
  deps.monitorProvider(provider);
  console.log(gray(`Connected to Ethereum node at ${providerUrl}`));

  let unWrappedSigners = deps.createWallets({
    provider,
    mnemonic: deps.ETH_HDWALLET_MNEMONIC,
    num: parseInt(numAccounts),
  });
  console.log(
    gray`Using ${unWrappedSigners.length} account(s) to submit transactions:`
  );
  const signers = await Promise.all(
    unWrappedSigners.map(async (signer, i) => {
      let wrappedSigner = new deps.NonceManager(signer);

      // Each signer gets its own RPC connection.
      // This seems to improve the transaction speed even further.
      return wrappedSigner.connect(provider);
    })
  );

  const signerPool = await deps.SignerPool.create({ signers });
  await deps.logAndStartTrackingBalances({ network, provider, signers });

  // Load contracts.
  const marketContracts = marketsArray.map(market =>
    snx.getTarget({
      contract: `ProxyFuturesMarket${market.slice(1)}`,
      network,
      useOvm: true,
    })
  );
  const exchangeRates = snx.getTarget({
    contract: "ExchangeRates",
    network,
    useOvm: true,
  });
  for (const marketContract of marketContracts) {
    const keeper = await deps.Keeper.create({
      network,
      proxyFuturesMarket: marketContract.address,
      exchangeRates: exchangeRates.address,
      signerPool,
      provider,
    });

    keeper.run({ fromBlock });
  }
}

export const cmd = (program: CommanderStatic) =>
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
      String(DEFAULTS.numAccounts)
    )
    .option(
      "-m, --markets <value>",
      "Runs keeper operations for the specified markets, delimited by a comma. Supported markets: sETH, sBTC, sLINK.",
      DEFAULTS.markets
    )
    .action(run);

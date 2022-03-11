require("dotenv").config();
import { NonceManager } from "@ethersproject/experimental";
import snx from "synthetix";
import Keeper from "../keeper";
import SignerPool from "../signer-pool";
import { runServer as runMetricServer } from "../metrics";
import { getProvider, monitorProvider } from "../provider";
import { Command } from "commander";
import createWallets from "./createWallets";
import logAndStartTrackingBalances from "./logAndStartTrackingBalances";
import { createLogger } from "../logging";

const futuresMarkets: { asset: string }[] = snx.getFuturesMarkets({
  // TODO: change this to mainnet when it's eventually deployed
  network: "kovan-ovm",
  useOvm: true,
});

export const DEFAULTS = {
  fromBlock: process.env.FROM_BLOCK || "1",
  providerUrl: "http://localhost:8545",
  numAccounts: "1",
  markets: futuresMarkets.map(market => market.asset).join(","),
  network: process.env.NETWORK || "kovan-ovm",
};

const logger = createLogger({ componentName: "Run" });
export async function run(
  {
    fromBlockRaw = DEFAULTS.fromBlock,
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
  const providerUrl = process.env.PROVIDER_URL || DEFAULTS.providerUrl;
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

  logger.info(`Connected to Ethereum node at ${providerUrl}`);

  let unWrappedSigners = deps.createWallets({
    provider,
    mnemonic: deps.ETH_HDWALLET_MNEMONIC,
    num: parseInt(numAccounts),
  });
  logger.info(
    `Using ${unWrappedSigners.length} account(s) to submit transactions:`
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
      contract: `FuturesMarket${market.slice(1)}`,
      network,
      useOvm: true,
    })
  );
  for (const marketContract of marketContracts) {
    const keeper = await deps.Keeper.create({
      network,
      futuresMarketAddress: marketContract.address,
      signerPool,
      provider,
    });

    keeper.run({ fromBlock });
  }
}

export const cmd = (program: Command) =>
  program
    .command("run")
    .description("Run the keeper")
    .option(
      "-b, --from-block <value>",
      "Rebuild the keeper index from a starting block, before initiating keeper actions.",
      DEFAULTS.fromBlock
    )
    .option("--network <value>", "Ethereum network to connect to.")
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
    .action(arg => run(arg));

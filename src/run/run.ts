require("dotenv").config();
import { providers, Wallet } from "ethers";
import { gray, yellow } from "chalk";
import { NonceManager } from "@ethersproject/experimental";
import snx from "synthetix";
import Keeper from "../keeper";
import SignerPool from "../signer-pool";
import * as metrics from "../metrics";
import { Providers } from "../provider";
import { CommanderStatic } from "commander";
import createWallets from "./createWallets";

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
    Providers: Providers,
    NonceManager: NonceManager,
    SignerPool: SignerPool,
    Keeper: Keeper,
    createWallets,
    futuresMarkets,
  }
) {
  if (!deps.ETH_HDWALLET_MNEMONIC) {
    throw new Error(
      "ETH_HDWALLET_MNEMONIC environment variable is not configured."
    );
  }
  // Get addresses.
  const marketsArray = markets.split(",");
  // Verify markets.
  const supportedAssets = deps.futuresMarkets.map(({ asset }) => asset);
  marketsArray.forEach(asset => {
    if (!supportedAssets.includes(asset)) {
      throw new Error(`No futures market for currencyKey: ${asset}`);
    }
  });

  deps.metrics.runServer();

  let fromBlock =
    fromBlockRaw === "latest" ? fromBlockRaw : parseInt(fromBlockRaw);

  // Setup.
  const provider = deps.Providers.create(providerUrl);
  deps.Providers.monitor(provider);
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

  // Check balances of accounts.
  const { SynthsUSD } = deps.getSynthetixContracts({
    network,
    provider: provider,
    useOvm: true,
  });

  const signerBalances = await Promise.all(
    signers.map(async signer => {
      // ETH.
      const balance = await signer.getBalance();
      // sUSD.
      const address = await signer.getAddress();
      const sUSDBalance = await SynthsUSD.balanceOf(address);

      const balances = [
        ["ETH", balance],
        ["sUSD", sUSDBalance],
      ];

      return { balances, address };
    })
  );
  // Log and track account balances
  signerBalances.forEach(({ address, balances }, i) => {
    const balanceText = balances
      .map(([key, balance]) => {
        let balanceText = formatEther(balance);
        if (balance.isZero()) {
          balanceText = yellow(balanceText);
        }
        return `${balanceText} ${key}`;
      })
      .join(", ");

    console.log(gray(`Account #${i}: ${address} (${balanceText})`));
    deps.metrics.trackKeeperBalance(signers[i], SynthsUSD);
  });

  // Get addresses.
  const marketsArray = markets.split(",");
  // Verify markets.
  const supportedAssets = futuresMarkets.map(({ asset }) => asset);
  marketsArray.forEach(asset => {
    if (!supportedAssets.includes(asset)) {
      throw new Error(`No futures market for currencyKey: ${asset}`);
    }
  });

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
    .action(x => run(x));

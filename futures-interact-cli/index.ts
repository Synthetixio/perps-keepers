require("dotenv").config();
import { wei } from "@synthetixio/wei";
import { providers, Wallet } from "ethers";
import { Command } from "commander";
import { getSynthetixContracts } from "../src/utils";
import { setupPriceAggregators, updateAggregatorRates } from "./helpers";
import { execSync } from "child_process";
import deployMockAggregator from "./deploy-mock-aggregator";
import { formatBytes32String } from "ethers/lib/utils";

let hasLoggedEthersSetup = false;
const ethersSetup = ({
  asset,
  network,
  providerUrl,
  privateKey,
}: DefaultArgs) => {
  const provider = new providers.JsonRpcProvider(providerUrl);
  const privateKeyToUse = privateKey || process.env.INTERACT_WALLET_PRIVATE_KEY;
  if (!privateKeyToUse) {
    throw new Error(
      `You need to provide a private key in .env "INTERACT_WALLET_PRIVATE_KEY" or with --private-key`
    );
  }
  const wallet = new Wallet(privateKeyToUse, provider);
  const deployerWallet =
    process.env.DEPLOYER_WALLET_PRIVATE_KEY &&
    new Wallet(process.env.DEPLOYER_WALLET_PRIVATE_KEY, provider);
  const contractName = `FuturesMarket${asset.substring(1)}`;
  const contracts = getSynthetixContracts({
    network,
    provider,
    useOvm: true,
  });

  const { SynthsUSD, ExchangeRates, DebtCache } = contracts;
  const futuresMarketContract = contracts[contractName];
  if (!hasLoggedEthersSetup) {
    console.log(
      `${contractName} (${network}): ${futuresMarketContract.address}`
    );
    hasLoggedEthersSetup = true;
  }
  return {
    provider,
    wallet,
    futuresMarketContract,
    SynthsUSD,
    ExchangeRates,
    DebtCache,
    deployerWallet,
  };
};

const fundMargin = async (arg: FundPosArg) => {
  const { fundAmountUsd, network } = arg;
  const { wallet, futuresMarketContract, SynthsUSD } = ethersSetup(arg);
  const [remainingMargin] = await futuresMarketContract.remainingMargin(
    wallet.address
  );
  if (wei(remainingMargin).gt(wei(fundAmountUsd))) {
    console.log(
      `Skipping funding, remaining margin: $${wei(remainingMargin).toString()}`
    );
    return;
  }
  console.log(`Transferring margin ($${fundAmountUsd})...`);
  const x = await futuresMarketContract
    .connect(wallet)
    .transferMargin(wei(fundAmountUsd).toBN());
  await x.wait();
  console.log("Margin Account funded 💰");
};
const openPos = async (arg: OpenPosArg) => {
  const { wallet, futuresMarketContract } = ethersSetup(arg);
  const { positionAmount, asset } = arg;

  const [remainingMargin] = await futuresMarketContract.remainingMargin(
    wallet.address
  );
  console.log(`Opening pos for asset ${asset} ${positionAmount}...`);

  console.log("remainingMargin:", wei(remainingMargin).toString(1));
  const positionSize = wei(positionAmount);
  const [
    margin,
    size,
    price,
    liqPrice,
    fee,
    status,
  ] = await futuresMarketContract.postTradeDetails(
    positionSize.toBN(),
    wallet.address
  );
  console.log("postTradeDetails response", {
    margin: wei(margin).toString(),
    size: wei(size).toString(),
    price: wei(price).toString(),
    liqPrice: wei(liqPrice).toString(),
    fee: wei(fee).toString(),
    status,
  });

  const gasLimit = await futuresMarketContract
    .connect(wallet)
    .estimateGas.modifyPosition(positionSize.toBN());

  const tx = await futuresMarketContract
    .connect(wallet)
    .modifyPosition(positionSize.toBN(), { gasLimit });
  await tx.wait();
  console.log("Position opened 📈");
};
const closePosition = async (arg: ClosePosArg) => {
  const { wallet, futuresMarketContract } = ethersSetup(arg);
  const gasLimit = await futuresMarketContract
    .connect(wallet)
    .estimateGas.closePosition();

  const tx = await futuresMarketContract
    .connect(wallet)
    .closePosition({ gasLimit });
  await tx.wait();
  console.log("Position closed");
};

const checkPos = async (arg: CheckPosArg) => {
  const { wallet, provider, futuresMarketContract, SynthsUSD } = ethersSetup(
    arg
  );
  const sUSDBalance = await SynthsUSD.balanceOf(wallet.address);
  const ethBalance = await wallet.connect(provider).getBalance();
  const [remainingMargin] = await futuresMarketContract.remainingMargin(
    wallet.address
  );
  const [openPos] = await futuresMarketContract.notionalValue(wallet.address);
  const [price] = await futuresMarketContract.assetPrice();
  const [liqPrice] = await futuresMarketContract.liquidationPrice(
    wallet.address,
    false
  );
  console.log(`${arg.asset} price: $${wei(price).toString(1)}`);
  console.log(`sUSD Balance $${wei(sUSDBalance).toString(1)}`);
  console.log(`ETH Balance  E${wei(ethBalance).toString(1)}`);
  console.log(`Open Position: $${wei(openPos).toString(1)}`);
  console.log(`Liquidation Price: $${wei(liqPrice).toString(1)}`);
  console.log(`Remaining Margin: $${wei(remainingMargin).toString(1)}`);
};

const fundAndOpenPos = async (arg: FundAndOpenPosArg) => {
  await fundMargin(arg);
  await openPos(arg);
};

const setPrice = async (arg: SetPriceArg) => {
  const { ExchangeRates, deployerWallet } = ethersSetup(arg);

  if (!deployerWallet) {
    throw Error("Setting price requires a DEPLOYER_WALLET_PRIVATE_KEY");
  }
  // Compile mock Aggregator contract is needed
  execSync("npx hardhat compile", { stdio: "inherit" });
  // Deploy contracts if needed
  await deployMockAggregator();
  const exchangeRates = ExchangeRates.connect(deployerWallet);
  const assetBytes32 = formatBytes32String(arg.asset);
  const rate = wei(arg.assetPrice).toBN();

  await setupPriceAggregators(exchangeRates, deployerWallet, [assetBytes32]);
  await updateAggregatorRates(exchangeRates, [{ assetBytes32, rate }]);

  console.log(`Price for ${arg.asset} updated to: $${arg.assetPrice}`);
};

type DefaultArgs = {
  providerUrl: string;
  asset: string;
  privateKey: string;
  network: string;
};
type FundAndOpenPosArg = DefaultArgs & {
  fundAmountUsd: string;
  positionAmount: string;
};
type CheckPosArg = DefaultArgs;
type SetPriceArg = DefaultArgs & { assetPrice: string };
type ClosePosArg = DefaultArgs;
type FundPosArg = DefaultArgs & { fundAmountUsd: string };
type OpenPosArg = DefaultArgs & { positionAmount: string };

const setupProgram = () => {
  const program = new Command().version("0.0.1");

  program
    .option(
      "-p, --provider-url <value>",
      "Ethereum RPC URL",
      "http://127.0.0.1:8545"
    )
    .option(
      "-a, --asset <value>",
      "Asset to open position/ fund ie. sBTC",
      "sBTC"
    )
    .option("-P, --private-key <value>", "Private key to wallet")
    .option(
      "-n --network <value>",
      "Ethereum network to connect to.",
      "kovan-ovm-futures"
    );
  program
    .command("fundAndOpenPosition")
    .option("-f, --fund-amount-usd <value>", "Fund Amount", "100000")
    .option("-A --position-amount <value>", "Position Amount", "0.1")
    .action(async (_x, cmd) => {
      const options: FundAndOpenPosArg = cmd.optsWithGlobals();
      await checkPos(options);
      await fundAndOpenPos(options);
      await checkPos(options);
    });

  program
    .command("fundMargin")
    .option("-f, --fund-amount-usd <value>", "Fund Amount", "100000")
    .action(async (_x, cmd) => {
      const options: FundPosArg = cmd.optsWithGlobals();
      await checkPos(options);
      await fundMargin(options);
      await checkPos(options);
    });

  program
    .command("openPosition")
    .option("-A --position-amount <value>", "Position Amount", "0.1")
    .action(async (_x, cmd) => {
      const options: OpenPosArg = cmd.optsWithGlobals();
      await checkPos(options);
      await openPos(options);
      await checkPos(options);
    });

  program.command("closePosition").action(async (_x, cmd) => {
    const options: ClosePosArg = cmd.optsWithGlobals();
    await checkPos(options);
    await closePosition(options);
    await checkPos(options);
  });
  program.command("checkPosition").action(async (_x, cmd) => {
    const options: CheckPosArg = cmd.optsWithGlobals();
    await checkPos(options);
  });
  program
    .command("setPrice")
    .option("-A, --asset-price <value>", "Asset Price", "40000")
    .action(async (_x, cmd) => {
      const options: SetPriceArg = cmd.optsWithGlobals();

      await setPrice(options);
      /**
       * Calling const aggregator = await MockAggregator.new({ from: deployerWallet.address }); sets up some subscription
       * causing the script to not end.
       * I tried calling `aggregator.contract.clearSubscriptions();` but that throws an error :(
       * So exiting manually
       *  */
      process.exit();
    });
  program.parseAsync(process.argv);
};
setupProgram();

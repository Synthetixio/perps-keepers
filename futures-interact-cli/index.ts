require("dotenv").config();
import { wei } from "@synthetixio/wei";
import { Contract, providers, Wallet } from "ethers";
import snx from "synthetix";
import { Command } from "commander";
import { getSynthetixContracts } from "../src/utils";

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
  const contractName = `FuturesMarket${asset.substring(1)}`;
  const FuturesMarketTarget = snx.getTarget({
    network,
    contract: contractName,
    useOvm: true,
  });
  const FuturesMarket = snx.getSource({
    network,
    contract: "FuturesMarket",
    useOvm: true,
  });

  const futuresMarketContract = new Contract(
    FuturesMarketTarget.address,
    FuturesMarket.abi,
    provider
  );
  if (!hasLoggedEthersSetup) {
    console.log(
      `${contractName} (${network}): ${futuresMarketContract.address}`
    );
    hasLoggedEthersSetup = true;
  }

  const { SynthsUSD } = getSynthetixContracts({
    network,
    provider,
    useOvm: true,
  });
  return { provider, wallet, futuresMarketContract, SynthsUSD };
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
  console.log(`sUSDBalance $${wei(sUSDBalance).toString(1)}`);
  console.log(`ethBalance  E${wei(ethBalance).toString(1)}`);
  console.log(`openPos: $${wei(openPos).toString(1)}`);
  console.log(`remainingMargin: $${wei(remainingMargin).toString(1)}`);
};

const fundAndOpenPos = async (arg: FundAndOpenPosArg) => {
  await fundMargin(arg);
  await openPos(arg);
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
    .option("-pk, --private-key <value>", "Private key to wallet")
    .option(
      "-n --network <value>",
      "Ethereum network to connect to.",
      "kovan-ovm-futures"
    );
  program
    .command("fundAndOpenPosition")
    .option("-f, --fund-amount-usd <value>", "Fund Amount", "100000")
    .option("-pa --position-amount <value>", "Position Amount", "0.1")
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
    .option("-pa --position-amount <value>", "Position Amount", "0.1")
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
  program.command("checkPosition").action((_x, cmd) => {
    const options: CheckPosArg = cmd.optsWithGlobals();
    checkPos(options);
  });
  program.parseAsync(process.argv);
};
setupProgram();

import { BigNumber, ethers } from "ethers";
import { artifacts } from "hardhat";
import { web3 } from "hardhat";
const MockAggregator = artifacts.require("MockAggregatorV2V3");
const ZERO_ADDRESS = "0x" + "0".repeat(40);

const currentTime = async () => {
  const { timestamp } = await web3.eth.getBlock("latest");
  return timestamp;
};

export async function setupPriceAggregators(
  exchangeRates: ethers.Contract,
  deployerWallet: ethers.Wallet,
  assetsBytes32: string[]
) {
  for (const assetBytes32 of assetsBytes32) {
    const aggregator = await MockAggregator.new({
      from: deployerWallet.address,
    });

    await exchangeRates
      .connect(deployerWallet)
      .addAggregator(assetBytes32, aggregator.address, {
        from: deployerWallet.address,
      });
    /**
     * await MockAggregator.new({ from: owner.address }); is causing the process to never end
     * I tried calling aggregator.contract.clearSubscriptions(); here to avoid it, but that methods throws :(
     */
  }
}

export async function updateAggregatorRates(
  exchangeRates: ethers.Contract,
  rates: { assetBytes32: string; rate: BigNumber }[]
) {
  const timestamp = await currentTime();
  for (const { assetBytes32, rate } of rates) {
    const aggregatorAddress = await exchangeRates.aggregators(assetBytes32);
    if (aggregatorAddress === ZERO_ADDRESS) {
      throw new Error(
        `Aggregator set to zero address, use "setupPriceAggregators" to set it up`
      );
    }
    const aggregator = await MockAggregator.at(aggregatorAddress);
    await aggregator.setLatestAnswer(rate, timestamp);
  }
}

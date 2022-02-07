import "@nomiclabs/hardhat-ethers";
import hardhat from "hardhat";

async function main() {
  let MockAggregatorV2V3 = await hardhat.ethers.getContractFactory(
    "MockAggregatorV2V3"
  );
  const mockAggregatorV2V3 = await MockAggregatorV2V3.deploy();

  await mockAggregatorV2V3.deployed();

  console.log("MockAggregatorV2V3 deployed to:", mockAggregatorV2V3.address);
}
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
export default main;

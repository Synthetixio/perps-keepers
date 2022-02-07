import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config = {
  ovm: {
    solcVersion: "0.5.16",
  },
  solidity: {
    compilers: [
      {
        version: "0.4.25",
      },
      {
        version: "0.5.16",
      },
    ],
  },
  paths: {
    sources: "./test-contracts",
  },
  defaultNetwork: "localhost",
  networks: {
    localhost: {
      gas: 12e6,
      blockGasLimit: 12e6,
      url: "http://localhost:8545",
      // Add DEPLOYER_WALLET_PRIVATE_KEY if it exists ()
      accounts: process.env.DEPLOYER_WALLET_PRIVATE_KEY
        ? [process.env.DEPLOYER_WALLET_PRIVATE_KEY]
        : "remote",
    },
  },
};
export default config;

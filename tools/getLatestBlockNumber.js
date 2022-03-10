const { providers } = require("ethers");

const provider = new providers.JsonRpcProvider(process.argv[2]);
provider
  .getBlockNumber()
  .then(console.log)
  .catch(console.log);

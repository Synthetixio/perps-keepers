// PM2 Config
module.exports = {
  apps: [
    {
      name: "futures-keeper-mainnet",
      script: "./build/src/index.js",
      args: "run",
    },
    {
      name: "futures-keeper-kovan",
      script: "./build/src/index.js",
      args: "run",
    },
  ],
};

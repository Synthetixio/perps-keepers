module.exports = {
  apps: [
    {
      name: 'perps-keeper-mainnet',
      cron_restart: '0 0 * * *',
      max_memory_restart: '1000M',
      script: './build/src/index.js',
      args: 'run',
    },
    {
      name: 'perps-keeper-goerli',
      script: './build/src/index.js',
      args: 'run',
    },
  ],
};

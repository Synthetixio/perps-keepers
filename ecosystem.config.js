module.exports = {
  apps: [
    {
      name: 'perps-keeper-mainnet',
      cron_restart: '0 0 * * *',
      max_memory_restart: '1000M',
      script: './build/index.js',
      args: 'run',
    },
  ],
};

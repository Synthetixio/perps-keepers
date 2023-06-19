import { z } from 'zod';
import { KeeperType, Network } from './typed';

export const DEFAULT_CONFIG = {
  network: Network.OPT_GOERLI,
  maxOrderExecAttempts: 10,
  isMetricsEnabled: false,
  distributorProcessInterval: 3000,
  signerPoolSize: 1,
  signerPoolMonitorInterval: 1000 * 60, // 1min

  autoSwapSusdEnabled: false,
  autoSwapMinSusd: Math.pow(10, 18) * 50, // $50 USD
  autoSwapInterval: 1000 * 60 * 60 * 24, // 24hrs

  enabledKeepers: [KeeperType.OffchainOrder, KeeperType.Liquidator],

  // @see: https://github.com/pyth-network/pyth-js/tree/main/pyth-evm-js
  //   'https://xc-testnet.pyth.network'
  //   'https://xc-mainnet.pyth.network'
  pythPriceServer: 'https://xc-testnet.pyth.network',
};

export const KeeperConfigSchema = z.object({
  marketKeys: z.string().array(),
  distributorProcessInterval: z.coerce
    .number()
    .positive()
    .default(DEFAULT_CONFIG.distributorProcessInterval),
  signerPoolSize: z.coerce
    .number()
    .positive()
    .min(1)
    .default(DEFAULT_CONFIG.signerPoolSize),
  signerPoolMonitorInterval: z.coerce
    .number()
    .positive()
    .min(1000)
    .default(DEFAULT_CONFIG.signerPoolMonitorInterval),
  providerUrls: z.object({
    infura: z
      .string()
      .url()
      .optional(),
    alchemy: z
      .string()
      .url()
      .optional(),
  }),
  pythPriceServer: z
    .string()
    .url()
    .default(DEFAULT_CONFIG.pythPriceServer),
  network: z.nativeEnum(Network).default(DEFAULT_CONFIG.network),
  ethHdwalletMnemonic: z.string().min(1),
  maxOrderExecAttempts: z.coerce
    .number()
    .min(1)
    .max(1024)
    .default(DEFAULT_CONFIG.maxOrderExecAttempts),
  isMetricsEnabled: z.coerce.boolean().default(DEFAULT_CONFIG.isMetricsEnabled),
  autoSwapSusdEnabled: z.coerce.boolean().default(DEFAULT_CONFIG.autoSwapSusdEnabled),
  autoSwapMinSusd: z.coerce
    .number()
    .min(1)
    .default(DEFAULT_CONFIG.autoSwapMinSusd),
  autoSwapInterval: z.coerce
    .number()
    .min(1000 * 60)
    .default(DEFAULT_CONFIG.autoSwapInterval),
  enabledKeepers: z
    .nativeEnum(KeeperType)
    .array()
    .min(1)
    .default(DEFAULT_CONFIG.enabledKeepers),
  aws: z.object({
    region: z.string().optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
  }),
});

export type KeeperConfig = z.infer<typeof KeeperConfigSchema>;

let _config: KeeperConfig | undefined;

export const getConfig = (force = false): KeeperConfig => {
  if (_config && !force) {
    return _config;
  }

  const result = KeeperConfigSchema.safeParse({
    marketKeys: !process.env.MARKET_KEYS ? [] : process.env.MARKET_KEYS.split(','),
    signerPoolSize: process.env.SIGNER_POOL_SIZE,
    providerUrls: {
      infura: process.env.PROVIDER_URL_INFURA,
      alchemy: process.env.PROVIDER_URL_ALCHEMY,
    },
    distributorProcessInterval: process.env.DISTRIBUTOR_PROCESS_INTERVAL,
    network: process.env.NETWORK,
    ethHdwalletMnemonic: process.env.ETH_HDWALLET_MNEMONIC,
    pythPriceServer: process.env.PYTH_PRICE_SERVER,
    maxOrderExecAttempts: process.env.MAX_ORDER_EXEC_ATTEMPTS,
    isMetricsEnabled: process.env.METRICS_ENABLED === '1',

    autoSwapSusdEnabled: process.env.AUTO_SWAP_SUSD_ENABLED === '1',
    autoSwapMinSusd: process.env.AUTO_SWAP_MIN_SUSD,
    autoSwapInterval: process.env.AUTO_SWAP_INTERVAL,

    enabledKeepers: !process.env.ENABLED_KEEPERS
      ? undefined
      : process.env.ENABLED_KEEPERS.split(','),

    // This should really not exist? If deployed to AWS, VM should be IAM configured.
    aws: {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_KEY,
    },
  });

  if (!result.success) {
    throw result.error;
  }

  _config = result.data;
  return _config;
};

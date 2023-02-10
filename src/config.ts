import { z } from 'zod';
import { Network } from './typed';

export const DEFAULT_CONFIG = {
  fromBlock: 1,
  network: Network.OPT_GOERLI,
  maxOrderExecAttempts: 10,
  isMetricsEnabled: false,
  distributorProcessInterval: 3000,
  signerPoolSize: 1,
};

export const KeeperConfigSchema = z.object({
  fromBlock: z.coerce
    .number()
    .positive()
    .default(DEFAULT_CONFIG.fromBlock),
  distributorProcessInterval: z.coerce
    .number()
    .positive()
    .default(DEFAULT_CONFIG.distributorProcessInterval),
  signerPoolSize: z.coerce
    .number()
    .positive()
    .min(1)
    .default(DEFAULT_CONFIG.signerPoolSize),
  providerApiKeys: z.object({
    infura: z.string().min(1),
    alchemy: z.string().optional(),
  }),
  network: z.nativeEnum(Network).default(DEFAULT_CONFIG.network),
  ethHdwalletMnemonic: z.string().min(1),
  maxOrderExecAttempts: z.coerce
    .number()
    .min(1)
    .max(1024)
    .default(DEFAULT_CONFIG.maxOrderExecAttempts),
  isMetricsEnabled: z.coerce.boolean().default(DEFAULT_CONFIG.isMetricsEnabled),
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
    fromBlock: process.env.FROM_BLOCK,
    signerPoolSize: process.env.SIGNER_POOL_SIZE,
    providerApiKeys: {
      infura: process.env.PROVIDER_API_KEY_INFURA,
      alchemy: process.env.PROVIDER_API_KEY_ALCHEMY,
    },
    distributorProcessInterval: process.env.DISTRIBUTOR_PROCESS_INTERVAL,
    network: process.env.NETWORK,
    ethHdwalletMnemonic: process.env.ETH_HDWALLET_MNEMONIC,
    maxOrderExecAttempts: process.env.MAX_ORDER_EXEC_ATTEMPTS,
    isMetricsEnabled: process.env.METRICS_ENABLED === '1',

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

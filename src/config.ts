import { z } from 'zod';
import { Network } from './typed';

export const DEFAULT_CONFIG = {
  fromBlock: 1,
  network: Network.GOERLI_OVM,
  runEveryXBlock: 1,
};

export const KeeperConfigSchema = z.object({
  fromBlock: z.coerce
    .number()
    .positive()
    .or(z.literal('latest'))
    .default(DEFAULT_CONFIG.fromBlock),
  providerUrl: z.string().min(1),
  network: z.nativeEnum(Network).default(DEFAULT_CONFIG.network),
  runEveryXBlock: z.coerce
    .number()
    .positive()
    .default(DEFAULT_CONFIG.runEveryXBlock),
  ethHdwalletMnemonic: z.string().min(1),
  awsRegion: z.string().optional(),
  awsAccessKeyId: z.string().optional(),
  awsSecretAccessKey: z.string().optional(),
});

export type KeeperConfig = z.infer<typeof KeeperConfigSchema>;

let _config: KeeperConfig | undefined;

export const getConfig = (force = false): KeeperConfig => {
  if (_config && !force) {
    return _config;
  }

  const result = KeeperConfigSchema.safeParse({
    fromBlock: process.env.FROM_BLOCK,
    providerUrl: process.env.PROVIDER_URL,
    network: process.env.NETWORK,
    runEveryXBlock: process.env.RUN_EVERY_X_BLOCK,
    ethHdwalletMnemonic: process.env.ETH_HDWALLET_MNEMONIC,

    // This should really not exist? If deployed to AWS, VM should be IAM configured.
    awsRegion: process.env.AWS_REGION,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY,
    awsSecretAccessKey: process.env.AWS_SECRET_KEY,
  });

  if (!result.success) {
    throw result.error;
  }

  _config = result.data;
  return _config;
};

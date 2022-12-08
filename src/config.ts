import Joi from 'joi';

export enum KeeperSupportedNetwork {
  GOERLI_OVM = 'goerli-ovm',
  MAINNET_OVM = 'mainnet-ovm',
}

export interface KeeperConfig {
  // Keeper config
  fromBlock: number | 'latest';
  providerUrl: string;
  network: KeeperSupportedNetwork;
  runEveryXBlock: number;
  ethHdwalletMnemonic: string;

  // AWS config
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export const DEFAULT_CONFIG = {
  fromBlock: 1,
  network: KeeperSupportedNetwork.GOERLI_OVM,
  runEveryXBlock: 1,
};

export const KeeperConfigSchema = Joi.object({
  // Keeper config
  fromBlock: Joi.alternatives(Joi.string().valid('latest'), Joi.number().positive())
    .default(DEFAULT_CONFIG.fromBlock)
    .required(),
  providerUrl: Joi.string().required(),
  network: Joi.string()
    .valid(...Object.values(KeeperSupportedNetwork))
    .default(DEFAULT_CONFIG.network)
    .required(),
  runEveryXBlock: Joi.number()
    .positive()
    .default(DEFAULT_CONFIG.runEveryXBlock)
    .required(),
  ethHdwalletMnemonic: Joi.string().required(),

  // AWS config
  awsRegion: Joi.string(),
  awsAccessKeyId: Joi.string(),
  awsSecretAccessKey: Joi.string(),
});

let _config: KeeperConfig | undefined;

export const getConfig = (force = false): KeeperConfig => {
  if (_config && !force) {
    return _config;
  }

  console.log({
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

  const { value, error } = KeeperConfigSchema.validate({
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
  if (error) {
    throw error;
  }

  _config = value;
  return value;
};

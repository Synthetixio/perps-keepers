import { NetworkIdByName, NetworkName, synthetix } from '@synthetixio/contracts-interface';
import { providers, Signer } from 'ethers';

export function isSupportedNetwork(name: string): name is NetworkName {
  return name in NetworkIdByName;
}

export const getSynthetixContracts = ({
  network,
  signer,
  provider,
  useOvm,
}: {
  network: string;
  signer?: Signer;
  provider: providers.BaseProvider;
  useOvm: boolean;
}) => {
  if (!isSupportedNetwork(network)) {
    throw Error(`Invalid network ${network} (unsupported)`);
  }
  return synthetix({ networkId: NetworkIdByName[network], useOvm, provider, signer }).contracts;
};

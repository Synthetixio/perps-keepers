import {
  NetworkIdByName,
  NetworkName,
  synthetix,
} from "@synthetixio/contracts-interface";
import { providers, Signer } from "ethers";

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
  provider: providers.JsonRpcProvider | providers.WebSocketProvider;
  useOvm: boolean;
}) => {
  if (!isSupportedNetwork(network)) {
    throw Error(`Invalid network ${network}`);
  }
  const networkId = NetworkIdByName[network];
  const snx = synthetix({ networkId, useOvm, provider, signer });
  return snx.contracts;
};

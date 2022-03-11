// import { NetworkId, synthetix } from "@synthetixio/contracts-interface";
import {
  Contract,
  ContractInterface,
  getDefaultProvider,
  providers,
  Signer,
} from "ethers";
import snx from "synthetix";
const { getSource, getTarget } = snx;

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
  // Once @synthetixio/contracts-interface has the new contracts/deployment change implementation to this:
  // const networkId = parseInt(network) as NetworkId;
  // const snx = synthetix({ networkId, useOvm: true, provider, signer });
  // return snx.contracts;
  const sources: { [key: string]: { abi: ContractInterface } } = getSource({
    network,
    useOvm,
  });
  const targets: {
    [key: string]: { name: string; source: string; address: string };
  } = getTarget({
    network,
    useOvm,
  });

  return Object.values(targets)
    .map(target => {
      if (target.name === "Synthetix") {
        target.address = targets.ProxyERC20.address;
      } else if (target.name === "SynthsUSD") {
        target.address = targets.ProxyERC20sUSD.address;
      } else if (target.name === "FeePool") {
        target.address = targets.ProxyFeePool.address;
      } else if (target.name.match(/Synth(s|i)[a-zA-Z]+$/)) {
        const newTarget = target.name.replace("Synth", "Proxy");
        target.address = targets[newTarget].address;
      }
      return target;
    })
    .reduce((acc: { [name: string]: Contract }, { name, source, address }) => {
      acc[name] = new Contract(
        address,
        sources[source].abi,
        signer || provider || getDefaultProvider(network)
      );
      return acc;
    }, {});
};

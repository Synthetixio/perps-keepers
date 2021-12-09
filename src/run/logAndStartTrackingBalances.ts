import { formatEther } from "@ethersproject/units";
import { gray, yellow } from "chalk";
import {
  Contract,
  ContractInterface,
  getDefaultProvider,
  providers,
  Signer,
} from "ethers";
import snx from "synthetix";
import { trackKeeperBalance } from "../metrics";

const { getSource, getTarget } = snx;

// This is lifted from the synthetix-js package, since the package doesn't
// support local-ovm/kovan-ovm-futures artifacts, which impeded testing.
const getSynthetixContracts = ({
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
async function logAndStartTrackingBalances(
  {
    network,
    provider,
    signers,
  }: {
    network: string;
    provider: providers.WebSocketProvider | providers.JsonRpcProvider;
    signers: Signer[];
  },
  deps = { getSynthetixContracts, trackKeeperBalance }
) {
  // Check balances of accounts.
  const { SynthsUSD } = deps.getSynthetixContracts({
    network,
    provider: provider,
    useOvm: true,
  });

  const signerBalances = await Promise.all(
    signers.map(async signer => {
      // ETH.
      const balance = await signer.getBalance();

      const address = await signer.getAddress();
      // sUSD.
      const sUSDBalance = await SynthsUSD.balanceOf(address);

      const balances = [
        ["ETH", balance],
        ["sUSD", sUSDBalance],
      ];

      return { balances, address };
    })
  );
  // Log and track account balances
  signerBalances.forEach(({ address, balances }, i) => {
    const balanceText = balances
      .map(([key, balance]) => {
        let balanceText = formatEther(balance);
        if (balance.isZero()) {
          balanceText = yellow(balanceText);
        }
        return `${balanceText} ${key}`;
      })
      .join(", ");

    console.log(gray(`Account #${i}: ${address} (${balanceText})`));
    deps.trackKeeperBalance(signers[i], SynthsUSD);
  });
}
export default logAndStartTrackingBalances;

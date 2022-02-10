import { formatEther } from "@ethersproject/units";
import { gray, yellow } from "chalk";
import { providers, Signer } from "ethers";
import { trackKeeperBalance } from "../metrics";
import { getSynthetixContracts } from "../utils";

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

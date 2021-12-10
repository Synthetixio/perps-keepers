import { providers, Wallet } from "ethers";
import { HDNode } from "ethers/lib/utils";

function createWallets(
  {
    provider,
    mnemonic,
    num,
  }: {
    provider: providers.JsonRpcProvider | providers.WebSocketProvider;
    mnemonic: string;
    num: number;
  },
  deps = { HDNode, Wallet }
) {
  const masterNode = deps.HDNode.fromMnemonic(mnemonic);
  const wallets = [];

  for (let i = 0; i < num; i++) {
    wallets.push(
      new deps.Wallet(
        masterNode.derivePath(`m/44'/60'/0'/0/${i}`).privateKey,
        provider
      )
    );
  }

  return wallets;
}

export default createWallets;

import { providers, Wallet } from "ethers";
import { HDNode } from "ethers/lib/utils";

function createWallets({
  provider,
  mnemonic,
  num,
}: {
  provider: providers.JsonRpcProvider | providers.WebSocketProvider;
  mnemonic: string;
  num: number;
}) {
  const masterNode = HDNode.fromMnemonic(mnemonic);
  const wallets = [];

  for (let i = 0; i < num; i++) {
    wallets.push(
      new Wallet(
        masterNode.derivePath(`m/44'/60'/0'/0/${i}`).privateKey,
        provider
      )
    );
  }

  return wallets;
}

export default createWallets;

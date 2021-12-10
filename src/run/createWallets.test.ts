import { HDNode } from "@ethersproject/hdnode";
import createWallets from "./createWallets";

describe("createWallets", () => {
  test("works", () => {
    const args = {
      provider: "__PROVIDER__",
      mnemonic: "__MNEMONIC__",
      num: 2,
    } as any;
    const derivePathMock = jest
      .fn()
      .mockReturnValue({ privateKey: "__PRIVATE_KEY__" });
    const deps = {
      Wallet: jest.fn(),
      HDNode: {
        fromMnemonic: jest.fn().mockReturnValue({
          derivePath: derivePathMock,
        }),
      },
    } as any;
    createWallets(args, deps);
    expect(deps.HDNode.fromMnemonic).toBeCalledTimes(1);
    expect(deps.HDNode.fromMnemonic).toBeCalledWith("__MNEMONIC__");
    expect(derivePathMock).toBeCalledTimes(2);
    expect(derivePathMock).toHaveBeenNthCalledWith(1, `m/44'/60'/0'/0/0`);
    expect(derivePathMock).toHaveBeenNthCalledWith(2, `m/44'/60'/0'/0/1`);
    expect(deps.Wallet).toBeCalledTimes(2);
    expect(deps.Wallet).toBeCalledWith("__PRIVATE_KEY__", "__PROVIDER__");
  });
});

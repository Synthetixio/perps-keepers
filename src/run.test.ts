import { BigNumber } from "@ethersproject/bignumber";
import { DEFAULTS, run } from "./run";

describe("run", () => {
  test("throws when no MNEMONIC", () => {
    expect(() =>
      run(DEFAULTS, { ETH_HDWALLET_MNEMONIC: undefined } as any)
    ).rejects.toEqual(
      Error("ETH_HDWALLET_MNEMONIC environment variable is not configured.")
    );
  });
  test("happy path", async () => {
    const providerCreateMock = jest.fn().mockReturnValue("__PROVIDER__");
    const providerMonitorMock = jest.fn();
    const NonceManagerMock = jest.fn();
    const NonceManagerGetBalanceMock = jest
      .fn()
      .mockResolvedValue(BigNumber.from(1));
    const NonceManagerGetAddressMock = jest
      .fn()
      .mockResolvedValue("__ADDRESS__");
    const NonceManagerConnectMock = jest.fn().mockReturnValue({
      getBalance: NonceManagerGetBalanceMock,
      getAddress: NonceManagerGetAddressMock,
    });

    const SignerPoolCreateMock = jest.fn();

    const createWalletsMock = jest.fn().mockReturnValue(["___WALLET1___"]);
    const KeeperMockRun = jest.fn();
    const KeeperMockCreate = jest.fn().mockReturnValue({ run: KeeperMockRun });

    const getSynthetixContractsMock = jest.fn();
    const sUSDBalanceOfMock = jest.fn().mockResolvedValue(BigNumber.from(1000));
    const metricsRunServerMock = jest.fn();
    const metricsTrackKeeperBalance = jest.fn();

    const deps = {
      ETH_HDWALLET_MNEMONIC: "fake words",
      Providers: {
        create: providerCreateMock,
        monitor: providerMonitorMock,
      },
      NonceManager: NonceManagerMock.mockReturnValue({
        connect: NonceManagerConnectMock,
      }),
      SignerPool: { create: SignerPoolCreateMock },
      Keeper: { create: KeeperMockCreate },
      getSynthetixContracts: getSynthetixContractsMock.mockReturnValue({
        SynthsUSD: { balanceOf: sUSDBalanceOfMock },
      }),
      metrics: {
        runServer: metricsRunServerMock,
        trackKeeperBalance: metricsTrackKeeperBalance,
      },
      createWallets: createWalletsMock,
    } as any;

    await run({ numAccounts: "1" }, deps);
    expect(metricsRunServerMock).toBeCalledTimes(1);
    expect(providerCreateMock).toBeCalledTimes(1);
    expect(providerCreateMock).toBeCalledWith(DEFAULTS.providerUrl);
    expect(createWalletsMock).toBeCalledTimes(1);
    expect(createWalletsMock).toBeCalledWith({
      provider: "__PROVIDER__",
      mnemonic: deps.ETH_HDWALLET_MNEMONIC,
      num: 1,
    });
    expect(providerMonitorMock).toBeCalledTimes(1);
    expect(providerMonitorMock).toBeCalledWith("__PROVIDER__");
    expect(NonceManagerMock).toBeCalledTimes(1);
    expect(NonceManagerConnectMock).toBeCalledTimes(1);
    expect(NonceManagerConnectMock).toBeCalledWith("__PROVIDER__");
    expect(SignerPoolCreateMock).toBeCalledTimes(1);
    expect(SignerPoolCreateMock).toBeCalledWith({
      signers: expect.any(Array),
    });
    expect(NonceManagerGetBalanceMock).toBeCalledTimes(1);
    expect(sUSDBalanceOfMock).toBeCalledTimes(1);
    expect(NonceManagerGetAddressMock).toBeCalledTimes(1);
    expect(sUSDBalanceOfMock).toBeCalledWith("__ADDRESS__");

    expect(1).toBe(1);
  });
});

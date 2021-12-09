import { BigNumber } from "@ethersproject/bignumber";
import logAndStartTrackingBalances from "./logAndStartTrackingBalances";

describe("logAndStartTrackingBalances", () => {
  test("happy path", async () => {
    const network = "kovan";
    const provider = "__PROVIDER__";
    const signerMock = {
      getBalance: jest.fn().mockResolvedValue(BigNumber.from(1)),
      getAddress: jest.fn().mockResolvedValue("__ADDRESS__"),
    };
    const signers = [signerMock];
    const args = { network, provider, signers } as any;

    const SynthsUSD = {
      balanceOf: jest.fn().mockResolvedValue(BigNumber.from(100)),
    };
    const deps = {
      getSynthetixContracts: () => ({ SynthsUSD }),
      trackKeeperBalance: jest.fn(),
    } as any;

    await logAndStartTrackingBalances(args, deps);
    expect(signerMock.getAddress).toBeCalledTimes(1);
    expect(signerMock.getBalance).toBeCalledTimes(1);
    expect(SynthsUSD.balanceOf).toBeCalledTimes(1);
    expect(deps.trackKeeperBalance).toBeCalledTimes(1);
    expect(deps.trackKeeperBalance).toBeCalledWith(signerMock, SynthsUSD);
  });
});

import { BigNumber } from "@ethersproject/bignumber";
import { runServer, trackKeeperBalance } from "./metrics";

describe("metrics", () => {
  test("runServer", async () => {
    const listenMock = jest.fn();
    const getMock = jest.fn();
    const expressMock = jest
      .fn()
      .mockReturnValue({ listen: listenMock, get: getMock });
    const registerMetricMock = jest.fn();
    const setDefaultLabels = jest.fn();
    const promClientMock = {
      Registry: jest.fn().mockReturnValue({
        name: "__REGISTRY_INSTANCE__",
        registerMetric: registerMetricMock,
        setDefaultLabels: setDefaultLabels,
      }),
      collectDefaultMetrics: jest.fn(),
    };
    const metricsMock = [jest.fn(), jest.fn()];
    const deps = {
      express: expressMock,
      promClient: promClientMock,
      metrics: metricsMock,
    } as any;
    runServer("goerli-ovm", deps);
    expect(expressMock).toBeCalledTimes(1);

    expect(promClientMock.Registry.mock.instances.length).toBe(1);
    expect(promClientMock.collectDefaultMetrics).toBeCalledTimes(1);
    expect(promClientMock.collectDefaultMetrics).toHaveBeenCalledWith({
      register: {
        name: "__REGISTRY_INSTANCE__",
        registerMetric: registerMetricMock,
        setDefaultLabels: setDefaultLabels,
      },
    });
    expect(registerMetricMock).toBeCalledTimes(metricsMock.length);
    expect(registerMetricMock).toHaveBeenNthCalledWith(1, metricsMock[0]);
    expect(registerMetricMock).toHaveBeenNthCalledWith(2, metricsMock[1]);

    expect(getMock).toBeCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/metrics", expect.any(Function));

    expect(listenMock).toBeCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(8084, expect.any(Function));
  });
  test("trackKeeperBalance", async () => {
    jest.useFakeTimers();
    jest.spyOn(global, "setInterval");
    const signerMock = {
      getAddress: jest.fn().mockResolvedValue("__ADDRESS__"),
      getBalance: jest.fn().mockResolvedValue(BigNumber.from(1)),
    } as any;
    const SynthsUSDMock = {
      balanceOf: jest.fn().mockResolvedValue(BigNumber.from(1000)),
    } as any;
    const deps = {
      keeperEthBalance: { set: jest.fn() },
      keeperSusdBalance: { set: jest.fn() },
      intervalTimeMs: 2500,
    } as any;
    trackKeeperBalance(signerMock, "goerli-ovm", SynthsUSDMock, deps);

    // Advance the fake timers to tricker the setInterval
    jest.advanceTimersByTime(deps.intervalTimeMs);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenLastCalledWith(
      expect.any(Function),
      deps.intervalTimeMs
    );
    // Use real timer and wait 50ms to let the promises in the setInterval callback resolve
    jest.useRealTimers();
    await new Promise(res => setTimeout(res, 50));

    expect(signerMock.getAddress).toBeCalledTimes(1);
    expect(signerMock.getBalance).toBeCalledTimes(1);
    expect(SynthsUSDMock.balanceOf).toBeCalledTimes(1);
    expect(SynthsUSDMock.balanceOf).toBeCalledWith("__ADDRESS__");
    expect(deps.keeperEthBalance.set).toBeCalledTimes(1);
    expect(deps.keeperEthBalance.set).toBeCalledWith(
      { account: "__ADDRESS__", network: "goerli-ovm" },
      1e-18
    );
    expect(deps.keeperSusdBalance.set).toBeCalledTimes(1);
    expect(deps.keeperSusdBalance.set).toBeCalledWith(
      { account: "__ADDRESS__", network: "goerli-ovm" },
      1e-15
    );
  });
});

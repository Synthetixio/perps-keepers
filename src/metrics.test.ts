import { runServer } from "./metrics";

describe("metrics", () => {
  test("runServer", async () => {
    const listenMock = jest.fn();
    const getMock = jest.fn();
    const expressMock = jest
      .fn()
      .mockReturnValue({ listen: listenMock, get: getMock });
    const registerMetricMock = jest.fn();
    const promClientMock = {
      Registry: jest.fn().mockReturnValue({
        name: "__REGISTRY_INSTANCE__",
        registerMetric: registerMetricMock,
      }),
      collectDefaultMetrics: jest.fn(),
    };
    const metricsMock = [jest.fn(), jest.fn()];
    const deps = {
      express: expressMock,
      promClient: promClientMock,
      metrics: metricsMock,
    } as any;
    runServer(deps);
    expect(expressMock).toBeCalledTimes(1);

    expect(promClientMock.Registry.mock.instances.length).toBe(1);
    expect(promClientMock.collectDefaultMetrics).toBeCalledTimes(1);
    expect(promClientMock.collectDefaultMetrics).toHaveBeenCalledWith({
      register: {
        name: "__REGISTRY_INSTANCE__",
        registerMetric: registerMetricMock,
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
});

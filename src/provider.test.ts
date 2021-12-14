import { getProvider, monitorProvider } from "./provider";

describe("provider", () => {
  beforeEach(() => jest.clearAllMocks());
  describe("getProvider", () => {
    const deps = {
      providers: {
        JsonRpcProvider: jest.fn(),
        WebSocketProvider: jest.fn(),
      },
    } as any;
    test("https", () => {
      const result = getProvider("https://infura.com", deps);

      expect(deps.providers.JsonRpcProvider).toBeCalledTimes(1);
      expect(deps.providers.JsonRpcProvider).toBeCalledWith({
        timeout: 120000,
        url: "https://infura.com",
      });
      expect(deps.providers.WebSocketProvider).not.toBeCalled();
      expect(result).toEqual(deps.providers.JsonRpcProvider.mock.instances[0]);
    });
    test("http", () => {
      const result = getProvider("http://infura.com", deps);

      expect(deps.providers.JsonRpcProvider).toBeCalledTimes(1);
      expect(deps.providers.JsonRpcProvider).toBeCalledWith({
        timeout: 120000,
        url: "http://infura.com",
      });
      expect(deps.providers.WebSocketProvider).not.toBeCalled();
      expect(result).toEqual(deps.providers.JsonRpcProvider.mock.instances[0]);
    });
    test("wss", () => {
      const result = getProvider("ws://infura.com", deps);

      expect(deps.providers.WebSocketProvider).toBeCalledTimes(1);
      expect(deps.providers.WebSocketProvider).toBeCalledWith({
        timeout: 120000,
        url: "ws://infura.com",
        pollingInterval: 50,
      });
      expect(deps.providers.JsonRpcProvider).not.toBeCalled();
      expect(result).toEqual(
        deps.providers.WebSocketProvider.mock.instances[0]
      );
    });
    test("ws", () => {
      const result = getProvider("wss://infura.com", deps);

      expect(deps.providers.WebSocketProvider).toBeCalledTimes(1);
      expect(deps.providers.WebSocketProvider).toBeCalledWith({
        timeout: 120000,
        url: "wss://infura.com",
        pollingInterval: 50,
      });
      expect(deps.providers.JsonRpcProvider).not.toBeCalled();
      expect(result).toEqual(
        deps.providers.WebSocketProvider.mock.instances[0]
      );
    });
    test("throws when invalid url", () => {
      expect(() => {
        getProvider("bad url", deps);
      }).toThrowError("Invalid URL");
    });
  });
  describe("monitorProvider", () => {
    test("ws works", async () => {
      jest.useFakeTimers();
      const providerMock = {
        connection: { url: "test.com" },
        _websocket: {
          on: jest.fn().mockImplementation((event, cb) => {
            // Trigger open event directly
            if (event === "open") cb();
            if (event === "pong") cb();
          }),
          terminate: jest.fn(),
          ping: jest.fn(),
        },
      } as any;
      const deps = {
        WS_PROVIDER_TIMEOUT: 2 * 60 * 1000,
        HEARTBEAT_INTERVAL: 3000,
        ethNodeUptime: { set: jest.fn() },
        ethNodeHeartbeatRTT: { observe: jest.fn() },
      } as any;

      const stopMonitoring = monitorProvider(providerMock, deps);

      // Assert event listeners gets setup correctly
      expect(providerMock._websocket.on).toBeCalledTimes(3);
      expect(providerMock._websocket.on).toHaveBeenNthCalledWith(
        1,
        "open",
        expect.any(Function)
      );
      expect(providerMock._websocket.on).toHaveBeenNthCalledWith(
        2,
        "pong",
        expect.any(Function)
      );
      expect(providerMock._websocket.on).toHaveBeenNthCalledWith(
        3,
        "close",
        expect.any(Function)
      );
      expect(providerMock._websocket.ping).not.toHaveBeenCalled();

      // Assert ping gets called when heartbeat interval is triggered
      jest.advanceTimersByTime(deps.HEARTBEAT_INTERVAL);
      expect(providerMock._websocket.ping).toBeCalledTimes(1);

      // Ensure the promises in the interval gets resolved
      jest.useRealTimers();
      await new Promise(process.nextTick);

      // Assert that metrics gets called.
      expect(deps.ethNodeUptime.set).toBeCalledTimes(1);
      expect(deps.ethNodeUptime.set).toBeCalledWith(1);
      expect(deps.ethNodeHeartbeatRTT.observe).toBeCalledTimes(1);
      expect(deps.ethNodeHeartbeatRTT.observe).toBeCalledWith(
        expect.any(Number)
      );
      // Stop monitoring to avoid jest worker process warning
      stopMonitoring();
    });
    test("ws terminates and exits if open socket doesn't respond within WS_PROVIDER_TIMEOUT", () => {
      jest.useFakeTimers();
      const providerMock = {
        connection: { url: "test.com" },
        _websocket: {
          on: jest.fn().mockImplementation((event, cb) => {
            // Trigger open event directly
            if (event === "open") cb();
            if (event === "pong") {
            } // do not respond to pong event
          }),
          terminate: jest.fn(),
          ping: jest.fn(),
        },
      } as any;
      const deps = {
        WS_PROVIDER_TIMEOUT: 2 * 60 * 1000,
        HEARTBEAT_INTERVAL: 3000,
        ethNodeUptime: { set: jest.fn() },
        ethNodeHeartbeatRTT: { observe: jest.fn() },
      } as any;
      const processExitSpy = jest.spyOn(process, "exit").mockImplementation();
      const stopMonitoring = monitorProvider(providerMock, deps);
      jest.advanceTimersByTime(deps.WS_PROVIDER_TIMEOUT);

      expect(processExitSpy).toBeCalledWith(1);
      expect(providerMock._websocket.terminate).toBeCalled();
      stopMonitoring();
      jest.useRealTimers();
    });
    test("JSON RPC provider works", async () => {
      const providerMock = {
        connection: { url: "test.com" },
        getBlock: jest.fn().mockResolvedValue("__BLOCK__"),
      } as any;
      const deps = {
        HTTP_PROVIDER_TIMEOUT: 2 * 60 * 1000,
        HEARTBEAT_INTERVAL: 3000,
        ethNodeUptime: { set: jest.fn() },
        ethNodeHeartbeatRTT: { observe: jest.fn() },
      } as any;
      jest.useFakeTimers();
      const stopMonitoring = monitorProvider(providerMock, deps);
      jest.advanceTimersByTime(deps.HTTP_PROVIDER_TIMEOUT - 1); // important that it's less than HTTP_PROVIDER_TIMEOUT
      jest.useRealTimers();
      await new Promise(process.nextTick);
      expect(providerMock.getBlock).toBeCalled();
      expect(providerMock.getBlock).toHaveBeenCalledWith("latest");
      // Assert that metrics gets called.
      expect(deps.ethNodeUptime.set).toBeCalledTimes(1);
      expect(deps.ethNodeUptime.set).toBeCalledWith(1);
      expect(deps.ethNodeHeartbeatRTT.observe).toBeCalledTimes(1);
      expect(deps.ethNodeHeartbeatRTT.observe).toBeCalledWith(
        expect.any(Number)
      );
      stopMonitoring();
    });

    test("JSON RPC provider exits if open socket doesn't respond within WS_PROVIDER_TIMEOUT", () => {
      const providerMock = {
        connection: { url: "test.com" },
        getBlock: jest.fn().mockImplementation(() => new Promise(() => {})), // simulate getBlock promise never resolves
      } as any;
      const deps = {
        HTTP_PROVIDER_TIMEOUT: 2 * 60 * 1000,
        HEARTBEAT_INTERVAL: 3000,
        ethNodeUptime: { set: jest.fn() },
        ethNodeHeartbeatRTT: { observe: jest.fn() },
      } as any;
      jest.useFakeTimers();
      const processExitSpy = jest.spyOn(process, "exit").mockImplementation();

      const stopMonitoring = monitorProvider(providerMock, deps);
      jest.advanceTimersByTime(deps.HTTP_PROVIDER_TIMEOUT); // Move forward in time to trigger the heartbeatTimeout

      expect(processExitSpy).toBeCalledWith(1);
      stopMonitoring();
      jest.clearAllTimers();
      jest.useRealTimers();
    });
  });
});

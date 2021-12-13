import { getProvider } from "./provider";

describe("provider", () => {
  describe("getProvider", () => {
    beforeEach(() => jest.clearAllMocks());
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
});

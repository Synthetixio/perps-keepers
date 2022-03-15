import { providers } from "ethers";

import { ethNodeUptime, ethNodeHeartbeatRTT } from "./metrics";
import { createLogger } from "./logging";

const getErrorMessage = (e: unknown) => {
  if (e instanceof Error) return e.message;
  return e &&
    typeof e === "object" &&
    "toString" in e &&
    typeof e.toString === "function"
    ? e.toString()
    : String(e);
};

const logger = createLogger({ componentName: "ProviderHeartbeat" });

async function runNextTick(fn: () => Promise<void>) {
  await new Promise((resolve, reject) => {
    process.nextTick(() => {
      fn()
        .then(resolve)
        .catch(reject);
    });
  });
}

class Stopwatch {
  hrTime: [number, number] | undefined;
  start() {
    this.hrTime = process.hrtime();
  }

  stop() {
    const hrTime = process.hrtime(this.hrTime);
    const ms = hrTime[0] * 1000 + hrTime[1] / 1000000;
    return ms;
  }
}

export const getProvider = (
  providerUrl: string,
  deps = { providers }
): providers.JsonRpcProvider | providers.WebSocketProvider => {
  const url = new URL(providerUrl);

  if (url.protocol.match(/^(ws|wss):/)) {
    // @ts-ignore TODO, it seems like we instantiate this incorrectly
    return new deps.providers.WebSocketProvider({
      url: providerUrl,
      pollingInterval: 50,
      timeout: WS_PROVIDER_TIMEOUT,
    });
  }
  if (url.protocol.match(/^(http|https):/)) {
    return new deps.providers.JsonRpcProvider({
      url: providerUrl,
      // pollingInterval: 50,  pollingInterval is not a valid option
      timeout: HTTP_PROVIDER_TIMEOUT,
    });
  }
  throw new Error("Unknown provider protocol scheme - " + url.protocol);
};

const WS_PROVIDER_TIMEOUT = 2 * 60 * 1000;
const HTTP_PROVIDER_TIMEOUT = WS_PROVIDER_TIMEOUT;
const HEARTBEAT_INTERVAL = 60000;
export const monitorProvider = (
  provider: providers.JsonRpcProvider | providers.WebSocketProvider,
  network: string,
  deps = {
    WS_PROVIDER_TIMEOUT,
    HTTP_PROVIDER_TIMEOUT,
    HEARTBEAT_INTERVAL,
    ethNodeUptime,
    ethNodeHeartbeatRTT,
  }
) => {
  let heartbeatTimeout: NodeJS.Timeout | undefined;
  let heartbeatInterval: NodeJS.Timeout | undefined;
  const stopwatch = new Stopwatch();
  let running = true;
  if ("_websocket" in provider) {
    async function monitorWsProvider(provider: providers.WebSocketProvider) {
      while (running) {
        // Listen for timeout.
        heartbeatTimeout = setTimeout(() => {
          logger.error("The heartbeat to the RPC provider timed out.");
          heartbeatTimeout && clearTimeout(heartbeatTimeout);

          // Use `WebSocket#terminate()`, which immediately destroys the connection,
          // instead of `WebSocket#close()`, which waits for the close timer.
          provider._websocket.terminate();
          process.exit(1);
        }, WS_PROVIDER_TIMEOUT);

        // Heartbeat.
        try {
          logger.info(`ping (${provider.connection.url})`);
          const pong = new Promise((res, rej) => {
            provider._websocket.on("pong", res);
          });

          stopwatch.start();
          await runNextTick(async () => provider._websocket.ping());
          await pong;
          const ms = stopwatch.stop();

          logger.info(`pong rtt=${ms}ms`);

          deps.ethNodeUptime.set({ network }, 1);
          deps.ethNodeHeartbeatRTT.observe({ network }, ms);
        } catch (e) {
          const errorMessage = getErrorMessage(e);
          logger.error("Error while pinging provider: " + errorMessage);
          process.exit(-1);
        }
        clearTimeout(heartbeatTimeout);

        await new Promise((res, rej) => {
          heartbeatInterval = setTimeout(res, deps.HEARTBEAT_INTERVAL);
        });
      }
    }

    provider._websocket.on("open", () => {
      monitorWsProvider(provider);
    });

    provider._websocket.on("close", () => {
      logger.error("The websocket connection was closed");

      heartbeatTimeout && clearTimeout(heartbeatTimeout);
      process.exit(1);
    });
  } else {
    async function monitorJsonProvider() {
      while (running) {
        // Listen for timeout.
        heartbeatTimeout = setTimeout(() => {
          logger.error("The heartbeat to the RPC provider timed out.");
          heartbeatTimeout && clearTimeout(heartbeatTimeout);
          process.exit(1);
        }, HTTP_PROVIDER_TIMEOUT);

        // Heartbeat.
        try {
          logger.info(`ping (${provider.connection.url})`);
          stopwatch.start();
          await runNextTick(async () => {
            await provider.getBlock("latest");
          });

          const ms = stopwatch.stop();

          logger.info(`pong rtt=${ms}ms`);

          deps.ethNodeUptime.set({ network }, 1);
          deps.ethNodeHeartbeatRTT.observe({ network }, ms);
        } catch (e) {
          const errorMessage = getErrorMessage(e);
          logger.error("Error while pinging provider: " + errorMessage);
          process.exit(-1);
        }
        clearTimeout(heartbeatTimeout);

        await new Promise((res, rej) => {
          heartbeatInterval = setTimeout(res, deps.HEARTBEAT_INTERVAL);
        });
      }
    }

    monitorJsonProvider();
  }
  return function stopMonitoring() {
    heartbeatInterval && clearTimeout(heartbeatInterval);
    heartbeatTimeout && clearTimeout(heartbeatTimeout);
    running = false;
  };
};

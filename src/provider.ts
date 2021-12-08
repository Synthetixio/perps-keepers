import { ethers } from "ethers";

import * as metrics from "./metrics";
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

const WS_PROVIDER_TIMEOUT = 2 * 60 * 1000;
const HTTP_PROVIDER_TIMEOUT = WS_PROVIDER_TIMEOUT;

export class Providers {
  static create(providerUrl: string) {
    const url = new URL(providerUrl);

    if (url.protocol.match(/^(ws|wss):/)) {
      // @ts-ignore TODO, it seems like we instantiate this incorrectly
      return new ethers.providers.WebSocketProvider({
        url: providerUrl,
        pollingInterval: 50,
        timeout: WS_PROVIDER_TIMEOUT,
      });
    }
    if (url.protocol.match(/^(http|https):/)) {
      return new ethers.providers.JsonRpcProvider({
        url: providerUrl,
        // pollingInterval: 50,  pollingInterval is not a valid option
        timeout: HTTP_PROVIDER_TIMEOUT,
      });
      // provider = new ethers.providers.InfuraProvider({
      //     url: "https://optimism-kovan.infura.io/v3/***REMOVED***",
      //     network: "optimism-kovan",
      //     pollingInterval: 50,
      //     timeout: 1000 * 60 // 1 minute
      // });
    }
    throw new Error("Unknown provider protocol scheme - " + url.protocol);
  }

  // Setup the provider to exit the process if a connection is closed.
  static monitor(
    provider:
      | ethers.providers.JsonRpcProvider
      | ethers.providers.WebSocketProvider
  ) {
    const HEARTBEAT_INTERVAL = 10000;
    let heartbeatTimeout: NodeJS.Timeout | undefined;
    const stopwatch = new Stopwatch();

    if ("_websocket" in provider) {
      async function monitorWs(provider: ethers.providers.WebSocketProvider) {
        while (true) {
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
            logger.info("ping");
            const pong = new Promise((res, rej) => {
              provider._websocket.on("pong", res);
            });

            stopwatch.start();
            await runNextTick(async () => provider._websocket.ping());
            await pong;
            const ms = stopwatch.stop();

            logger.info(`pong rtt=${ms}ms`);
            metrics.ethNodeUptime.set(1);
            metrics.ethNodeHeartbeatRTT.observe(ms);
          } catch (e) {
            const errorMessage = getErrorMessage(e);
            logger.error("Error while pinging provider: " + errorMessage);
            process.exit(-1);
          }
          clearTimeout(heartbeatTimeout);

          await new Promise((res, rej) => setTimeout(res, HEARTBEAT_INTERVAL));
        }
      }

      provider._websocket.on("open", () => {
        monitorWs(provider);
      });

      provider._websocket.on("close", () => {
        logger.error("The websocket connection was closed");

        heartbeatTimeout && clearTimeout(heartbeatTimeout);
        process.exit(1);
      });
    } else {
      async function monitor() {
        while (true) {
          // Listen for timeout.
          heartbeatTimeout = setTimeout(() => {
            logger.error("The heartbeat to the RPC provider timed out.");
            heartbeatTimeout && clearTimeout(heartbeatTimeout);
            process.exit(1);
          }, HTTP_PROVIDER_TIMEOUT);

          // Heartbeat.
          try {
            logger.info("ping");
            stopwatch.start();
            await runNextTick(async () => {
              provider.getBlock("latest");
            });
            const ms = stopwatch.stop();
            logger.info(`pong rtt=${ms}ms`);

            metrics.ethNodeUptime.set(1);
            metrics.ethNodeHeartbeatRTT.observe(ms);
          } catch (e) {
            const errorMessage = getErrorMessage(e);
            logger.error("Error while pinging provider: " + errorMessage);
            process.exit(-1);
          }
          clearTimeout(heartbeatTimeout);

          await new Promise((res, rej) => setTimeout(res, HEARTBEAT_INTERVAL));
        }
      }

      monitor();
    }
  }
}

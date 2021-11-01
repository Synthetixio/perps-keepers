const ethers = require("ethers");
const metrics = require("./metrics");
const { createLogger } = require("./logging");

function validateProviderUrl(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Provider URL must be a ws[s]:// endpoint");
  }
}

const logger = createLogger({ componentName: "ProviderHeartbeat" });

async function runNextTick(fn) {
  await new Promise((resolve, reject) => {
    process.nextTick(() => {
      fn()
        .then(resolve)
        .catch(reject);
    });
  });
}

class Stopwatch {
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

class Providers {
  static create(providerUrl) {
    const url = new URL(providerUrl);
    // validateProviderUrl(providerUrl);

    let provider;
    if (url.protocol.match(/ws[s]:/)) {
      provider = new ethers.providers.WebSocketProvider({
        url: providerUrl,
        pollingInterval: 50,
        timeout: WS_PROVIDER_TIMEOUT
      });
    } else if (url.protocol.match(/http[s]:/)) {
      provider = new ethers.providers.JsonRpcProvider({
        url: providerUrl,
        pollingInterval: 50,
        timeout: HTTP_PROVIDER_TIMEOUT
      });
      // provider = new ethers.providers.InfuraProvider({
      //     url: "https://optimism-kovan.infura.io/v3/***REMOVED***",
      //     network: "optimism-kovan",
      //     pollingInterval: 50,
      //     timeout: 1000 * 60 // 1 minute
      // });
    } else {
      throw new Error("Unknown provider protocol scheme - " + url.protocol);
    }

    return provider;
  }

  // Setup the provider to exit the process if a connection is closed.
  static monitor(provider) {
    const HEARTBEAT_INTERVAL = 10000;
    let heartbeatTimeout;
    const stopwatch = new Stopwatch();

    if (provider._websocket) {
      async function monitor() {
        while (true) {
          // Listen for timeout.
          heartbeatTimeout = setTimeout(() => {
            logger.error("The heartbeat to the RPC provider timed out.");
            clearTimeout(heartbeatTimeout);

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
          } catch (ex) {
            logger.error("Error while pinging provider: " + ex.toString());
            process.exit(-1);
          }
          clearTimeout(heartbeatTimeout);

          await new Promise((res, rej) => setTimeout(res, HEARTBEAT_INTERVAL));
        }
      }

      provider._websocket.on("open", () => {
        monitor();
      });

      provider._websocket.on("close", () => {
        logger.error("The websocket connection was closed");
        clearTimeout(heartbeatTimeout);
        process.exit(1);
      });

      // provider._websocket.on("open", () => {
      //   heartbeat = setInterval(() => {
      //     logger.info('ping')
      //     stopwatch.start()
      //     await runNextTick(() => provider._websocket.ping())

      //     // Use `WebSocket#terminate()`, which immediately destroys the connection,
      //     // instead of `WebSocket#close()`, which waits for the close timer.
      //     heartbeatTimeout = setTimeout(() => {
      //       provider._websocket.terminate();
      //     }, HEARTBEAT_TIMEOUT);
      //   }, HEARTBEAT_INTERVAL);
      // });

      // provider._websocket.on("close", () => {
      //   logger.error("The websocket connection was closed");
      //   clearInterval(heartbeat);
      //   clearTimeout(heartbeatTimeout);
      //   process.exit(1);
      // });

      // provider._websocket.on("pong", () => {
      //   const ms = stopwatch.stop()
      //   logger.info(`pong rtt=${ms}`)
      //   metrics.ethNodeUptime.set(1);
      //   clearInterval(heartbeatTimeout);
      // });
    } else {
      async function monitor() {
        while (true) {
          // Listen for timeout.
          heartbeatTimeout = setTimeout(() => {
            logger.error("The heartbeat to the RPC provider timed out.");
            clearTimeout(heartbeatTimeout);
            process.exit(1);
          }, HTTP_PROVIDER_TIMEOUT);

          // Heartbeat.
          try {
            logger.info("ping");
            stopwatch.start();
            await runNextTick(() => provider.getBlock("latest"));
            const ms = stopwatch.stop();
            logger.info(`pong rtt=${ms}ms`);

            metrics.ethNodeUptime.set(1);
            metrics.ethNodeHeartbeatRTT.observe(ms);
          } catch (ex) {
            logger.error("Error while pinging provider: " + ex.toString());
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

module.exports = {
  Providers
};

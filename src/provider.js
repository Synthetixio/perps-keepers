const ethers = require("ethers");
const metrics = require("./metrics");
const { createLogger } = require('./logging')

function validateProviderUrl(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Provider URL must be a ws[s]:// endpoint");
  }
}

const logger = createLogger({ componentName: "ProviderHeartbeat" })

class Providers {
  static create(providerUrl) {
    const url = new URL(providerUrl);
    // validateProviderUrl(providerUrl);

    let provider;
    if (url.protocol.match(/ws[s]:/)) {
      provider = new ethers.providers.WebSocketProvider({
        url: providerUrl,
        pollingInterval: 50,
        timeout: 1000 * 60 // 1 minute
      });
    } else if (url.protocol.match(/http[s]:/)) {
      provider = new ethers.providers.JsonRpcProvider({
        url: providerUrl,
        pollingInterval: 50,
        timeout: 3 * 1000 * 60 // 3 minutes
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
    let heartbeat, heartbeatTimeout;

    if (provider._websocket) {
      const HEARTBEAT_TIMEOUT = 60000;

      provider._websocket.on("open", () => {
        heartbeat = setInterval(() => {
          provider._websocket.ping();

          // Use `WebSocket#terminate()`, which immediately destroys the connection,
          // instead of `WebSocket#close()`, which waits for the close timer.
          heartbeatTimeout = setTimeout(() => {
            provider._websocket.terminate();
          }, HEARTBEAT_TIMEOUT);
        }, HEARTBEAT_INTERVAL);
      });

      provider._websocket.on("close", () => {
        logger.error("The websocket connection was closed");
        clearInterval(heartbeat);
        clearTimeout(heartbeatTimeout);
        process.exit(1);
      });

      provider._websocket.on("pong", () => {
        metrics.ethNodeUptime.set(1);
        clearInterval(heartbeatTimeout);
      });
    } else {
      const HEARTBEAT_TIMEOUT = 3 * 60000;

      const onClose = async () => {
        logger.error("The heartbeat to the RPC provider timed out.");
        clearInterval(heartbeat);
        clearTimeout(heartbeatTimeout);
        process.exit(1);
      };

      heartbeat = setInterval(async () => {
        // ping
        process.nextTick(async () => {
          try {
            await provider.getBlock("latest")
            // pong
            metrics.ethNodeUptime.set(1);
            clearInterval(heartbeatTimeout);
          } catch(ex) {
            logger.error('Error sending heartbeat to RPC provider:')
            process.exit(1);
          }
        })

        heartbeatTimeout = setTimeout(() => {
          onClose();
        }, HEARTBEAT_TIMEOUT);
      }, HEARTBEAT_INTERVAL);
    }
  }
}

module.exports = {
  Providers
};

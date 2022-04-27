import client from "prom-client";
import express from "express";
import { formatEther } from "@ethersproject/units";
import { BigNumber, ethers } from "ethers";
import { createLogger } from "./logging";

// constants
export const VOLUME_RECENCY_CUTOFF = 6 * 3600; // 1 day

// Metrics.

const keeperEthBalance = new client.Gauge({
  name: "keeper_eth_balance",
  help: "The ETH balance of the keeper",
  labelNames: ["account", "network"],
});
const keeperSusdBalance = new client.Gauge({
  name: "keeper_sUSD_balance",
  help: "The sUSD balance of the keeper",
  labelNames: ["account", "network"],
});
export const ethNodeUptime = new client.Gauge({
  name: "eth_uptime",
  help: "Whether the Ethereum node is responding is running",
  labelNames: ["network"],
});
export const ethNodeHeartbeatRTT = new client.Summary({
  name: "eth_heartbeat_rtt",
  help: "Round trip time of the heartbeat to the ETH RPC node.",
  labelNames: ["network"],
});
export const futuresOpenPositions = new client.Gauge({
  name: "futures_open_positions",
  help: "Positions being monitored for liquidation",
  labelNames: ["market", "network"],
});
export const futuresLiquidations = new client.Gauge({
  name: "futures_liquidations",
  help: "Number of liquidations made by this keeper",
  labelNames: ["market", "network"],
});
export const keeperErrors = new client.Gauge({
  name: "keeper_errors",
  help: "Number of errors in running keeper tasks",
  labelNames: ["market", "network", "errorMessage"],
});
export const keeperChecks = new client.Gauge({
  name: "keeper_checks",
  help: "Number of liquidation checks the keeper did",
  labelNames: ["market", "network"],
});
export const totalLiquidations = new client.Gauge({
  name: "total_liquidations",
  help: "Total number of liquidations",
  labelNames: ["market", "network"],
});
export const marketSize = new client.Gauge({
  name: "market_size",
  help: "Open interest in USD",
  labelNames: ["market", "network"],
});
export const marketSkew = new client.Gauge({
  name: "skew",
  help: "Market skew in USD",
  labelNames: ["market", "network"],
});
export const recentVolume = new client.Gauge({
  name: "recent_volume",
  help: "Recent volume in USD",
  labelNames: ["market", "network"],
});

const metrics = [
  keeperEthBalance,
  keeperSusdBalance,
  ethNodeUptime,
  ethNodeHeartbeatRTT,
  futuresOpenPositions,
  futuresLiquidations,
  keeperErrors,
  keeperChecks,
  totalLiquidations,
  marketSize,
  marketSkew,
  recentVolume,
];
export function runServer(
  network: string,
  deps = { express, promClient: client, metrics }
) {
  const app = deps.express();

  // Setup registry.
  const Registry = deps.promClient.Registry;
  const register = new Registry();

  register.setDefaultLabels({ network });
  // Register metrics.
  deps.promClient.collectDefaultMetrics({ register });

  deps.metrics.map(metric => register.registerMetric(metric));

  // Register Prometheus endpoint.
  app.get("/metrics", async (req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  });
  const port = process.env.METRIC_SERVER_PORT
    ? parseInt(process.env.METRIC_SERVER_PORT)
    : 8084;
  // Run Express HTTP server.
  app.listen(port, () => {
    console.log(
      `Prometheus HTTP server is running on http://localhost:${port}, metrics are exposed on http://localhost:${port}/metrics`
    );
  });
}

export function bnToNumber(bn: BigNumber) {
  return parseFloat(formatEther(bn));
}

const logger = createLogger({ componentName: "Balance tracker" });
// Tracker functions.
export function trackKeeperBalance(
  signer: ethers.Signer,
  network: string,
  SynthsUSD: ethers.Contract,
  deps = {
    keeperEthBalance,
    keeperSusdBalance,
    intervalTimeMs: 60000,
  }
) {
  setInterval(async () => {
    try {
      const [account, balance] = await Promise.all([
        signer.getAddress(),
        signer.getBalance(),
      ]);
      const sUSDBalance = await SynthsUSD.balanceOf(account);
      deps.keeperEthBalance.set({ account, network }, bnToNumber(balance));
      deps.keeperSusdBalance.set({ account, network }, bnToNumber(sUSDBalance));
    } catch (error) {
      logger.error(
        `We're having problems getting balances, error: \n ${String(Error)}`
      );
    }
  }, deps.intervalTimeMs);
}

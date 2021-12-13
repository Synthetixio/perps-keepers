import client from "prom-client";
import express from "express";
import { formatEther } from "@ethersproject/units";
import { BigNumber, ethers } from "ethers";

// Metrics.

const keeperEthBalance = new client.Gauge({
  name: "keeper_eth_balance",
  help: "The ETH balance of the keeper",
  labelNames: ["account"],
});
const keeperSusdBalance = new client.Gauge({
  name: "keeper_sUSD_balance",
  help: "The sUSD balance of the keeper",
  labelNames: ["account"],
});
export const ethNodeUptime = new client.Gauge({
  name: "eth_uptime",
  help: "Whether the Ethereum node is responding is running",
});
export const ethNodeHeartbeatRTT = new client.Summary({
  name: "eth_heartbeat_rtt",
  help: "Round trip time of the heartbeat to the ETH RPC node.",
});
export const futuresOpenPositions = new client.Gauge({
  name: "futures_open_positions",
  help: "Positions being monitored for liquidation",
  labelNames: ["market"],
});
export const futuresLiquidations = new client.Summary({
  name: "futures_liquidations",
  help: "Number of liquidations",
  labelNames: ["market", "success"],
});
export const keeperErrors = new client.Summary({
  name: "keeper_errors",
  help: "Number of errors in running keeper tasks",
  labelNames: ["market"],
});

const metrics = [
  keeperEthBalance,
  keeperSusdBalance,
  ethNodeUptime,
  ethNodeHeartbeatRTT,
  futuresOpenPositions,
  futuresLiquidations,
  keeperErrors,
];
export function runServer(deps = { express, promClient: client, metrics }) {
  const app = deps.express();

  // Setup registry.
  const Registry = deps.promClient.Registry;
  const register = new Registry();

  // Register metrics.
  deps.promClient.collectDefaultMetrics({ register });

  deps.metrics.map(metric => register.registerMetric(metric));

  // Register Prometheus endpoint.
  app.get("/metrics", async (req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  // Run Express HTTP server.
  app.listen(8084, () => {
    console.log(
      "Prometheus HTTP server is running on http://localhost:8084, metrics are exposed on http://localhost:8084/metrics"
    );
  });
}

// Tracker functions.

export function trackKeeperBalance(
  signer: ethers.Signer,
  SynthsUSD: ethers.Contract,
  deps = {
    keeperEthBalance,
    keeperSusdBalance,
    intervalTimeMs: 2500,
  }
) {
  setInterval(async () => {
    const account = await signer.getAddress();
    const balance = await signer.getBalance();
    const sUSDBalance = await SynthsUSD.balanceOf(account);

    const bnToNumber = (bn: BigNumber) => parseFloat(formatEther(bn));
    deps.keeperEthBalance.set({ account }, bnToNumber(balance));
    deps.keeperSusdBalance.set({ account }, bnToNumber(sUSDBalance));
  }, deps.intervalTimeMs);
}

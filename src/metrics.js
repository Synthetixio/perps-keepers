
const client = require('prom-client');
const express = require('express');


// Metrics.

const keeperEthBalance = new client.Gauge({ name: 'keeper_eth_balance', help: 'The ETH balance of the keeper' });
const keeperSusdBalance = new client.Gauge({ name: 'keeper_sUSD_balance', help: 'The sUSD balance of the keeper' })


function runServer() {
    const app = express();

    // Setup registry.
    const Registry = client.Registry;
    const register = new Registry();
    const collectDefaultMetrics = client.collectDefaultMetrics;

    // Register metrics.
    collectDefaultMetrics({ register });
    register.registerMetric(keeperEthBalance)
    register.registerMetric(keeperSusdBalance)

    // Register Prometheus endpoint.
    app.get('/metrics', async (req, res) => {
        res.setHeader('Content-Type', register.contentType);
        res.send(await register.metrics());
    });

    // Run Express HTTP server.
    app.listen(8080, () => {
        console.log('Prometheus HTTP server is running on http://localhost:8080, metrics are exposed on http://localhost:8080/metrics')
    });
}

// Tracker functions.

function trackKeeperBalance(signer, SynthsUSD) {
    setInterval(async () => {
        const balance = await signer.getBalance()
        const sUSDBalance = await SynthsUSD.balanceOf(await signer.getAddress());

        const bnToNumber = (bn) => parseFloat(formatEther(bn))
        keeperEthBalance.set(bnToNumber(balance))
        keeperSusdBalance.set(bnToNumber(sUSDBalance))
    }, 2500)
}

module.exports = { 
    trackKeeperBalance,
    runServer
}
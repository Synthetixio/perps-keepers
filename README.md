# futures-keeper

A liquidations keeper bot for Synthetix Futures.

- **Serial processing** - older orders are checked before later ones.

- **Backlog processing** - the keeper maintains an in-memory index from scanning blocks. If there is a backlog of unprocessed events, a keeper can be started to re-index from a specific block using `--from-block`, and then execute keeper actions based on the most recent state of the index.

- **Parallel tx submission** - on the OVM, we are competing on submitting transactions quickly to the node, as each transaction is mined as it is received. In a production scenario, there might be 10's of other transactions being delivered while we are submitting the keeper transactions. The bot includes a feature to submit transactions from multiple accounts (of a HD wallet) across multiple websocket connections in parallel. The multiple accounts ensures we can submit transactions in parallel without the node receiving tx's in different order and failing on a nonce error. The multiple websocket connections was an optimization I implemented which marginally increased performance too.

- **Metrics**. A variety of metrics ([documented here](src/metrics.js)) are collected and exposed on a [Prometheus](https://prometheus.io/) endpoint, which can be easily integrated with [Grafana](https://grafana.com/) for visualisation and alerts.

## Configure.

### Environment configuration.

Any variables specified in `.env` at the project root will be loaded using [dotenv](https://www.npmjs.com/package/dotenv).

- **`ETH_HDWALLET_MNEMONIC`**: the HD wallet mnemonic used to unlock the bot's wallet. The bot does not support private keys.

## Usage.

```
Usage: index run [options]

Run the keeper

Options:
  -b, --from-block <value>    Rebuild the keeper index from a starting block, before initiating keeper actions. (default: "latest")
  -p, --provider-url <value>  Ethereum RPC URL (default: "ws://localhost:8546")
  --network <value>           Ethereum network to connect to. (default: "kovan-ovm-futures")
  -n, --num-accounts <value>  Number of accounts from the HD wallet to use for parallel tx submission. Improves performance. (default: 10)
  -m, --markets <value>       Runs keeper operations for the specified markets, delimited by a comma. Supported markets: sETH, sBTC, sLINK. (default:
                              "sBTC,sETH,sLINK")
  -h, --help                  display help for command
```

```sh
NETWORK=kovan-ovm-futures node src/ run -p ws://kovan.optimism.io:8546 --from-block 0 -n 1 --network kovan-ovm-futures
```

### Restarting on disconnect.

The keeper is a long-running process. The only time it will shutdown is if its websocket connection to the Ethereum node is disconnected.

It is trivial to restart automatically like so:

```sh
until node src/ run -p wss://ws-kovan.optimism.io --from-block 0 -n 1; do
    echo "Keeper exited with exit code $?.  Respawning.." >&2
    sleep 3
done
```

## Instrumentation/metrics.

Prometheus is a pull-based instrumentation system. We must run a separate Prometheus server to scrape the metrics and upload them to a remote endpoint. See [`prometheus/`](prometheus/) for more.

## Development & Handover notes

- Testing new changes: the current way of testing is manual, vs. a local instance of OVM deployment. Some simple integration test vs. local network should be added (add some positions, modify prices, see that liquidations happen).
- Updating with new deployments: the contracts repo reference needs to be udpated, the `node_modules/` folder for it needs to be removed (npm not detecting cache issue)
- Infra: currently runs on AWS (Syntetix account), will be run by community member / 3rd party instead.
- Monitoring: the current setup is being monitored via Prometheus + Grafana + alerts to discord.
- Future maintenence work: the current flow is very inefficient (checks all positions every block), which means that it's possible that liquidations won't keep up due to node chatter bottleneck. The implementation should maintain a view of position liquidation prices (by following events / subgraph) and only check liquidation status for the positions most at risk (liquidation price closeest to current price).

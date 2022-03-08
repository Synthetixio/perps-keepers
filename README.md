# futures-keeper

Synthetix futures lets anyone liquidate a position by calling `liquidatePosition(address)` if the address has an open position that is under water. You can check if a wallet have a position under water by calling `canLiquidate(address)`

This repository is an example liquidations keeper bot that anyone can run.

Features include:

- **Backlog processing** - the keeper maintains an in-memory index from scanning blocks. If there is a backlog of unprocessed events, a keeper can be started to re-index from a specific block using `--from-block`, and then execute keeper actions based on the most recent state of the index.

- **Position processing** - position with higher leverage are checked first

- **Parallel tx submission** - on the OVM, we are competing on submitting transactions quickly to the node, as each transaction is mined as it is received. In a production scenario, there might be 10's of other transactions being delivered while we are submitting the keeper transactions. The bot includes a feature to submit transactions from multiple accounts (of a HD wallet) across multiple websocket connections in parallel. The multiple accounts ensures we can submit transactions in parallel without the node receiving tx's in different order and failing on a nonce error. The multiple websocket connections was an optimization implemented which marginally increased performance too.

- **Metrics**. A variety of metrics ([documented here](src/metrics.js)) are collected and exposed on a [Prometheus](https://prometheus.io/) endpoint, which can be easily integrated with [Grafana](https://grafana.com/) for visualisation and alerts.

## Configure.

### Environment configuration.

Any variables specified in `.env` at the project root will be loaded using [dotenv](https://www.npmjs.com/package/dotenv).

**Required variables:**

- **`ETH_HDWALLET_MNEMONIC`**: the HD wallet mnemonic used to unlock the bot's wallet. The bot does not support private keys.

**Optional variables used for testing on a local fork (see Futures interact CLI section):**

- **`INTERACT_WALLET_PRIVATE_KEY`**: Wallet used to open positions with
- **`DEPLOYER_WALLET_PRIVATE_KEY`**: Owner of synthetix `ExchangeRates` contract, only needed if you want to fake/manipulate price feeds on a local fork.

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

## Futures interact CLI

### Setup for local node:

1. Start a local node:
   `hardhat node --fork https://optimism-kovan.infura.io/v3/<infura key>`
2. Fund one of the test wallets.

   - Checkout: https://github.com/synthetixio/synthetix
   - `git checkout futures-implementation`
   - npm install
   - `npx hardhat fund-local-accounts --provider-url http://127.0.0.1:8545/ --target-network kovan-ovm-futures --deployment-path ./publish/deployed/kovan-ovm-futures/ --use-ovm --private-key $KOVAN_OVM_FUTURES_DEPLOYER_PRIVATE_KEY --account 0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199`
     `0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199` is one of the default accounts from hardhat node --fork

### Usage

`npx ts-node --files futures-interact-cli` commands and options documented in the CLI.
Current commands/ features:

- fundAndOpenPosition
- fundMargin
- openPosition
- closePosition
- checkPosition
- setPrice
  To get help for a certain command:
  `npx ts-node --files futures-interact-cli setPrice -h`

### Restarting on disconnect.

The keeper is a long-running process. The only time it will shutdown is if its websocket connection to the Ethereum node is disconnected.

To handle these restarts we rely on `pm2`

## Instrumentation/metrics.

You can optionally setup Prometheus and Grafana to get some metrics from the keeper.

Prometheus is a pull-based instrumentation system. We must run a separate Prometheus server to scrape the metrics and upload them to a remote endpoint. See [`prometheus/`](prometheus/) for more.

## Deployment notes

TODO

## Future improvements

- Currently we only have unit tests. Manual integrations tests can be run with the Futures interact CLI, but ideally we should add some proper integration tests.

- The current flow is very inefficient (checks all positions every block), which means that it's possible that liquidations won't keep up due to node chatter bottleneck. The implementation should maintain a view of position liquidation prices (by following events / subgraph) and only check liquidation status for the positions most at risk (liquidation price closest to current price).

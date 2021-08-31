# futures-keeper

A basic liquidations keeper bot for Synthetix Futures Alpha. The [PR here](https://github.com/Synthetixio/futures-keepers/pull/1) describes its features fairly well.

 * Serial processing - older orders are checked before later ones.
 * Backlog processing - the keeper maintains an in-memory index from scanning blocks. If there is a backlog of unprocessed events, a keeper can be started to re-index from a specific block using `--from-block`, and then execute keeper actions based on the most recent state of the index.
 * Parallel tx submission - on the OVM, we are competing on submitting transactions quickly to the node, as each transaction is mined as it is received. In a production scenario, there might be 10's of other transactions being delivered while we are submitting the keeper transactions. The bot includes a feature to submit transactions from multiple accounts (of a HD wallet) across multiple websocket connections in parallel. The multiple accounts ensures we can submit transactions in parallel without the node receiving tx's in different order and failing on a nonce error. The multiple websocket connections was an optimization I implemented which marginally increased performance too.

## Usage.

```
Usage: node src/index.js run [options]

Run the keeper

Options:
  -b, --from-block <value>    Rebuild the keeper index from a starting block, before initiating keeper actions. (default: "latest")
  -p, --provider-url <value>  Ethereum RPC URL (default: "ws://localhost:8546")
  -n, --num-accounts <value>  Number of accounts from the HD wallet to use for parallel tx submission. Improves performance. (default: 10)
  -m, --markets <value>       Runs keeper operations for the specified currencies. Supported values: ETH, BTC, LINK. (default: "sBTC,sETH,sLINK")
  -h, --help                  display help for command
```

```sh
NETWORK=kovan-ovm-futures node src/ run -p ws://kovan.optimism.io:8546 --from-block 0 -n 1
```

### Environment configuration.

Any variables specified in `.env` at the project root will be loaded using [dotenv](https://www.npmjs.com/package/dotenv).

 - **`ETH_HDWALLET_MNEMONIC`**: the HD wallet mnemonic used to unlock the bot's wallet. The bot does not support private keys.
 - **`NETWORK`**: the network passed into the `synthetix` NPM package to fetch contracts.


# perps-keepers

**Welcome to perps-keepers!**

This repository houses Synthetix Perps keepers to maintain the health and provide a better UX for traders on frontends such as Kwenta and Decentrex. `perps-keepers` provides 3 main functions. These include:

1. Liquidation of underwater positions
1. Execution of delayed orders
1. Execution of off-chain delayed orders

This project is a [fork of futures-keepers](https://github.com/Synthetixio/futures-keepers). The internals around liquidations remain largely the same but has undergone significant restructure.

## Development

```bash
# Clone the repository.
git clone git@github.com:Synthetixio/perps-keepers.git

# Install project dependencies.
npm i

# Execute keeper locally.
npm run dev
```

_**NOTE:** See configuration section before attempting to run locally._

## Overview

![overview](./assets/perpsv2_overview.png)

`perps-keepers` architecture is fairly simple. A block listener consumes events from the blockchain (Optimism) and inserts the block number into an in-memory first-in-first-out (FIFO) queue to be consumed by a block distributor. The block distributor queries for events and distributes relevant events each keeper. Keepers track

## Configuration

Variables for configuration are defined as environment variables. During development they are stored in an `.env.staging` file at the project root then loaded via [dotenv](https://www.npmjs.com/package/dotenv). The contents are as follows:

| Variable                | Required | Description                                       |
| ----------------------- | -------- | ------------------------------------------------- |
| `ETH_HDWALLET_MNEMONIC` | Yes      | Mnemonic used to unlock the keeper's wallet       |
| `PROVIDER_URL`          | Yes      | RPC provider URL                                  |
| `NETWORK`               | No       | Network to keep against (goerli-ovm, mainnet-ovm) |
| `FROM_BLOCK`            | No       | Default block to index from                       |
| `RUN_EVERY_X_BLOCK`     | No       | Used to skip blocks (`1` to not skip)             |

_For an example `.env` see `.env.example`. All input variables are validated (see `./src/config.ts` for more details)._

## Usage

```
> npx ts-node --files src/index.ts run --help

Usage: index run [options]

Run the perps-keeper

Options:
  -b, --from-block <value>  rebuild the keeper index from a starting block, before initiating keeper actions.
  --network <value>         Ethereum network to connect to.
  -m, --markets <value>     runs keeper operations for the specified markets, delimited by a comma. Default all live markets.
  -h, --help                display help for command
```

## Deployment

TODO

### Setup for local node:

1. Start a local node:
   `hardhat node --fork https://optimism-goerli.infura.io/v3/<infura key>`
2. Fund one of the test wallets.

   - Checkout: https://github.com/synthetixio/synthetix
   - `git checkout futures-implementation`
   - npm install
   - `npx hardhat fund-local-accounts --provider-url http://127.0.0.1:8545/ --target-network goerli-ovm --deployment-path ./publish/deployed/goerli-ovm/ --use-ovm --private-key $GOERLI_OVM_FUTURES_DEPLOYER_PRIVATE_KEY --account 0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199`
     `0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199` is one of the default accounts from hardhat node --fork

### Restarting on disconnect.

The keeper is a long-running process. The only time it will shutdown is if its websocket connection to the Ethereum node is disconnected.

To handle these restarts we rely on `pm2`

## Deployment notes

We use github actions for continuous deployments. See `/.github/workflows/deploy-keeper.yml`.

- Merge/Push to branch `develop` will trigger a staging release and start the keeper on `ovm-goerli`
- Merge/Push to branch `master` will trigger a production release and start the keeper on `ovm-mainnet`

To set this up as a fork we need to create github secrets for all required environment variables

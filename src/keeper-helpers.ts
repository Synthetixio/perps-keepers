import { ethers } from "ethers";
import { range } from "lodash";
import { createLogger } from "./logging";

const MAX_BLOCKS = 200000;

const logger = createLogger({ componentName: "Keeper Helpers" });
// exported for test
export const getPaginatedFromAndTo = (fromBlock: number, toBlock: number) => {
  const numberOfBlocks = toBlock - fromBlock || 1;

  const numberOfGroups = Math.ceil(numberOfBlocks / MAX_BLOCKS);
  return range(0, numberOfGroups).map((x: number) => {
    const newFrom = fromBlock + x * MAX_BLOCKS;
    return {
      fromBlock: newFrom,
      toBlock: Math.min(newFrom + MAX_BLOCKS, toBlock),
    };
  });
};
export const getEvents = async (
  eventNames: string[],
  contract: ethers.Contract,
  {
    fromBlock,
    toBlock,
  }: { fromBlock: number | string; toBlock: number | string }
) => {
  const nestedEvents = await Promise.all(
    eventNames.map(async eventName => {
      const pagination = getPaginatedFromAndTo(
        Number(fromBlock),
        Number(toBlock)
      );
      if (pagination.length > 1) {
        // Only log this for when we're doing pagination
        logger.info(
          `Making ${pagination.length} requests to infura to index ${eventName}`
        );
      }

      const events = await Promise.all(
        pagination.map(({ fromBlock, toBlock }) => {
          return contract.queryFilter(
            contract.filters[eventName](),
            fromBlock,
            toBlock
          );
        })
      );
      return events.flat(1);
    })
  );
  nestedEvents.forEach((singleFilterEvents, index) => {
    if (singleFilterEvents.length > 4000) {
      // at some point we'll issues getting enough events
      logger.log(
        "warn",
        `Got ${singleFilterEvents.length} ${eventNames[index]} events, will run into RPC limits at 10000`,
        { component: "Indexer" }
      );
    }
  });
  const events = nestedEvents.flat(1);
  // sort by block, tx index, and log index, so that events are processed in order
  events.sort(
    (a, b) =>
      a.blockNumber - b.blockNumber ||
      a.transactionIndex - b.transactionIndex ||
      a.logIndex - b.logIndex
  );
  return events;
};

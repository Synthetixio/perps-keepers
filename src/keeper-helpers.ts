import { ethers } from "ethers";
import { range } from "lodash";

const MAX_BLOCKS = 200000;

// exported for test
export const getPaginatedFromAndTo = (fromBlock: number, toBlock: number) => {
  const numberOfBlocks = toBlock - fromBlock;
  if (numberOfBlocks > MAX_BLOCKS) {
    const numberOfGroups = Math.ceil(numberOfBlocks / MAX_BLOCKS);
    return range(0, numberOfGroups).map((x: number) => {
      const newFrom = fromBlock + x * MAX_BLOCKS;
      return {
        fromBlock: newFrom,
        toBlock: Math.min(newFrom + MAX_BLOCKS, toBlock),
      };
    });
  }
  return [{ fromBlock, toBlock }];
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
      const events = await Promise.all(
        getPaginatedFromAndTo(Number(fromBlock), Number(toBlock)).map(
          ({ fromBlock, toBlock }) => {
            return contract.queryFilter(
              contract.filters[eventName](),
              fromBlock,
              toBlock
            );
          }
        )
      );
      return events.flat(1);
    })
  );
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

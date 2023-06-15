import { Contract, utils } from 'ethers';
import { range } from 'lodash';
import { Logger } from 'winston';
import { PerpsEvent } from '../typed';

const MAX_BLOCKS = 200_000;

export const getPaginatedFromAndTo = (
  fromBlock: number,
  toBlock: number,
  pageSize: number = MAX_BLOCKS
) => {
  const numberOfBlocks = toBlock - fromBlock || 1;
  const numberOfGroups = Math.ceil(numberOfBlocks / pageSize);
  return range(0, numberOfGroups).map((x: number) => {
    const newFrom = fromBlock + x * pageSize;
    const newTo = Math.min(newFrom + pageSize, toBlock);
    return {
      fromBlock: newFrom,
      toBlock: newTo,
      size: newTo - newFrom,
    };
  });
};

export const getEvents = async (
  eventNames: PerpsEvent[],
  contract: Contract,
  {
    fromBlock,
    toBlock,
    logger,
  }: { fromBlock: number | string; toBlock: number | string; logger: Logger }
) => {
  const nestedEvents = await Promise.all(
    eventNames.map(async eventName => {
      const pagination = getPaginatedFromAndTo(Number(fromBlock), Number(toBlock));
      if (pagination.length > 1) {
        // Only log this for when we're doing pagination
        logger.info('Querying Infura for indexing', {
          args: { pagination: pagination.length, eventName },
        });
      }

      const events = await Promise.all(
        pagination.map(({ fromBlock, toBlock }) =>
          contract.queryFilter(contract.filters[eventName](), fromBlock, toBlock)
        )
      );
      return events.flat(1);
    })
  );
  nestedEvents.forEach((singleFilterEvents, index) => {
    if (singleFilterEvents.length > 4000) {
      // At some point we'll have issues getting enough events.
      logger.warn('Received events but will run into RPC limits at 10k', {
        args: { n: singleFilterEvents.length, eventName: eventNames[index] },
      });
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

export const UNIT = utils.parseUnits('1');

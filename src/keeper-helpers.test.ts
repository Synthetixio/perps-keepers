import { getEvents, getPaginatedFromAndTo } from "./keeper-helpers";

describe("getPaginatedToAndFrom", () => {
  const result = getPaginatedFromAndTo(0, 9998);
  expect(result).toEqual([
    {
      fromBlock: 0,
      toBlock: 2000,
    },
    {
      fromBlock: 2000,
      toBlock: 4000,
    },
    {
      fromBlock: 4000,
      toBlock: 6000,
    },
    {
      fromBlock: 6000,
      toBlock: 8000,
    },
    {
      fromBlock: 8000,
      toBlock: 9998,
    },
  ]);
});
describe("getEvents", () => {
  test("sorts correctly", async () => {
    const eventNames = ["FundingRecomputed"];
    const contract = {
      queryFilter: jest.fn(() => [
        { blockNumber: 1, transactionIndex: 1, logIndex: 1 },
        { blockNumber: 3, transactionIndex: 3, logIndex: 3 },
        { blockNumber: 3, transactionIndex: 4, logIndex: 4 },
        { blockNumber: 3, transactionIndex: 4, logIndex: 5 },
        { blockNumber: 2, transactionIndex: 2, logIndex: 2 },
      ]),
      filters: {
        FundingRecomputed: jest.fn(),
      },
    } as any;

    const events = await getEvents(eventNames, contract, {
      fromBlock: 1,
      toBlock: 1000,
    });
    expect(events).toEqual([
      { blockNumber: 1, transactionIndex: 1, logIndex: 1 },
      { blockNumber: 2, transactionIndex: 2, logIndex: 2 },
      { blockNumber: 3, transactionIndex: 3, logIndex: 3 },
      { blockNumber: 3, transactionIndex: 4, logIndex: 4 },
      { blockNumber: 3, transactionIndex: 4, logIndex: 5 },
    ]);
  });
  test("pagination correctly", async () => {
    const eventNames = [
      "PositionLiquidated",
      "PositionModified",
      "FundingRecomputed",
    ];
    const contract = {
      queryFilter: jest.fn(),
      filters: {
        PositionLiquidated: jest.fn(() => [1]),
        PositionModified: jest.fn(() => [2]),
        FundingRecomputed: jest.fn(() => [3]),
      },
    } as any;

    const events = await getEvents(eventNames, contract, {
      fromBlock: 1,
      toBlock: 1000,
    });
    expect(contract.queryFilter).toBeCalledTimes(3);
    expect(events.length).toBe(3);
    contract.queryFilter.mockReset();

    const events1 = await getEvents(eventNames, contract, {
      fromBlock: 1,
      toBlock: 3000,
    });
    expect(contract.queryFilter).toBeCalledTimes(6);
    expect(events.length).toBe(3);
  });
});

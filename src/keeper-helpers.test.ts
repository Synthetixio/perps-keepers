import { getEvents, getPaginatedFromAndTo } from "./keeper-helpers";

describe("getPaginatedToAndFrom", () => {
  test("one block", () => {
    const result = getPaginatedFromAndTo(1000, 1000);
    expect(result).toEqual([
      {
        fromBlock: 1000,
        toBlock: 1000,
      },
    ]);
  });
  test("a lot of blocks", () => {
    const result = getPaginatedFromAndTo(4500000, 5999999);
    expect(result).toEqual([
      { fromBlock: 4500000, toBlock: 4700000 },
      { fromBlock: 4700000, toBlock: 4900000 },
      { fromBlock: 4900000, toBlock: 5100000 },
      { fromBlock: 5100000, toBlock: 5300000 },
      { fromBlock: 5300000, toBlock: 5500000 },
      { fromBlock: 5500000, toBlock: 5700000 },
      { fromBlock: 5700000, toBlock: 5900000 },
      { fromBlock: 5900000, toBlock: 5999999 },
    ]);
  });
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
      toBlock: 200000,
    });
    expect(contract.queryFilter).toBeCalledTimes(3); // 1 call for each event name
    expect(events.length).toBe(3);
    contract.queryFilter.mockReset();

    const events1 = await getEvents(eventNames, contract, {
      fromBlock: 1,
      toBlock: 600000,
    });
    expect(contract.queryFilter).toBeCalledTimes(9); // 3 calls for each event name
    expect(events1.length).toBe(9);
  });
});

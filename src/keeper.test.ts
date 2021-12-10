import { BigNumber } from "@ethersproject/bignumber";
import Keeper from "./keeper";
import * as metrics from "./metrics";
const getMockPositions = () => ({
  ___ACCOUNT1__: {
    id: "1",
    event: "__OLD_EVENT__",
    account: "___ACCOUNT1__",
    size: BigNumber.from(10),
  },
  ___ACCOUNT2__: {
    id: "1",
    event: "__OLD_EVENT__",
    account: "___ACCOUNT2__",
    size: BigNumber.from(10),
  },
  ___ACCOUNT3__: {
    id: "1",
    event: "__OLD_EVENT__",
    account: "___ACCOUNT3__",
    size: BigNumber.from(10),
  },
});
describe("keeper", () => {
  test("create works", async () => {
    const snx = {
      fromBytes32: jest.fn(),
      getSource: jest.fn().mockImplementation(arg => {
        if (arg.contract === "FuturesMarket") {
          return { abi: "__FuturesMarketContractAbi__" };
        }
        if (arg.contract === "ExchangeRatesWithoutInvPricing") {
          return { abi: "__ExchangeRatesWithoutInvPricingAbi__" };
        }
      }),
    };
    const baseAssetMock = jest.fn();
    const Contract = jest.fn().mockReturnValue({ baseAsset: baseAssetMock });

    const args = {
      proxyFuturesMarket: "__FUTURES_MARKET__",
      exchangeRates: "__EXCHANGE_RATES__",
      signerPool: "__SIGNER_POOL__",
      provider: "__PROVIDER__",
      network: "kovan",
    } as any;
    const deps = { snx, Contract } as any;

    const result = await Keeper.create(args, deps);

    expect(snx.getSource).toBeCalledTimes(2);
    expect(snx.getSource).toHaveBeenNthCalledWith(1, {
      network: args.network,
      contract: "FuturesMarket",
      useOvm: true,
    });
    expect(snx.getSource).toHaveBeenNthCalledWith(2, {
      network: args.network,
      contract: "ExchangeRatesWithoutInvPricing",
      useOvm: true,
    });

    expect(deps.Contract).toBeCalledTimes(2);
    expect(deps.Contract).toHaveBeenNthCalledWith(
      1,
      "__FUTURES_MARKET__",
      "__FuturesMarketContractAbi__",
      "__PROVIDER__"
    );
    expect(deps.Contract).toHaveBeenNthCalledWith(
      2,
      "__EXCHANGE_RATES__",
      "__ExchangeRatesWithoutInvPricingAbi__",
      "__PROVIDER__"
    );
    expect(baseAssetMock).toBeCalledTimes(1);
    expect(snx.fromBytes32).toBeCalledTimes(1);
    expect(result).toBeInstanceOf(Keeper);
  });
  test("run", async () => {
    const arg = {
      baseAsset: "sUSD",
      futuresMarket: {
        queryFilter: jest.fn().mockResolvedValue(["__EVENT1__"]),
      },
      exchangeRates: jest.fn(),
      signerPool: jest.fn(),
      provider: { on: jest.fn() },
    } as any;
    const keeper = new Keeper(arg);
    const updateIndexSpy = jest.spyOn(keeper, "updateIndex");
    const runKeepersSpy = jest.spyOn(keeper, "runKeepers");
    const startProcessNewBlockConsumerSpy = jest
      .spyOn(keeper, "startProcessNewBlockConsumer")
      .mockImplementation(); // avoid starting while(1)
    await keeper.run({ fromBlock: 0 });
    expect(arg.futuresMarket.queryFilter).toBeCalledTimes(1);
    expect(arg.futuresMarket.queryFilter).toHaveBeenCalledWith(
      "*",
      0,
      "latest"
    );
    expect(updateIndexSpy).toBeCalledTimes(1);
    expect(updateIndexSpy).toHaveBeenCalledWith(["__EVENT1__"]);
    expect(runKeepersSpy).toBeCalledTimes(1);
    expect(arg.provider.on).toBeCalledTimes(1);
    expect(arg.provider.on).toHaveBeenCalledWith("block", expect.any(Function));
    expect(startProcessNewBlockConsumerSpy).toBeCalledTimes(1);
  });
  test("updateIndex", () => {
    const arg = {
      baseAsset: "sUSD",
      futuresMarket: jest.fn(),
      exchangeRates: jest.fn(),
      signerPool: jest.fn(),
      provider: jest.fn(),
    } as any;
    const keeper = new Keeper(arg);
    keeper.positions = getMockPositions();
    /**
     * PositionModified
     */
    keeper.updateIndex([
      {
        event: "PositionModified",
        args: { id: "1", account: "___ACCOUNT1__", size: BigNumber.from(20) },
      } as any,
    ]);
    expect(keeper.positions["___ACCOUNT1__"]).toEqual({
      account: "___ACCOUNT1__",
      event: "PositionModified",
      id: "1",
      size: BigNumber.from(20),
    });
    /**
     * PositionModified to 0
     */
    keeper.updateIndex([
      {
        event: "PositionModified",
        args: { id: "1", account: "___ACCOUNT1__", size: BigNumber.from(0) },
      },
    ] as any);
    expect(keeper.positions["___ACCOUNT1__"]).toEqual(undefined);

    /**
     * PositionLiquidated
     */
    keeper.updateIndex([
      {
        event: "PositionLiquidated",
        args: { account: "___ACCOUNT2__" },
      },
    ] as any);
    expect(keeper.positions["___ACCOUNT2__"]).toEqual(undefined);

    // After these event we only expect ___ACCOUNT3__ to have a position
    expect(keeper.positions).toEqual({
      ___ACCOUNT3__: {
        id: "1",
        event: "__OLD_EVENT__",
        account: "___ACCOUNT3__",
        size: BigNumber.from(10),
      },
    });
  });
  test("runKeepers", async () => {
    const arg = {
      baseAsset: "sUSD",
      futuresMarket: jest.fn(),
      exchangeRates: jest.fn(),
      signerPool: jest.fn(),
      provider: jest.fn(),
    } as any;
    const keeper = new Keeper(arg);
    const mockPosition = getMockPositions();
    keeper.positions = mockPosition;
    const runKeeperTaskSpy = jest.spyOn(keeper, "runKeeperTask");
    const liquidateOrderSpy = jest
      .spyOn(keeper, "liquidateOrder")
      .mockImplementation();
    const futuresOpenPositionsSetMock = jest.fn();

    await keeper.runKeepers({
      BATCH_SIZE: 1,
      WAIT: 1,
      metrics: {
        futuresOpenPositions: { set: futuresOpenPositionsSetMock },
      } as any,
    });

    expect(futuresOpenPositionsSetMock).toBeCalledTimes(1);
    expect(futuresOpenPositionsSetMock).toHaveBeenCalledWith(
      { market: "sUSD" },
      3
    );
    expect(runKeeperTaskSpy).toBeCalledTimes(3);
    expect(runKeeperTaskSpy).toHaveBeenNthCalledWith(
      1,
      mockPosition["___ACCOUNT1__"].id,
      "liquidation",
      expect.any(Function)
    );
    expect(runKeeperTaskSpy).toHaveBeenNthCalledWith(
      2,
      mockPosition["___ACCOUNT2__"].id,
      "liquidation",
      expect.any(Function)
    );
    expect(runKeeperTaskSpy).toHaveBeenNthCalledWith(
      3,
      mockPosition["___ACCOUNT3__"].id,
      "liquidation",
      expect.any(Function)
    );
    expect(liquidateOrderSpy).toBeCalledTimes(3);
    expect(liquidateOrderSpy).toHaveBeenNthCalledWith(
      1,
      mockPosition["___ACCOUNT1__"].id,
      "___ACCOUNT1__"
    );
    expect(liquidateOrderSpy).toHaveBeenNthCalledWith(
      2,
      mockPosition["___ACCOUNT2__"].id,
      "___ACCOUNT2__"
    );
    expect(liquidateOrderSpy).toHaveBeenNthCalledWith(
      3,
      mockPosition["___ACCOUNT3__"].id,
      "___ACCOUNT3__"
    );
  });

  test("liquidateOrder bails when it cant liquidate", async () => {
    const arg = {
      baseAsset: "sUSD",
      futuresMarket: {
        canLiquidate: jest.fn().mockResolvedValue(false),
      },
      exchangeRates: jest.fn(),
      signerPool: { withSigner: jest.fn() },
      provider: jest.fn(),
    } as any;
    const keeper = new Keeper(arg);
    await keeper.liquidateOrder("1", "__ACCOUNT__");
    expect(arg.futuresMarket.canLiquidate).toBeCalledTimes(1);
    expect(arg.futuresMarket.canLiquidate).toHaveBeenCalledWith("__ACCOUNT__");
    expect(arg.signerPool.withSigner).not.toHaveBeenCalled();
  });

  test("liquidateOrder works", async () => {
    const waitMock = jest.fn();
    const liquidatePositionMock = jest.fn().mockReturnValue({ wait: waitMock });
    const arg = {
      baseAsset: "sUSD",
      futuresMarket: {
        canLiquidate: jest.fn().mockResolvedValue(true),
        connect: jest.fn().mockReturnValue({
          liquidatePosition: liquidatePositionMock,
        }),
      },
      exchangeRates: jest.fn(),
      signerPool: { withSigner: (cb: any) => cb("__SIGNER__") },
      provider: jest.fn(),
    } as any;
    const keeper = new Keeper(arg);
    const deps = { metricFuturesLiquidations: { observe: jest.fn() } } as any;

    await keeper.liquidateOrder("1", "__ACCOUNT__", deps);

    expect(arg.futuresMarket.canLiquidate).toBeCalledTimes(1);
    expect(arg.futuresMarket.canLiquidate).toHaveBeenCalledWith("__ACCOUNT__");
    expect(arg.futuresMarket.connect).toBeCalledTimes(1);
    expect(arg.futuresMarket.connect).toHaveBeenCalledWith("__SIGNER__");
    expect(liquidatePositionMock).toBeCalledTimes(1);
    expect(liquidatePositionMock).toHaveBeenCalledWith("__ACCOUNT__");
    expect(waitMock).toBeCalledTimes(1);
    expect(waitMock).toHaveBeenCalledWith(1);
    expect(deps.metricFuturesLiquidations.observe).toBeCalledTimes(1);
    expect(deps.metricFuturesLiquidations.observe).toHaveBeenCalledWith(
      {
        market: "sUSD",
        success: "true",
      },
      1
    );
  });
});

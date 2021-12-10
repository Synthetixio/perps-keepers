import Keeper from "./keeper";

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
});

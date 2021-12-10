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
});

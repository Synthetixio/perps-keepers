import SignerPool from "./signer-pool";

describe("signer-pool", () => {
  test("create", () => {
    const signersMock = ["__SIGNER1__", "__SIGNER2__"] as any;
    const signer = new SignerPool(signersMock);
    expect(signer.logger).toBeDefined();
    expect(signer.signers).toEqual(signersMock);
    expect(signer.pool).toEqual([0, 1]);
  });
  test("acquire", async () => {
    const signersMock = ["__SIGNER1__", "__SIGNER2__"] as any;
    const signer = new SignerPool(signersMock);
    const result = await signer.acquire();
    expect(result).toEqual([1, "__SIGNER2__"]);

    const result1 = await signer.acquire();
    expect(result1).toEqual([0, "__SIGNER1__"]);
  });
  test("release", async () => {
    const signersMock = [] as any;
    const signer = new SignerPool(signersMock);
    expect(signer.pool).toEqual([]);
    signer.release(0);
    expect(signer.pool).toEqual([0]);
  });

  test("withSigner", async () => {
    const cbMock = jest.fn().mockResolvedValue(true);
    const signersMock = ["__SIGNER1__", "__SIGNER2__"] as any;
    const signer = new SignerPool(signersMock);
    await signer.withSigner(cbMock);
    expect(cbMock).toBeCalledTimes(1);
    expect(cbMock).toHaveBeenCalledWith("__SIGNER2__");
    // Make sure signer is released
    expect(signer.pool).toEqual([0, 1]);
  });
});

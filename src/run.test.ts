import { DEFAULTS, run } from './run';

describe('run', () => {
  test('throws when no MNEMONIC', () => {
    expect(() => run(DEFAULTS, { ETH_HDWALLET_MNEMONIC: undefined } as any)).rejects.toEqual(
      Error('ETH_HDWALLET_MNEMONIC environment variable is not configured.')
    );
  });
  test('throws when called with unsupported market', () => {
    expect(() =>
      run({
        futuresMarkets: [{ asset: 'sBTC' }],
        ETH_HDWALLET_MNEMONIC: 'some words',
      } as any)
    ).rejects.toEqual(Error('No futures market for marketKey: sDOGE'));
  });
  test.only('happy path', async () => {
    const getProviderMock = jest.fn().mockReturnValue('__PROVIDER__');
    const providerMonitorMock = jest.fn();
    const NonceManagerMock = jest.fn();
    const NonceManagerConnectMock = jest.fn().mockReturnValue('__SIGNER__');
    const SignerPoolCreateMock = jest.fn().mockReturnValue('__SIGNER_POOL__');
    const createWalletsMock = jest.fn().mockReturnValue(['___WALLET1___']);
    const KeeperMockRun = jest.fn();
    const KeeperMockCreate = jest.fn().mockReturnValue({ run: KeeperMockRun });
    const metricsRunServerMock = jest.fn();
    const logAndStartTrackingBalancesMock = jest.fn();
    const getSynthetixContractsMock = jest.fn().mockReturnValue({
      FuturesMarketBTC: 'BTC_CONTRACT',
      FuturesMarketETH: 'ETH_CONTRACT',
    });

    const deps = {
      ETH_HDWALLET_MNEMONIC: 'fake words',
      getProvider: getProviderMock,
      monitorProvider: providerMonitorMock,
      NonceManager: NonceManagerMock.mockReturnValue({
        connect: NonceManagerConnectMock,
      }),
      SignerPool: { create: SignerPoolCreateMock },
      Keeper: { create: KeeperMockCreate },
      runMetricServer: metricsRunServerMock,
      createWallets: createWalletsMock,
      logAndStartTrackingBalances: logAndStartTrackingBalancesMock,
      futuresMarkets: [{ asset: 'sBTC' }, { asset: 'sETH' }],
      getSynthetixContracts: getSynthetixContractsMock,
    } as any;

    await run(deps);

    expect(metricsRunServerMock).toBeCalledTimes(1);
    expect(getSynthetixContractsMock).toBeCalled();
    expect(getProviderMock).toBeCalledTimes(1);
    expect(getProviderMock).toBeCalledWith(DEFAULTS.providerUrl);
    expect(providerMonitorMock).toBeCalledTimes(1);
    expect(providerMonitorMock).toBeCalledWith('__PROVIDER__', 'goerli-ovm');

    expect(createWalletsMock).toBeCalledTimes(1);
    expect(createWalletsMock).toBeCalledWith({
      provider: '__PROVIDER__',
      mnemonic: deps.ETH_HDWALLET_MNEMONIC,
      num: 1,
    });

    expect(NonceManagerMock).toBeCalledTimes(1);
    expect(NonceManagerMock).toBeCalledWith('___WALLET1___');
    expect(NonceManagerConnectMock).toBeCalledTimes(1);
    expect(NonceManagerConnectMock).toBeCalledWith('__PROVIDER__');

    expect(SignerPoolCreateMock).toBeCalledTimes(1);
    expect(SignerPoolCreateMock).toBeCalledWith({
      signers: ['__SIGNER__'],
    });

    expect(logAndStartTrackingBalancesMock).toBeCalledTimes(1);
    expect(logAndStartTrackingBalancesMock).toBeCalledWith({
      network: DEFAULTS.network,
      provider: '__PROVIDER__',
      signers: ['__SIGNER__'],
    });

    expect(KeeperMockCreate).toBeCalledTimes(2);
    expect(KeeperMockCreate).toBeCalledWith({
      network: 'goerli-ovm',
      provider: '__PROVIDER__',
      futuresMarket: expect.any(String), // The mock just return a string, in real life this would be the contract
      signerPool: '__SIGNER_POOL__',
    });
    expect(KeeperMockRun).toBeCalledTimes(2);
    expect(KeeperMockRun).toBeCalledWith({
      fromBlock: Number(DEFAULTS.fromBlock),
    });
  });
});

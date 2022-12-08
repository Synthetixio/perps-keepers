declare module 'synthetix' {
  function getTarget({
    network: string,
    contract: string,
  }): {
    address: string;
  };

  function getSource({
    network: string,
    contract: string,
  }): {
    abi: any;
  };
}

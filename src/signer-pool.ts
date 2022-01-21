import { ethers } from "ethers";
import { Logger } from "winston";
import { createLogger } from "./logging";

class SignerPool {
  signers: ethers.Signer[];
  pool: number[];
  logger: Logger;
  constructor(signers: ethers.Signer[]) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.logger = createLogger({ componentName: "SignerPool" });
  }

  static async create({ signers }: { signers: ethers.Signer[] }) {
    return new SignerPool(signers);
  }

  async acquire(): Promise<[number, ethers.Signer]> {
    this.logger.info("awaiting signer");
    let i = this.pool.pop();

    while (i === undefined) {
      await new Promise((resolve, reject) => setTimeout(resolve, 10));
      i = this.pool.pop();
    }
    this.logger.info(`acquired signer i=${i}`);
    return [i, this.signers[i]];
  }

  release(i: number) {
    this.logger.info(`released signer i=${i}`);
    this.pool.push(i);
  }

  async withSigner(cb: (signer: ethers.Signer) => Promise<void>) {
    const [i, signer] = await this.acquire();

    try {
      await cb(signer);
    } catch (ex) {
      throw ex;
    } finally {
      this.release(i);
    }
  }
}

export default SignerPool;

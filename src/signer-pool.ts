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
    // this.acquireCallbacks = []; unused
    this.logger = createLogger({ componentName: "SignerPool" });
  }

  static async create({ signers }: { signers: ethers.Signer[] }) {
    return new SignerPool(signers);
  }

  async acquire(): Promise<[number, ethers.Signer] | undefined> {
    this.logger.info("awaiting signer");
    while (!this.pool.length) {
      await new Promise((resolve, reject) => setTimeout(resolve, 1));
    }
    const i = this.pool.pop();
    if (i === undefined) return undefined;
    this.logger.info(`acquired signer i=${i}`);
    return [i, this.signers[i]];
  }

  release(i: number) {
    this.logger.info(`released signer i=${i}`);
    this.pool.push(i);
  }

  async withSigner(cb: (signer: ethers.Signer) => Promise<void>) {
    const [i, signer] = (await this.acquire()) || [];
    if (!signer || i === undefined)
      return Promise.reject("No signer available");
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

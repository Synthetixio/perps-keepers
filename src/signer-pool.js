const { createLogger } = require("./logging");

class SignerPool {
  constructor(signers) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.acquireCallbacks = [];
    this.logger = createLogger({ componentName: "SignerPool" });
  }

  static async create({ signers }) {
    return new SignerPool(signers);
  }

  async acquire() {
    this.logger.info("awaiting signer");
    while (!this.pool.length) {
      await new Promise((resolve, reject) => setTimeout(resolve, 1));
    }
    const i = this.pool.pop();
    this.logger.info(`acquired signer i=${i}`);
    return [i, this.signers[i]];
  }

  release(i) {
    this.logger.info(`released signer i=${i}`);
    this.pool.push(i);
  }

  async withSigner(cb) {
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

module.exports = SignerPool;

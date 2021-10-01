class SignerPool {
  constructor(signers) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.acquireCallbacks = [];
  }

  async acquire() {
    console.log(`SignerPool - awaiting signer`);
    while (!this.pool.length) {
      await new Promise((resolve, reject) => setTimeout(resolve, 1));
    }
    const i = this.pool.pop();
    console.log(`SignerPool - acquired signer ${i}`);
    return [i, this.signers[i]];
  }

  release(i) {
    console.log(`SignerPool - released signer ${i}`);
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

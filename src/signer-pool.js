const winston = require('winston');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;
class SignerPool {
  constructor(signers) {
    this.signers = signers;
    this.pool = Array.from(Array(this.signers.length).keys());
    this.acquireCallbacks = [];

    this.logger = winston.createLogger({
      level: 'info',
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.label({ label: `SignerPool` }),
        format.printf(info => {
          return [
            info.timestamp, info.level, info.label, info.component, info.message
          ].filter(x => !!x).join(' ')
        })
      ),
      transports: [
        new transports.Console()
      ],
    });
  }

  async acquire() {
    this.logger.info('awaiting signer')
    while (!this.pool.length) {
      await new Promise((resolve, reject) => setTimeout(resolve, 1));
    }
    const i = this.pool.pop();
    this.logger.info(`acquired signer i=${i}`)
    return [i, this.signers[i]];
  }

  release(i) {
    this.logger.info(`released signer i=${i}`)
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

import { map } from 'lodash';
import winston, { format, transports } from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';
import { getConfig } from './config';

const config = getConfig();

export const createLogger = (label: string): winston.Logger => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: format.combine(
      format.label({ label }),
      format.timestamp(),
      format.printf(({ timestamp, level, label, component, message, args }) => {
        const argsMessage = map(args, (value, key) => `${key}=${value}`).join(' ');
        return [timestamp, level, label, component, message, argsMessage]
          .filter(x => !!x)
          .join(' ');
      })
    ),
    // Implicit transport to exclude console when pm_id (pm2) is available (no log rotation).
    transports: process.env.pm_id ? [] : [new transports.Console()],
  });

  const { accessKeyId, secretAccessKey, region } = config.aws;

  // Implicitly infer the environment and attach AWS CWL. This should really be in an environment
  // where we can log to stdout/err then have a log aggregator to push to some log service.
  if (accessKeyId && secretAccessKey && region) {
    const logGroupName =
      process.env.name === 'perps-keeper-goerli'
        ? 'perps-keeper-staging'
        : 'perps-keeper-production';

    // @see: https://github.com/lazywithclass/winston-cloudwatch#options
    logger.add(
      new WinstonCloudWatch({
        logGroupName,
        logStreamName: 'latest',
        messageFormatter: ({ level, message, component, args }) => {
          const argsMessage = map(args, (value, key) => `${key}=${value}`).join(' ');
          return [level, label, component, '-', message, argsMessage].filter(x => !!x).join(' ');
        },
        awsOptions: {
          region,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        },
      })
    );
  }

  return logger;
};

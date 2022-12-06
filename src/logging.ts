import winston, { format, transports } from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';

const date = new Date();
const logStreamName = date.toDateString() + ' - ' + date.getTime();

interface CreateLoggerParams {
  componentName: string;
}

export const createLogger = ({
  componentName,
}: CreateLoggerParams): winston.Logger => {
  const logger = winston.createLogger({
    level: 'info',
    format: format.combine(
      format.label({ label: componentName }),
      format.printf(info => {
        return [
          info.timestamp,
          info.level,
          info.label,
          info.component,
          info.message,
        ]
          .filter(x => !!x)
          .join(' ');
      })
    ),
    transports: process.env.pm_id ? [] : [new transports.Console()],
  });

  // Implicitly infer the environment and attach AWS CWL. This should really be in an environment
  // where we can log to stdout/err then have a log aggregator to push to some log service.
  if (
    process.env.AWS_ACCESS_KEY &&
    process.env.AWS_SECRET_KEY &&
    process.env.AWS_REGION
  ) {
    const logGroupName =
      process.env.name === 'futures-keeper-goerli'
        ? 'futures-liquidations-keeper-staging'
        : 'futures-liquidations-keeper-production';

    logger.add(
      new WinstonCloudWatch({
        logGroupName,
        logStreamName,
        messageFormatter: ({ level, message }) =>
          `${level} ${componentName} ${message}`,
        awsOptions: {
          region: process.env.AWS_REGION,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY,
            secretAccessKey: process.env.AWS_SECRET_KEY,
          },
        },
      })
    );
  }

  return logger;
};

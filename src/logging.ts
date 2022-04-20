import winston, { format, transports } from "winston";
import WinstonCloudWatch from "winston-cloudwatch";

export function createLogger({ componentName }: { componentName: string }) {
  const logger = winston.createLogger({
    level: "info",
    format: format.combine(
      format.colorize(),
      format.timestamp(),
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
          .join(" ");
      })
    ),
    transports: [new transports.Console()],
  });

  if (
    process.env.AWS_ACCESS_KEY &&
    process.env.AWS_SECRET_KEY &&
    process.env.AWS_REGION
  ) {
    const logGroupName =
      process.env.name === "futures-keeper-kovan"
        ? "futures-liquidations-keeper-staging"
        : "futures-liquidations-keeper-production";
    logger.add(
      winston.add(
        new WinstonCloudWatch({
          logGroupName,
          logStreamName: logGroupName,
          awsRegion: process.env.AWS_REGION,
          awsAccessKeyId: process.env.AWS_ACCESS_KEY,
          awsSecretKey: process.env.AWS_SECRET_KEY,
        })
      )
    );
  }

  return logger;
}

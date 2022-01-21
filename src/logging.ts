import winston, { format, transports } from "winston";

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

  return logger;
}

const winston = require("winston");
const { format, transports } = require("winston");

function createLogger({ componentName }) {
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
          info.message
        ]
          .filter(x => !!x)
          .join(" ");
      })
    ),
    transports: [new transports.Console()]
  });

  return logger;
}

module.exports = {
  createLogger
};

"use strict";

require("dotenv").config({
  path:
    // I would prefer to set NODE_ENV in ecosystem.config.js but the dot-env package and pm2 env configuration doesn't play nicely together
    process.env.name === "futures-keeper-goerli"
      ? require("path").resolve(__dirname, "../.env.staging")
      : require("path").resolve(__dirname, "../.env"),
});
import { program } from "commander";
import { cmd } from "./run";
import { createLogger } from "./logging";
import logProcessError from "log-process-errors";

logProcessError({
  log(error, level) {
    const logger = createLogger({ componentName: "Unhandled Exceptions" });
    logger.log(level, error.stack);
  },
});

cmd(program);

program.parseAsync(process.argv).catch(err => {
  throw err;
});

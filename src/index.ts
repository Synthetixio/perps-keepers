"use strict";

require("dotenv").config({
  path:
    // I would prefer to set NODE_ENV in ecosystem.config.js but the dot-env package and pm2 env configuration doesn't play nicely together
    process.env.name === "futures-keeper-kovan"
      ? require("path").resolve(__dirname, "../.env.staging")
      : require("path").resolve(__dirname, "../.env"),
});
import { program } from "commander";
import { cmd } from "./run";

require("pretty-error").start();

cmd(program);

program.parseAsync(process.argv).catch(err => {
  throw err;
});

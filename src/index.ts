"use strict";

import { program } from "commander";
import { cmd } from "./run";

require("pretty-error").start();
require("dotenv").config();

cmd(program);

program.parseAsync(process.argv).catch(err => {
  throw err;
});

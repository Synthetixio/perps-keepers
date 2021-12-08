"use strict";

import program from "commander";

require("pretty-error").start();
require("dotenv").config();

require("./run").cmd(program);

program.parseAsync(process.argv).catch((err) => {
  throw err;
});

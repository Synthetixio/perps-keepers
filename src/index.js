"use strict";

const program = require("commander");

require("pretty-error").start();
require("dotenv").config();

require("./run").cmd(program);

program.parse(process.argv);

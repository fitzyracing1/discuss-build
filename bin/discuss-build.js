#!/usr/bin/env node
'use strict';
const { main } = require('../lib/cli');
main(process.argv.slice(2)).catch((err) => {
  console.error('discuss-build: ' + err.message);
  process.exitCode = 1;
});

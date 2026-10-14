#!/usr/bin/env node
import { main } from '../src/main.js';
import { PwaError } from '../src/util.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (!(err instanceof PwaError)) throw err;
    console.error(`pwa: ${err.message}`);
    process.exitCode = err.code;
  },
);

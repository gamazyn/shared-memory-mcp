#!/usr/bin/env node
import { runCli } from "../src/cli.js"
import { runServer } from "../src/server.js"

if (process.argv.length > 2) {
  await runCli()
} else {
  await runServer()
}

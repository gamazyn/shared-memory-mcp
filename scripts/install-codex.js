#!/usr/bin/env node
import { configureCodex } from "../src/installers/codex.js"

const result = await configureCodex()
console.log(`Configured ${result.serverName} MCP server in ${result.configPath}`)

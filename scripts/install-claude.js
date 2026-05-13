#!/usr/bin/env node
import { configureClaude } from "../src/installers/claude.js"

const result = await configureClaude()
console.log(`Configured ${result.serverName} MCP server in ${result.settingsPath}`)

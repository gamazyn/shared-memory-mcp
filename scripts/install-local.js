#!/usr/bin/env node
import { configureClaude } from "../src/installers/claude.js"
import { configureCodex } from "../src/installers/codex.js"

const claude = await configureClaude()
const codex = await configureCodex()

console.log(`Configured ${claude.serverName} MCP server in ${claude.settingsPath}`)
console.log(`Configured ${codex.serverName} MCP server in ${codex.configPath}`)

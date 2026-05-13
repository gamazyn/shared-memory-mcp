import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import { configureClaude } from "../src/installers/claude.js"
import { configureCodex } from "../src/installers/codex.js"

test("configureClaude adds MCP server and permission idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const settingsPath = join(dir, "settings.json")
    await writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["Bash(git *)"] } }, null, 2))

    await configureClaude({ settingsPath, command: "node", args: ["/tmp/server.js"] })
    await configureClaude({ settingsPath, command: "node", args: ["/tmp/server.js"] })

    const settings = JSON.parse(await readFile(settingsPath, "utf8"))

    assert.deepEqual(settings.mcpServers["shared-memory"], {
      command: "node",
      args: ["/tmp/server.js"]
    })
    assert.equal(settings.permissions.allow.filter(item => item === "mcp__shared-memory__*").length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("configureCodex adds or replaces shared-memory section idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const configPath = join(dir, "config.toml")
    await writeFile(configPath, 'model = "gpt-5.5"\\n\\n[mcp_servers.old]\\ncommand = "old"\\n')

    await configureCodex({ configPath, command: "node", args: ["/tmp/server.js"] })
    await configureCodex({ configPath, command: "node", args: ["/tmp/server.js"] })

    const config = await readFile(configPath, "utf8")

    assert.equal((config.match(/\[mcp_servers\.shared-memory\]/g) || []).length, 1)
    assert.match(config, /command = "node"/)
    assert.match(config, /args = \["\/tmp\/server\.js"\]/)
    assert.match(config, /\[mcp_servers\.old\]/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

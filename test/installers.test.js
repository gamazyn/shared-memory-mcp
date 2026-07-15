import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import { configureClaude } from "../src/installers/claude.js"
import { configureCodex } from "../src/installers/codex.js"
import { getLocalServerCommand } from "../src/package-paths.js"

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

test("getLocalServerCommand uses a version-agnostic node command", () => {
  const local = getLocalServerCommand()
  assert.equal(local.command, "node")
  assert.doesNotMatch(local.command, /Cellar|\/node\/\d+\.\d+\.\d+\//)
  assert.match(local.args[0], /bin\/shared-memory-mcp\.js$/)
})

test("configureClaude preserves existing entry fields when updating command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const settingsPath = join(dir, "settings.json")
    await writeFile(settingsPath, JSON.stringify({
      mcpServers: {
        "shared-memory": {
          command: "/old/versioned/node",
          args: ["/old/server.js"],
          type: "stdio",
          env: { SHARED_MEMORY_MCP_ENV_FILE: "/keep/.env" }
        }
      }
    }, null, 2))

    await configureClaude({ settingsPath, command: "node", args: ["/tmp/server.js"] })

    const entry = JSON.parse(await readFile(settingsPath, "utf8")).mcpServers["shared-memory"]
    assert.equal(entry.command, "node")
    assert.deepEqual(entry.args, ["/tmp/server.js"])
    assert.equal(entry.type, "stdio")
    assert.deepEqual(entry.env, { SHARED_MEMORY_MCP_ENV_FILE: "/keep/.env" })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

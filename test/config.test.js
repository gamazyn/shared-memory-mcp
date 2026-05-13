import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import { createEnvFile, getRuntimeConfig } from "../src/config.js"

test("getRuntimeConfig reads values from an env file and explicit env wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const envFile = join(dir, ".env")
    await writeFile(envFile, [
      "SHARED_MEMORY_MCP_STORAGE_FILE=/tmp/from-env-file.json",
      "SHARED_MEMORY_MCP_MAX_ITEMS=75",
      "SHARED_MEMORY_MCP_READ_HANDOFF_TTL_DAYS=3",
      "SHARED_MEMORY_MCP_DELETE_READ_HANDOFFS=true"
    ].join("\n"))

    const config = getRuntimeConfig({
      envFile,
      env: { SHARED_MEMORY_MCP_MAX_ITEMS: "12" }
    })

    assert.equal(config.storageFile, "/tmp/from-env-file.json")
    assert.equal(config.maxItems, 12)
    assert.equal(config.readHandoffTtlDays, 3)
    assert.equal(config.deleteReadHandoffs, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("createEnvFile creates an example env file without overwriting existing values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const envPath = join(dir, ".env")
    await writeFile(envPath, "SHARED_MEMORY_MCP_MAX_ITEMS=99\n")

    await createEnvFile({ envPath })
    await createEnvFile({ envPath })

    const env = await readFile(envPath, "utf8")

    assert.match(env, /SHARED_MEMORY_MCP_STORAGE_FILE=/)
    assert.match(env, /SHARED_MEMORY_MCP_MAX_ITEMS=99/)
    assert.match(env, /SHARED_MEMORY_MCP_READ_HANDOFF_TTL_DAYS=7/)
    assert.match(env, /SHARED_MEMORY_MCP_DELETE_READ_HANDOFFS=false/)
    assert.equal((env.match(/SHARED_MEMORY_MCP_MAX_ITEMS=/g) || []).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import { createServer } from "../src/server.js"
import { createSharedMemoryStore } from "../src/storage.js"

async function withClient(run) {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-server-"))
  const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })
  const server = createServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "1.0.0" })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    await run(client)
  } finally {
    await client.close()
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function textOf(result) {
  return result.content[0].text
}

test("server registers exactly the expected 13 tools", async () => {
  await withClient(async client => {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(t => t.name).sort(), [
      "ack_handoff", "create_handoff", "create_snapshot", "get_project_brief",
      "list_contexts", "list_handoffs", "peek_handoff", "read_handoff",
      "read_latest_context", "reopen_handoff", "save_context", "save_memory", "search_memory"
    ])
  })
})

test("create_handoff then read_handoff returns the handoff content and marks it read", async () => {
  await withClient(async client => {
    const created = await client.callTool({
      name: "create_handoff",
      arguments: { to: "codex", summary: "did X", context: "all the details" }
    })
    assert.match(textOf(created), /Handoff created for codex/)

    const read = await client.callTool({ name: "read_handoff", arguments: { agent: "codex" } })
    assert.match(textOf(read), /## Summary\ndid X/)
    assert.match(textOf(read), /## Full Context\nall the details/)

    const again = await client.callTool({ name: "read_handoff", arguments: { agent: "codex" } })
    assert.match(textOf(again), /No pending handoff/)
  })
})

test("save_context then read_latest_context round-trips", async () => {
  await withClient(async client => {
    await client.callTool({
      name: "save_context",
      arguments: { agent: "claude-code", title: "Notes", content: "remember this" }
    })
    const latest = await client.callTool({ name: "read_latest_context", arguments: {} })
    assert.match(textOf(latest), /remember this/)
  })
})

test("save_memory enforces the kind enum at the protocol boundary", async () => {
  await withClient(async client => {
    // SDK 1.29 surfaces validation errors as a result with isError:true rather than rejecting
    const result = await client.callTool({
      name: "save_memory",
      arguments: { agent: "a", kind: "bogus", title: "t", content: "c" }
    })
    assert.equal(result.isError, true)
    assert.match(textOf(result), /invalid_enum_value|Invalid enum value/)
  })
})

test("peek_handoff does not consume the handoff", async () => {
  await withClient(async client => {
    await client.callTool({
      name: "create_handoff",
      arguments: { to: "codex", summary: "s", context: "c" }
    })
    await client.callTool({ name: "peek_handoff", arguments: { agent: "codex" } })
    const read = await client.callTool({ name: "read_handoff", arguments: { agent: "codex" } })
    assert.match(textOf(read), /## Summary\ns/)
  })
})

test("server registers resources and prompts", async () => {
  await withClient(async client => {
    const { resources } = await client.listResources()
    assert.deepEqual(resources.map(r => r.uri), ["memory://recent"])
    const { prompts } = await client.listPrompts()
    assert.deepEqual(prompts.map(p => p.name).sort(), [
      "load_project_memory", "prepare_handoff", "summarize_decisions"
    ])
  })
})

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const smokeStorageFile = join(tmpdir(), "shared-memory-mcp-smoke.json")

rmSync(smokeStorageFile, { force: true })
rmSync(`${smokeStorageFile}.tmp`, { force: true })

function runSession(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["./bin/shared-memory-mcp.js"], {
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        SHARED_MEMORY_MCP_STORAGE_FILE: smokeStorageFile
      }
    })

    let output = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", chunk => {
      output += chunk
    })

    for (const req of requests) {
      child.stdin.write(`${JSON.stringify(req)}\n`)
    }
    child.stdin.end()

    child.on("close", exitCode => {
      if (exitCode !== 0) return reject(new Error(`Process exited with code ${exitCode}`))
      const responses = output.trim().split("\n").map(line => JSON.parse(line))
      resolve(responses)
    })
  })
}

// --- Session 1: list/read smoke (empty store only, no writes) ---
const responses = await runSession([
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" }
    }
  },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "resources/list", params: {} },
  { jsonrpc: "2.0", id: 4, method: "resources/templates/list", params: {} },
  { jsonrpc: "2.0", id: 5, method: "prompts/list", params: {} },
  {
    jsonrpc: "2.0",
    id: 6,
    method: "resources/read",
    params: { uri: "memory://namespace/smoke-namespace/recent" }
  },
  {
    jsonrpc: "2.0",
    id: 7,
    method: "resources/read",
    params: { uri: "memory://namespace/smoke-namespace/brief" }
  },
  {
    jsonrpc: "2.0",
    id: 8,
    method: "resources/read",
    params: { uri: "memory://namespace/smoke-namespace/handoffs/smoke-agent" }
  },
  {
    jsonrpc: "2.0",
    id: 9,
    method: "prompts/get",
    params: { name: "load_project_memory", arguments: { namespace: "smoke-namespace" } }
  }
])

const tools = responses.find(response => response.id === 2).result.tools.map(tool => tool.name)
const resources = responses.find(response => response.id === 3).result.resources.map(resource => resource.uri)
const resourceTemplates = responses.find(response => response.id === 4).result.resourceTemplates.map(resource => resource.uriTemplate)
const prompts = responses.find(response => response.id === 5).result.prompts.map(prompt => prompt.name)
const namespaceRecent = responses.find(response => response.id === 6).result.contents[0].text
const namespaceBrief = responses.find(response => response.id === 7).result.contents[0].text
const namespaceHandoffs = responses.find(response => response.id === 8).result.contents[0].text
const loadPrompt = responses.find(response => response.id === 9).result.messages[0].content.text

assert.deepEqual(tools.sort(), [
  "ack_handoff",
  "create_handoff",
  "create_snapshot",
  "get_project_brief",
  "list_contexts",
  "list_handoffs",
  "peek_handoff",
  "read_handoff",
  "read_latest_context",
  "reopen_handoff",
  "save_context",
  "save_memory",
  "search_memory"
].sort())
assert.deepEqual(resources.sort(), ["memory://recent"].sort())
assert.deepEqual(resourceTemplates.sort(), [
  "memory://handoffs/{agent}",
  "memory://namespace/{namespace}/brief",
  "memory://namespace/{namespace}/handoffs/{agent}",
  "memory://namespace/{namespace}/recent"
].sort())
assert.deepEqual(prompts.sort(), [
  "load_project_memory",
  "prepare_handoff",
  "summarize_decisions"
].sort())
assert.match(namespaceRecent, /No saved context yet/)
assert.match(namespaceBrief, /smoke-namespace/)
assert.match(namespaceHandoffs, /No handoffs found/)
assert.match(loadPrompt, /smoke-namespace/)

// --- Session 2: create_handoff (isolated write session) ---
const responses2 = await runSession([
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" }
    }
  },
  {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "create_handoff",
      arguments: { namespace: "smoke-namespace", to: "smoke-agent", summary: "smoke summary", context: "smoke context" }
    }
  }
])

const handoffCreated = responses2.find(response => response.id === 10).result.content[0].text
assert.match(handoffCreated, /Handoff created for smoke-agent/)

// --- Session 3: read_handoff (handoff now exists in store) ---
const responses3 = await runSession([
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" }
    }
  },
  {
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: {
      name: "read_handoff",
      arguments: { namespace: "smoke-namespace", agent: "smoke-agent" }
    }
  }
])

const handoffRead = responses3.find(response => response.id === 11).result.content[0].text
assert.match(handoffRead, /## Summary\nsmoke summary/)
assert.match(handoffRead, /## Full Context\nsmoke context/)

console.log("smoke OK")

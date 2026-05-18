import assert from "node:assert/strict"
import { spawn } from "node:child_process"

const child = spawn(process.execPath, ["./bin/shared-memory-mcp.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    SHARED_MEMORY_MCP_STORAGE_FILE: "/tmp/shared-memory-mcp-smoke.json"
  }
})

let output = ""
child.stdout.setEncoding("utf8")
child.stdout.on("data", chunk => {
  output += chunk
})

child.stdin.write(`${JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0.0" }
  }
})}\n`)
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`)
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/list", params: {} })}\n`)
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/templates/list", params: {} })}\n`)
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "prompts/list", params: {} })}\n`)
child.stdin.write(`${JSON.stringify({
  jsonrpc: "2.0",
  id: 6,
  method: "resources/read",
  params: { uri: "memory://namespace/smoke-namespace/brief" }
})}\n`)
child.stdin.write(`${JSON.stringify({
  jsonrpc: "2.0",
  id: 7,
  method: "prompts/get",
  params: { name: "load_project_memory", arguments: { namespace: "smoke-namespace" } }
})}\n`)
child.stdin.end()

const exitCode = await new Promise(resolve => child.on("close", resolve))
assert.equal(exitCode, 0)

const responses = output.trim().split("\n").map(line => JSON.parse(line))
const tools = responses.find(response => response.id === 2).result.tools.map(tool => tool.name)
const resources = responses.find(response => response.id === 3).result.resources.map(resource => resource.uri)
const resourceTemplates = responses.find(response => response.id === 4).result.resourceTemplates.map(resource => resource.uriTemplate)
const prompts = responses.find(response => response.id === 5).result.prompts.map(prompt => prompt.name)
const namespaceBrief = responses.find(response => response.id === 6).result.contents[0].text
const loadPrompt = responses.find(response => response.id === 7).result.messages[0].content.text

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
  "memory://namespace/{namespace}/brief"
].sort())
assert.deepEqual(prompts.sort(), [
  "load_project_memory",
  "prepare_handoff",
  "summarize_decisions"
].sort())
assert.match(namespaceBrief, /smoke-namespace/)
assert.match(loadPrompt, /smoke-namespace/)

console.log("smoke OK")

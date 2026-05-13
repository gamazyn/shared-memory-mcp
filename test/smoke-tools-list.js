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
child.stdin.end()

const exitCode = await new Promise(resolve => child.on("close", resolve))
assert.equal(exitCode, 0)

const responses = output.trim().split("\n").map(line => JSON.parse(line))
const tools = responses.find(response => response.id === 2).result.tools.map(tool => tool.name)

assert.deepEqual(tools.sort(), [
  "create_handoff",
  "list_contexts",
  "read_handoff",
  "read_latest_context",
  "save_context"
].sort())

console.log("smoke OK")

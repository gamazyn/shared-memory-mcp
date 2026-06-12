import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { getRuntimeConfig } from "./config.js"
import { createSharedMemoryStore } from "./storage.js"
import { registerResources } from "./server/resources.js"
import { registerPrompts } from "./server/prompts.js"
import { registerTools } from "./server/tools.js"

export function createServer(options = {}) {
  const config = options.config ?? getRuntimeConfig()
  const store = options.store ?? createSharedMemoryStore(config)
  const server = new McpServer({ name: "shared-memory", version: "1.0.0" })

  registerResources(server, store)
  registerPrompts(server)
  registerTools(server, store)

  return server
}

export async function runServer(options = {}) {
  const server = createServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

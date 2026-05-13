import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { getRuntimeConfig } from "./config.js"
import { createSharedMemoryStore } from "./storage.js"

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString()
}

export function createServer(options = {}) {
  const config = options.config ?? getRuntimeConfig()
  const store = options.store ?? createSharedMemoryStore(config)
  const server = new McpServer({ name: "shared-memory", version: "1.0.0" })

  server.tool(
    "save_context",
    "Save free-form context so another MCP-compatible agent can read it later.",
    {
      agent: z.string().min(1).describe("Agent saving the context, for example: claude-code, codex, assistant-a"),
      title: z.string().min(1).describe("Short descriptive title"),
      content: z.string().min(1).describe("Full context content"),
      tags: z.array(z.string()).optional().describe("Optional categorization tags")
    },
    async ({ agent, title, content, tags }) => {
      const entry = store.saveContext({ agent, title, content, tags: tags ?? [] })
      return { content: [{ type: "text", text: `Context saved with ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "create_handoff",
    "Create a structured handoff for another MCP-compatible agent.",
    {
      to: z.string().min(1).describe("Destination agent, for example: claude-code, codex, assistant-b"),
      summary: z.string().min(1).describe("Summary of what happened and what should continue"),
      context: z.string().min(1).describe("Full context needed to continue the work")
    },
    async ({ to, summary, context }) => {
      const entry = store.createHandoff({ to, summary, context })
      return { content: [{ type: "text", text: `Handoff created for ${to}. ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "read_handoff",
    "Read the next pending handoff for this agent and mark it as read.",
    {
      agent: z.string().min(1).describe("Current agent name, for example: claude-code, codex, assistant-b")
    },
    async ({ agent }) => {
      const entry = store.readHandoff({ agent })
      if (!entry) return { content: [{ type: "text", text: "No pending handoff." }] }
      return { content: [{ type: "text", text: entry.content }] }
    }
  )

  server.tool(
    "read_latest_context",
    "Read the most recent saved context, optionally filtered by agent.",
    {
      agent: z.string().optional().describe("Optional agent filter")
    },
    async ({ agent }) => {
      const entry = store.getLastContext({ agent })
      if (!entry) return { content: [{ type: "text", text: "No context found." }] }
      return {
        content: [{
          type: "text",
          text: `**${entry.title}** - ${entry.agent} - ${formatTimestamp(entry.timestamp)}\n\n${entry.content}`
        }]
      }
    }
  )

  server.tool(
    "list_contexts",
    "List recent contexts and handoffs.",
    {
      limit: z.number().optional().describe("Maximum number of items to list, default: 10")
    },
    async ({ limit }) => {
      const items = store.listContexts({ limit: limit ?? 10 })
      if (items.length === 0) return { content: [{ type: "text", text: "No saved context yet." }] }

      const text = items.map((entry, index) => {
        const destination = entry.to ? ` -> ${entry.to}` : ""
        const pending = entry.read === false ? " [PENDING]" : ""
        return `${index + 1}. [${entry.type}${destination}${pending}] ${entry.title} - ${entry.agent} - ${formatTimestamp(entry.timestamp)}`
      }).join("\n")
      return { content: [{ type: "text", text }] }
    }
  )

  return server
}

export async function runServer(options = {}) {
  const server = createServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

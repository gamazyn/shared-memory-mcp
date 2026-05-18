import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { getRuntimeConfig } from "./config.js"
import { createSharedMemoryStore } from "./storage.js"

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString()
}

function formatContextEntry(entry, index) {
  const destination = entry.to ? ` -> ${entry.to}` : ""
  const pending = entry.read === false ? " [PENDING]" : ""
  const namespace = entry.namespace ? ` (${entry.namespace})` : ""
  return `${index + 1}. [${entry.type}${destination}${pending}]${namespace} ${entry.title} - ${entry.agent} - ${formatTimestamp(entry.timestamp)}`
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
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      title: z.string().min(1).describe("Short descriptive title"),
      content: z.string().min(1).describe("Full context content"),
      tags: z.array(z.string()).optional().describe("Optional categorization tags")
    },
    async ({ agent, namespace, title, content, tags }) => {
      const entry = store.saveContext({ agent, namespace, title, content, tags: tags ?? [] })
      return { content: [{ type: "text", text: `Context saved with ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "create_handoff",
    "Create a structured handoff for another MCP-compatible agent.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      to: z.string().min(1).describe("Destination agent, for example: claude-code, codex, assistant-b"),
      summary: z.string().min(1).describe("Summary of what happened and what should continue"),
      context: z.string().min(1).describe("Full context needed to continue the work")
    },
    async ({ namespace, to, summary, context }) => {
      const entry = store.createHandoff({ namespace, to, summary, context })
      return { content: [{ type: "text", text: `Handoff created for ${to}. ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "read_handoff",
    "Read the next pending handoff for this agent and mark it as read.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      agent: z.string().min(1).describe("Current agent name, for example: claude-code, codex, assistant-b")
    },
    async ({ namespace, agent }) => {
      const entry = store.readHandoff({ namespace, agent })
      if (!entry) return { content: [{ type: "text", text: "No pending handoff." }] }
      return { content: [{ type: "text", text: entry.content }] }
    }
  )

  server.tool(
    "read_latest_context",
    "Read the most recent saved context, optionally filtered by agent.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      agent: z.string().optional().describe("Optional agent filter")
    },
    async ({ namespace, agent }) => {
      const entry = store.getLastContext({ namespace, agent })
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
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      agent: z.string().optional().describe("Optional agent filter"),
      tags: z.array(z.string()).optional().describe("Optional tag filters; all tags must match"),
      type: z.enum(["context", "handoff"]).optional().describe("Optional item type filter"),
      limit: z.number().optional().describe("Maximum number of items to list, default: 10")
    },
    async ({ namespace, agent, tags, type, limit }) => {
      const items = store.listContexts({ namespace, agent, tags: tags ?? [], type, limit: limit ?? 10 })
      if (items.length === 0) return { content: [{ type: "text", text: "No saved context yet." }] }

      const text = items.map(formatContextEntry).join("\n")
      return { content: [{ type: "text", text }] }
    }
  )

  server.tool(
    "search_memory",
    "Search saved contexts and handoffs by text and filters.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      query: z.string().optional().describe("Optional case-insensitive text query"),
      agent: z.string().optional().describe("Optional source agent filter"),
      tags: z.array(z.string()).optional().describe("Optional tag filters; all tags must match"),
      type: z.enum(["context", "handoff"]).optional().describe("Optional item type filter"),
      handoffStatus: z.enum(["all", "pending", "read"]).optional().describe("Optional status filter for handoffs"),
      limit: z.number().optional().describe("Maximum number of items to return, default: 10")
    },
    async ({ namespace, query, agent, tags, type, handoffStatus, limit }) => {
      const items = store.searchMemory({
        namespace,
        query,
        agent,
        tags: tags ?? [],
        type,
        handoffStatus: handoffStatus ?? "all",
        limit: limit ?? 10
      })
      if (items.length === 0) return { content: [{ type: "text", text: "No matching memory found." }] }

      const text = items.map(formatContextEntry).join("\n")
      return { content: [{ type: "text", text }] }
    }
  )

  server.tool(
    "list_handoffs",
    "List handoffs, optionally filtered by destination agent and status.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      agent: z.string().optional().describe("Optional destination agent filter"),
      status: z.enum(["all", "pending", "read"]).optional().describe("Optional handoff status filter"),
      limit: z.number().optional().describe("Maximum number of handoffs to list, default: 10")
    },
    async ({ namespace, agent, status, limit }) => {
      const items = store.listHandoffs({ namespace, agent, status: status ?? "all", limit: limit ?? 10 })
      if (items.length === 0) return { content: [{ type: "text", text: "No handoffs found." }] }

      const text = items.map(formatContextEntry).join("\n")
      return { content: [{ type: "text", text }] }
    }
  )

  server.tool(
    "peek_handoff",
    "Read the next pending handoff for this agent without marking it as read.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      agent: z.string().min(1).describe("Current agent name")
    },
    async ({ namespace, agent }) => {
      const entry = store.peekHandoff({ namespace, agent })
      if (!entry) return { content: [{ type: "text", text: "No pending handoff." }] }
      return { content: [{ type: "text", text: entry.content }] }
    }
  )

  server.tool(
    "ack_handoff",
    "Mark a handoff as read by ID.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      id: z.string().min(1).describe("Handoff ID")
    },
    async ({ namespace, id }) => {
      const entry = store.ackHandoff({ namespace, id })
      if (!entry) return { content: [{ type: "text", text: "Handoff not found." }] }
      return { content: [{ type: "text", text: `Handoff marked as read. ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "reopen_handoff",
    "Mark a read handoff as pending again by ID.",
    {
      namespace: z.string().optional().describe("Optional project or workspace namespace, default: default"),
      id: z.string().min(1).describe("Handoff ID")
    },
    async ({ namespace, id }) => {
      const entry = store.reopenHandoff({ namespace, id })
      if (!entry) return { content: [{ type: "text", text: "Handoff not found." }] }
      return { content: [{ type: "text", text: `Handoff reopened. ID: ${entry.id}` }] }
    }
  )

  return server
}

export async function runServer(options = {}) {
  const server = createServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { getRuntimeConfig } from "./config.js"
import { schemas } from "./schemas.js"
import { createSharedMemoryStore } from "./storage.js"

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString()
}

function formatContextEntry(entry, index) {
  const destination = entry.to ? ` -> ${entry.to}` : ""
  const pending = entry.read === false ? " [PENDING]" : ""
  const namespace = entry.namespace ? ` (${entry.namespace})` : ""
  const kind = entry.kind ? `/${entry.kind}` : ""
  return `${index + 1}. [${entry.type}${kind}${destination}${pending}]${namespace} ${entry.title} - ${entry.agent} - ${formatTimestamp(entry.timestamp)}`
}

function promptMessage(text) {
  return {
    messages: [{
      role: "user",
      content: { type: "text", text }
    }]
  }
}

export function createServer(options = {}) {
  const config = options.config ?? getRuntimeConfig()
  const store = options.store ?? createSharedMemoryStore(config)
  const server = new McpServer({ name: "shared-memory", version: "1.0.0" })

  server.registerResource(
    "recent-memory",
    "memory://recent",
    {
      title: "Recent Memory",
      description: "Recent contexts and handoffs from the default namespace.",
      mimeType: "text/plain"
    },
    async () => {
      const items = store.listContexts({ limit: 10 })
      return {
        contents: [{
          uri: "memory://recent",
          mimeType: "text/plain",
          text: items.length ? items.map(formatContextEntry).join("\n") : "No saved context yet."
        }]
      }
    }
  )

  server.registerResource(
    "namespace-brief",
    new ResourceTemplate("memory://namespace/{namespace}/brief", { list: undefined }),
    {
      title: "Namespace Brief",
      description: "Latest snapshot or generated brief for a namespace.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const namespace = variables.namespace
      const brief = store.getProjectBrief({ namespace })
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: `**${brief.title}**\n\n${brief.content}`
        }]
      }
    }
  )

  server.registerResource(
    "namespace-recent-memory",
    new ResourceTemplate("memory://namespace/{namespace}/recent", { list: undefined }),
    {
      title: "Namespace Recent Memory",
      description: "Recent contexts and handoffs for a namespace.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const items = store.listContexts({ namespace: variables.namespace, limit: 10 })
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: items.length ? items.map(formatContextEntry).join("\n") : "No saved context yet."
        }]
      }
    }
  )

  server.registerResource(
    "agent-handoffs",
    new ResourceTemplate("memory://handoffs/{agent}", { list: undefined }),
    {
      title: "Agent Handoffs",
      description: "Pending and read handoffs for an agent in the default namespace.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const items = store.listHandoffs({ agent: variables.agent, status: "all", limit: 20 })
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: items.length ? items.map(formatContextEntry).join("\n") : "No handoffs found."
        }]
      }
    }
  )

  server.registerResource(
    "namespace-agent-handoffs",
    new ResourceTemplate("memory://namespace/{namespace}/handoffs/{agent}", { list: undefined }),
    {
      title: "Namespace Agent Handoffs",
      description: "Pending and read handoffs for an agent in a namespace.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const items = store.listHandoffs({
        namespace: variables.namespace,
        agent: variables.agent,
        status: "all",
        limit: 20
      })
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: items.length ? items.map(formatContextEntry).join("\n") : "No handoffs found."
        }]
      }
    }
  )

  server.registerPrompt(
    "prepare_handoff",
    {
      title: "Prepare Handoff",
      description: "Draft a complete handoff for another agent.",
      argsSchema: {
        to: z.string().describe("Destination agent name"),
        namespace: z.string().optional().describe("Project namespace")
      }
    },
    async ({ to, namespace }) => promptMessage(
      `Prepare a concise but complete handoff for ${to}${namespace ? ` in namespace ${namespace}` : ""}. Include summary, current state, files or decisions that matter, risks, and the exact next action.`
    )
  )

  server.registerPrompt(
    "load_project_memory",
    {
      title: "Load Project Memory",
      description: "Load the relevant shared memory before starting work.",
      argsSchema: {
        namespace: z.string().optional().describe("Project namespace")
      }
    },
    async ({ namespace }) => promptMessage(
      `Load shared memory${namespace ? ` for namespace ${namespace}` : ""}. Read the project brief, recent memory, and pending handoffs before making changes.`
    )
  )

  server.registerPrompt(
    "summarize_decisions",
    {
      title: "Summarize Decisions",
      description: "Summarize saved decisions in shared memory.",
      argsSchema: {
        namespace: z.string().optional().describe("Project namespace")
      }
    },
    async ({ namespace }) => promptMessage(
      `Summarize the important decisions${namespace ? ` in namespace ${namespace}` : ""}. Group them by topic, include the rationale, and identify any stale or conflicting decisions.`
    )
  )

  server.tool(
    "save_context",
    "Save free-form context so another MCP-compatible agent can read it later.",
    schemas.saveContext,
    async ({ agent, namespace, title, content, tags }) => {
      const entry = store.saveContext({ agent, namespace, title, content, tags: tags ?? [] })
      return { content: [{ type: "text", text: `Context saved with ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "save_memory",
    "Save structured memory with a kind and optional workflow metadata.",
    schemas.saveMemory,
    async input => {
      const entry = store.saveMemory({ ...input, tags: input.tags ?? [], relatedFiles: input.relatedFiles ?? [] })
      return { content: [{ type: "text", text: `Memory saved with ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "create_handoff",
    "Create a structured handoff for another MCP-compatible agent.",
    schemas.createHandoff,
    async ({ namespace, to, summary, context }) => {
      const entry = store.createHandoff({ namespace, to, summary, context })
      return { content: [{ type: "text", text: `Handoff created for ${to}. ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "read_handoff",
    "Read the next pending handoff for this agent and mark it as read.",
    schemas.readHandoff,
    async ({ namespace, agent }) => {
      const entry = store.readHandoff({ namespace, agent })
      if (!entry) return { content: [{ type: "text", text: "No pending handoff." }] }
      return { content: [{ type: "text", text: entry.content }] }
    }
  )

  server.tool(
    "read_latest_context",
    "Read the most recent saved context, optionally filtered by agent.",
    schemas.readLatestContext,
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
    schemas.listContexts,
    async ({ namespace, agent, tags, type, kind, limit }) => {
      const items = store.listContexts({ namespace, agent, tags: tags ?? [], type, kind, limit: limit ?? 10 })
      if (items.length === 0) return { content: [{ type: "text", text: "No saved context yet." }] }

      const text = items.map(formatContextEntry).join("\n")
      return { content: [{ type: "text", text }] }
    }
  )

  server.tool(
    "search_memory",
    "Search saved contexts and handoffs by text and filters.",
    schemas.searchMemory,
    async ({ namespace, query, agent, tags, type, kind, handoffStatus, limit }) => {
      const items = store.searchMemory({
        namespace,
        query,
        agent,
        tags: tags ?? [],
        type,
        kind,
        handoffStatus: handoffStatus ?? "all",
        limit: limit ?? 10
      })
      if (items.length === 0) return { content: [{ type: "text", text: "No matching memory found." }] }

      const text = items.map(formatContextEntry).join("\n")
      return { content: [{ type: "text", text }] }
    }
  )

  server.tool(
    "create_snapshot",
    "Save a durable snapshot summary for a namespace.",
    schemas.createSnapshot,
    async ({ namespace, agent, title, content }) => {
      const entry = store.createSnapshot({ namespace, agent, title, content })
      return { content: [{ type: "text", text: `Snapshot created with ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "get_project_brief",
    "Read the latest snapshot for a namespace, or a generated brief from recent memory.",
    schemas.getProjectBrief,
    async ({ namespace, limit }) => {
      const entry = store.getProjectBrief({ namespace, limit: limit ?? 10 })
      return {
        content: [{
          type: "text",
          text: `**${entry.title}** - ${entry.namespace} - ${formatTimestamp(entry.timestamp)}\n\n${entry.content}`
        }]
      }
    }
  )

  server.tool(
    "list_handoffs",
    "List handoffs, optionally filtered by destination agent and status.",
    schemas.listHandoffs,
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
    schemas.peekHandoff,
    async ({ namespace, agent }) => {
      const entry = store.peekHandoff({ namespace, agent })
      if (!entry) return { content: [{ type: "text", text: "No pending handoff." }] }
      return { content: [{ type: "text", text: entry.content }] }
    }
  )

  server.tool(
    "ack_handoff",
    "Mark a handoff as read by ID.",
    schemas.ackHandoff,
    async ({ namespace, id }) => {
      const entry = store.ackHandoff({ namespace, id })
      if (!entry) return { content: [{ type: "text", text: "Handoff not found." }] }
      return { content: [{ type: "text", text: `Handoff marked as read. ID: ${entry.id}` }] }
    }
  )

  server.tool(
    "reopen_handoff",
    "Mark a read handoff as pending again by ID.",
    schemas.reopenHandoff,
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

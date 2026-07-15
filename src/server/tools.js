import { schemas } from "../schemas.js"
import { formatContextEntry, formatTimestamp } from "./format.js"

export function registerTools(server, store) {
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
}

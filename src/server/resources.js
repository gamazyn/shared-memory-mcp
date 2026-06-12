import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"

import { formatContextEntry } from "./format.js"

export function registerResources(server, store) {
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
}

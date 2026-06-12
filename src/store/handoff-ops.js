import {
  sanitizeText,
  INPUT_LIMITS
} from "../sanitize.js"
import { matchesHandoffStatus, matchesNamespace, normalizeLimit } from "./matchers.js"

export function createHandoffOps({ update, readData, resolveNamespace, cleanupOptions }) {
  return {
    createHandoff({ namespace, to, summary, context }, { sanitizeHandoffInput, redactEntry, randomUUID }) {
      const input = sanitizeHandoffInput({ namespace: resolveNamespace(namespace), to, summary, context })
      return update(data => {
        const entry = redactEntry({
          id: randomUUID(),
          agent: "handoff",
          namespace: input.namespace,
          kind: input.kind,
          to: input.to,
          title: `Handoff to ${input.to}`,
          content: `## Summary\n${input.summary}\n\n## Full Context\n${input.context}`,
          tags: ["handoff"],
          timestamp: new Date().toISOString(),
          type: "handoff",
          read: false
        })
        data.contexts.unshift(entry)
        return entry
      })
    },

    readHandoff({ agent, namespace }) {
      const safeAgent = sanitizeText(agent, "agent", INPUT_LIMITS.agent)
      const safeNamespace = resolveNamespace(namespace)
      return update(data => {
        const entry = data.contexts.find(context =>
          context.type === "handoff" &&
          matchesNamespace(context, safeNamespace) &&
          context.to === safeAgent &&
          !context.read
        )
        if (!entry) return null
        entry.read = true
        entry.readAt = new Date().toISOString()
        if (cleanupOptions.deleteReadHandoffs) {
          data.contexts = data.contexts.filter(context => context.id !== entry.id)
        }
        return entry
      })
    },

    listHandoffs({ namespace, agent, status = "all", limit = 10 } = {}) {
      const safeLimit = normalizeLimit(limit)
      const safeNamespace = resolveNamespace(namespace)
      const safeAgent = agent ? sanitizeText(agent, "agent", INPUT_LIMITS.agent) : undefined
      const data = readData()
      return data.contexts.filter(context =>
        context.type === "handoff" &&
        matchesNamespace(context, safeNamespace) &&
        (safeAgent ? context.to === safeAgent : true) &&
        matchesHandoffStatus(context, status)
      ).slice(0, safeLimit)
    },

    peekHandoff({ agent, namespace }) {
      const safeAgent = sanitizeText(agent, "agent", INPUT_LIMITS.agent)
      const safeNamespace = resolveNamespace(namespace)
      const data = readData()
      return data.contexts.find(context =>
        context.type === "handoff" &&
        matchesNamespace(context, safeNamespace) &&
        context.to === safeAgent &&
        !context.read
      ) ?? null
    },

    ackHandoff({ id, namespace }) {
      const safeId = sanitizeText(id, "id", INPUT_LIMITS.content)
      const safeNamespace = resolveNamespace(namespace)
      return update(data => {
        const entry = data.contexts.find(context =>
          context.type === "handoff" &&
          matchesNamespace(context, safeNamespace) &&
          context.id === safeId
        )
        if (!entry) return null
        entry.read = true
        entry.readAt = new Date().toISOString()
        if (cleanupOptions.deleteReadHandoffs) {
          data.contexts = data.contexts.filter(context => context.id !== entry.id)
        }
        return entry
      })
    },

    reopenHandoff({ id, namespace }) {
      const safeId = sanitizeText(id, "id", INPUT_LIMITS.content)
      const safeNamespace = resolveNamespace(namespace)
      return update(data => {
        const entry = data.contexts.find(context =>
          context.type === "handoff" &&
          matchesNamespace(context, safeNamespace) &&
          context.id === safeId
        )
        if (!entry) return null
        entry.read = false
        delete entry.readAt
        return entry
      })
    }
  }
}

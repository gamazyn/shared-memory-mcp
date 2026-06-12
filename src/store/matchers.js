import {
  DEFAULT_DELETE_READ_HANDOFFS,
  DEFAULT_READ_HANDOFF_TTL_DAYS
} from "../config.js"

const DEFAULT_NAMESPACE = "default"

export function normalizeData(data) {
  if (!data || !Array.isArray(data.contexts)) return { contexts: [] }
  for (const context of data.contexts) {
    context.namespace ??= DEFAULT_NAMESPACE
    context.kind ??= context.type === "handoff" ? "handoff" : "note"
  }
  return data
}

export function normalizeLimit(limit) {
  return Number.isFinite(limit) && limit > 0 ? limit : 10
}

export function contextNamespace(context) {
  return context.namespace ?? DEFAULT_NAMESPACE
}

export function matchesNamespace(context, namespace) {
  return contextNamespace(context) === namespace
}

export function matchesTags(context, tags) {
  if (!tags || tags.length === 0) return true
  const existing = new Set(context.tags ?? [])
  return tags.every(tag => existing.has(tag))
}

export function matchesQuery(context, query) {
  if (!query) return true
  const haystack = [
    context.title,
    context.content,
    context.agent,
    context.to,
    ...(context.tags ?? [])
  ].filter(Boolean).join("\n").toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export function matchesHandoffStatus(context, status) {
  if (!status || status === "all") return true
  if (status === "pending") return context.read === false
  if (status === "read") return context.read === true
  return true
}

export function matchesKind(context, kind) {
  return kind ? context.kind === kind : true
}

export function formatBriefItem(context) {
  return `- [${context.kind ?? context.type}] ${context.title} (${context.agent}): ${context.content}`
}

export function limitContexts(contexts, maxItems) {
  if (contexts.length <= maxItems) return contexts

  const keep = new Set()
  for (const context of contexts) {
    const pendingHandoff = context.type === "handoff" && context.read === false
    if (pendingHandoff && keep.size < maxItems) keep.add(context)
  }
  for (const context of contexts) {
    if (keep.size >= maxItems) break
    keep.add(context)
  }
  return contexts.filter(context => keep.has(context))
}

export function cleanContexts(contexts, options) {
  const deleteReadHandoffs = options.deleteReadHandoffs ?? DEFAULT_DELETE_READ_HANDOFFS
  const ttlDays = options.readHandoffTtlDays ?? DEFAULT_READ_HANDOFF_TTL_DAYS
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000
  const now = Date.now()

  return contexts.filter(context => {
    if (context.type !== "handoff" || context.read !== true) return true
    if (deleteReadHandoffs) return false
    if (!context.readAt) return true
    return now - Date.parse(context.readAt) < ttlMs
  })
}

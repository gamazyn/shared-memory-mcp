import { randomUUID } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"

import {
  DEFAULT_DELETE_READ_HANDOFFS,
  DEFAULT_MAX_ITEMS,
  DEFAULT_READ_HANDOFF_TTL_DAYS,
  DEFAULT_STORAGE_FILE
} from "./config.js"
import {
  sanitizeContextInput,
  sanitizeHandoffInput,
  sanitizeKind,
  sanitizeOptionalNamespace,
  sanitizeRelatedFiles,
  sanitizeStructuredMemoryInput,
  sanitizeTags,
  sanitizeText,
  INPUT_LIMITS
} from "./sanitize.js"

const LOCK_RETRY_MS = 20
const LOCK_TIMEOUT_MS = 5000
const LOCK_STALE_MS = 30000
const DEFAULT_NAMESPACE = "default"

function redactSecrets(value) {
  return value
    .replace(/\b(?:gho|ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(api[_-]?key|token|secret|password)=([^\s]+)/gi, "$1=[REDACTED_SECRET]")
}

function redactTags(tags) {
  return tags.map(tag => redactSecrets(tag))
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function normalizeData(data) {
  if (!data || !Array.isArray(data.contexts)) return { contexts: [] }
  for (const context of data.contexts) {
    context.namespace ??= DEFAULT_NAMESPACE
    context.kind ??= context.type === "handoff" ? "handoff" : "note"
  }
  return data
}

function normalizeLimit(limit) {
  return Number.isFinite(limit) && limit > 0 ? limit : 10
}

function contextNamespace(context) {
  return context.namespace ?? DEFAULT_NAMESPACE
}

function matchesNamespace(context, namespace) {
  return contextNamespace(context) === namespace
}

function matchesTags(context, tags) {
  if (!tags || tags.length === 0) return true
  const existing = new Set(context.tags ?? [])
  return tags.every(tag => existing.has(tag))
}

function matchesQuery(context, query) {
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

function matchesHandoffStatus(context, status) {
  if (!status || status === "all") return true
  if (status === "pending") return context.read === false
  if (status === "read") return context.read === true
  return true
}

function matchesKind(context, kind) {
  return kind ? context.kind === kind : true
}

function formatBriefItem(context) {
  return `- [${context.kind ?? context.type}] ${context.title} (${context.agent}): ${context.content}`
}

function limitContexts(contexts, maxItems) {
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

function cleanContexts(contexts, options) {
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

function withDirectoryLock({ storageDir, lockDir }, fn) {
  if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })
  const start = Date.now()

  while (true) {
    try {
      mkdirSync(lockDir)
      break
    } catch (error) {
      try {
        const lockAge = Date.now() - statSync(lockDir).mtimeMs
        if (lockAge > LOCK_STALE_MS) rmSync(lockDir, { recursive: true, force: true })
      } catch {
        // The lock may have been removed between mkdir failure and stat.
      }

      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for shared memory storage lock: ${error.message}`)
      }
      sleep(LOCK_RETRY_MS)
    }
  }

  try {
    return fn()
  } finally {
    rmSync(lockDir, { recursive: true, force: true })
  }
}

export function createSharedMemoryStore(options = {}) {
  const storageFile = options.storageFile ?? DEFAULT_STORAGE_FILE
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const cleanupOptions = {
    readHandoffTtlDays: options.readHandoffTtlDays ?? DEFAULT_READ_HANDOFF_TTL_DAYS,
    deleteReadHandoffs: options.deleteReadHandoffs ?? DEFAULT_DELETE_READ_HANDOFFS
  }
  const storageDir = dirname(storageFile)
  const lockDir = join(storageDir, ".contexts.lock")
  const tempFile = `${storageFile}.tmp`
  const backupDir = options.backupDir
  const redactEnabled = options.redactSecrets === true
  const defaultNamespace = options.defaultNamespace ?? DEFAULT_NAMESPACE

  function resolveNamespace(namespace) {
    return sanitizeOptionalNamespace(
      namespace === undefined || namespace === null || namespace === "" ? defaultNamespace : namespace
    )
  }

  function redactContent(content) {
    return redactEnabled ? redactSecrets(content) : content
  }

  function redactTagList(tags) {
    return redactEnabled ? redactTags(tags) : tags
  }

  function redactEntry(entry) {
    if (!redactEnabled) return entry
    const redacted = { ...entry }
    for (const field of ["title", "content", "status", "branch", "commit", "nextAction", "to", "agent"]) {
      if (typeof redacted[field] === "string") redacted[field] = redactContent(redacted[field])
    }
    if (Array.isArray(redacted.tags)) redacted.tags = redactTagList(redacted.tags)
    if (Array.isArray(redacted.relatedFiles)) redacted.relatedFiles = redactTagList(redacted.relatedFiles)
    return redacted
  }

  function sanitizeTimestamp(timestamp) {
    const safeTimestamp = sanitizeText(timestamp, "timestamp", INPUT_LIMITS.content)
    if (Number.isNaN(Date.parse(safeTimestamp))) throw new Error("timestamp must be a valid date")
    return safeTimestamp
  }

  function hasProvidedValue(value) {
    return value !== undefined && value !== null && value !== ""
  }

  function sanitizeImportedEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("imported context must be an object")
    }
    const id = sanitizeText(entry.id, "id", INPUT_LIMITS.content)
    const type = sanitizeText(entry.type, "type", INPUT_LIMITS.kind)
    if (!["context", "handoff"].includes(type)) throw new Error("type must be one of: context, handoff")

    const base = {
      id,
      namespace: resolveNamespace(entry.namespace),
      title: sanitizeText(entry.title, "title", INPUT_LIMITS.title),
      content: sanitizeText(entry.content, "content", INPUT_LIMITS.content),
      tags: sanitizeTags(entry.tags ?? []),
      timestamp: sanitizeTimestamp(entry.timestamp),
      type
    }

    if (type === "handoff") {
      const imported = {
        ...base,
        agent: sanitizeText(entry.agent ?? "handoff", "agent", INPUT_LIMITS.agent),
        kind: "handoff",
        to: sanitizeText(entry.to, "to", INPUT_LIMITS.agent),
        read: entry.read === true
      }
      if (hasProvidedValue(entry.readAt)) imported.readAt = sanitizeTimestamp(entry.readAt)
      return redactEntry(imported)
    }

    const imported = {
      ...base,
      agent: sanitizeText(entry.agent, "agent", INPUT_LIMITS.agent),
      kind: sanitizeKind(entry.kind ?? "note")
    }
    if (hasProvidedValue(entry.status)) imported.status = sanitizeText(entry.status, "status", INPUT_LIMITS.status)
    if (entry.relatedFiles !== undefined) imported.relatedFiles = sanitizeRelatedFiles(entry.relatedFiles)
    if (hasProvidedValue(entry.branch)) imported.branch = sanitizeText(entry.branch, "branch", INPUT_LIMITS.file)
    if (hasProvidedValue(entry.commit)) imported.commit = sanitizeText(entry.commit, "commit", INPUT_LIMITS.file)
    if (hasProvidedValue(entry.nextAction)) imported.nextAction = sanitizeText(entry.nextAction, "nextAction", INPUT_LIMITS.title)
    return redactEntry(imported)
  }

  function backupStorage() {
    if (!backupDir || !existsSync(storageFile)) return null
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
    const backupFile = join(backupDir, `contexts-${Date.now()}.json`)
    copyFileSync(storageFile, backupFile)
    return backupFile
  }

  function load() {
    if (!existsSync(storageFile)) return { contexts: [] }
    try {
      return normalizeData(JSON.parse(readFileSync(storageFile, "utf8")))
    } catch {
      renameSync(storageFile, `${storageFile}.corrupt-${Date.now()}`)
      return { contexts: [] }
    }
  }

  function save(data) {
    if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })
    writeFileSync(tempFile, JSON.stringify(data, null, 2))
    renameSync(tempFile, storageFile)
  }

  function update(mutator) {
    return withDirectoryLock({ storageDir, lockDir }, () => {
      const data = load()
      data.contexts = cleanContexts(data.contexts, cleanupOptions)
      const result = mutator(data)
      data.contexts = cleanContexts(data.contexts, cleanupOptions)
      data.contexts = limitContexts(data.contexts, maxItems)
      save(data)
      return result
    })
  }

  function readData() {
    return withDirectoryLock({ storageDir, lockDir }, () => load())
  }

  return {
    saveContext({ agent, namespace, title, content, tags = [] }) {
      const input = sanitizeContextInput({ agent, namespace: resolveNamespace(namespace), title, content, tags })
      return update(data => {
        const entry = redactEntry({
          id: randomUUID(),
          agent: input.agent,
          namespace: input.namespace,
          kind: input.kind,
          title: input.title,
          content: input.content,
          tags: input.tags,
          timestamp: new Date().toISOString(),
          type: "context"
        })
        data.contexts.unshift(entry)
        return entry
      })
    },

    createHandoff({ namespace, to, summary, context }) {
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

    getLastContext({ agent, namespace } = {}) {
      const safeAgent = agent ? sanitizeText(agent, "agent", INPUT_LIMITS.agent) : undefined
      const safeNamespace = resolveNamespace(namespace)
      const data = readData()
      return data.contexts.find(context =>
        context.type === "context" &&
        matchesNamespace(context, safeNamespace) &&
        (safeAgent ? context.agent === safeAgent : true)
      ) ?? null
    },

    saveMemory(input) {
      const safeInput = sanitizeStructuredMemoryInput({ ...input, namespace: resolveNamespace(input.namespace) })
      return update(data => {
        const entry = redactEntry({
          id: randomUUID(),
          agent: safeInput.agent,
          namespace: safeInput.namespace,
          kind: safeInput.kind,
          title: safeInput.title,
          content: safeInput.content,
          tags: safeInput.tags,
          timestamp: new Date().toISOString(),
          type: "context"
        })
        if (safeInput.status) entry.status = redactContent(safeInput.status)
        if (safeInput.relatedFiles.length > 0) entry.relatedFiles = redactTagList(safeInput.relatedFiles)
        if (safeInput.branch) entry.branch = redactContent(safeInput.branch)
        if (safeInput.commit) entry.commit = redactContent(safeInput.commit)
        if (safeInput.nextAction) entry.nextAction = redactContent(safeInput.nextAction)
        data.contexts.unshift(entry)
        return entry
      })
    },

    createSnapshot({ namespace, agent, title, content }) {
      const safeInput = sanitizeStructuredMemoryInput({
        namespace: resolveNamespace(namespace),
        agent,
        kind: "snapshot",
        title,
        content,
        tags: ["snapshot"]
      })
      return update(data => {
        const entry = redactEntry({
          id: randomUUID(),
          agent: safeInput.agent,
          namespace: safeInput.namespace,
          kind: "snapshot",
          title: safeInput.title,
          content: safeInput.content,
          tags: safeInput.tags,
          timestamp: new Date().toISOString(),
          type: "context"
        })
        data.contexts.unshift(entry)
        return entry
      })
    },

    getProjectBrief({ namespace, limit = 10 } = {}) {
      const safeNamespace = resolveNamespace(namespace)
      const safeLimit = normalizeLimit(limit)
      const data = readData()
      const snapshot = data.contexts.find(context =>
        matchesNamespace(context, safeNamespace) &&
        context.type === "context" &&
        context.kind === "snapshot"
      )
      if (snapshot) return snapshot

      const items = data.contexts.filter(context =>
        matchesNamespace(context, safeNamespace) &&
        context.type === "context"
      ).slice(0, safeLimit)
      return {
        id: `brief-${safeNamespace}`,
        agent: "shared-memory",
        namespace: safeNamespace,
        kind: "snapshot",
        title: `Project brief for ${safeNamespace}`,
        content: items.length > 0
          ? items.map(formatBriefItem).join("\n")
          : `No saved memory found for namespace: ${safeNamespace}`,
        tags: ["snapshot"],
        timestamp: new Date().toISOString(),
        type: "context"
      }
    },

    listContexts({ namespace, agent, tags = [], type, kind, limit = 10 } = {}) {
      const safeLimit = normalizeLimit(limit)
      const safeNamespace = resolveNamespace(namespace)
      const safeAgent = agent ? sanitizeText(agent, "agent", INPUT_LIMITS.agent) : undefined
      const safeTags = sanitizeTags(tags)
      const data = readData()
      return data.contexts.filter(context =>
        matchesNamespace(context, safeNamespace) &&
        (safeAgent ? context.agent === safeAgent : true) &&
        (type ? context.type === type : true) &&
        matchesKind(context, kind) &&
        matchesTags(context, safeTags)
      ).slice(0, safeLimit)
    },

    searchMemory({ namespace, query, agent, tags = [], type, kind, handoffStatus = "all", limit = 10 } = {}) {
      const safeLimit = normalizeLimit(limit)
      const safeNamespace = resolveNamespace(namespace)
      const safeQuery = query ? sanitizeText(query, "query", INPUT_LIMITS.content) : undefined
      const safeAgent = agent ? sanitizeText(agent, "agent", INPUT_LIMITS.agent) : undefined
      const safeTags = sanitizeTags(tags)
      const data = readData()
      return data.contexts.filter(context =>
        matchesNamespace(context, safeNamespace) &&
        (safeAgent ? context.agent === safeAgent : true) &&
        (type ? context.type === type : true) &&
        matchesKind(context, kind) &&
        matchesTags(context, safeTags) &&
        matchesQuery(context, safeQuery) &&
        (context.type === "handoff" ? matchesHandoffStatus(context, handoffStatus) : true)
      ).slice(0, safeLimit)
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
    },

    exportData() {
      return readData()
    },

    importData(importedData) {
      const incomingContexts = Array.isArray(importedData)
        ? importedData
        : Array.isArray(importedData?.contexts)
          ? importedData.contexts
          : []
      const sanitizedContexts = incomingContexts.map(sanitizeImportedEntry)
      return update(data => {
        const backupFile = backupStorage()
        data.contexts = [...sanitizedContexts, ...data.contexts]
        return { imported: sanitizedContexts.length, backupFile }
      })
    },

    prune({ keep = 0 } = {}) {
      const safeKeep = Number.isFinite(keep) && keep >= 0 ? keep : 0
      return update(data => {
        const backupFile = backupStorage()
        const originalContexts = data.contexts
        const kept = []
        for (const context of originalContexts) {
          if (context.type === "handoff" && context.read === false) kept.push(context)
        }
        for (const context of originalContexts) {
          if (kept.length >= safeKeep) break
          if (!kept.includes(context)) kept.push(context)
        }
        data.contexts = kept
        return { pruned: Math.max(0, originalContexts.length - kept.length), backupFile }
      })
    }
  }
}

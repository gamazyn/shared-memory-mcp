import { randomUUID } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
  INPUT_LIMITS,
  redactSecrets,
  redactTags,
  sanitizeContextInput,
  sanitizeHandoffInput,
  sanitizeKind,
  sanitizeOptionalNamespace,
  sanitizeRelatedFiles,
  sanitizeStructuredMemoryInput,
  sanitizeTags,
  sanitizeText,
  sanitizeTimestamp
} from "./sanitize.js"
import {
  cleanContexts,
  formatBriefItem,
  limitContexts,
  matchesHandoffStatus,
  matchesKind,
  matchesNamespace,
  matchesQuery,
  matchesTags,
  normalizeData,
  normalizeLimit
} from "./store/matchers.js"
import { withDirectoryLock } from "./store/lock.js"
import { createHandoffOps } from "./store/handoff-ops.js"

const DEFAULT_NAMESPACE = "default"

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

  const handoffOps = createHandoffOps({ update, readData, resolveNamespace, cleanupOptions })

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

    createHandoff(args) {
      return handoffOps.createHandoff(args, { sanitizeHandoffInput, redactEntry, randomUUID })
    },

    readHandoff: handoffOps.readHandoff,

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

    listHandoffs: handoffOps.listHandoffs,
    peekHandoff: handoffOps.peekHandoff,
    ackHandoff: handoffOps.ackHandoff,
    reopenHandoff: handoffOps.reopenHandoff,

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

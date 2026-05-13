import { randomUUID } from "node:crypto"
import {
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
import { sanitizeContextInput, sanitizeHandoffInput, sanitizeText, INPUT_LIMITS } from "./sanitize.js"

const LOCK_RETRY_MS = 20
const LOCK_TIMEOUT_MS = 5000
const LOCK_STALE_MS = 30000

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function normalizeData(data) {
  if (!data || !Array.isArray(data.contexts)) return { contexts: [] }
  return data
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

  return {
    saveContext({ agent, title, content, tags = [] }) {
      const input = sanitizeContextInput({ agent, title, content, tags })
      return update(data => {
        const entry = {
          id: randomUUID(),
          agent: input.agent,
          title: input.title,
          content: input.content,
          tags: input.tags,
          timestamp: new Date().toISOString(),
          type: "context"
        }
        data.contexts.unshift(entry)
        return entry
      })
    },

    createHandoff({ to, summary, context }) {
      const input = sanitizeHandoffInput({ to, summary, context })
      return update(data => {
        const entry = {
          id: randomUUID(),
          agent: "handoff",
          to: input.to,
          title: `Handoff to ${input.to}`,
          content: `## Summary\n${input.summary}\n\n## Full Context\n${input.context}`,
          tags: ["handoff"],
          timestamp: new Date().toISOString(),
          type: "handoff",
          read: false
        }
        data.contexts.unshift(entry)
        return entry
      })
    },

    readHandoff({ agent }) {
      const safeAgent = sanitizeText(agent, "agent", INPUT_LIMITS.agent)
      return update(data => {
        const entry = data.contexts.find(context =>
          context.type === "handoff" && context.to === safeAgent && !context.read
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

    getLastContext({ agent } = {}) {
      const safeAgent = agent ? sanitizeText(agent, "agent", INPUT_LIMITS.agent) : undefined
      const data = update(currentData => null) ?? load()
      return data.contexts.find(context =>
        context.type === "context" && (safeAgent ? context.agent === safeAgent : true)
      ) ?? null
    },

    listContexts({ limit = 10 } = {}) {
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10
      const data = update(currentData => null) ?? load()
      return data.contexts.slice(0, safeLimit)
    }
  }
}

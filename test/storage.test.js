import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import { createSharedMemoryStore } from "../src/storage.js"

test("store saves and lists generic contexts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })

    const saved = store.saveContext({
      agent: "agent-a",
      title: "Planning notes",
      content: "Use this state later.",
      tags: ["planning"]
    })

    assert.match(saved.id, /^[0-9a-f-]{36}$/)
    assert.equal(store.listContexts({ limit: 1 })[0].title, "Planning notes")
    assert.equal(store.getLastContext({ agent: "agent-a" }).content, "Use this state later.")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store sanitizes saved context input before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })

    const saved = store.saveContext({
      agent: "  agent-a\u0000  ",
      title: "  Planning\u0007 notes  ",
      content: "  Keep this context.\u0008  ",
      tags: [" planning ", "", "planning", "handoff\u0000"]
    })

    assert.equal(saved.agent, "agent-a")
    assert.equal(saved.title, "Planning notes")
    assert.equal(saved.content, "Keep this context.")
    assert.deepEqual(saved.tags, ["planning", "handoff"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store rejects empty required input after sanitization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })

    assert.throws(() => {
      store.saveContext({
        agent: " \u0000 ",
        title: "Planning notes",
        content: "Keep this context."
      })
    }, /agent is required/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("handoff is read once and marked as read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })

    store.createHandoff({
      to: "agent-b",
      summary: "Finished discovery.",
      context: "Continue implementation."
    })

    const firstRead = store.readHandoff({ agent: "agent-b" })
    const secondRead = store.readHandoff({ agent: "agent-b" })

    assert.match(firstRead.content, /Finished discovery/)
    assert.equal(secondRead, null)
    const raw = JSON.parse(await readFile(join(dir, "contexts.json"), "utf8"))
    assert.equal(raw.contexts[0].read, true)
    assert.match(raw.contexts[0].readAt, /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("read handoffs can be deleted immediately after read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({
      storageFile: join(dir, "contexts.json"),
      deleteReadHandoffs: true
    })

    store.createHandoff({ to: "agent-b", summary: "One shot", context: "Delete after read." })
    const read = store.readHandoff({ agent: "agent-b" })
    const items = store.listContexts({ limit: 10 })

    assert.match(read.content, /One shot/)
    assert.equal(items.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("read handoffs older than TTL are cleaned automatically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    const oldReadAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    await writeJson(storageFile, {
      contexts: [{
        id: "old-read-handoff",
        agent: "handoff",
        to: "agent-b",
        title: "Old handoff",
        content: "Old content",
        tags: ["handoff"],
        timestamp: oldReadAt,
        type: "handoff",
        read: true,
        readAt: oldReadAt
      }]
    })

    const store = createSharedMemoryStore({ storageFile, readHandoffTtlDays: 1 })
    assert.equal(store.listContexts({ limit: 10 }).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("retention keeps pending handoffs before ordinary contexts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json"), maxItems: 3 })
    store.createHandoff({ to: "agent-b", summary: "Old pending handoff", context: "Keep me." })

    for (let i = 0; i < 5; i += 1) {
      store.saveContext({ agent: "agent-a", title: `Context ${i}`, content: `Content ${i}` })
    }

    const items = store.listContexts({ limit: 10 })

    assert.equal(items.length, 3)
    assert.equal(items.some(item => item.type === "handoff" && item.read === false), true)
    assert.equal(items.some(item => item.content.includes("Old pending handoff")), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store filters contexts by namespace and treats legacy entries as default namespace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    await writeJson(storageFile, {
      contexts: [{
        id: "legacy-context",
        agent: "agent-a",
        title: "Legacy note",
        content: "Visible in default namespace.",
        tags: [],
        timestamp: new Date().toISOString(),
        type: "context"
      }]
    })

    const store = createSharedMemoryStore({ storageFile })
    store.saveContext({
      namespace: "project-alpha",
      agent: "agent-a",
      title: "Alpha note",
      content: "Only visible in alpha."
    })
    store.saveContext({
      namespace: "project-beta",
      agent: "agent-a",
      title: "Beta note",
      content: "Only visible in beta."
    })

    assert.deepEqual(
      store.listContexts({ namespace: "project-alpha", limit: 10 }).map(item => item.title),
      ["Alpha note"]
    )
    assert.deepEqual(
      store.listContexts({ namespace: "default", limit: 10 }).map(item => item.title),
      ["Legacy note"]
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store searches memory by query, tags, agent, type, and namespace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })
    store.saveContext({
      namespace: "project-alpha",
      agent: "planner",
      title: "Database decision",
      content: "Use local JSON storage for now.",
      tags: ["architecture", "storage"]
    })
    store.saveContext({
      namespace: "project-beta",
      agent: "planner",
      title: "Search decision",
      content: "Use SQLite full text search later.",
      tags: ["architecture"]
    })

    const results = store.searchMemory({
      namespace: "project-alpha",
      query: "json",
      agent: "planner",
      tags: ["storage"],
      type: "context",
      limit: 10
    })

    assert.equal(results.length, 1)
    assert.equal(results[0].title, "Database decision")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store supports handoff peek, ack, reopen, and status filtering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })
    const handoff = store.createHandoff({
      namespace: "project-alpha",
      to: "implementer",
      summary: "Discovery complete.",
      context: "Build the searchable storage API."
    })

    const peeked = store.peekHandoff({ namespace: "project-alpha", agent: "implementer" })
    assert.equal(peeked.id, handoff.id)
    assert.equal(store.listHandoffs({ namespace: "project-alpha", agent: "implementer", status: "pending" }).length, 1)

    const acked = store.ackHandoff({ namespace: "project-alpha", id: handoff.id })
    assert.equal(acked.read, true)
    assert.equal(store.listHandoffs({ namespace: "project-alpha", agent: "implementer", status: "read" }).length, 1)

    const reopened = store.reopenHandoff({ namespace: "project-alpha", id: handoff.id })
    assert.equal(reopened.read, false)
    assert.equal(reopened.readAt, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2))
}

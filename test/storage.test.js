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
    store.saveContext({ agent: "agent-a", title: "Fresh context", content: "Fresh content" })

    const items = store.listContexts({ limit: 10 })
    assert.equal(items.length, 1)
    assert.equal(items[0].title, "Fresh context")
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

test("store saves structured memory and filters by kind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })
    const note = store.saveContext({
      namespace: "project-alpha",
      agent: "planner",
      title: "Plain note",
      content: "This remains compatible."
    })
    const decision = store.saveMemory({
      namespace: "project-alpha",
      agent: "planner",
      kind: "decision",
      title: "Storage choice",
      content: "Keep local JSON storage for v1.",
      status: "accepted",
      relatedFiles: ["src/storage.js"],
      branch: "feat/phase-2-structured-memory",
      commit: "abc123",
      nextAction: "Document the decision.",
      tags: ["architecture"]
    })

    const decisions = store.searchMemory({ namespace: "project-alpha", kind: "decision", limit: 10 })

    assert.equal(note.kind, "note")
    assert.equal(decision.kind, "decision")
    assert.equal(decision.status, "accepted")
    assert.deepEqual(decision.relatedFiles, ["src/storage.js"])
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].title, "Storage choice")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store creates snapshots and returns the latest snapshot as project brief", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })
    store.saveMemory({
      namespace: "project-alpha",
      agent: "planner",
      kind: "decision",
      title: "Search API",
      content: "Add text and metadata filters."
    })
    const snapshot = store.createSnapshot({
      namespace: "project-alpha",
      agent: "planner",
      title: "Project Alpha Brief",
      content: "Latest state: search API is ready for implementation."
    })

    const brief = store.getProjectBrief({ namespace: "project-alpha" })

    assert.equal(snapshot.kind, "snapshot")
    assert.equal(brief.id, snapshot.id)
    assert.match(brief.content, /search API is ready/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store builds a project brief from recent memory when no snapshot exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json") })
    store.saveMemory({
      namespace: "project-alpha",
      agent: "planner",
      kind: "decision",
      title: "Use JSON",
      content: "Keep storage local."
    })
    store.saveMemory({
      namespace: "project-alpha",
      agent: "reviewer",
      kind: "risk",
      title: "Retention risk",
      content: "Pending handoffs must survive pruning."
    })

    const brief = store.getProjectBrief({ namespace: "project-alpha" })

    assert.equal(brief.kind, "snapshot")
    assert.match(brief.content, /Retention risk/)
    assert.match(brief.content, /Use JSON/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("retention keeps pending handoffs before snapshots and structured notes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({ storageFile: join(dir, "contexts.json"), maxItems: 2 })
    const handoff = store.createHandoff({
      namespace: "project-alpha",
      to: "implementer",
      summary: "Pending work",
      context: "Keep this handoff."
    })
    store.createSnapshot({
      namespace: "project-alpha",
      agent: "planner",
      title: "Snapshot",
      content: "Snapshot content."
    })
    store.saveMemory({
      namespace: "project-alpha",
      agent: "planner",
      kind: "note",
      title: "Recent note",
      content: "Recent note content."
    })

    const items = store.listContexts({ namespace: "project-alpha", limit: 10 })

    assert.equal(items.length, 2)
    assert.equal(items.some(item => item.id === handoff.id && item.read === false), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store redacts common secrets when configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({
      storageFile: join(dir, "contexts.json"),
      redactSecrets: true
    })

    const saved = store.saveContext({
      agent: "agent-a",
      title: "Secret note",
      content: "Token is gho_abcdefghijklmnopqrstuvwxyz123456 and api_key=super-secret-value."
    })

    assert.doesNotMatch(saved.content, /gho_abcdefghijklmnopqrstuvwxyz123456/)
    assert.doesNotMatch(saved.content, /super-secret-value/)
    assert.match(saved.content, /\[REDACTED/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store redacts persisted title, content, tags, and handoff fields when configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({
      storageFile: join(dir, "contexts.json"),
      redactSecrets: true
    })

    const saved = store.saveContext({
      agent: "agent-a token=agent-secret",
      title: "api_key=title-secret",
      content: "token=content-secret",
      tags: ["secret=tag-secret"]
    })
    const handoff = store.createHandoff({
      to: "agent-b token=to-secret",
      summary: "api_key=summary-secret",
      context: "token=context-secret"
    })
    const memory = store.saveMemory({
      agent: "agent-c token=memory-agent-secret",
      kind: "task",
      title: "Task",
      content: "Done",
      status: "secret=status-secret",
      relatedFiles: ["token=file-secret"],
      branch: "secret=branch-secret",
      commit: "token=commit-secret",
      nextAction: "api_key=next-secret"
    })

    assert.doesNotMatch(saved.agent, /agent-secret/)
    assert.doesNotMatch(saved.title, /title-secret/)
    assert.doesNotMatch(saved.content, /content-secret/)
    assert.doesNotMatch(saved.tags.join(" "), /tag-secret/)
    assert.doesNotMatch(handoff.to, /to-secret/)
    assert.doesNotMatch(handoff.title, /to-secret/)
    assert.doesNotMatch(handoff.content, /summary-secret|context-secret/)
    assert.doesNotMatch(JSON.stringify(memory), /memory-agent-secret|status-secret|file-secret|branch-secret|commit-secret|next-secret/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store redacts imported memory when configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const store = createSharedMemoryStore({
      storageFile: join(dir, "contexts.json"),
      redactSecrets: true
    })

    store.importData({
      contexts: [{
        id: "imported-secret",
        agent: "importer",
        namespace: "default",
        kind: "note",
        title: "api_key=title-secret",
        content: "token=content-secret",
        tags: ["secret=tag-secret"],
        timestamp: new Date().toISOString(),
        type: "context"
      }]
    })

    const imported = store.listContexts({ limit: 1 })[0]

    assert.doesNotMatch(imported.title, /title-secret/)
    assert.doesNotMatch(imported.content, /content-secret/)
    assert.doesNotMatch(imported.tags.join(" "), /tag-secret/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store rejects invalid imported entries before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    const store = createSharedMemoryStore({ storageFile })

    assert.throws(() => {
      store.importData({ contexts: [{ id: "bad" }] })
    }, /must be a string/)
    assert.throws(() => {
      store.importData({ contexts: [null] })
    }, /imported context must be an object/)
    assert.throws(() => {
      store.importData({
        contexts: [{
          id: "bad-namespace",
          agent: "agent-a",
          namespace: false,
          kind: "note",
          title: "Bad namespace",
          content: "Bad content",
          tags: [],
          timestamp: new Date().toISOString(),
          type: "context"
        }]
      })
    }, /namespace must be a string/)
    assert.throws(() => {
      store.importData({
        contexts: [{
          id: "bad-status",
          agent: "agent-a",
          kind: "note",
          title: "Bad status",
          content: "Bad content",
          status: false,
          tags: [],
          timestamp: new Date().toISOString(),
          type: "context"
        }]
      })
    }, /status must be a string/)

    assert.equal(store.listContexts({ limit: 10 }).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store export does not apply retention or mutate storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    await writeJson(storageFile, {
      contexts: [
        {
          id: "older",
          agent: "agent-a",
          namespace: "default",
          kind: "note",
          title: "Older",
          content: "Older content",
          tags: [],
          timestamp: new Date().toISOString(),
          type: "context"
        },
        {
          id: "newer",
          agent: "agent-a",
          namespace: "default",
          kind: "note",
          title: "Newer",
          content: "Newer content",
          tags: [],
          timestamp: new Date().toISOString(),
          type: "context"
        }
      ]
    })
    const store = createSharedMemoryStore({ storageFile, maxItems: 1 })

    const exported = store.exportData()
    const raw = JSON.parse(await readFile(storageFile, "utf8"))

    assert.equal(exported.contexts.length, 2)
    assert.equal(raw.contexts.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("store read operations do not apply retention or mutate storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    await writeJson(storageFile, {
      contexts: [
        {
          id: "older",
          agent: "agent-a",
          namespace: "default",
          kind: "note",
          title: "Older",
          content: "Older content",
          tags: [],
          timestamp: new Date().toISOString(),
          type: "context"
        },
        {
          id: "newer",
          agent: "agent-a",
          namespace: "default",
          kind: "note",
          title: "Newer",
          content: "Newer content",
          tags: [],
          timestamp: new Date().toISOString(),
          type: "context"
        }
      ]
    })
    const store = createSharedMemoryStore({ storageFile, maxItems: 1 })

    assert.equal(store.listContexts({ limit: 10 }).length, 2)
    assert.equal(store.searchMemory({ query: "content", limit: 10 }).length, 2)
    assert.match(store.getProjectBrief().content, /Older content/)
    assert.equal(store.getLastContext().title, "Older")

    const raw = JSON.parse(await readFile(storageFile, "utf8"))
    assert.equal(raw.contexts.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2))
}

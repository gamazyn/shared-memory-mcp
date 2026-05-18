import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import test from "node:test"

function runCli(args, env) {
  return spawnSync(process.execPath, ["./bin/shared-memory-mcp.js", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8"
  })
}

test("cli lists, searches, and exports memory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    const exportFile = join(dir, "export.json")
    const env = { SHARED_MEMORY_MCP_STORAGE_FILE: storageFile }

    assert.equal(runCli(["save", "--agent", "tester", "--title", "CLI note", "--content", "searchable content"], env).status, 0)

    const list = runCli(["list"], env)
    const search = runCli(["search", "searchable"], env)
    const exported = runCli(["export", exportFile], env)

    assert.equal(list.status, 0)
    assert.match(list.stdout, /CLI note/)
    assert.equal(search.status, 0)
    assert.match(search.stdout, /CLI note/)
    assert.equal(exported.status, 0)
    assert.equal(existsSync(exportFile), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("cli imports memory, prunes items, creates backups, and reports doctor status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shared-memory-mcp-"))
  try {
    const storageFile = join(dir, "contexts.json")
    const backupDir = join(dir, "backups")
    const importFile = join(dir, "import.json")
    const env = {
      SHARED_MEMORY_MCP_STORAGE_FILE: storageFile,
      SHARED_MEMORY_MCP_BACKUP_DIR: backupDir
    }
    await writeFile(importFile, JSON.stringify({
      contexts: [{
        id: "imported-context",
        agent: "importer",
        namespace: "default",
        kind: "note",
        title: "Imported note",
        content: "Imported content",
        tags: [],
        timestamp: new Date().toISOString(),
        type: "context"
      }]
    }))

    const imported = runCli(["import", importFile], env)
    const pruned = runCli(["prune", "--keep", "0"], env)
    const doctor = runCli(["doctor"], env)

    assert.equal(imported.status, 0)
    assert.match(imported.stdout, /Imported 1 item/)
    assert.equal(pruned.status, 0)
    assert.match(pruned.stdout, /Pruned/)
    assert.equal(existsSync(backupDir), true)
    assert.equal(doctor.status, 0)
    assert.match(doctor.stdout, /Storage file/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

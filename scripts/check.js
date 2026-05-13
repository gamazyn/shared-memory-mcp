#!/usr/bin/env node
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const ignoredDirectories = new Set(["node_modules", ".git"])

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...await listJavaScriptFiles(join(directory, entry.name)))
      }
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(join(directory, entry.name))
    }
  }

  return files
}

const files = await listJavaScriptFiles(process.cwd())

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status)
}

console.log(`Checked ${files.length} JavaScript files.`)

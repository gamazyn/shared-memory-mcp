import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, extname } from "node:path"

import { getRuntimeConfig } from "./config.js"
import { createSharedMemoryStore } from "./storage.js"

function parseOptions(args) {
  const options = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith("--")) {
      options._.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = args[index + 1]
    if (!next || next.startsWith("--")) {
      options[key] = true
      continue
    }
    options[key] = next
    index += 1
  }
  return options
}

function formatEntry(entry, index) {
  const namespace = entry.namespace ? ` (${entry.namespace})` : ""
  const kind = entry.kind ? `/${entry.kind}` : ""
  const destination = entry.to ? ` -> ${entry.to}` : ""
  const pending = entry.read === false ? " [PENDING]" : ""
  return `${index + 1}. [${entry.type}${kind}${destination}${pending}]${namespace} ${entry.title} - ${entry.agent}`
}

function writeOutput(text) {
  process.stdout.write(`${text}\n`)
}

function writeExport(filePath, data) {
  if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true })
  if (extname(filePath).toLowerCase() === ".md") {
    const lines = ["# shared-memory-mcp export", ""]
    for (const [index, entry] of data.contexts.entries()) {
      lines.push(`## ${formatEntry(entry, index)}`, "", entry.content, "")
    }
    writeFileSync(filePath, lines.join("\n"))
    return
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const command = argv[0]
  const parsed = parseOptions(argv.slice(1))
  const config = options.config ?? getRuntimeConfig()
  const store = options.store ?? createSharedMemoryStore(config)

  if (command === "save") {
    const entry = store.saveContext({
      namespace: parsed.namespace,
      agent: parsed.agent,
      title: parsed.title,
      content: parsed.content,
      tags: parsed.tags ? String(parsed.tags).split(",") : []
    })
    writeOutput(`Saved ${entry.id}`)
    return
  }

  if (command === "list") {
    const items = store.listContexts({ namespace: parsed.namespace, limit: Number(parsed.limit ?? 10) })
    writeOutput(items.length ? items.map(formatEntry).join("\n") : "No saved context yet.")
    return
  }

  if (command === "search") {
    const query = parsed._[0] ?? parsed.query
    const items = store.searchMemory({ namespace: parsed.namespace, query, limit: Number(parsed.limit ?? 10) })
    writeOutput(items.length ? items.map(formatEntry).join("\n") : "No matching memory found.")
    return
  }

  if (command === "handoffs") {
    const items = store.listHandoffs({
      namespace: parsed.namespace,
      agent: parsed.agent,
      status: parsed.status ?? "all",
      limit: Number(parsed.limit ?? 10)
    })
    writeOutput(items.length ? items.map(formatEntry).join("\n") : "No handoffs found.")
    return
  }

  if (command === "export") {
    const filePath = parsed._[0]
    if (!filePath) throw new Error("export requires an output file")
    writeExport(filePath, store.exportData())
    writeOutput(`Exported memory to ${filePath}`)
    return
  }

  if (command === "import") {
    const filePath = parsed._[0]
    if (!filePath) throw new Error("import requires an input file")
    const result = store.importData(JSON.parse(readFileSync(filePath, "utf8")))
    writeOutput(`Imported ${result.imported} item${result.imported === 1 ? "" : "s"}.`)
    return
  }

  if (command === "prune") {
    const result = store.prune({ keep: Number(parsed.keep ?? 0) })
    writeOutput(`Pruned ${result.pruned} item${result.pruned === 1 ? "" : "s"}.`)
    return
  }

  if (command === "doctor") {
    const lines = [
      `Storage file: ${config.storageFile}`,
      `Storage exists: ${existsSync(config.storageFile) ? "yes" : "no"}`,
      `Backup dir: ${config.backupDir}`,
      `Default namespace: ${config.defaultNamespace}`,
      "MCP server: ok"
    ]
    writeOutput(lines.join("\n"))
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

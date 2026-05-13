import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export const DEFAULT_STORAGE_FILE = join(homedir(), ".shared-memory-mcp", "contexts.json")
export const DEFAULT_MAX_ITEMS = 50
export const DEFAULT_READ_HANDOFF_TTL_DAYS = 7
export const DEFAULT_DELETE_READ_HANDOFFS = false

export const ENV_DEFAULTS = {
  SHARED_MEMORY_MCP_STORAGE_FILE: DEFAULT_STORAGE_FILE,
  SHARED_MEMORY_MCP_MAX_ITEMS: String(DEFAULT_MAX_ITEMS),
  SHARED_MEMORY_MCP_READ_HANDOFF_TTL_DAYS: String(DEFAULT_READ_HANDOFF_TTL_DAYS),
  SHARED_MEMORY_MCP_DELETE_READ_HANDOFFS: String(DEFAULT_DELETE_READ_HANDOFFS)
}

function parseEnvFile(content) {
  const values = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function loadEnvFile(envFile) {
  if (!envFile || !existsSync(envFile)) return {}
  return parseEnvFile(readFileSync(envFile, "utf8"))
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase())
}

export function getRuntimeConfig(options = {}) {
  const env = options.env ?? process.env
  const envFile = options.envFile ?? env.SHARED_MEMORY_MCP_ENV_FILE ?? join(process.cwd(), ".env")
  const fileEnv = loadEnvFile(envFile)
  const merged = { ...fileEnv, ...env }

  return {
    storageFile: merged.SHARED_MEMORY_MCP_STORAGE_FILE || DEFAULT_STORAGE_FILE,
    maxItems: parsePositiveInteger(merged.SHARED_MEMORY_MCP_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    readHandoffTtlDays: parsePositiveInteger(
      merged.SHARED_MEMORY_MCP_READ_HANDOFF_TTL_DAYS,
      DEFAULT_READ_HANDOFF_TTL_DAYS
    ),
    deleteReadHandoffs: parseBoolean(merged.SHARED_MEMORY_MCP_DELETE_READ_HANDOFFS, DEFAULT_DELETE_READ_HANDOFFS)
  }
}

export async function createEnvFile(options = {}) {
  const envPath = options.envPath ?? join(process.cwd(), ".env")
  let existing = {}

  try {
    existing = parseEnvFile(await readFile(envPath, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }

  const merged = { ...ENV_DEFAULTS, ...existing }
  const content = [
    "# shared-memory-mcp configuration",
    ...Object.entries(merged).map(([key, value]) => `${key}=${value}`),
    ""
  ].join("\n")

  await mkdir(dirname(envPath), { recursive: true })
  await writeFile(envPath, content)
  return { envPath, values: merged }
}

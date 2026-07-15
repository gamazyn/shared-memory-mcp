import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { getLocalServerCommand } from "../package-paths.js"

export const DEFAULT_CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json")

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return {}
    throw error
  }
}

export async function configureClaude(options = {}) {
  const settingsPath = options.settingsPath ?? DEFAULT_CLAUDE_SETTINGS_PATH
  const localCommand = getLocalServerCommand()
  const command = options.command ?? localCommand.command
  const args = options.args ?? localCommand.args
  const serverName = options.serverName ?? "shared-memory"
  const permission = `mcp__${serverName}__*`

  const settings = await readJsonIfExists(settingsPath)
  settings.permissions ??= {}
  settings.permissions.allow ??= []
  if (!settings.permissions.allow.includes(permission)) settings.permissions.allow.push(permission)

  settings.mcpServers ??= {}
  // Merge over any existing entry so custom fields (type, env, ...) survive re-runs.
  settings.mcpServers[serverName] = { ...settings.mcpServers[serverName], command, args }

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)

  return { settingsPath, serverName, command, args }
}

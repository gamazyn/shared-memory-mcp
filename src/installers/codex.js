import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { getLocalServerCommand } from "../package-paths.js"

export const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml")

function quoteTomlString(value) {
  return JSON.stringify(value)
}

function formatTomlArray(values) {
  return `[${values.map(quoteTomlString).join(", ")}]`
}

function buildServerSection({ serverName, command, args }) {
  return [
    `[mcp_servers.${serverName}]`,
    `command = ${quoteTomlString(command)}`,
    `args = ${formatTomlArray(args)}`,
    ""
  ].join("\n")
}

function upsertTomlSection(config, sectionHeader, sectionBody) {
  const lines = config.split("\n")
  const start = lines.findIndex(line => line.trim() === sectionHeader)
  if (start === -1) {
    const prefix = config.trimEnd()
    return `${prefix}${prefix ? "\n\n" : ""}${sectionBody}`
  }

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
      end = index
      break
    }
  }

  const replacement = sectionBody.trimEnd().split("\n")
  lines.splice(start, end - start, ...replacement)
  return `${lines.join("\n").trimEnd()}\n`
}

export async function configureCodex(options = {}) {
  const configPath = options.configPath ?? DEFAULT_CODEX_CONFIG_PATH
  const localCommand = getLocalServerCommand()
  const command = options.command ?? localCommand.command
  const args = options.args ?? localCommand.args
  const serverName = options.serverName ?? "shared-memory"
  const sectionHeader = `[mcp_servers.${serverName}]`
  const sectionBody = buildServerSection({ serverName, command, args })

  let config = ""
  try {
    config = await readFile(configPath, "utf8")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }

  const updated = upsertTomlSection(config, sectionHeader, sectionBody)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, updated)

  return { configPath, serverName, command, args }
}

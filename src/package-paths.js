import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const srcDir = dirname(fileURLToPath(import.meta.url))
export const packageRoot = resolve(srcDir, "..")
export const binPath = resolve(packageRoot, "bin", "shared-memory-mcp.js")

export function getLocalServerCommand() {
  // Use a version-agnostic "node" resolved from PATH instead of process.execPath.
  // On Homebrew/nvm/fnm, process.execPath is a version-pinned path (e.g.
  // .../node/26.0.0/bin/node) that breaks the moment node is upgraded and the old
  // directory is removed. MCP clients inherit the user's PATH, so "node" stays valid.
  return {
    command: "node",
    args: [binPath]
  }
}

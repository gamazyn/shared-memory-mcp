import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const srcDir = dirname(fileURLToPath(import.meta.url))
export const packageRoot = resolve(srcDir, "..")
export const binPath = resolve(packageRoot, "bin", "shared-memory-mcp.js")

export function getLocalServerCommand() {
  return {
    command: process.execPath,
    args: [binPath]
  }
}

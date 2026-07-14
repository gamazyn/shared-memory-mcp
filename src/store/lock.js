import { existsSync, mkdirSync, rmSync, statSync } from "node:fs"

const LOCK_RETRY_MS = 20
const LOCK_TIMEOUT_MS = 5000
const LOCK_STALE_MS = 30000

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function withDirectoryLock({ storageDir, lockDir }, fn) {
  if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })
  const start = Date.now()

  while (true) {
    try {
      mkdirSync(lockDir)
      break
    } catch (error) {
      try {
        const lockAge = Date.now() - statSync(lockDir).mtimeMs
        if (lockAge > LOCK_STALE_MS) rmSync(lockDir, { recursive: true, force: true })
      } catch {
        // The lock may have been removed between mkdir failure and stat.
      }

      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for shared memory storage lock: ${error.message}`)
      }
      sleep(LOCK_RETRY_MS)
    }
  }

  try {
    return fn()
  } finally {
    rmSync(lockDir, { recursive: true, force: true })
  }
}

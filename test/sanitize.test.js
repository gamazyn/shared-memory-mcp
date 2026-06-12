import assert from "node:assert/strict"
import test from "node:test"

import {
  INPUT_LIMITS,
  MEMORY_KINDS,
  sanitizeContextInput,
  sanitizeHandoffInput,
  sanitizeKind,
  sanitizeOptionalNamespace,
  sanitizeRelatedFiles,
  sanitizeStructuredMemoryInput,
  sanitizeTags,
  sanitizeText
} from "../src/sanitize.js"
import { redactSecrets, redactTags, sanitizeTimestamp } from "../src/sanitize.js"

test("sanitizeText strips control chars and trims", () => {
  assert.equal(sanitizeText("  hello  ", "field", 100), "hello")
})

test("sanitizeText rejects non-string", () => {
  assert.throws(() => sanitizeText(42, "field", 100), /field must be a string/)
})

test("sanitizeText rejects empty after sanitization", () => {
  assert.throws(() => sanitizeText("   ", "field", 100), /field is required/)
})

test("sanitizeText rejects values over maxLength", () => {
  assert.throws(() => sanitizeText("x".repeat(11), "field", 10), /field exceeds 10 characters/)
})

test("sanitizeTags dedupes, drops empty, trims and caps at INPUT_LIMITS.tags", () => {
  const many = Array.from({ length: INPUT_LIMITS.tags + 5 }, (_, i) => `tag${i}`)
  assert.deepEqual(sanitizeTags([" a ", "", "a", "b "]), ["a", "b"])
  assert.equal(sanitizeTags(many).length, INPUT_LIMITS.tags)
})

test("sanitizeTags rejects non-array and oversized tags", () => {
  assert.throws(() => sanitizeTags("nope"), /tags must be an array/)
  assert.throws(() => sanitizeTags(["x".repeat(INPUT_LIMITS.tag + 1)]), /tag exceeds/)
})

test("sanitizeOptionalNamespace defaults empty inputs to 'default'", () => {
  for (const value of [undefined, null, ""]) {
    assert.equal(sanitizeOptionalNamespace(value), "default")
  }
  assert.equal(sanitizeOptionalNamespace(" proj "), "proj")
})

test("sanitizeKind accepts known kinds and rejects unknown", () => {
  for (const kind of MEMORY_KINDS) assert.equal(sanitizeKind(kind), kind)
  assert.throws(() => sanitizeKind("bogus"), /kind must be one of/)
})

test("sanitizeRelatedFiles validates array of strings", () => {
  assert.deepEqual(sanitizeRelatedFiles([" a.js ", "b.js"]), ["a.js", "b.js"])
  assert.throws(() => sanitizeRelatedFiles("nope"), /relatedFiles must be an array/)
})

test("sanitizeContextInput forces kind note and sanitizes all fields", () => {
  const out = sanitizeContextInput({
    agent: " a ", namespace: "", title: " t ", content: " c ", tags: [" x ", "x"]
  })
  assert.deepEqual(out, { agent: "a", namespace: "default", kind: "note", title: "t", content: "c", tags: ["x"] })
})

test("sanitizeHandoffInput forces kind handoff", () => {
  const out = sanitizeHandoffInput({ namespace: "p", to: " codex ", summary: " s ", context: " ctx " })
  assert.equal(out.kind, "handoff")
  assert.equal(out.to, "codex")
})

test("sanitizeStructuredMemoryInput includes optional fields only when present", () => {
  const minimal = sanitizeStructuredMemoryInput({ agent: "a", title: "t", content: "c" })
  assert.equal(minimal.status, undefined)
  assert.equal(minimal.kind, "note")
  const full = sanitizeStructuredMemoryInput({
    agent: "a", title: "t", content: "c", kind: "decision",
    status: "open", branch: "main", commit: "abc", nextAction: "ship"
  })
  assert.equal(full.kind, "decision")
  assert.equal(full.status, "open")
  assert.equal(full.nextAction, "ship")
})

test("redactSecrets masks known token shapes and key=value pairs", () => {
  assert.match(redactSecrets("ghp_" + "a".repeat(30)), /\[REDACTED_TOKEN\]/)
  assert.match(redactSecrets("sk-" + "b".repeat(30)), /\[REDACTED_TOKEN\]/)
  assert.match(redactSecrets("api_key=supersecret"), /api_key=\[REDACTED_SECRET\]/)
  assert.equal(redactSecrets("nothing to hide"), "nothing to hide")
})

test("redactTags applies redaction to each tag", () => {
  assert.deepEqual(redactTags(["token=abc123def", "safe"]), ["token=[REDACTED_SECRET]", "safe"])
})

test("sanitizeTimestamp accepts valid dates and rejects garbage", () => {
  const iso = "2026-06-12T10:00:00.000Z"
  assert.equal(sanitizeTimestamp(iso), iso)
  assert.throws(() => sanitizeTimestamp("not-a-date"), /timestamp must be a valid date/)
})

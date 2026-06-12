import { z } from "zod"

import { INPUT_LIMITS, MEMORY_KINDS } from "./sanitize.js"

const KIND_VALUES = Array.from(MEMORY_KINDS)

const requiredText = (limitKey, description) =>
  z.string().min(1).max(INPUT_LIMITS[limitKey]).describe(description)

const optionalText = (limitKey, description) =>
  z.string().min(1).max(INPUT_LIMITS[limitKey]).optional().describe(description)

const namespaceField = z.string().max(INPUT_LIMITS.namespace).optional()
  .describe("Optional project or workspace namespace, default: default")

const tagsField = z.array(z.string().max(INPUT_LIMITS.tag)).max(INPUT_LIMITS.tags).optional()
  .describe("Optional categorization tags; all tags must match")

export const KIND_ENUM = z.enum(KIND_VALUES)

export const schemas = {
  saveContext: {
    agent: requiredText("agent", "Agent saving the context, for example: claude-code, codex, assistant-a"),
    namespace: namespaceField,
    title: requiredText("title", "Short descriptive title"),
    content: requiredText("content", "Full context content"),
    tags: tagsField
  },
  saveMemory: {
    agent: requiredText("agent", "Agent saving the memory"),
    namespace: namespaceField,
    kind: KIND_ENUM.describe("Structured memory kind"),
    title: requiredText("title", "Short descriptive title"),
    content: requiredText("content", "Full memory content"),
    status: optionalText("status", "Optional status, for example: open, accepted, done"),
    relatedFiles: z.array(z.string().max(INPUT_LIMITS.file)).optional().describe("Optional related file paths"),
    branch: optionalText("file", "Optional related branch name"),
    commit: optionalText("file", "Optional related commit SHA"),
    nextAction: optionalText("title", "Optional next action"),
    tags: tagsField
  },
  createHandoff: {
    namespace: namespaceField,
    to: requiredText("agent", "Destination agent, for example: claude-code, codex, assistant-b"),
    summary: requiredText("title", "Summary of what happened and what should continue"),
    context: requiredText("content", "Full context needed to continue the work")
  },
  readHandoff: {
    namespace: namespaceField,
    agent: requiredText("agent", "Current agent name, for example: claude-code, codex, assistant-b")
  },
  readLatestContext: {
    namespace: namespaceField,
    agent: z.string().max(INPUT_LIMITS.agent).optional().describe("Optional agent filter")
  },
  listContexts: {
    namespace: namespaceField,
    agent: z.string().max(INPUT_LIMITS.agent).optional().describe("Optional agent filter"),
    tags: tagsField,
    type: z.enum(["context", "handoff"]).optional().describe("Optional item type filter"),
    kind: KIND_ENUM.optional().describe("Optional structured memory kind filter"),
    limit: z.number().optional().describe("Maximum number of items to list, default: 10")
  },
  searchMemory: {
    namespace: namespaceField,
    query: optionalText("content", "Optional case-insensitive text query"),
    agent: z.string().max(INPUT_LIMITS.agent).optional().describe("Optional source agent filter"),
    tags: tagsField,
    type: z.enum(["context", "handoff"]).optional().describe("Optional item type filter"),
    kind: KIND_ENUM.optional().describe("Optional structured memory kind filter"),
    handoffStatus: z.enum(["all", "pending", "read"]).optional().describe("Optional status filter for handoffs"),
    limit: z.number().optional().describe("Maximum number of items to return, default: 10")
  },
  createSnapshot: {
    namespace: namespaceField,
    agent: requiredText("agent", "Agent creating the snapshot"),
    title: requiredText("title", "Snapshot title"),
    content: requiredText("content", "Snapshot summary content")
  },
  getProjectBrief: {
    namespace: namespaceField,
    limit: z.number().optional().describe("Maximum number of recent items to include when no snapshot exists")
  },
  listHandoffs: {
    namespace: namespaceField,
    agent: z.string().max(INPUT_LIMITS.agent).optional().describe("Optional destination agent filter"),
    status: z.enum(["all", "pending", "read"]).optional().describe("Optional handoff status filter"),
    limit: z.number().optional().describe("Maximum number of handoffs to list, default: 10")
  },
  peekHandoff: {
    namespace: namespaceField,
    agent: requiredText("agent", "Current agent name")
  },
  ackHandoff: {
    namespace: namespaceField,
    id: requiredText("content", "Handoff ID")
  },
  reopenHandoff: {
    namespace: namespaceField,
    id: requiredText("content", "Handoff ID")
  }
}

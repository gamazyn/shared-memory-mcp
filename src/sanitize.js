const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export const INPUT_LIMITS = {
  agent: 100,
  namespace: 100,
  title: 200,
  content: 200000,
  tag: 64,
  tags: 20
}

export function sanitizeText(value, field, maxLength) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`)

  const sanitized = value.replace(CONTROL_CHARS, "").trim()
  if (!sanitized) throw new Error(`${field} is required`)
  if (sanitized.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`)
  }

  return sanitized
}

export function sanitizeTags(tags = []) {
  if (!Array.isArray(tags)) throw new TypeError("tags must be an array")

  const seen = new Set()
  const sanitized = []

  for (const tag of tags) {
    if (typeof tag !== "string") throw new TypeError("tags must contain only strings")
    const cleaned = tag.replace(CONTROL_CHARS, "").trim()
    if (!cleaned || seen.has(cleaned)) continue
    if (cleaned.length > INPUT_LIMITS.tag) throw new Error(`tag exceeds ${INPUT_LIMITS.tag} characters`)

    seen.add(cleaned)
    sanitized.push(cleaned)
    if (sanitized.length >= INPUT_LIMITS.tags) break
  }

  return sanitized
}

export function sanitizeContextInput({ agent, namespace, title, content, tags = [] }) {
  return {
    agent: sanitizeText(agent, "agent", INPUT_LIMITS.agent),
    namespace: sanitizeOptionalNamespace(namespace),
    title: sanitizeText(title, "title", INPUT_LIMITS.title),
    content: sanitizeText(content, "content", INPUT_LIMITS.content),
    tags: sanitizeTags(tags)
  }
}

export function sanitizeHandoffInput({ namespace, to, summary, context }) {
  return {
    namespace: sanitizeOptionalNamespace(namespace),
    to: sanitizeText(to, "to", INPUT_LIMITS.agent),
    summary: sanitizeText(summary, "summary", INPUT_LIMITS.title),
    context: sanitizeText(context, "context", INPUT_LIMITS.content)
  }
}

export function sanitizeOptionalNamespace(namespace) {
  if (namespace === undefined || namespace === null || namespace === "") return "default"
  return sanitizeText(namespace, "namespace", INPUT_LIMITS.namespace)
}

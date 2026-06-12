export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString()
}

export function formatContextEntry(entry, index) {
  const destination = entry.to ? ` -> ${entry.to}` : ""
  const pending = entry.read === false ? " [PENDING]" : ""
  const namespace = entry.namespace ? ` (${entry.namespace})` : ""
  const kind = entry.kind ? `/${entry.kind}` : ""
  return `${index + 1}. [${entry.type}${kind}${destination}${pending}]${namespace} ${entry.title} - ${entry.agent} - ${formatTimestamp(entry.timestamp)}`
}

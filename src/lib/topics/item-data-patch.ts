export type JsonRecord = Record<string, unknown>

function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

/**
 * RFC 7396-style merge patch for topic itemData.
 *
 * - object values merge recursively
 * - null removes a key
 * - any other value replaces the old value
 */
export function applyTopicItemMergePatch(
  itemData: JsonRecord,
  patch: JsonRecord,
): JsonRecord {
  const next: JsonRecord = { ...itemData }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
    } else if (isPlainRecord(value) && isPlainRecord(next[key])) {
      next[key] = applyTopicItemMergePatch(next[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

export function summarizeTopicPatchKeys(patch: JsonRecord): string[] {
  return Object.keys(patch).sort((a, b) => a.localeCompare(b))
}

export function displayNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const raw =
    metadata?.display_name ?? metadata?.full_name ?? metadata?.name ?? null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 60) : null
}

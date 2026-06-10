/**
 * Client-safe error helpers.
 *
 * No 'server-only' — this is importable from Client Components. Use it in
 * `catch` blocks to read a human-readable message off an unknown thrown
 * value (Server Actions throw typed `AppError`s whose `.message` is safe to
 * surface), falling back to a generic string for non-Error throws.
 */
export function getErrorMessage(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error ? e.message : fallback
}

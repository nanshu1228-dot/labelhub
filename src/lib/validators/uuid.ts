import { z } from 'zod'

/**
 * Permissive UUID validator — accepts any 36-char hex-with-hyphens shape.
 *
 * Why we don't use Zod's built-in `.uuid()`:
 *
 *   Zod 3.23+ tightened `.uuid()` to require version digit 1-8 (per RFC 9562).
 *   Our demo / seed data uses "00000000-0000-0000-0000-000000000010"-style
 *   IDs where the version digit is `0` — these are valid PostgreSQL UUID
 *   column values but rejected by strict Zod. So every action gated by
 *   `.uuid()` would fail when called against seeded rows.
 *
 *   This validator only checks the wire-shape (8-4-4-4-12 hex segments),
 *   which is what we actually care about at the boundary. The DB still
 *   enforces canonical storage.
 *
 * Use this instead of `z.string().uuid()` in every Server Action / Route
 * Handler input schema.
 */
export const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message:
      'Invalid UUID shape (must be 8-4-4-4-12 hex characters separated by hyphens).',
  })

/**
 * Strict UUID for cases where we ONLY want auto-generated values (e.g.
 * tokens, invite codes). Keeps Zod's built-in semantics.
 */
export const uuidStrict = z.string().uuid()

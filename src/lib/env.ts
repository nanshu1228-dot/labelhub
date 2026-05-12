import { z } from 'zod'

/**
 * Centralized, type-safe environment variable access.
 *
 * All env reads go through `env()` (lazy) or `requireEnv(key)` (strict).
 * Direct `process.env.XXX` is discouraged — bypass review by routing here.
 *
 * Design notes:
 *   - LAZY: `env()` only parses on first read. Build never requires env values.
 *   - VALIDATED: Zod schema catches typos + format mistakes at first call.
 *   - PORTABLE: When swapping Auth/AI provider, ADD fields here + flip discriminator.
 *
 * Future provider swap: extend `AUTH_PROVIDER` enum, add provider-specific
 * optional fields, refine schema to require the right subset.
 */

const envSchema = z
  .object({
    // ── Core (Postgres — works with ANY provider) ─────────────────────
    DATABASE_URL: z.string().url().optional(),

    // ── Auth provider (currently Supabase only; extend enum to swap) ──
    AUTH_PROVIDER: z.enum(['supabase']).default('supabase'),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

    // ── AI provider (currently Anthropic only) ─────────────────────────
    AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),

    // ── Quotas / limits ───────────────────────────────────────────────
    AI_DAILY_LIMIT_PER_USER: z.coerce.number().int().positive().default(100),

    // ── Misc ──────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })

export type Env = z.infer<typeof envSchema>

let _cached: Env | null = null

/**
 * Lazy env access. Parses at first call; cached thereafter.
 * Returns the typed object — fields may be undefined if not set.
 *
 * Use `requireEnv(key)` instead when you NEED a value at call-site.
 */
export function env(): Env {
  if (_cached) return _cached
  _cached = envSchema.parse(process.env)
  return _cached
}

/**
 * Strict variant: throws a clear error if the key is missing.
 * Prefer this in code paths where the absence is a runtime config error.
 */
export function requireEnv<K extends keyof Env>(
  key: K,
): NonNullable<Env[K]> {
  const value = env()[key]
  if (value === undefined || value === null) {
    throw new Error(
      `Missing required environment variable: ${String(key)}. See .env.example.`,
    )
  }
  return value as NonNullable<Env[K]>
}

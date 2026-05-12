// Load .env.local first (Next.js convention), then .env as fallback. The
// vanilla `dotenv/config` import only reads `.env`, so a DATABASE_URL kept
// in `.env.local` would be invisible to drizzle-kit otherwise.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import type { Config } from 'drizzle-kit'

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
} satisfies Config

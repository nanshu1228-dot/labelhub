import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle> | null = null

/** Lazy singleton DB client. Server-only; throws if called from browser. */
export function getDb() {
  if (_db) return _db
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL not set. See .env.example.')
  }
  const sql = postgres(url, { prepare: false })
  _db = drizzle(sql, { schema })
  return _db
}

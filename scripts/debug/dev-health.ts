/**
 * dev_health — env + DB + dev server connectivity check.
 *
 * Reports green / yellow / red on each of:
 *   - DATABASE_URL set + reachable
 *   - ANTHROPIC_API_KEY present (Anthropic-backed features won't work without it)
 *   - DOUBAO_API_KEY present (proxy won't work without it)
 *   - NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY present
 *   - localhost:3000 reachable (dev server up?)
 *   - Demo workspace exists in DB
 *
 * Run: `tsx scripts/debug/dev-health.ts`
 */
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { cliRun, isMain } from './_shared/args'
import { withDb, ensureEnv, schema } from './_shared/db'
import { DEMO_WORKSPACE_ID } from './_shared/api-key'

export interface HealthCheck {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface HealthResult {
  ok: boolean
  checks: HealthCheck[]
}

function envCheck(name: string, required: boolean): HealthCheck {
  const v = process.env[name]
  if (v && v.length > 0) {
    return { name, status: 'ok', detail: 'set' }
  }
  return {
    name,
    status: required ? 'fail' : 'warn',
    detail: required ? 'missing (required)' : 'missing (optional)',
  }
}

async function pingDb(): Promise<HealthCheck> {
  if (!process.env.DATABASE_URL) {
    return { name: 'database.connect', status: 'fail', detail: 'DATABASE_URL not set' }
  }
  try {
    return await withDb(async ({ db }) => {
      const [row] = await db.execute<{ one: number }>(sql`select 1 as one`)
      const ok = row && (row.one === 1 || String(row.one) === '1')
      return {
        name: 'database.connect',
        status: ok ? 'ok' : 'warn',
        detail: ok ? 'select 1 succeeded' : 'unexpected response',
      } as HealthCheck
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'database.connect', status: 'fail', detail: msg.slice(0, 200) }
  }
}

async function demoWorkspaceCheck(): Promise<HealthCheck> {
  if (!process.env.DATABASE_URL) {
    return { name: 'demo.workspace', status: 'warn', detail: 'skipped (no DATABASE_URL)' }
  }
  try {
    return await withDb(async ({ db }) => {
      const [ws] = await db
        .select({ id: schema.workspaces.id, name: schema.workspaces.name })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, DEMO_WORKSPACE_ID))
        .limit(1)
      if (!ws) {
        return {
          name: 'demo.workspace',
          status: 'warn',
          detail: 'not seeded — run `npm run bootstrap` or `npm run seed`',
        } as HealthCheck
      }
      return { name: 'demo.workspace', status: 'ok', detail: ws.name } as HealthCheck
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'demo.workspace', status: 'fail', detail: msg.slice(0, 200) }
  }
}

async function devServerCheck(port = 3000): Promise<HealthCheck> {
  const url = `http://localhost:${port}/`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return {
      name: `dev.server.${port}`,
      status: 'ok',
      detail: `responded ${res.status}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      name: `dev.server.${port}`,
      status: 'warn',
      detail: `not reachable — start with \`npm run dev\` (${msg.slice(0, 80)})`,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runDevHealth(): Promise<HealthResult> {
  ensureEnv()
  const checks: HealthCheck[] = [
    envCheck('DATABASE_URL', true),
    envCheck('ANTHROPIC_API_KEY', false),
    envCheck('DOUBAO_API_KEY', false),
    envCheck('NEXT_PUBLIC_SUPABASE_URL', false),
    envCheck('NEXT_PUBLIC_SUPABASE_ANON_KEY', false),
    envCheck('SUPABASE_SERVICE_ROLE_KEY', false),
  ]

  // Run the network/DB checks in parallel — they're independent.
  const [dbResult, demoResult, devResult] = await Promise.all([
    pingDb(),
    demoWorkspaceCheck(),
    devServerCheck(),
  ])
  checks.push(dbResult, demoResult, devResult)

  return {
    ok: !checks.some((c) => c.status === 'fail'),
    checks,
  }
}

if (isMain(import.meta.url)) {
  void cliRun(runDevHealth)
}

/**
 * Smoke-test the customer-facing read API against prod (or any env via
 * BASE_URL override). Hits all 5 new endpoints with a real workspace
 * bearer, prints status + truncated JSON, and cleans up the webhook it
 * creates so re-running stays idempotent.
 *
 * Usage:
 *   npm run test:customer-api
 *   BASE_URL=http://localhost:3000 npm run test:customer-api
 *   LABELHUB_KEY=lh_ws_yourkey  npm run test:customer-api
 *
 * Default bearer is the public demo key from DEMO_CHECKLIST.md.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const BASE_URL = process.env.BASE_URL ?? 'https://labelhub-gamma.vercel.app'
const KEY =
  process.env.LABELHUB_KEY ??
  '$LABELHUB_DEMO_KEY'

const SECTION = (s: string) =>
  `\n\x1b[1;35m━━━ ${s} ━━━\x1b[0m`

function snip(s: string, n = 1200): string {
  return s.length > n ? s.slice(0, n) + `…[+${s.length - n} chars]` : s
}

/**
 * Shell out to curl instead of Node's fetch — on Windows we sometimes hit
 * undici DNS weirdness (it resolves to wrong IPs for some hosts). curl uses
 * the system resolver and Just Works.
 */
async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; bodyText: string; json: unknown }> {
  const args = [
    '-sS',
    '-X', method,
    '-w', '\n__HTTP_STATUS__%{http_code}__',
    '-H', `Authorization: Bearer ${KEY}`,
    `${BASE_URL}${path}`,
  ]
  if (body) {
    args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body))
  }
  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 10 * 1024 * 1024,
  })
  const match = stdout.match(/__HTTP_STATUS__(\d+)__$/)
  const status = match ? Number(match[1]) : 0
  const bodyText = match ? stdout.slice(0, match.index!).replace(/\n$/, '') : stdout
  let json: unknown = null
  try {
    json = JSON.parse(bodyText)
  } catch {
    /* not JSON */
  }
  return { status, bodyText, json }
}

async function main() {
  console.log(`\n${BASE_URL}  ·  key prefix ${KEY.slice(0, 14)}…\n`)

  // ─── 1. GET /api/annotations ─────────────────────────────────────────
  console.log(SECTION('1. GET /api/annotations?limit=3'))
  const list = await call('GET', '/api/annotations?limit=3')
  console.log(`status: ${list.status}`)
  if (list.json && typeof list.json === 'object' && 'annotations' in list.json) {
    const data = list.json as {
      annotations: unknown[]
      total: number
      hasMore: boolean
    }
    console.log(`total=${data.total} returned=${data.annotations.length} hasMore=${data.hasMore}`)
    console.log(snip(JSON.stringify(data.annotations[0] ?? null, null, 2)))
  } else {
    console.log(snip(list.bodyText))
  }

  // Capture an id for the single-row test.
  const firstAnnotationId =
    list.json &&
    typeof list.json === 'object' &&
    'annotations' in list.json &&
    Array.isArray((list.json as { annotations: unknown[] }).annotations) &&
    (list.json as { annotations: Array<{ id?: string }> }).annotations[0]?.id
      ? (list.json as { annotations: Array<{ id: string }> }).annotations[0].id
      : null

  // ─── 2. GET /api/annotations/[id] ────────────────────────────────────
  if (firstAnnotationId) {
    console.log(
      SECTION(`2. GET /api/annotations/${firstAnnotationId.slice(0, 8)}…`),
    )
    const single = await call('GET', `/api/annotations/${firstAnnotationId}`)
    console.log(`status: ${single.status}`)
    console.log(snip(JSON.stringify(single.json, null, 2)))
  } else {
    console.log(SECTION('2. SKIP — no annotation id returned'))
  }

  // ─── 3. GET /api/quality/summary ─────────────────────────────────────
  console.log(SECTION('3. GET /api/quality/summary'))
  const summary = await call('GET', '/api/quality/summary')
  console.log(`status: ${summary.status}`)
  console.log(snip(JSON.stringify(summary.json, null, 2), 1800))

  // ─── 4. POST /api/webhooks ───────────────────────────────────────────
  console.log(SECTION('4. POST /api/webhooks  (register subscription)'))
  const created = await call('POST', '/api/webhooks', {
    url: 'https://webhook.site/test-customer-api-stub',
    events: ['annotation.approved', 'annotation.rejected'],
  })
  console.log(`status: ${created.status}`)
  console.log(snip(JSON.stringify(created.json, null, 2)))

  let createdId: string | null = null
  if (
    created.json &&
    typeof created.json === 'object' &&
    'webhook' in created.json
  ) {
    const w = (created.json as { webhook: { id?: string } }).webhook
    createdId = w.id ?? null
  }

  // ─── 5. GET /api/webhooks ────────────────────────────────────────────
  console.log(SECTION('5. GET /api/webhooks'))
  const listHooks = await call('GET', '/api/webhooks')
  console.log(`status: ${listHooks.status}`)
  console.log(snip(JSON.stringify(listHooks.json, null, 2)))

  // ─── 6. DELETE /api/webhooks/[id]  (cleanup) ─────────────────────────
  if (createdId) {
    console.log(
      SECTION(`6. DELETE /api/webhooks/${createdId.slice(0, 8)}…  (cleanup)`),
    )
    const del = await call('DELETE', `/api/webhooks/${createdId}`)
    console.log(`status: ${del.status}`)
    console.log(snip(JSON.stringify(del.json, null, 2)))
  } else {
    console.log(SECTION('6. SKIP — no webhook id to clean up'))
  }

  console.log('\ndone.')
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})

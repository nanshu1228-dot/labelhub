/**
 * Production-deployment smoke for LabelHub on Vercel.
 *
 *   tsx scripts/_prod-smoke.ts <https://your-app.vercel.app> [bearer]
 *
 * Covers (in order):
 *   1. Home page loads
 *   2. Workspace dashboard loads + shows captured trajectories from Supabase
 *   3. Trajectories list page renders
 *   4. Read API (GET /api/trajectories) returns JSON
 *   5. Read API single (GET /api/trajectories/[id]) returns JSON
 *   6. Proxy auth gate works (401 without bearer)
 *   7. Proxy round-trip: real Doubao call captured to DB on Vercel
 *
 * Failures stop the run with a clear message.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

const BEARER_DEFAULT = '$LABELHUB_DEMO_KEY'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

async function probe(
  label: string,
  url: string,
  init: RequestInit,
  check: (res: Response, body: string) => string | null,
): Promise<boolean> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, init)
    const text = await res.text()
    const err = check(res, text)
    const dt = Date.now() - t0
    if (err) {
      console.log(`\x1b[31m✗\x1b[0m  ${label}  [HTTP ${res.status} in ${dt}ms]`)
      console.log(`    ${err}`)
      console.log(`    body: ${text.slice(0, 300)}`)
      return false
    }
    console.log(`\x1b[32m✓\x1b[0m  ${label}  [HTTP ${res.status} in ${dt}ms]`)
    return true
  } catch (e) {
    console.log(`\x1b[31m✗\x1b[0m  ${label}  [fetch failed]`)
    console.log(`    ${e instanceof Error ? e.message : e}`)
    return false
  }
}

async function main() {
  const base = process.argv[2]?.replace(/\/$/, '')
  const bearer = process.argv[3] ?? BEARER_DEFAULT
  if (!base) {
    console.error(
      'usage: tsx scripts/_prod-smoke.ts <https://your-app.vercel.app> [bearer]',
    )
    process.exit(1)
  }

  console.log(`\n=== LabelHub prod smoke against ${base}\n`)

  let pass = 0
  let fail = 0
  const ok = (b: boolean) => (b ? pass++ : fail++)

  // 1. Home
  ok(
    await probe(
      'GET /                            (landing page)',
      `${base}/`,
      {},
      (r, b) => (r.ok && b.includes('LabelHub') ? null : 'expected 200 + LabelHub in HTML'),
    ),
  )

  // 2. Dashboard
  ok(
    await probe(
      `GET /workspaces/${WORKSPACE_ID.slice(0, 8)}…    (dashboard)`,
      `${base}/workspaces/${WORKSPACE_ID}`,
      {},
      (r, b) => {
        if (!r.ok) return `expected 200, got ${r.status}`
        if (b.includes('Database not configured')) return 'DB unreachable from Vercel'
        if (!b.includes('TRAJECTORIES')) return 'dashboard tiles not in HTML'
        return null
      },
    ),
  )

  // 3. Trajectories list
  ok(
    await probe(
      `GET /workspaces/…/trajectories   (list page)`,
      `${base}/workspaces/${WORKSPACE_ID}/trajectories`,
      {},
      (r) => (r.ok ? null : `expected 200, got ${r.status}`),
    ),
  )

  // 4. Read API list
  let firstTrajId: string | null = null
  ok(
    await probe(
      'GET /api/trajectories            (read API list)',
      `${base}/api/trajectories?limit=5`,
      { headers: { Authorization: `Bearer ${bearer}` } },
      (r, b) => {
        if (!r.ok) return `expected 200, got ${r.status}`
        try {
          const j = JSON.parse(b) as {
            trajectories: Array<{ id: string }>
            total: number
          }
          console.log(`    → ${j.trajectories.length} of ${j.total} returned`)
          firstTrajId = j.trajectories[0]?.id ?? null
        } catch {
          return 'response not JSON'
        }
        return null
      },
    ),
  )

  // 5. Read API single
  if (firstTrajId) {
    ok(
      await probe(
        'GET /api/trajectories/[id]       (single fetch)',
        `${base}/api/trajectories/${firstTrajId}`,
        { headers: { Authorization: `Bearer ${bearer}` } },
        (r, b) => {
          if (!r.ok) return `expected 200, got ${r.status}`
          try {
            const j = JSON.parse(b) as {
              steps: unknown[]
              toolProviders: Record<string, unknown>
            }
            console.log(
              `    → ${j.steps.length} steps · ${Object.keys(j.toolProviders).length} tool providers`,
            )
          } catch {
            return 'response not JSON'
          }
          return null
        },
      ),
    )
  }

  // 6. Proxy auth gate
  ok(
    await probe(
      'POST /api/proxy/doubao  (no auth, expect 401)',
      `${base}/api/proxy/doubao/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
      (r) => (r.status === 401 ? null : `expected 401, got ${r.status}`),
    ),
  )

  // 7. Live proxy round trip
  const before = await fetch(`${base}/api/trajectories?limit=1`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  const beforeCount = (
    (await before.json()) as { total: number }
  ).total
  console.log(`\n→ firing a live proxy call (10-30s for Doubao)...`)
  const t0 = Date.now()
  const r = await fetch(`${base}/api/proxy/doubao/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'doubao-seed-2-0-lite-260428',
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly one word: ack',
        },
      ],
    }),
  })
  const dt = Date.now() - t0
  console.log(`← HTTP ${r.status} in ${dt}ms`)
  if (r.ok) {
    console.log(`\x1b[32m✓\x1b[0m  proxy live round-trip succeeded`)
    pass++
    // Wait for after()-window persist
    await new Promise((res) => setTimeout(res, 4000))
    const after2 = await fetch(`${base}/api/trajectories?limit=1`, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
    const afterCount = (
      (await after2.json()) as { total: number }
    ).total
    if (afterCount > beforeCount) {
      console.log(
        `\x1b[32m✓\x1b[0m  trajectory persisted (count ${beforeCount} → ${afterCount})`,
      )
      pass++
    } else {
      console.log(
        `\x1b[31m✗\x1b[0m  trajectory NOT persisted (count stayed at ${beforeCount})`,
      )
      fail++
    }
  } else {
    console.log(`\x1b[31m✗\x1b[0m  proxy round-trip failed`)
    console.log(`    body: ${(await r.text()).slice(0, 400)}`)
    fail++
  }

  console.log(
    `\n=== Result: \x1b[32m${pass} pass\x1b[0m · ${fail === 0 ? '0 fail' : `\x1b[31m${fail} fail\x1b[0m`}\n`,
  )
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('failed:', e)
  process.exit(1)
})

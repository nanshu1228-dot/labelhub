/**
 * Security smoke test — verifies the 7468022 + 5a2ec01 hardening actually
 * holds on the deployed site. Runs a series of unauthenticated /
 * wrong-credential requests against prod and asserts each gets the
 * expected reject status.
 *
 * Run:
 *   npm run security:smoke
 *   BASE_URL=https://your.preview.app npm run security:smoke
 *
 * Exits non-zero on any failure so CI can fail the build. Shells out to
 * curl rather than fetch because Node's undici has DNS issues on some
 * Windows boxes (see test-customer-api.ts for the same dance).
 *
 * What we CAN test from a script:
 *   - Anonymous GET on protected pages → expect 30x to /signin
 *   - Old admin token → expect 403 or 503
 *   - Cross-workspace bearer → expect 404 (no existence leak)
 *   - Missing bearer on customer API → expect 401
 *
 * What we CANNOT test here (would need Playwright with a real Supabase
 * session): a signed-in user from workspace A probing workspace B.
 * That's the most important case but also the hardest to fake; we
 * cover it indirectly by checking `requireWorkspaceMember` is wired
 * at the source level (see security-audit-grep.sh).
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const BASE_URL = (process.env.BASE_URL ?? 'https://labelhub-gamma.vercel.app').replace(
  /\/$/,
  '',
)
const DEMO_WORKSPACE_ID = '00000000-0000-0000-0000-000000000010'

// Public-by-design demo bearer (documented in DEMO_CHECKLIST.md) —
// used here to verify CROSS-workspace boundaries, not as a secret.
const DEMO_BEARER =
  process.env.LABELHUB_KEY ??
  '$LABELHUB_DEMO_KEY'

// The old hardcoded admin token that used to be a fallback. Should now
// be 100% rejected.
const OLD_ADMIN_TOKEN = 'labelhub-diag-2026'

// ANSI helpers — minimal so the output is readable in a CI log too.
const c = {
  pass: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

interface CurlResult {
  status: number
  body: string
  finalUrl: string
}

async function curl(opts: {
  url: string
  method?: 'GET' | 'POST' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  /** If true, follow redirects and report the final URL. Default false. */
  follow?: boolean
}): Promise<CurlResult> {
  const args = ['-sS', '-X', opts.method ?? 'GET']
  if (opts.follow) args.push('-L')
  args.push('-w', '\n__HTTP_STATUS__%{http_code}__%{url_effective}__')
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    args.push('-H', `${k}: ${v}`)
  }
  if (opts.body) {
    args.push('-d', opts.body)
  }
  args.push(opts.url)
  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 4 * 1024 * 1024,
  })
  const m = stdout.match(/__HTTP_STATUS__(\d+)__(.+)__$/)
  return {
    status: m ? Number(m[1]) : 0,
    finalUrl: m ? m[2] : opts.url,
    body: m ? stdout.slice(0, m.index!).replace(/\n$/, '') : stdout,
  }
}

interface Test {
  name: string
  /** Human-readable threat: "what bad thing is being prevented?" */
  threat: string
  run: () => Promise<{ ok: boolean; detail: string }>
}

const tests: Test[] = [
  // ─── Unauthenticated probes of protected pages ───────────────────────
  // We don't follow redirects — we want to see the 307/308 + Location
  // header pointing at /signin. Vercel serves 307 for Next.js server
  // redirects.
  ...[
    '',
    '/trajectories',
    '/billing',
    '/api',
    '/connections',
    '/disputes',
    '/members',
    '/quality',
    '/analyze',
    '/activity',
    '/settings',
    '/eval-runs/new',
  ].map(
    (suffix): Test => ({
      name: `anonymous → /workspaces/<id>${suffix}`,
      threat:
        'Old behavior: change URL, see workspace data without signing in',
      run: async () => {
        const r = await curl({
          url: `${BASE_URL}/workspaces/${DEMO_WORKSPACE_ID}${suffix}`,
        })
        // Next redirects unauth visitors with 307 → /signin
        const ok = r.status === 307 || r.status === 308 || r.status === 302
        return {
          ok,
          detail: `HTTP ${r.status} ${ok ? '(redirect, good)' : '(expected 30x redirect to /signin)'}`,
        }
      },
    }),
  ),

  // ─── Trajectory detail / annotate ────────────────────────────────────
  {
    name: 'anonymous → trajectory detail',
    threat: 'View any trajectory by URL without auth',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/workspaces/${DEMO_WORKSPACE_ID}/trajectories/00000000-0000-0000-0000-000000020001`,
      })
      const ok = r.status === 307 || r.status === 308 || r.status === 302
      return {
        ok,
        detail: `HTTP ${r.status}`,
      }
    },
  },
  {
    name: 'anonymous → annotator page',
    threat: 'Open annotator on any trajectory without auth',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/workspaces/${DEMO_WORKSPACE_ID}/trajectories/00000000-0000-0000-0000-000000020001/annotate`,
      })
      const ok = r.status === 307 || r.status === 308 || r.status === 302
      return {
        ok,
        detail: `HTTP ${r.status}`,
      }
    },
  },

  // ─── Old admin token ─────────────────────────────────────────────────
  {
    name: 'old admin token → /api/admin/diag',
    threat: 'Old leaked token still works to probe env',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/admin/diag?token=${OLD_ADMIN_TOKEN}`,
      })
      // Either 403 (token mismatch) or 503 (ADMIN_DIAG_TOKEN not set in
      // prod — also rejecting) is acceptable. NOT 200.
      const ok = r.status === 403 || r.status === 503
      return {
        ok,
        detail: `HTTP ${r.status}${ok ? '' : ' (expected 403 or 503)'} body: ${r.body.slice(0, 120)}`,
      }
    },
  },
  {
    name: 'no token → /api/admin/diag',
    threat: 'Admin endpoint reachable without any auth',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/admin/diag`,
      })
      const ok = r.status === 403 || r.status === 503
      return { ok, detail: `HTTP ${r.status}` }
    },
  },
  {
    name: 'old admin token → /api/admin/compute-hints',
    threat: 'Burn LLM tokens via leaked admin endpoint',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/admin/compute-hints?token=${OLD_ADMIN_TOKEN}&trajectoryId=00000000-0000-0000-0000-000000020001`,
        method: 'POST',
      })
      const ok = r.status === 403 || r.status === 503
      return { ok, detail: `HTTP ${r.status}` }
    },
  },
  {
    name: 'old admin token → /api/admin/backfill-summaries',
    threat: 'Trigger expensive batch via leaked admin endpoint',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/admin/backfill-summaries?token=${OLD_ADMIN_TOKEN}&limit=1`,
        method: 'POST',
      })
      const ok = r.status === 403 || r.status === 503
      return { ok, detail: `HTTP ${r.status}` }
    },
  },

  // ─── Customer API: missing bearer ────────────────────────────────────
  {
    name: 'no bearer → GET /api/annotations',
    threat: 'Customer API reachable without bearer',
    run: async () => {
      const r = await curl({ url: `${BASE_URL}/api/annotations` })
      const ok = r.status === 401
      return { ok, detail: `HTTP ${r.status} (expected 401)` }
    },
  },
  {
    name: 'no bearer → GET /api/quality/summary',
    threat: 'Quality summary reachable without bearer',
    run: async () => {
      const r = await curl({ url: `${BASE_URL}/api/quality/summary` })
      const ok = r.status === 401
      return { ok, detail: `HTTP ${r.status} (expected 401)` }
    },
  },
  {
    name: 'no bearer → GET /api/trajectories',
    threat: 'Trajectory list reachable without bearer',
    run: async () => {
      const r = await curl({ url: `${BASE_URL}/api/trajectories` })
      const ok = r.status === 401
      return { ok, detail: `HTTP ${r.status} (expected 401)` }
    },
  },
  {
    name: 'no bearer → POST /api/webhooks',
    threat: 'Subscribe a webhook without bearer',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/webhooks`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"url":"https://evil.example/hook"}',
      })
      const ok = r.status === 401
      return { ok, detail: `HTTP ${r.status} (expected 401)` }
    },
  },

  // ─── Cross-workspace bearer probing ──────────────────────────────────
  // Use the demo bearer to query a fabricated annotation id that's NOT
  // in this workspace. Should get 404, NOT 200, NOT 403 (we don't want
  // to leak existence).
  {
    name: 'cross-workspace probe → GET /api/annotations/<random-uuid>',
    threat: 'Bearer for workspace A enumerates workspace B annotations',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/annotations/ffffffff-ffff-ffff-ffff-ffffffffffff`,
        headers: { Authorization: `Bearer ${DEMO_BEARER}` },
      })
      const ok = r.status === 404
      return { ok, detail: `HTTP ${r.status} (expected 404, not-found-or-not-yours)` }
    },
  },
  {
    name: 'cross-workspace probe → GET /api/trajectories/<random-uuid>',
    threat: 'Bearer for workspace A enumerates workspace B trajectories',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/trajectories/ffffffff-ffff-ffff-ffff-ffffffffffff`,
        headers: { Authorization: `Bearer ${DEMO_BEARER}` },
      })
      const ok = r.status === 404
      return { ok, detail: `HTTP ${r.status} (expected 404)` }
    },
  },

  // ─── Workspace API key sanity ─────────────────────────────────────────
  {
    name: 'demo bearer → GET /api/annotations (positive control)',
    threat: 'Sanity: the valid bearer still works (regression check)',
    run: async () => {
      const r = await curl({
        url: `${BASE_URL}/api/annotations?limit=1`,
        headers: { Authorization: `Bearer ${DEMO_BEARER}` },
      })
      const ok = r.status === 200
      return { ok, detail: `HTTP ${r.status} (positive control — expected 200)` }
    },
  },
]

async function main() {
  console.log(
    `\n${c.bold('LabelHub security smoke test')}  ${c.dim(BASE_URL)}\n`,
  )
  let pass = 0
  let fail = 0
  const failures: string[] = []
  for (const t of tests) {
    try {
      const r = await t.run()
      const glyph = r.ok ? c.pass : c.fail
      console.log(`${glyph} ${t.name}`)
      console.log(`  ${c.dim(t.threat)}`)
      console.log(`  ${c.dim(r.detail)}\n`)
      if (r.ok) pass++
      else {
        fail++
        failures.push(`${t.name}  —  ${r.detail}`)
      }
    } catch (e) {
      fail++
      failures.push(
        `${t.name}  —  EXCEPTION: ${e instanceof Error ? e.message : e}`,
      )
      console.log(`${c.fail} ${t.name}  (exception)\n`)
    }
  }
  console.log(
    `\n${c.bold('Summary:')}  ${pass} pass / ${fail} fail / ${tests.length} total\n`,
  )
  if (fail > 0) {
    console.log(c.bold('Failures:'))
    for (const f of failures) console.log(`  ${c.fail} ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('runner failed:', e)
  process.exit(2)
})

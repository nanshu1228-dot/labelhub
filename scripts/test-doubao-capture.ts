/**
 * Smoke test: does our adapter capture a REAL Doubao response cleanly?
 *
 * Run: `npm run test:capture`
 * Requires: DOUBAO_API_KEY in .env.local
 *
 * What it does (NO DB, NO Next.js dev server needed):
 *   1. Fires a real chat completion request straight to Doubao
 *   2. Pipes the raw response through openAIChatToTrajectory
 *   3. Pretty-prints both sides so you can eyeball what gets captured
 *
 * This isolates the capture LOGIC from the HTTP+DB persistence layer
 * (which is already covered by 62 unit tests). If this script shows a
 * clean canonical trajectory, the proxy will too.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { openAIChatToTrajectory } from '../src/lib/proxy/openai-compat-adapter'
import { validateTrajectory } from '../src/lib/trajectories/schema'

// `||` not `??` — env vars come back as '' when unset in .env files, and ??
// only falls back on null/undefined, not on empty strings.
const DEFAULT_MODEL =
  process.env.DOUBAO_DEFAULT_MODEL || 'doubao-1-5-pro-32k-250115'
const BASE_URL = (
  process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
).replace(/\/$/, '')

// A representative test prompt that exercises a non-trivial response.
// Keep it short so the round-trip is fast.
const TEST_PROMPT =
  '请用三句话介绍一下"自进化标注平台"应该具备哪些关键能力。'

async function main() {
  const key = process.env.DOUBAO_API_KEY
  if (!key) {
    console.error(
      '\n❌ DOUBAO_API_KEY missing. Add it to .env.local first.\n' +
        '   Get one at https://www.volcengine.com/product/doubao → 火山方舟 console.\n',
    )
    process.exit(1)
  }

  console.log('\n🔬 LabelHub capture smoke test\n')
  console.log(`  model    : ${DEFAULT_MODEL}`)
  console.log(`  endpoint : ${BASE_URL}/chat/completions`)
  console.log(`  prompt   : ${TEST_PROMPT}\n`)
  console.log('  → calling Doubao…')

  const requestBody = {
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system' as const, content: '你是一个简洁、专业的技术顾问。' },
      { role: 'user' as const, content: TEST_PROMPT },
    ],
  }

  const start = Date.now()
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(requestBody),
  })
  const latencyMs = Date.now() - start

  if (!res.ok) {
    const text = await res.text()
    console.error(`\n❌ Doubao returned HTTP ${res.status}:\n${text}\n`)
    process.exit(2)
  }

  const upstream = await res.json()
  console.log(`  ✓ upstream OK in ${latencyMs}ms\n`)

  // ── Run the adapter ─────────────────────────────────────────────────
  const trajectory = openAIChatToTrajectory(requestBody, upstream, {
    agentName: `doubao/${DEFAULT_MODEL}`,
    source: 'production',
    latencyMs,
  })

  // ── Validate canonical shape (would throw if broken) ────────────────
  const validated = validateTrajectory(trajectory)

  // ── Pretty-print the captured trajectory ────────────────────────────
  const line = '─'.repeat(72)
  console.log(line)
  console.log('CAPTURED CANONICAL TRAJECTORY')
  console.log(line)
  console.log(`agentName     : ${validated.agentName}`)
  console.log(`source        : ${validated.source}`)
  console.log(`schemaVersion : ${validated.schemaVersion}`)
  console.log(`rootPrompt    : ${validated.rootPrompt}`)
  console.log(
    `finalResponse : ${validated.finalResponse?.slice(0, 200) ?? '(none)'}${
      (validated.finalResponse?.length ?? 0) > 200 ? '…' : ''
    }`,
  )
  console.log(
    `steps         : ${validated.steps.length}  [${validated.steps
      .map((s) => s.kind)
      .join(', ')}]`,
  )
  console.log(`\nmeta:`)
  for (const [k, v] of Object.entries(validated.meta ?? {})) {
    const display =
      typeof v === 'object' && v !== null
        ? JSON.stringify(v)
        : String(v)
    console.log(`  ${k.padEnd(15)} : ${display}`)
  }

  console.log(`\nsteps:`)
  validated.steps.forEach((step, i) => {
    console.log(`\n  [${i}] kind=${step.kind}`)
    if (step.modelName) console.log(`      model      : ${step.modelName}`)
    if (step.latencyMs) console.log(`      latencyMs  : ${step.latencyMs}`)
    if (step.tokensIn) console.log(`      tokensIn   : ${step.tokensIn}`)
    if (step.tokensOut) console.log(`      tokensOut  : ${step.tokensOut}`)
    const c = step.content as Record<string, unknown>
    for (const [k, v] of Object.entries(c)) {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      const display = s.length > 200 ? `${s.slice(0, 200)}…` : s
      console.log(`      ${k.padEnd(11)}: ${display}`)
    }
  })

  console.log(`\n${line}`)
  console.log('VERDICT')
  console.log(line)
  console.log(
    `  ✓ Adapter produced a valid canonical trajectory (${validated.steps.length} step${validated.steps.length === 1 ? '' : 's'}).`,
  )
  console.log(
    `  ✓ Both rootPrompt + ${validated.finalResponse ? 'finalResponse' : 'tool_calls'} captured.`,
  )
  console.log(
    `  ✓ Usage metadata: ${
      validated.meta?.usage
        ? JSON.stringify(validated.meta.usage)
        : '(none reported by upstream)'
    }`,
  )
  console.log(
    '\n  → When the dev server is up, this same trajectory is what /api/proxy/doubao\n    persists to the trajectories + trajectory_steps tables.\n',
  )
}

main().catch((e) => {
  console.error('\n❌ Smoke test failed:', e instanceof Error ? e.message : e)
  if (e instanceof Error && e.stack) {
    console.error(e.stack.split('\n').slice(0, 5).join('\n'))
  }
  process.exit(1)
})

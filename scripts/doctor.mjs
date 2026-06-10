#!/usr/bin/env node
/**
 * doctor.mjs — LabelHub 流程体检(flow health-check)
 * ---------------------------------------------------------------------------
 * 一条命令、一张总览,看清「每条业务流程通不通、有没有 bug」。三层,缺哪层
 * 就醒目跳过(绝不假绿):
 *
 *   Tier 0  静态接线   复用 scripts/verify-spec.mjs(只查接线在不在,0 搭建)
 *   Tier 1  实时探针   fetch 打 /api/health + 公共页 + demo-key 客户 API(~15s)
 *   Tier 2  深度全链路 --deep:本地 Docker PG → seed → Playwright 真跑 owner→
 *                      labeler→reviewer→payout→export,硬断言 + 逐步截图
 *
 * 用法:
 *   node scripts/doctor.mjs                      # 默认 target=prod(aipert.top),Tier0+1
 *   node scripts/doctor.mjs --target local       # 打 http://localhost:3000
 *   node scripts/doctor.mjs --target https://x   # 打任意 URL
 *   node scripts/doctor.mjs --deep               # 追加 Tier2(需 Docker + .env.e2e)
 *   node scripts/doctor.mjs --allow-writes       # 允许写型探针(默认仅 local 跑)
 *   node scripts/doctor.mjs --json               # 机读 JSON
 *   node scripts/doctor.mjs --quiet              # 只打印 FAIL/SKIP 行 + 汇总
 *
 * 退出码:任一 required 检查 FAIL → 1;否则 0(SKIP / WARN 不致失败)。
 *
 * 安全:对 prod 严格只读(写型探针仅 local 或 --allow-writes);任何密钥只从
 * .env 文件或环境变量读取,绝不打印。
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

// ----- arg parsing ----------------------------------------------------------
function flag(name) {
  return args.includes(`--${name}`)
}
function opt(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  return fallback
}
const JSON_OUT = flag('json')
const QUIET = flag('quiet')
const DEEP = flag('deep')
const ALLOW_WRITES_FLAG = flag('allow-writes')
const HELP = flag('help') || flag('h')

const PROD_URL = 'https://aipert.top'
const LOCAL_URL = 'http://localhost:3000'
const targetArg = opt('target', 'prod')
const TARGET =
  targetArg === 'prod'
    ? PROD_URL
    : targetArg === 'local'
      ? LOCAL_URL
      : targetArg.replace(/\/$/, '')
const IS_LOCAL = TARGET === LOCAL_URL || /localhost|127\.0\.0\.1/.test(TARGET)
// Write-type probes (e.g. mutating round-trips) only run against local OR when
// the operator explicitly opts in — never silently against prod.
const ALLOW_WRITES = ALLOW_WRITES_FLAG || IS_LOCAL

if (HELP) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^[\s\S]*?\n \*/, ' *'))
  process.exit(0)
}

// ----- tiny .env loader (no deps) ------------------------------------------
// Picks up HEALTH_DETAILED_TOKEN (to unlock /api/health detail) and any vars a
// child process may need. Never logs values.
function loadEnvFiles() {
  for (const f of ['.env.local', '.env', '.env.e2e']) {
    const p = join(ROOT, f)
    if (!existsSync(p)) continue
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const k = line.slice(0, eq).trim()
      let v = line.slice(eq + 1).trim()
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      )
        v = v.slice(1, -1)
      if (!(k in process.env)) process.env[k] = v
    }
  }
}
loadEnvFiles()

// ----- result model ---------------------------------------------------------
/** rows: { tier, label, status: 'pass'|'fail'|'skip'|'warn', note } */
const rows = []
const add = (tier, label, status, note = '') =>
  rows.push({ tier, label, status, note })

// ----- http helper ----------------------------------------------------------
async function http(path, { headers = {}, method = 'GET', body, ms = 15000 } = {}) {
  const url = path.startsWith('http') ? path : `${TARGET}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal, redirect: 'manual' })
    const text = await res.text()
    return { ok: true, status: res.status, text, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, status: 0, text: '', ms: Date.now() - t0, err: e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}
const snippet = (s, n = 120) => (s || '').replace(/\s+/g, ' ').slice(0, n)

// ===========================================================================
// Tier 0 — 静态接线(复用 verify-spec.mjs)
// ===========================================================================
function tier0Static() {
  const TIER = 'Tier0 静态接线'
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-spec.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (r.error) {
    add(TIER, 'verify-spec 运行', 'fail', r.error.message)
    return
  }
  let parsed
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    add(TIER, 'verify-spec 解析', 'fail', `非 JSON 输出 (exit ${r.status})`)
    return
  }
  const { required, optional } = parsed.summary
  add(
    TIER,
    `必备功能接线 ${required.pass}/${required.total}`,
    required.fail ? 'fail' : 'pass',
    required.fail ? `${required.fail} 项缺口:${parsed.failures.filter((f) => f.required).map((f) => f.id).join(', ')}` : '',
  )
  add(
    TIER,
    `加分/工程项接线 ${optional.pass}/${optional.total}`,
    optional.fail ? 'warn' : 'pass',
  )
}

// ===========================================================================
// Tier 1 — 实时 HTTP/健康探针
// ===========================================================================
async function tier1Probe() {
  const TIER = 'Tier1 实时探针'

  // 1. /api/health — DB 存活 / 延迟 / (token 解锁) 错误率·p95·版本
  {
    const token = process.env.HEALTH_DETAILED_TOKEN
    const headers = token ? { authorization: `Bearer ${token}` } : {}
    const res = await http('/api/health', { headers })
    if (!res.ok) {
      add(TIER, 'DB 存活 (/api/health)', 'fail', `请求失败: ${res.err}`)
    } else if (res.status === 429) {
      add(TIER, 'DB 存活 (/api/health)', 'warn', '429 限流 — 稍后重试')
    } else {
      let j = {}
      try {
        j = JSON.parse(res.text)
      } catch {}
      const dbOk = j?.db?.ok === true
      const lat = j?.db?.latencyMs
      const st = j?.status
      const detail = j?.window5min
        ? ` · 5min 错误率 ${(j.window5min.errorRate * 100).toFixed(1)}% · p95 ${j.window5min.p95DurationMs}ms${j.version ? ` · ${j.version}` : ''}`
        : ' · (无 HEALTH_DETAILED_TOKEN,仅基础信号)'
      add(
        TIER,
        'DB 存活 (/api/health)',
        dbOk && st !== 'down' ? (st === 'degraded' ? 'warn' : 'pass') : 'fail',
        `status=${st} db=${dbOk ? `ok ${lat}ms` : '✗'}${detail}`,
      )
    }
  }

  // 2. 公共页渲染(免浏览器,等价 public-smoke)
  {
    const pages = [
      { p: '/', brand: true },
      { p: '/signin' },
      { p: '/docs' },
    ]
    const failed = []
    let landingBrandOk = true
    for (const { p, brand } of pages) {
      const res = await http(p)
      const ok2xx = res.ok && res.status >= 200 && res.status < 400
      if (!ok2xx) failed.push(`${p}→${res.ok ? res.status : res.err}`)
      if (brand && ok2xx && !/LabelHub/i.test(res.text)) landingBrandOk = false
    }
    // 未知路由应是 themed 404(渲染不崩)
    const nf = await http('/this-route-does-not-exist-xyz-doctor')
    const nfOk = nf.ok && [200, 404].includes(nf.status)
    if (!nfOk) failed.push(`404→${nf.ok ? nf.status : nf.err}`)

    if (failed.length) add(TIER, '公共页渲染 / /signin /docs /404', 'fail', failed.join(', '))
    else if (!landingBrandOk) add(TIER, '公共页渲染 / /signin /docs /404', 'warn', 'landing 未含 LabelHub 品牌字样')
    else add(TIER, '公共页渲染 / /signin /docs /404', 'pass', '全部 200/404 且渲染正常')
  }

  // 3. /api/demo/info → 取公开 demo bearer key
  let demoKey = null
  {
    const res = await http('/api/demo/info')
    if (!res.ok || res.status >= 400) {
      add(TIER, 'demo 凭据 (/api/demo/info)', 'fail', `${res.ok ? res.status : res.err}`)
    } else {
      let j = {}
      try {
        j = JSON.parse(res.text)
      } catch {}
      demoKey = typeof j.demoKey === 'string' ? j.demoKey : null
      add(
        TIER,
        'demo 凭据 (/api/demo/info)',
        'pass',
        demoKey ? `demoKey 已铸 (rpm=${j.demoKeyRpm ?? '?'})` : 'demoKey=null(下方 bearer 探针将跳过)',
      )
    }
  }

  // 4. 持 demo key 读客户 API(workspace 推断自 key)
  {
    if (!demoKey) {
      add(TIER, '客户 API (annotations / trajectories / quality)', 'skip', '无 demoKey,无法 bearer 探针')
    } else {
      const eps = [
        '/api/annotations?limit=1',
        '/api/trajectories?limit=1',
        '/api/quality/summary',
      ]
      const bad = []
      let all401 = true
      for (const ep of eps) {
        const res = await http(ep, { headers: { 'x-api-key': demoKey } })
        const good = res.ok && res.status === 200
        if (!good) {
          bad.push(`${ep.split('?')[0]}→${res.ok ? `${res.status} ${snippet(res.text, 60)}` : res.err}`)
          if (res.status !== 401) all401 = false
        }
      }
      if (bad.length) {
        // 全 401 + demoKey 已发布 ⇒ settings.demoApiKey 与 workspace_api_keys 失同步
        // (landing 页广告的"可用凭据"实际 401)。补救是运维动作,非代码改动。
        const hint = all401
          ? ' ‖ 诊断:landing 广告的 demoKey 全部 401 → settings.demoApiKey 与 workspace_api_keys 失同步;在 VPS 上 `DATABASE_URL=… npx tsx scripts/debug/seed-demo-key.ts` 重铸即可'
          : ''
        add(TIER, '客户 API (annotations / trajectories / quality)', 'fail', bad.join(' ; ') + hint)
      } else add(TIER, '客户 API (annotations / trajectories / quality)', 'pass', '3/3 → 200')
    }
  }

  // 5. (写型,默认仅 local)导出数据集端点可达性
  {
    const ep = '/api/export/dataset?kind=qa_quality&format=jsonl&limit=1'
    if (!ALLOW_WRITES) {
      add(TIER, '导出端点 (/api/export/dataset)', 'skip', '写/重型探针默认仅 local(加 --allow-writes 强制)')
    } else if (!demoKey) {
      add(TIER, '导出端点 (/api/export/dataset)', 'skip', '无 demoKey')
    } else {
      const res = await http(ep, { headers: { 'x-api-key': demoKey }, ms: 30000 })
      const good = res.ok && [200, 204].includes(res.status)
      add(
        TIER,
        '导出端点 (/api/export/dataset)',
        good ? 'pass' : 'warn',
        good ? `${res.status} (${res.ms}ms)` : `${res.ok ? `${res.status} ${snippet(res.text, 60)}` : res.err}`,
      )
    }
  }
}

// ===========================================================================
// Tier 2 — 深度全链路(--deep):编排 Docker + seed + Playwright
// ===========================================================================
function sh(cmd, cmdArgs, extraEnv = {}, ms = 600000) {
  return spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: ms,
    shell: process.platform === 'win32',
  })
}

const DEEP_RESULT_FILE = join(ROOT, 'e2e', '.doctor-deep.json')

// 整站都在服务器上(应用 + Postgres + 鉴权),本机不跑该站、服务器 DB 不外开放
// → 深度层走【远程模式直打目标服务器】+【隔离 smoke 工作区】,payout 用标注员自己
// 的 /my/earnings 页面(UI)断言,不直连 DB。
const REQUIRED_E2E_ENV = ['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD', 'E2E_SMOKE_WORKSPACE_ID']

async function tier2Deep() {
  const TIER = 'Tier2 深度全链路'

  // 缺凭据 → 醒目 SKIP(绝不假绿)
  const missing = REQUIRED_E2E_ENV.filter((k) => !process.env[k])
  if (missing.length) {
    add(
      TIER,
      '深度全链路',
      'skip',
      `缺 ${missing.join(', ')} —— cp .env.e2e.example .env.e2e:注册一个 smoke admin、建一个隔离 smoke 工作区并在其中建任务导入几条题目,把 workspace id 填进 E2E_SMOKE_WORKSPACE_ID(见 docs/DOCTOR.md)`,
    )
    return
  }

  // 远程模式:E2E_BASE_URL=目标(默认 prod)→ playwright.config 不起本地 server,
  // 直打线上。数据只落隔离 smoke 工作区,绝不碰 demo。
  try {
    if (existsSync(DEEP_RESULT_FILE)) unlinkSync(DEEP_RESULT_FILE)
  } catch {}
  const pw = sh(
    'npx',
    ['playwright', 'test', 'deep-lifecycle', '--reporter=line'],
    { DOCTOR_DEEP: '1', E2E_BASE_URL: TARGET },
    600000,
  )

  // 优先用 spec 落盘的结构化结果(逐步标红);否则按退出码兜底。
  if (existsSync(DEEP_RESULT_FILE)) {
    try {
      const r = JSON.parse(readFileSync(DEEP_RESULT_FILE, 'utf8'))
      for (const s of r.steps || []) add(TIER, s.label, s.ok ? 'pass' : 'fail', s.note || '')
      if (r.screenshotDir) add(TIER, '逐步截图', 'pass', r.screenshotDir)
      return
    } catch {
      /* fall through */
    }
  }
  add(
    TIER,
    '深度全链路 (Playwright)',
    pw.status === 0 ? 'pass' : 'fail',
    pw.status === 0 ? '全链路通过' : snippet((pw.stdout || '') + (pw.stderr || ''), 280),
  )
}

// ===========================================================================
// run + print
// ===========================================================================
async function main() {
  tier0Static()
  await tier1Probe()
  if (DEEP) await tier2Deep()

  const fails = rows.filter((r) => r.status === 'fail')
  const skips = rows.filter((r) => r.status === 'skip')
  const warns = rows.filter((r) => r.status === 'warn')

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          target: TARGET,
          deep: DEEP,
          summary: { total: rows.length, fail: fails.length, skip: skips.length, warn: warns.length },
          rows,
        },
        null,
        2,
      ),
    )
    process.exit(fails.length ? 1 : 0)
  }

  const C = process.stdout.isTTY
  const g = (s) => (C ? `\x1b[32m${s}\x1b[0m` : s)
  const red = (s) => (C ? `\x1b[31m${s}\x1b[0m` : s)
  const y = (s) => (C ? `\x1b[33m${s}\x1b[0m` : s)
  const b = (s) => (C ? `\x1b[34m${s}\x1b[0m` : s)
  const dim = (s) => (C ? `\x1b[2m${s}\x1b[0m` : s)
  const bold = (s) => (C ? `\x1b[1m${s}\x1b[0m` : s)
  const tag = (st) =>
    st === 'pass' ? g('PASS') : st === 'fail' ? red('FAIL') : st === 'warn' ? y('WARN') : b('SKIP')

  console.log(
    bold('\n  LabelHub flow doctor  ') +
      dim(`(target: ${TARGET}${DEEP ? ' · --deep' : ''}${ALLOW_WRITES ? ' · writes' : ''})\n`),
  )
  let cur = ''
  for (const r of rows) {
    if (QUIET && r.status === 'pass') continue
    if (r.tier !== cur) {
      cur = r.tier
      console.log('  ' + bold(cur))
    }
    console.log(`    [${tag(r.status)}] ${r.label}`)
    if (r.note) console.log('           ' + dim(r.note))
  }

  console.log('')
  const parts = [
    g(`${rows.filter((r) => r.status === 'pass').length} PASS`),
    fails.length ? red(`${fails.length} FAIL`) : dim('0 FAIL'),
    warns.length ? y(`${warns.length} WARN`) : dim('0 WARN'),
    skips.length ? b(`${skips.length} SKIP`) : dim('0 SKIP'),
  ]
  console.log('  ' + bold('汇总: ') + parts.join(dim(' · ')))
  if (fails.length) {
    console.log('\n  ' + red(bold('异常流程(需修复):')))
    for (const f of fails) console.log('    - ' + f.tier + ' :: ' + f.label + (f.note ? dim(' — ' + f.note) : ''))
  }
  if (!DEEP) console.log('\n  ' + dim('提示:加 --deep 跑 owner→labeler→reviewer→payout→export 全链路(对线上+隔离 smoke 工作区,需 .env.e2e)'))
  console.log('')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => {
  console.error('doctor 崩溃:', e?.stack || e)
  process.exit(1)
})

import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Deep全链路 spec — doctor 的 Tier 2(对【真实服务器】+【隔离 smoke 工作区】跑)。
 *
 * 整站(应用 + Postgres + 鉴权)都在服务器上,本机不跑该站,服务器的 Postgres 也
 * 不对外开放——所以这条链路:① Playwright 远程模式直打 E2E_BASE_URL(默认
 * aipert.top);② 用一个【专门的 smoke admin】登录;③ 只在一个【一次性 smoke
 * 工作区】里操作(绝不碰 demo 数据);④ payout 用标注员自己的 /my/earnings 页面
 * (UI)断言,不直连 DB。
 *
 * 同一个 smoke admin 既作答又审批——`reviewAnnotation` 允许 admin 审自己的提交
 * (annotations.ts:690 “admin reviewing their own annotation — unusual but possible”),
 * 故 payout 落在该 admin 自己的 /my/earnings。
 *
 * 由 `node scripts/doctor.mjs --deep` 编排触发,它注入:
 *   DOCTOR_DEEP=1
 *   E2E_BASE_URL=https://aipert.top         (远程模式;playwright.config 据此不起本地 server)
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD    (smoke admin)
 *   E2E_SMOKE_WORKSPACE_ID                   (隔离 smoke 工作区 uuid)
 *
 * 一次性前置(见 .env.e2e.example):注册 smoke admin → 建一个 smoke 工作区 →
 * 在其中建一个任务并导入几条题目 → 把 workspace id 填进 .env.e2e。
 *
 * 缺 DOCTOR_DEEP 或缺凭据时整组 SELF-SKIP(绝不假绿)。
 */

const ENABLED = process.env.DOCTOR_DEEP === '1'
const email = process.env.E2E_ADMIN_EMAIL
const password = process.env.E2E_ADMIN_PASSWORD
const smokeWs = process.env.E2E_SMOKE_WORKSPACE_ID

const SHOT_DIR = join(process.cwd(), 'e2e', '__screenshots__', 'doctor')
const RESULT_FILE = join(process.cwd(), 'e2e', '.doctor-deep.json')

type Step = { label: string; ok: boolean; note?: string }
const steps: Step[] = []
let shotN = 0

async function shot(page: Page, name: string) {
  try {
    mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({
      path: join(SHOT_DIR, `${String(++shotN).padStart(2, '0')}-${name}.png`),
      fullPage: true,
    })
  } catch {
    /* 截图失败不致命 */
  }
}

/** 跑一步,捕获异常为 finding(不抛),并截图。返回是否成功。 */
async function step(page: Page, label: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const note = await fn()
    steps.push({ label, ok: true, note: note || undefined })
    await shot(page, label.replace(/[^a-z0-9]+/gi, '-').slice(0, 30))
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    steps.push({ label, ok: false, note: msg.slice(0, 200) })
    await shot(page, `FAIL-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}`)
    return false
  }
}

test.describe('deep lifecycle (doctor --deep · live + smoke workspace)', () => {
  test.skip(
    !ENABLED || !email || !password || !smokeWs,
    'doctor --deep 专用:需 DOCTOR_DEEP=1 + E2E_ADMIN_EMAIL/PASSWORD + E2E_SMOKE_WORKSPACE_ID',
  )

  test.describe.configure({ mode: 'serial' })

  test('claim → annotate → submit → approve → payout(UI) → export', async ({ page }) => {
    test.setTimeout(300_000)
    let topicId: string | null = null

    // ── 1. 登录(真实 Supabase 邮箱+密码表单) ──────────────────────
    await step(page, '登录', async () => {
      await page.goto('/signin')
      await page.getByLabel(/email/i).fill(email!)
      await page.getByLabel(/password/i).fill(password!)
      // 用邮箱/密码表单的提交按钮(class auth-submit),别点上方的 "Continue with Google"。
      await page.locator('button.auth-submit, form.auth-form button[type="submit"]').first().click()
      const err = page.locator('.auth-error')
      const res = await Promise.race([
        // 登录成功后 router.push(next) 默认回首页 "/" —— 只要离开 /signin 即视为成功。
        page
          .waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30_000 })
          .then(() => 'ok'),
        err.waitFor({ timeout: 30_000 }).then(async () => `auth-error: ${(await err.innerText()).slice(0, 100)}`),
      ])
      if (res !== 'ok') throw new Error(String(res))
      return '已进入鉴权区'
    })

    // ── 2. smoke 工作区可见(确认隔离工作区存在 + 有权限) ───────────
    await step(page, 'smoke 工作区可达', async () => {
      await page.goto(`/workspaces/${smokeWs}`)
      await expect(page.getByText(/task|topic|annotat|任务|题目/i).first()).toBeVisible({ timeout: 20_000 })
      return `workspace=${smokeWs}`
    })

    // ── 2.5 确保 smoke 任务为【单段审核】(自愈) ──────────────────────
    // 这条链路是单账号自产自审:两段审核(默认开)下,初审被自审规则拦
    // (qc-review.ts 禁 self-QC)、终审被两段策略拦 → 单账号死路。
    // reviewAnnotation 明确允许 admin 自审,所以 smoke 任务必须单段。
    // 此步幂等:已是单段则直接跳过。
    await step(page, 'smoke 任务设为单段(自审需要)', async () => {
      await page.goto(`/workspaces/${smokeWs}/tasks`)
      const taskLink = page
        .locator(`a[href*="/workspaces/${smokeWs}/tasks/"]:not([href$="/new"])`)
        .first()
      await expect(taskLink).toBeVisible({ timeout: 20_000 })
      const href = await taskLink.getAttribute('href')
      const taskId = href?.match(/\/tasks\/([0-9a-f-]{36})/i)?.[1]
      if (!taskId) throw new Error(`无法从任务链接解析 taskId: ${href}`)
      await page.goto(`/workspaces/${smokeWs}/tasks/${taskId}/edit`)
      const cb = page
        .locator('label', { hasText: /两段人工审核/ })
        .locator('input[type="checkbox"]')
        .first()
      await expect(cb).toBeVisible({ timeout: 20_000 })
      if (!(await cb.isChecked())) return '已是单段,无需修改'
      await cb.uncheck()
      await page.getByRole('button', { name: /save changes|保存/i }).first().click()
      // 保存成功 → 跳回任务详情页;失败 → 留在 edit 页并出错误条。
      await page.waitForURL((u) => !u.pathname.endsWith('/edit'), { timeout: 20_000 })
      return `task=${taskId} 已切换为单段审核`
    })

    // ── 3. 领取:/my/queue 里挑【属于 smoke 工作区】的可作答题目,严防碰 demo ─
    await step(page, '领取题目(限 smoke 工作区)', async () => {
      await page.goto('/my/queue')
      // 只认 href 落在 smoke 工作区的作答卡片,绝不碰别的工作区。
      const card = page
        .locator(`a[href*="/workspaces/${smokeWs}/topics/"][href*="/annotate"]`)
        .first()
      await expect(card).toBeVisible({ timeout: 20_000 })
      const href = await card.getAttribute('href')
      topicId = href?.match(/\/topics\/([0-9a-f-]+)\/annotate/i)?.[1] ?? null
      // 如有批量勾选+领取按钮,先用它;否则点卡片(领取在首次保存/提交时落定)。
      const cb = page.locator('button[aria-label*="Select topic"]').first()
      const bulk = page.getByRole('button', { name: /claim \d+ selected|领取/i }).first()
      if ((await cb.count()) && (await bulk.count())) {
        await cb.click()
        if (await bulk.count()) await bulk.click()
      }
      await card.click()
      await page.waitForURL(/\/topics\/.*\/annotate/, { timeout: 20_000 })
      if (!topicId) topicId = page.url().match(/\/topics\/([0-9a-f-]+)\/annotate/i)?.[1] ?? null
      return topicId ? `topic=${topicId}` : '已进入作答页'
    })

    // ── 4. 作答:4 个必填评分(single-select,取末位)+ 一句话总评 ─────
    await step(page, '作答(填必填项)', async () => {
      // 等表单渲染 + 让挂载时的「草稿恢复」副作用先 settle(否则它会异步覆盖我填的值)。
      await page
        .locator('label.ts-13', { hasText: /相关性|准确性|格式|安全/ })
        .first()
        .waitFor({ timeout: 20_000 })
      await page.waitForTimeout(1200)

      // FormRenderer 的字段 label 是 sibling(无 htmlFor),getByLabel 抓不到 →
      // 按字段 label 文本定位 → 上钻到 wrapper div → 操作其中的原生控件。
      // 评分 radio 与总评 text 都是【受控】组件:点/填某个会触发整表 re-render,
      // onChange 没落地的字段会被 React 回滚。→ 统一多趟收敛,直到 5 个都复核通过。
      const ratingRe = [/相关性/, /准确性/, /格式/, /安全/]
      const sumRe = /一句话总评|总评|summary/i
      const SUMMARY = 'doctor 深度体检:回答清晰、准确、合规。'
      const radio5For = (re: RegExp) =>
        page.locator('label.ts-13', { hasText: re }).first().locator('xpath=..').locator('input[type="radio"][value="5"]').first()
      const opt5For = (re: RegExp) =>
        page.locator('label.ts-13', { hasText: re }).first().locator('xpath=..').locator('label', { hasText: /^\s*5\s*$/ }).first()
      const sumInput = () =>
        page.locator('label.ts-13', { hasText: sumRe }).first().locator('xpath=..').locator('input[type="text"], textarea').first()

      let radiosOk = 0
      let sumOk = false
      for (let pass = 0; pass < 12; pass++) {
        radiosOk = 0
        for (const re of ratingRe) {
          const r5 = radio5For(re)
          if (!(await r5.count())) continue
          if (await r5.isChecked().catch(() => false)) {
            radiosOk++
            continue
          }
          const o5 = opt5For(re)
          if (await o5.count()) await o5.click({ force: true }).catch(() => {})
          else await r5.check({ force: true }).catch(() => {})
        }
        const si = sumInput()
        if (await si.count()) {
          sumOk = (await si.inputValue().catch(() => '')) === SUMMARY
          if (!sumOk) await si.fill(SUMMARY).catch(() => {})
        }
        if (radiosOk === ratingRe.length && sumOk) break
        await page.waitForTimeout(300)
      }
      // 终态复核
      radiosOk = (
        await Promise.all(ratingRe.map((re) => radio5For(re).isChecked().catch(() => false)))
      ).filter(Boolean).length
      sumOk = (await sumInput().inputValue().catch(() => '')) === SUMMARY
      const filled = radiosOk + (sumOk ? 1 : 0)
      if (filled < 5) throw new Error(`必填项只填上 ${filled}/5(评分 ${radiosOk}/4、总评 ${sumOk})`)
      return `已填 ${filled} 个必填字段`
    })

    // ── 5. 提交 ────────────────────────────────────────────────────
    const submitted = await step(page, '提交标注', async () => {
      const btn = page.getByRole('button', { name: /^submit annotation$|提交标注|^提交$/i }).first()
      await expect(btn).toBeVisible({ timeout: 10_000 })
      const submittedFrom = topicId
      await btn.click()
      // 提交成功后两种合法去向(after-submit-nav.ts):
      //   a) auto-next:还有可作答题 → push 到【下一题】的 /annotate
      //   b) 无下一题 → push 到 /my/tasks/<taskId>
      // prod 上含 autosave flush + 异步预审,较慢(实测 >15s),给 40s。
      try {
        await page.waitForURL(
          (u) =>
            /\/my\/tasks\//.test(u.pathname) ||
            (/\/annotate$/.test(u.pathname) &&
              (!submittedFrom || !u.pathname.includes(submittedFrom))),
          { timeout: 40_000 },
        )
        return /\/my\/tasks\//.test(page.url())
          ? 'drafting → submitted(回 my-tasks)'
          : 'drafting → submitted(auto-next 已跳下一题)'
      } catch {
        // 未跳转:先 count() 再读,避免不存在时 30s 自动等待拖垮整测预算。
        let msg = '(无可识别错误文本)'
        const errDiv = page.locator('div.rounded.p-2.ts-12').filter({ hasNotText: /AI assist/i }).first()
        if (await errDiv.count()) msg = (await errDiv.innerText().catch(() => '')) || msg
        throw new Error('提交未跳转;页面提示: ' + msg.replace(/\s+/g, ' ').slice(0, 180))
      }
    })

    // ── 6. 审核通过(同一 admin 终审自己的提交;单段任务 + admin 自审合法) ─
    // 提交后可能有 AI 预审在途(topic=ai_review 时无人工按钮),所以轮询:
    // 反复进 /review 队列 → 打开详情 → 等「终审通过·入库」出现(最多 ~100s)。
    let approved = false
    if (submitted) {
      approved = await step(page, '审核通过(admin 终审)', async () => {
        for (let i = 0; i < 10; i++) {
          await page.goto('/review')
          const link = page.locator('a[href^="/review/"]').first()
          if (await link.count()) {
            await link.click()
            await page.waitForURL(/\/review\//, { timeout: 15_000 })
            const accept = page
              .getByRole('button', { name: /终审通过|入库|^accept$|^approve/i })
              .first()
            if (await accept.isVisible().catch(() => false)) {
              await accept.click()
              await page
                .getByText(/accepted|approved|已通过|已入库|locked for payout/i)
                .first()
                .waitFor({ timeout: 15_000 })
              return '→ approved(admin 终审入库)'
            }
            // 无按钮:多半 AI 预审在途(ai_review)或页面未就绪 → 退避重试。
          }
          await page.waitForTimeout(10_000)
        }
        throw new Error(
          '100s 内未能完成终审:/review 队列无行,或详情页一直没有「终审通过」按钮(AI 预审卡住?任务仍是两段?自审按钮未放行?)',
        )
      })
    }

    // ── 7. payout 断言(UI):approve 后异步生成 line item → 自己的 /my/earnings
    if (approved) {
      await step(page, 'payout 生成(/my/earnings,关 #7)', async () => {
        // billing 订阅异步落 payout_line_item;轮询刷新 earnings 页直到出现 Pending 金额。
        for (let i = 0; i < 10; i++) {
          await page.goto('/my/earnings')
          // 待结算区出现非零金额 / 或 approved 贡献计数 ≥1 即视为钱路通。
          const pending = page.getByText(/pending|待结算|待发放|approved|已通过/i)
          if (await pending.count()) {
            const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
            // 形如 ¥0.05 / 5 fen / CNY 5 等任意正向金额或 "approved 1"
            if (/(¥|cny|usd|\$)\s?\d|[\d,]+\s*(分|fen|minor)|approved[^\d]{0,8}[1-9]|已通过[^\d]{0,8}[1-9]/i.test(body)) {
              return '/my/earnings 出现 payout/approved 正向信号'
            }
          }
          await page.waitForTimeout(2000)
        }
        throw new Error('approve 后 20s 内 /my/earnings 未出现 payout/approved 正向信号(billing 订阅未触发?或页面 DOM 与匹配不符,请人工核对 Pending 区)')
      })
    }

    // ── 8. 导出台可达 ──────────────────────────────────────────────
    await step(page, '导出台可达 (/admin/exports)', async () => {
      await page.goto('/admin/exports')
      await expect(page.locator('body')).toContainText(/export|format|download|job|交付|导出|no .*yet/i)
      return '导出台渲染正常'
    })

    writeFileSync(RESULT_FILE, JSON.stringify({ steps, screenshotDir: SHOT_DIR }, null, 2), 'utf8')

    const failed = steps.filter((s) => !s.ok)
    expect(failed, `失败步骤:${failed.map((s) => s.label).join(', ')}`).toHaveLength(0)
  })
})

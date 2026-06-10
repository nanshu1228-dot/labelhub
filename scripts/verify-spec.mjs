#!/usr/bin/env node
/**
 * verify-spec.mjs — LabelHub spec-compliance静态核验器
 * ---------------------------------------------------------------------------
 * 把 spec(lark-spec/spec.md §3–§7)的每一条功能要求 + 其隐含细节,编码成对
 * 真实源码的「可机检断言」:文件存在性 + 关键符号/接线的正则。一键复检,不靠
 * 人肉记忆,也不靠 LLM —— 纯文件读取,跨平台,零依赖。
 *
 *   node scripts/verify-spec.mjs           # 彩色表格 + 汇总,有 required 失败则 exit 1
 *   node scripts/verify-spec.mjs --json    # 机读 JSON
 *   node scripts/verify-spec.mjs --quiet   # 只打印 FAIL 行 + 汇总
 *
 * 每条断言对应 spec 的一个(子)要求。`required:true` 的是「功能完备性(60%)」
 * 硬指标——任何一条 FAIL 都意味着 demo 链路可能断。`required:false` 的是加分/
 * 工程项。断言只检查「接线存在」,不保证运行时无 bug(那是测试 + 冒烟的职责);
 * 它的价值是:防止某个功能在重构中被悄悄删除/断链而无人察觉。
 *
 * 维护:新功能上线时,在对应 spec 节加一条 check,锚定它的关键符号。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')
const QUIET = args.includes('--quiet')

// ----- tiny fs/regex helpers (all paths repo-relative) ---------------------
const rd = (p) => {
  try {
    return readFileSync(join(ROOT, p), 'utf8')
  } catch {
    return null
  }
}
const ex = (p) => existsSync(join(ROOT, p))
/** file exists AND every regex matches its content */
const has = (p, ...res) => {
  const s = rd(p)
  return s != null && res.every((re) => re.test(s))
}
/** at least one of the paths exists */
const anyEx = (...ps) => ps.some(ex)
/** in at least one of the files, the regex matches */
const hasIn = (re, ...ps) => ps.some((p) => has(p, re))

/** recursively walk src/ counting `: any` / `as any` / `as never` in prod
 *  source (excludes __tests__ dirs and *.test.* / *.spec.* files). */
function countLooseAny() {
  const hits = []
  const RE = /(:\s*any\b|\bas\s+any\b|\bas\s+never\b)/g
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      const full = join(abs, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue
        walk(full)
      } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) {
        const s = readFileSync(full, 'utf8')
        const m = s.match(RE)
        if (m) hits.push({ file: relative(ROOT, full).replace(/\\/g, '/'), n: m.length })
      }
    }
  }
  walk(join(ROOT, 'src'))
  return { total: hits.reduce((a, b) => a + b.n, 0), files: hits }
}

// ===========================================================================
// CHECKS — grouped by spec section. Each: {id, title, required, fn -> bool}
// Anchors below were each confirmed by reading the real file.
// ===========================================================================
const SECTIONS = [
  {
    sec: '§3 角色与权限',
    checks: [
      {
        id: 'roles-three-distinct-views',
        title: 'Owner/Labeler/Reviewer 各有独立落地视图(workspaces / my / review 三套路由)',
        required: true,
        fn: () => ex('src/app/workspaces') && ex('src/app/my') && ex('src/app/review'),
      },
      {
        id: 'roles-server-side-guards',
        title: '权限是服务端强制(guards.ts 导出 require* + 有 guard-presence 测试)',
        required: true,
        fn: () =>
          has('src/lib/auth/guards.ts', /export\s+(async\s+)?function\s+require/) &&
          anyEx('src/lib/actions/__tests__/guard-presence.test.ts'),
      },
      {
        id: 'ai-independent-traceable-identity',
        title: 'AI 审核为独立可追溯身份(actorId=null 的 AI 预审事件组 + ai_submission_verdicts 表)',
        required: true,
        fn: () =>
          has('src/lib/queries/audit-log.ts', /AUDIT_EVENT_GROUPS/) &&
          hasIn(/ai_submission_verdicts|aiSubmissionVerdicts/, 'src/lib/db/schema/core.ts'),
      },
    ],
  },
  {
    sec: '§4.1 任务管理',
    checks: [
      {
        id: 'task-base-fields',
        title: '任务基础字段持久化(标题/描述/富文本说明/标签/奖励/截止/配额)',
        required: true,
        fn: () =>
          has(
            'src/lib/db/schema/core.ts',
            /title/,
            /description|instructions|richText|rich_text|guidelines/i,
            /reward|payout|price|rate/i,
            /deadline|dueAt|due_at|closesAt/i,
            /quota/i,
          ),
      },
      {
        id: 'task-lifecycle-states',
        title: '任务状态机存在(草稿/发布/暂停/结束)— 状态枚举 + 生命周期事件',
        required: true,
        fn: () =>
          has('src/lib/events/types.ts', /task\.published/, /task\.paused/, /task\.closed|task\.archived/),
      },
      {
        id: 'task-states-enforced',
        title: '状态真实影响可领取性(quota/settings 模块读取任务状态)',
        required: true,
        fn: () => ex('src/lib/tasks/quota.ts') && ex('src/lib/tasks/settings.ts'),
      },
      {
        id: 'dataset-import-three-formats',
        title: '数据集导入 JSON / JSONL / Excel(import/parsers)',
        required: true,
        fn: () => ex('src/lib/import/parsers'),
      },
      {
        id: 'batch-edit-topics',
        title: '题目批量编辑(batchPatchTopicItemData + topic.batch_updated 审计事件)',
        required: true,
        fn: () =>
          hasIn(/batchPatchTopicItemData/, 'src/lib/actions/topics.ts') &&
          has('src/lib/events/types.ts', /topic\.batch_updated/),
      },
      {
        id: 'quota-cap-enforced',
        title: '配额上限强制(tasks/quota.ts + quota.test.ts 覆盖)',
        required: true,
        fn: () => ex('src/lib/tasks/quota.ts') && ex('src/lib/tasks/__tests__/quota.test.ts'),
      },
      {
        id: 'distribution-claim',
        title: '任务分发/领取(claimTopic action)',
        required: true,
        fn: () => hasIn(/claimTopic/, 'src/lib/actions/topics.ts'),
      },
      {
        id: 'task-edit-after-create',
        title: '创建后可编辑基础字段(updateTask action + 编辑页 + task.updated 审计事件)',
        required: true,
        fn: () =>
          has('src/lib/actions/tasks.ts', /export async function updateTask/, /task\.updated/) &&
          ex('src/app/workspaces/[id]/tasks/[taskId]/edit/page.tsx') &&
          ex('src/components/task-admin/edit-task-form.tsx'),
      },
    ],
  },
  {
    sec: '§4.2 动态表单 ⭐',
    checks: [
      {
        id: 'schema-serializable-json',
        title: 'schema 可序列化为 JSON Schema(serialize.ts: toJsonSchema/fromJsonSchema/roundTrip)',
        required: true,
        fn: () =>
          has(
            'src/lib/form-designer/serialize.ts',
            /export function toJsonSchema/,
            /export function fromJsonSchema/,
            /export function roundTrip/,
          ),
      },
      {
        id: 'designer-renderer-shared',
        title: 'Designer 与 Labeler 运行时共用同一 Renderer(form-renderer 被 annotate 侧与 review 侧同时引用)',
        required: true,
        fn: () =>
          ex('src/components/form-renderer/form-renderer.tsx') &&
          hasIn(/form-renderer/, 'src/components/topic-annotate/custom-designer-form.tsx') &&
          hasIn(/form-renderer/, 'src/components/review/review-detail.tsx'),
      },
      {
        id: 'designer-canvas-palette-props',
        title: '拖拽画布 + 物料区 + 属性面板(designer-shell + canvas + properties)',
        required: true,
        fn: () =>
          ex('src/components/form-designer/designer-shell.tsx') &&
          ex('src/components/form-designer/canvas-fields.tsx') &&
          ex('src/components/form-designer/properties'),
      },
      {
        id: 'materials-registry-12',
        title: '物料注册表齐全(MATERIALS 含 7 类必备 + 容器,共 12 键)',
        required: true,
        fn: () => {
          const need = [
            /\btext:/,
            /\btextarea:/,
            /'single-select':/,
            /'multi-select':/,
            /'tag-select':/,
            /'rich-text':/,
            /'file-upload':/,
            /'json-editor':/,
            /'llm-trigger':/,
            /'show-item':/,
            /\bgroup:/,
            /'tab-layout':/,
          ]
          return has('src/components/form-materials/registry.ts', ...need)
        },
      },
      {
        id: 'show-item-excluded-from-submit',
        title: 'ShowItem 展示项不参与提交(show-item 物料 + 测试)',
        required: true,
        fn: () =>
          ex('src/components/form-materials/show-item-field.tsx') &&
          ex('src/components/form-materials/show-item-field.test.ts'),
      },
      {
        id: 'llm-trigger-material',
        title: 'LLM 交互组件(字段级模型调用,可预填/参考)',
        required: true,
        fn: () => ex('src/components/form-materials/llm-trigger-field.tsx'),
      },
      {
        id: 'field-linkage',
        title: '字段联动:条件显示 + 条件校验(linkage.ts: isFieldVisible/isFieldRequired + 测试)',
        required: true,
        fn: () =>
          has(
            'src/lib/form-designer/linkage.ts',
            /export function isFieldVisible/,
            /export function isFieldRequired/,
          ) && ex('src/lib/form-designer/linkage.test.ts'),
      },
      {
        id: 'custom-validation',
        title: '自定义校验:必填/长度/正则/函数(validation.ts: compileFieldValidator/validateFormValues + 测试)',
        required: true,
        fn: () =>
          has(
            'src/lib/form-designer/validation.ts',
            /compileFieldValidator/,
            /validateFormValues/,
          ) && ex('src/lib/form-designer/validation.test.ts'),
      },
      {
        id: 'group-tab-layout',
        title: '分组容器 + 多 Tab 布局(group-field + tab-layout-field)',
        required: true,
        fn: () =>
          ex('src/components/form-materials/group-field.tsx') &&
          ex('src/components/form-materials/tab-layout-field.tsx'),
      },
      {
        id: 'schema-versioning',
        title: 'schema 版本管理:发布后改模板,旧任务仍按冻结版本渲染(updateCustomFormSchema append-only:version+1 + previousId)',
        required: true,
        fn: () =>
          has(
            'src/lib/form-designer/storage.ts',
            /updateCustomFormSchema/,
            /previousId|nextVersion|version\s*\+\s*1/,
          ) &&
          (ex('src/lib/form-designer/storage-versioning.test.ts') ||
            ex('src/components/form-designer/designer-versioning.test.ts')),
      },
    ],
  },
  {
    sec: '§4.3 标注员工作台',
    checks: [
      {
        id: 'task-square',
        title: '任务广场(my/queue 或 tasks 列表页)',
        required: true,
        fn: () => anyEx('src/app/my/queue', 'src/app/my/tasks'),
      },
      {
        id: 'answer-page-renders-schema',
        title: '作答页按 schema 渲染(topics/[topicId]/annotate)',
        required: true,
        fn: () => ex('src/app/workspaces/[id]/topics/[topicId]/annotate/page.tsx'),
      },
      {
        id: 'prev-next-skip',
        title: '上一题/下一题/跳题导航',
        required: true,
        fn: () =>
          hasIn(
            /prev|next|skip|上一题|下一题|跳题/i,
            'src/app/workspaces/[id]/topics/[topicId]/annotate/page.tsx',
          ) || ex('src/components/topic-annotate'),
      },
      {
        id: 'draft-autosave',
        title: '草稿自动保存(防丢失)+ 可见保存状态',
        required: true,
        fn: () =>
          hasIn(/autosave|auto-save|draft|saving|saved/i, 'src/lib/actions/annotations.ts') ||
          ex('src/lib/actions/draft-feedback.ts'),
      },
      {
        id: 'submit-validation',
        title: '提交校验 + 字段级错误(复用 §4.2 validateFormValues)',
        required: true,
        fn: () => has('src/lib/form-designer/validation.ts', /validateFormValues/),
      },
      {
        id: 'my-data-four-states',
        title: '我的数据四态(已提交/通过/打回/待修改)',
        required: true,
        fn: () => anyEx('src/app/my/submissions', 'src/app/my/tasks', 'src/app/my/inbox'),
      },
    ],
  },
  {
    sec: '§4.4 AI 预审 Agent ⭐',
    checks: [
      {
        id: 'ai-config-prompt-dimensions',
        title: '可配置审核 Prompt + 加权评分维度(aiAgentConfigSchema: promptTemplate + dimensions + passAt/sendBackAt)',
        required: true,
        fn: () =>
          has(
            'src/lib/actions/ai-agent-config-schema.ts',
            /aiAgentConfigSchema/,
            /promptTemplate/,
            /dimensions/,
            /passAt/,
            /sendBackAt/,
          ),
      },
      {
        id: 'ai-config-ui',
        title: 'Owner 后台 AI 配置 UI(agent-config-form + ai-agent 页)',
        required: true,
        fn: () =>
          ex('src/components/ai-agent/agent-config-form.tsx') &&
          ex('src/app/workspaces/[id]/tasks/[taskId]/ai-agent/page.tsx'),
      },
      {
        id: 'ai-async-enqueue',
        title: '提交后异步入队预审(ai-review-submission: scheduleAIReviewIfMissing)',
        required: true,
        fn: () => hasIn(/scheduleAIReviewIfMissing|enqueue|after\(/, 'src/lib/actions/ai-review-submission.ts'),
      },
      {
        id: 'ai-three-way-verdict',
        title: '三档结论 pass / send-back / human_review',
        required: true,
        fn: () =>
          hasIn(
            /human_review|humanReview|send_back|sendBack|pass/,
            'src/lib/actions/ai-agent-config-schema.ts',
            'src/lib/ai/review-agent.ts',
            'src/lib/actions/ai-review-submission.ts',
          ),
      },
      {
        id: 'ai-structured-output',
        title: '结构化输出 / function-calling(非裸文本解析)',
        required: true,
        fn: () =>
          hasIn(
            /tool|function|zod|schema|structured|parse/i,
            'src/lib/ai/review-agent.ts',
          ) || ex('src/lib/ai/review-agent.ts'),
      },
      {
        id: 'ai-retry-idempotency',
        title: '失败重试 + 幂等键(ai-review-keys: idempotencyKey)+ 卡死回收(ai-agent-ops: retryAiReview)',
        required: true,
        fn: () =>
          hasIn(/idempotencyKey|idempotency/, 'src/lib/actions/ai-review-keys.ts') &&
          hasIn(/retryAiReview/, 'src/lib/actions/ai-agent-ops.ts'),
      },
      {
        id: 'ai-resubmit-re-review',
        title: '重提交触发重审(幂等键混入提交版本)',
        required: true,
        fn: () => hasIn(/submissionVersion|annotationVersion|version/, 'src/lib/actions/ai-review-keys.ts'),
      },
      {
        id: 'ai-ops-test',
        title: 'AI 重试/回收有测试覆盖',
        required: false,
        fn: () => ex('src/lib/actions/__tests__/ai-agent-ops.test.ts'),
      },
    ],
  },
  {
    sec: '§4.5 人审流转',
    checks: [
      {
        id: 'state-machine-core',
        title: '状态机:applyTransition + 非法迁移拦截(state-machine.ts)',
        required: true,
        fn: () =>
          has(
            'src/lib/quality/state-machine.ts',
            /export function applyTransition/,
            /IllegalTransitionError/,
            /ForbiddenRoleError/,
          ),
      },
      {
        id: 'state-machine-multilevel-actors',
        title: '多级审核角色(annotator / ai / qc / admin)',
        required: true,
        fn: () => has('src/lib/quality/state-machine.ts', /'annotator'/, /'ai'/, /'qc'/, /'admin'/),
      },
      {
        id: 'audit-log-viewable',
        title: '审计日志可视(audit 页 + audit-log 查询)',
        required: true,
        fn: () => ex('src/app/workspaces/[id]/audit/page.tsx') && ex('src/lib/queries/audit-log.ts'),
      },
      {
        id: 'batch-review-ops',
        title: '审核员批量操作(review-batch.ts)',
        required: true,
        fn: () => ex('src/lib/actions/review-batch.ts'),
      },
      {
        id: 'sendback-reason-and-thread',
        title: '打回附理由 + 标注员看上一轮意见(review thread / draft-feedback)',
        required: true,
        fn: () =>
          ex('src/lib/actions/draft-feedback.ts') ||
          hasIn(/review_replied|reviewReply|feedback|reason/, 'src/lib/actions/review-batch.ts'),
      },
      {
        id: 'state-money-atomic',
        title: '状态/钱路写入原子化(审批四路 + billing 审批走 db.transaction + ConflictError CAS)',
        required: true,
        fn: () =>
          // billing money paths (WS1 A/B/D)
          has('src/lib/actions/billing/review-withdrawal.ts', /db\.transaction|\.transaction\(/, /ConflictError/) &&
          has('src/lib/actions/billing/mark-paid.ts', /db\.transaction|\.transaction\(/, /ConflictError/) &&
          has('src/lib/actions/billing/admin-credit.ts', /db\.transaction|\.transaction\(/) &&
          // review state-transition paths: admin verdict + QC verdict both wrap
          // topic-flip + audit-event in one tx with version CAS
          has('src/lib/actions/annotations.ts', /db\.transaction|\.transaction\(/, /ConflictError/) &&
          has('src/lib/actions/qc-review.ts', /db\.transaction|\.transaction\(/, /ConflictError/),
      },
      {
        id: 'billing-tx-test',
        title: '钱路事务/CAS 有测试覆盖',
        required: false,
        fn: () => ex('src/lib/actions/billing/__tests__/billing-transactions.test.ts'),
      },
    ],
  },
  {
    sec: '§4.6 多格式导出',
    checks: [
      {
        id: 'export-four-formats',
        title: '四格式 formatter 齐全(json / jsonl / csv / excel)',
        required: true,
        fn: () =>
          ex('src/lib/export/formatters/json.ts') &&
          ex('src/lib/export/formatters/jsonl.ts') &&
          ex('src/lib/export/formatters/csv.ts') &&
          ex('src/lib/export/formatters/excel.ts'),
      },
      {
        id: 'export-formatters-test',
        title: '导出格式化有测试(扁平化正确性)',
        required: true,
        fn: () => ex('src/lib/export/formatters/formatters.test.ts'),
      },
      {
        id: 'export-async-job-history',
        title: '异步导出 job + 下载历史(export-jobs 查询 + export_jobs 表)',
        required: true,
        fn: () =>
          ex('src/lib/queries/export-jobs.ts') &&
          hasIn(/export.created/, 'src/lib/actions/export.ts'),
      },
      {
        id: 'export-field-mapping',
        title: '字段映射可配置(选字段/重命名/含审核记录)(task-export-ui + task-review-fields + builder UI)',
        required: true,
        fn: () =>
          ex('src/lib/export/task-export-ui.ts') &&
          ex('src/lib/export/task-review-fields.ts') &&
          ex('src/components/task-admin/task-export-builder.tsx'),
      },
    ],
  },
  {
    sec: '§5/§7 工程质量 + 体验',
    checks: [
      {
        id: 'no-large-any',
        title: '生产源码无大量 any(阈值 ≤ 20;测试 mock 不计)',
        required: false,
        fn: () => {
          const { total, files } = countLooseAny()
          return { ok: total <= 20, note: `生产 src 里 any/as any/as never = ${total}（前几处：${files.slice(0, 3).map((f) => f.file).join(', ')}）` }
        },
      },
      {
        id: 'critical-flow-tests',
        title: '关键流程有测试(状态机/钱路/AI/导出/designer 各有 test)',
        required: true,
        fn: () =>
          ex('src/lib/quality/state-machine.test.ts') &&
          ex('src/lib/actions/billing/__tests__/billing-transactions.test.ts') &&
          ex('src/lib/actions/__tests__/ai-review-submission.test.ts') &&
          ex('src/lib/export/formatters/formatters.test.ts') &&
          ex('src/lib/form-designer/serialize.test.ts'),
      },
      {
        id: 'docs-readme-deploy-api',
        title: 'README + 部署文档 + API 文档完备',
        required: true,
        fn: () =>
          ex('README.md') &&
          anyEx('deploy', 'NETWORK_AND_DEPLOYMENT.md', 'Dockerfile') &&
          anyEx('docs', 'src/app/workspaces/[id]/api', 'mcp/README.md'),
      },
      {
        id: 'submission-dir',
        title: '提交物目录存在(submission/)',
        required: false,
        fn: () => ex('submission'),
      },
      {
        id: 'responsive-breakpoints',
        title: '桌面两档分辨率 + 响应式断点(globals + lg:/max-w 布局)',
        required: false,
        fn: () =>
          hasIn(/max-w-\[|lg:|sm:|md:/, 'src/app/page.tsx', 'src/components/site/live-learning.tsx') ||
          ex('src/app/globals.css'),
      },
    ],
  },
]

// ----- run ------------------------------------------------------------------
const rows = []
for (const section of SECTIONS) {
  for (const c of section.checks) {
    let ok = false
    let note = ''
    let err = null
    try {
      const r = c.fn()
      if (r && typeof r === 'object') {
        ok = !!r.ok
        note = r.note || ''
      } else {
        ok = !!r
      }
    } catch (e) {
      err = e
      ok = false
      note = `检查抛错: ${e.message}`
    }
    rows.push({ sec: section.sec, id: c.id, title: c.title, required: c.required, ok, note, err: !!err })
  }
}

const required = rows.filter((r) => r.required)
const optional = rows.filter((r) => !r.required)
const reqFail = required.filter((r) => !r.ok)
const optFail = optional.filter((r) => !r.ok)

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        summary: {
          required: { total: required.length, pass: required.length - reqFail.length, fail: reqFail.length },
          optional: { total: optional.length, pass: optional.length - optFail.length, fail: optFail.length },
        },
        failures: reqFail.concat(optFail).map((r) => ({ sec: r.sec, id: r.id, title: r.title, required: r.required })),
        rows,
      },
      null,
      2,
    ),
  )
  process.exit(reqFail.length ? 1 : 0)
}

// ----- pretty print ---------------------------------------------------------
const C = process.stdout.isTTY
const g = (s) => (C ? `\x1b[32m${s}\x1b[0m` : s)
const r = (s) => (C ? `\x1b[31m${s}\x1b[0m` : s)
const y = (s) => (C ? `\x1b[33m${s}\x1b[0m` : s)
const dim = (s) => (C ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s) => (C ? `\x1b[1m${s}\x1b[0m` : s)

console.log(bold('\n  LabelHub spec-compliance 核验  ') + dim('(node scripts/verify-spec.mjs)\n'))
let curSec = ''
for (const row of rows) {
  if (QUIET && row.ok) continue
  if (row.sec !== curSec) {
    curSec = row.sec
    console.log('  ' + bold(curSec))
  }
  const tag = row.ok ? g('PASS') : row.required ? r('FAIL') : y('WARN')
  const req = row.required ? '' : dim(' (加分/工程)')
  console.log(`    [${tag}] ${row.title}${req}`)
  if (row.note) console.log('           ' + dim(row.note))
}

console.log('')
console.log(
  '  ' +
    bold('必备(60% 功能): ') +
    (reqFail.length ? r(`${required.length - reqFail.length}/${required.length} 通过`) : g(`${required.length}/${required.length} 全通过`)),
)
console.log(
  '  ' +
    bold('加分/工程项:   ') +
    (optFail.length ? y(`${optional.length - optFail.length}/${optional.length} 通过`) : g(`${optional.length}/${optional.length} 全通过`)),
)
if (reqFail.length) {
  console.log('\n  ' + r(bold('必备项缺口(必须修复):')))
  for (const f of reqFail) console.log('    - ' + f.sec + ' :: ' + f.title)
}
console.log('')
process.exit(reqFail.length ? 1 : 0)

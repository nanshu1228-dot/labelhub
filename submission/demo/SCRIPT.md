# Demo video — shot-by-shot script (§8 deliverable)

**Target length: 7–8 min** (spec asks 5–10, covering the **three roles'**
complete workflows). Record against the **live deploy** (https://aipert.top)
after the latest `上线`, or a local `npm run build && npm start` on a fresh
`npm run seed:finals-demo`. Narration below is in 普通话; on-screen callouts in
[brackets]. Routes are exact — `[id]` / `[taskId]` are the seeded ids.

> Master reference for the click-path + expectations: `docs/DEMO.md` (the five
> hero flows). This script reorganizes them into the spec's 3-role narrative
> with timings + narration.

---

## Pre-flight (do BEFORE recording — not filmed)

1. `npm run seed:finals-demo`, sign up once at `/signup`, copy your UUID from
   `/account`, then `SEED_FINALS_ADMIN_ID=<uuid> npm run seed:finals-demo` so
   the demo workspace pivots to your identity.
2. Have a **second browser profile / incognito** signed in as a *labeler*
   member (so the role hand-off looks real, not the same account). The seed
   creates demo annotators — or invite one via `/workspaces/[id]/members`.
3. Screen at **1920×1080**, browser zoom 100%, hide the bookmarks bar.
4. Open these tabs in order so you never fumble for a URL on camera:
   `/workspaces/[id]` · `/workspaces/[id]/tasks/[taskId]` · `/review` ·
   `/workspaces/[id]/billing` · `/my/earnings`.
5. Do one silent dry-run end-to-end first (catch any seed/auth hiccup off-camera).

---

## 0:00–0:25 — Cold open (landing + one-line pitch)

- **[/]** the light-themed landing page.
- 旁白:"LabelHub 是一个数据标注平台——任务负责人拖拽搭建标注模板,标注员在线
  领取作答,AI Agent 自动预审,人工质检,最后导出训练就绪的数据集。一套引擎,
  三种角色,我用一条完整链路演示。"
- Click **Sign in** → land on the workspace cockpit **[/workspaces/[id]]**.
- 旁白:"这是工作区驾驶舱,所有模块都在这张图上。"

---

## 0:25–2:30 — 角色一:任务负责人 (Owner)

**A. 建任务 + 搭模板 (0:25–1:25)**
- **[/workspaces/[id]/tasks]** → **New task** → **[/workspaces/[id]/tasks/new]**.
- 旁白:"负责人先建任务。命名、选 `custom-designer` 模板——也就是自定义表单。"
- Open the **form designer**: drag in 1–2 fields (a text/rich-text field + a
  single-select or rating). Show the **left palette → canvas → right inspector**.
- 旁白:"标注页面是拖拽搭建的:左侧组件区、中间画布、右侧属性。文本、富文本、
  单/多选、文件、JSON 编辑器、LLM 触发、条件显隐——都是组件。Designer 和 Renderer
  通过一份 JSON Schema 解耦(这条边界是 ESLint 强制的)。" Create the task.

**B. 导入题目 (1:25–1:55)**
- On the task page **[/workspaces/[id]/tasks/[taskId]]** → **Import wizard**
  (→ `/admin/tasks/[taskId]/import`). Drop the seeded JSONL/Excel, **map columns**, confirm.
- 旁白:"题目支持 JSON / JSONL / Excel / CSV 导入,带列映射和预览。" Show the
  imported-count climbing. (Shortcut: the two seeded tasks are already imported.)

**C. 配 AI 审核 Agent (1:55–2:30)**
- **[/workspaces/[id]/tasks/[taskId]/ai-agent]** — show the rubric: weighted
  **dimensions** with anchors, **pass / send-back thresholds**, **samples**
  (self-consistency), and the **TASK SHAPE** selector.
- 旁白:"负责人配置 AI 预审的评分标准:加权维度、阈值、自一致采样次数。这个
  Agent 用 **function-calling** 强制结构化输出 verdict,先推理再打分。" Optionally
  hit **试运行 / Dry-run** to show a live verdict preview. Publish the task.

---

## 2:30–4:00 — 角色二:标注员 (Labeler)  *(switch to the labeler browser profile)*

- **[/my/queue]** — 旁白:"切换到标注员。任务广场列出可领取的题目。"
- (If bulk-claim shipped) select a few + **claim**; else open one topic.
- Open a topic → **annotate** (`/workspaces/[id]/topics/[topicId]/annotate`).
- 旁白:"标注员在线作答——这就是负责人刚搭的表单被 Renderer 渲染出来。"
- Fill the form. Pause ~2s, edit a field — show the **autosave** indicator.
- 旁白:"草稿自动保存(本地 IndexedDB + 服务端),断网或刷新都不丢。"
- Click **Submit**.
- 旁白:"提交。这一步把标注、题目状态、审计事件写在**一个数据库事务**里——
  要么全成,要么全不动。"
- (Optional 30s) the **trajectory loop**: `/workspaces/[id]/trajectories` →
  **Upload a trajectory** → paste JSON → **Upload & annotate** — 旁白:"也支持
  把 agent 轨迹抓进来标注自己的轨迹。"

---

## 4:00–5:30 — 角色三:AI 预审 + 人工质检 (AI + Reviewer/Admin)  *(back to the admin profile)*

- 旁白:"提交后,后台 AI Agent 异步预审——这是一条幂等的 after() 流水线。"
- **[/review]** — point at the **stage tabs(全部 / 待初审 / 待终审)**.
- 旁白:"质检台。这里是**两段人工审核**——对齐课题 9.3 的参考流程:先初审,
  再终审入库。队列按阶段筛选。" → open an item (→ `/review/[id]`).
- 旁白:"详情页顶部是**阶段步进条**:提交 → AI 预审 → 初审 → 终审 → 入库。
  AI 的 verdict(pass / send-back / human_review)、每个维度的打分、以及
  **原始 prompt 轨迹**都摆在提交内容旁边——可解释、可审计。"
- Show the **per-dimension scores + reasoning/evidence** + the provenance tiles
  (model / temperature / samples / confidence / latency).
- **Send back** one item: click **打回修订**, type a reason (required), confirm.
- 旁白:"打回必须填理由,题目回到标注员变成 revising。"
- **Two-stage accept** another: click **初审通过**(快捷键 Q)——状态进入
  *待终审*;then **终审通过·入库**(快捷键 A)。
- 旁白:"初审由质检完成,终审由管理员验收——状态机在服务端**强制**这个顺序,
  跳过初审直接终审会被拦截。管理员是质检的超集,演示里一个账号连点两步即可。
  批量操作同样分两段:在『待初审』选中多行批量通过是批量初审,切到『待终审』
  再批量通过才是入库。"
- 旁白:"终审通过即终态 approved——而通过会触发计费:给这条标注累计一笔 payout。
  注意:核心动作只是**派发一个 `annotation.approved` 领域事件**,计费网关在启动时
  订阅它——核心代码完全不依赖计费层(依赖反转,ESLint 锁死)。"

---

## 5:30–7:00 — 计费闭环 + 导出 (Owner/Admin)

**计费 (5:30–6:30)** — **[/workspaces/[id]/billing]**
- **Credit an account**: pick a member, enter amount + currency, **Credit**
  → 旁白:"管理员给账户充值,余额即时上涨(钱按整数最小单位存)。" (show the
  confirm dialog → 确认.)
- **[/my/earnings]** (labeler view): show the wallet balance + ledger.
  旁白:"标注员看到余额,发起提现申请。" → **withdraw →** request.
- Back to **billing → Withdrawal queue**: **Approve**(写负记账行,余额下降)→
  **Mark paid**(盖支付凭证,状态 paid)。旁白:"两步审批:批准→标记已付,
  全程记账可追溯,用户 inbox 收到通知。"

**导出 (6:30–7:00)** — task page **Export** builder
- Pick **JSON / JSONL / CSV / Excel**, field-map, download.
- 旁白:"最后导出训练就绪数据集,四种格式 + 字段映射。小文件直接流式下载,
  大文件(>5MB)走异步任务。" Show **/admin/exports**(+ the task page's
  Recent-exports pane if shipped)the job + status + download.

---

## 7:00–7:40 — Close (engineering one-liner)

- 旁白:"工程上:1109 个 vitest 测试 + Playwright e2e、`npm run lint` 0 问题、
  严格 TypeScript、ESLint 强制的模块边界、乐观锁 + 事务保护的状态机、事件溯源
  审计。一套引擎覆盖全部六个能力域。谢谢观看。"
- End on the cockpit or the ARCHITECTURE.md dependency diagram.

---

## Screenshot capture list (§8 — store under `submission/screenshots/`)

Capture these 8 frames at 1920×1080 (they double as the README/submission hero shots):

1. **designer.png** — the form designer: palette + canvas + inspector.
2. **renderer.png** — the labeler's answer form (Renderer) mid-annotation, autosave indicator visible.
3. **ai-agent-config.png** — the AI agent rubric (weighted dims + anchors + thresholds + TASK SHAPE).
4. **review.png** — `/review/[id]` with the AI verdict + per-dimension scores + provenance tiles.
5. **review-queue.png** — `/review` queue with AI-confidence chips + batch Accept.
6. **billing.png** — `/workspaces/[id]/billing` credit card + withdrawal queue.
7. **earnings.png** — `/my/earnings` wallet + ledger + withdrawal request.
8. **export.png** — the export builder (format + field mapping) and/or `/admin/exports` history.

Optional: **cockpit.png** (the workspace tile grid) and **architecture.png**
(the ARCHITECTURE.md mermaid dependency diagram) as title/closing cards.

---

## Notes for the recorder

- Keep narration calm + steady; ~135 words/min lands this at ~7.5 min.
- If a step is slow (AI verdict is async), pre-warm it off-camera or cut to it.
- **Deltas to expect on the current deployed build** (2026-06-10): the whole
  app now wears the white SaaS skin (white cards + soft shadows); the review
  flow is **two-stage by default**(初审 → 终审,见 4:00–5:30 段——这是唯一
  改变点击路径的变化:接受一条记录要点两次)。Older notes: focus-mode badge
  on the cockpit; empty-state card on a fresh Disputes page; confirm dialog
  before an admin credit; "Recent exports" pane on the task page.
- 若想单段直达(老流程),在任务编辑页取消勾选「两段人工审核」即可——但
  建议保留两段,这是 spec 9.3 的参考流程,是加分点。
- Record 1–2 extra seconds of idle on each screen so cuts aren't abrupt.

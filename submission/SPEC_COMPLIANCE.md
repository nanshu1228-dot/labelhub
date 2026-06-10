# LabelHub · Spec 符合性核验表

> 本表把课题 spec(§3–§7)的**每一条功能要求 + 其隐含细节**,逐条对照真实源码,给出
> 判定 + 证据(`file:line`)。判定不是自报,而是经两道独立核验:
>
> 1. **静态机检** —— `node scripts/verify-spec.mjs`(亦 `npm run verify:spec`):把每条要求
>    编码成对真实符号/接线的断言,一键复检。当前 **46/46 必备 + 5/5 工程项全通过**。
> 2. **多 agent 对抗式审计** —— 14 个需求簇各派 agent 实读代码取证,再对每个结论派独立
>    "反驳者"证伪(默认推定为空壳)。初次结果 **69 项:66 pass / 3 partial / 0 fail,0 项被推翻**;
>    随后修复了其中 2 个真实 partial(QC 路径原子性、任务创建后编辑),仅剩 1 个**非缺陷**的措辞型
>    partial(Designer/运行时 renderer 架构,见已知边界)。
>
> 验证日期:2026-06-04;**复检 2026-06-10(交稿日)**:四门禁全绿 —— vitest 106 文件 /
> 1109 用例 · lint 0 · `verify:spec` 46/46+5/5 · build exit 0。06-10 前新增并已核验:
> **两段人工审核(spec §9.3 初审→终审,默认开,状态机服务端强制)**、AI 辅助模板设计
> (Owner 描述→合法 FormSchema 预填画布)、标注端提交前 AI 快检(非阻断)、运营计费闭环
> (充值→余额→提现审批)。

---

## §3 角色与权限模型

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| Owner / Labeler / Reviewer 各有**独立落地视图** | ✅ | `app-shell/app-header.tsx:34-40,72-74` 角色感知导航(Tasks→`/my/tasks`、Review→`/review`、Admin→`/admin`),三套页面各自查询 |
| 权限**服务端强制**(改 URL 也越不了权,非仅隐藏菜单) | ✅ | `lib/auth/guards.ts:84-176` `requireWorkspaceAdmin/Member/QC`(`import 'server-only'`,读 `workspace_members.role`);先由资源解析出 workspace 再鉴权(防跨租户);测试 `auth/__tests__/role-guards.test.ts` 全角色矩阵 + `guard-presence.test.ts` "无静默未守护面" |
| AI 审核为**独立可追溯身份**(非伪装 user / 非匿名) | ✅ | `db/schema/core.ts:951-979` `ai_submission_verdicts` 表(每次评审一行,幂等键唯一索引);AI 预审事件 `actorId=null`(`audit-log.ts` `AUDIT_EVENT_GROUPS` 含 AI 组);review thread `reviewerRole` 区分 |

## §4.1 任务管理

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| 基础字段:标题/描述/富文本说明/标签/奖励/截止/配额**持久化+接线** | ✅ | `db/schema/core.ts:160-175`(title/description/rich-text/reward/deadline)+ `actions/tasks.ts:60-74`(tags/quota) |
| 发布下线**状态机**(草稿/发布/暂停/结束)**真实影响可见性** | ✅ | 枚举 `db/schema/enums.ts:27-33`;`actions/topics.ts:560-563` 领取按任务状态门控 |
| 数据集导入 **JSON / JSONL / Excel** + 脏数据容错 | ✅ | `lib/import/parsers/index.ts:15-26` 三解析器;`parsers/json.ts:27-67` 坏行可读报错 |
| **批量编辑**题目 + 审计事件 | ✅ | `actions/topics.ts:413-531` `batchPatchTopicItemData` → `topic.batch_updated` 事件 |
| 题目**预览**(发布前) | ✅ | `task-admin/import-wizard.tsx:427-488` |
| 分发策略(先到先得/指派/配额抢单)+ **配额上限强制** | ✅ | `lib/import/distribution.ts:47-65`;`lib/tasks/quota.ts:22-45` 上限校验 + `quota.test.ts` |
| 创建后**编辑基础字段**(改标题/描述/奖励/截止/标签/配额) | ✅ | `actions/tasks.ts` `updateTask`(事务 + `task.updated` 审计事件;不改 templateMode/范式/状态)+ 编辑页 `tasks/[taskId]/edit` + `edit-task-form.tsx` + `__tests__/update-task.test.ts` |

## §4.2 动态表单搭建 ⭐(第一关键能力)

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| 产物为**可序列化 JSON Schema** | ✅ | `form-designer/serialize.ts:280` `toJsonSchema`/`fromJsonSchema`/`roundTrip`(往返无损,有测试) |
| **同一份 schema** 既 Designer 预览也 Labeler 运行时渲染 | ✅(见注) | 单一 `FormSchema` + 单一物料注册表 `registry.ts:29-42` 驱动两端;Designer 用 `material.designerPreview`、运行时 `FormRenderer`→`material.runtimeRenderer`;边界由 `eslint.config.mjs:32-48` 强制。详见「已知边界 ②」 |
| 拖拽画布 + 物料区 + 属性面板 | ✅ | `form-designer/designer-shell.tsx:461-572`(dnd-kit 画布 + palette + properties) |
| **7+ 类物料**全部存在/注册/可渲染 | ✅ | `registry.ts:29-42` 共 **12** 键:text / textarea / single-select / multi-select / tag-select / rich-text / file-upload / json-editor / **llm-trigger** / **show-item** / group / tab-layout |
| ShowItem **不参与提交** | ✅ | `form-materials/show-item-field.tsx`(展示项,排除出提交/校验)+ `show-item-field.test.ts` |
| 字段**联动**:条件显示 + 条件校验(运行时求值) | ✅ | `form-designer/linkage.ts:93-122` `evaluatePredicate`/`isFieldVisible`/`isFieldRequired` + `linkage.test.ts` |
| **自定义校验**:必填/长度/正则/函数 | ✅ | `form-designer/schema.ts:83-98` 规则定义 → `validation.ts:83` `compileFieldValidator`(zod 编译) |
| **分组容器** + **多 Tab 布局** | ✅ | `group-field.tsx:27-76` / `tab-layout-field.tsx:22-140` |
| **schema 版本管理**:发布后改模板,旧任务按冻结版本渲染 | ✅ | `form-designer/storage.ts:94-164` `updateCustomFormSchema` append-only(新行 version+1 + previousId,旧行不可变)+ `storage-versioning.test.ts` |

## §4.3 标注员工作台

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| 任务广场:搜索/筛选/卡片 | ✅ | `app/my/tasks/page.tsx:244-283` |
| 作答页按 schema 渲染 | ✅ | `form-renderer/form-renderer.tsx:74-170` |
| 上一题/下一题/跳题**不丢答案** | ✅ | `labeler/topic-navigation-bar.tsx:17-85`(切题前 autosave) |
| **草稿自动保存** + 可见状态 + 刷新恢复 | ✅ | `topic-annotate/use-autosave-draft.ts:69-216`(debounce + saved 指示 + restore) |
| 提交校验 + **字段级**错误 | ✅ | `form-designer/validation.ts:153-245` `validateFormValues` 定位到具体字段 |
| 题目级 **LLM 辅助** | ✅ | `form-materials/llm-trigger-field.tsx:29-140` |
| 我的数据**四态**(已提交/通过/打回/待修改)+ 跳回修改 | ✅ | `app/my/submissions/page.tsx:113-149` |

## §4.4 AI 自动预审 Agent ⭐(第二关键能力)

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| Owner 可配置**审核 Prompt + 加权评分维度** | ✅ | `actions/ai-agent-config-schema.ts:13-46`(promptTemplate + dimensions[] + passAt/sendBackAt + samples 自一致);UI `ai-agent/agent-config-form.tsx` |
| 提交后**异步入队**(不阻塞提交) | ✅ | `actions/annotations.ts:503-507`(提交后调度,非同步等模型) |
| **三档结论** pass / send-back / human_review **真实路由** | ✅ | `actions/ai-review-submission.ts:433-453` |
| **按维度打分 + 解释**(可解释性) | ✅ | `lib/ai/review-agent.ts:73-108` 每维分数+理由 |
| **结构化输出 / function-calling**(非裸文本解析) | ✅ | `lib/ai/review-agent.ts:116-190`(schema 约束 + 解析兜底) |
| **失败重试 + 幂等 + 卡死回收** | ✅ | `review-agent.ts:713-734` 重试;`ai-review-keys.ts` 幂等键;`ai-agent-ops.ts` `retryAiReview`(含 stale-pending 回收) |
| **原始 Prompt 可存可查** | ✅ | `ai-review-submission.ts:64-74,400` |
| **重提交触发重审**(幂等键混入提交版本) | ✅ | `ai-review-keys.ts:16-43`(混入 `submissionVersion`) |

## §4.5 多角色人工审核流转

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| **多级**状态机(AI→QC/复审→admin 终审,含打回路径) | ✅ | `lib/quality/state-machine.ts:71-111` `applyTransition` + 非法迁移/越权拦截 |
| 所有迁移**可追溯**且**界面可看** | ✅ | 每次迁移写 `events`;`app/workspaces/[id]/audit/page.tsx` + `queries/audit-log.ts` 渲染 |
| 审核员**批量操作**(跳非法态 + 报告失败) | ✅ | `actions/review-batch.ts:85-119` |
| 打回**附理由** + 标注员看**上一轮(多轮)意见** | ✅ | `quality/review-feedback.ts:13-20`(强制理由)+ review thread 多轮 |
| 状态/钱路写入**原子化(事务 + 状态 CAS)** | ✅ | `submitAnnotation`/`reviewAnnotation`(`annotations.ts:413-484,657-688`)、`billing/approve-annotation.ts:207-277`、**`qc-review.ts:140-178`**(本轮补齐 QC 路径事务,与其余三路一致) |
| **两段人工审核**(spec §9.3 参考流程:初审→终审),服务端强制 | ✅ | `quality/state-machine.ts` `ReviewPolicy`/`isBlockedByPolicy`(twoStage 开启时禁止跳过初审直接 admin_accept,违规抛 `PolicyViolationError`)+ 任务级开关 `lib/tasks/settings.ts` `twoStageReview`(默认开)+ UI 显化(`review/stage-stepper.tsx` 步进条、队列 全部/待初审/待终审 筛选、`quality/stage-labels.ts` 中文阶段标签)+ 测试 `state-machine.test.ts`「two-stage review policy」9 例 / `review-annotation.test.ts` 闸门 3 例 |

## §4.6 多格式导出

| 要求(含隐含项) | 判定 | 证据 |
|---|---|---|
| **四格式** JSON/JSONL/CSV/Excel + 嵌套**扁平化** | ✅ | `export/formatters/{json,jsonl,csv,excel}.ts`(`index.ts:17-30`)+ `formatters.test.ts` |
| **异步 job + 下载历史 + 进度** | ✅ | `db/schema/core.ts:989-1011` export_jobs 表;`queries/export-jobs.ts` 历史;`export.created` 审计事件 |
| **字段映射**:选字段/重命名/含审核记录,且输出随之变 | ✅ | `task-admin/task-export-builder.tsx:55-178` + `export/task-export-ui.ts` + `task-review-fields.ts` |
| 只导出**已入库/通过**(草稿不入训练集) | ✅ | `actions/dataset-versions.ts:112-148`(冻结 approved 清单) |

## §5 / §7 工程质量(25%)+ 产品体验(15%)

| 要求 | 判定 | 证据 |
|---|---|---|
| TypeScript 类型完整,**无大量 any** | ✅ | 生产 `src` 内 `any/as any/as never` 共 **8** 处(测试 mock 不计)— `verify:spec` 阈值 ≤20 |
| 关键流程有**单测/集成测试** | ✅ | 状态机 `state-machine.test.ts`、钱路 `billing-transactions.test.ts`、AI `ai-review-submission.test.ts`、导出 `formatters.test.ts`、designer `serialize.test.ts`(共 106 文件 / 1109 用例) |
| README + 部署文档 + API 文档完备 | ✅ | `README.md`、`deploy/` + `NETWORK_AND_DEPLOYMENT.md` + `Dockerfile`、`docs/` + `/workspaces/[id]/api` + `mcp/README.md` |
| **1280×800 / 1920×1080** 表现 + 响应式 | ✅ | 全站 `max-w-[1280px]`/`lg:` 布局;移动端加分:earnings 四表横向滚动、任务卡堆叠等 |

---

## 已知边界(诚实声明)

**Designer 预览与运行时不共用同一个 `FormRenderer` 挂载(按设计如此,非缺陷)。** spec 要求"同一份 schema 两处渲染"
——这一点**满足**:唯一的 `FormSchema` + 唯一物料注册表 `registry.ts` 驱动两端,校验/联动引擎
(`lib/form-designer/{linkage,validation}`)两端共用。差异在于 Designer 画布渲染 `material.designerPreview`
(可编辑/可拖拽形态),运行时 `FormRenderer` 渲染 `material.runtimeRenderer`(作答形态)——一个 `Material`
同时携带两种渲染器(`form-materials/types.ts:83-85`)。这是**有意的解耦**:`eslint.config.mjs:32-48` 用
`no-restricted-imports` 禁止 `form-renderer` 反向依赖 `form-designer`,`form-renderer.test.tsx` 以源码字节断言
零越界 import。因此"同一 schema、同一物料、同一校验"成立,只是不是字面同一个组件实例。

---

## 如何复检

```bash
npm run verify:spec     # 静态符合性核验(46/46 必备 + 5/5 工程项)
npm run verify:spec -- --json   # 机读
npm test                # 106 文件 / 1109 用例
npm run lint            # 0 问题
npm run build           # typecheck,exit 0
```

`scripts/verify-spec.mjs` 是自包含、零依赖的 Node 脚本:每条 spec 要求 → 一条对真实符号/文件/接线的
断言。功能在重构中被删除/断链会立刻 FAIL,作为防回归底线。

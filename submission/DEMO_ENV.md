# 演示环境说明(spec §8 第 5 项)

> 评委可直接访问的线上环境 + 现成账号 + 10 分钟上手路径。
> 所有凭据均为演示专用账号,与任何真实用户无关。

## 环境

| 项 | 值 |
|---|---|
| **线上地址** | **https://aipert.top** |
| 部署形态 | 自托管 VPS(阿里云北京,Next.js standalone + 本地 Postgres + systemd + nginx),细节见 [`../NETWORK_AND_DEPLOYMENT.md`](../NETWORK_AND_DEPLOYMENT.md) |
| 健康检查 | `https://aipert.top/api/health`(应返回 `status=ok db=ok`) |
| AI 预审模型 | DeepSeek(function-calling 结构化输出;一条提交的预审约 10–20 秒) |

## 演示账号

| 账号 | 密码 | 角色 | 适合体验 |
|---|---|---|---|
| `judge@aipert.top` | `LabelHub2026!` | **admin**(Owner + Reviewer 视角) | 建任务/搭模板/配 AI/审核/计费/导出 |
| `labeler@labelhub.demo` | `Labeler2026!` | **annotator**(标注员视角) | 任务广场领题/作答/自动保存/提交/看打回 |

两个账号都已在演示工作区 **「Finals Demo · Annotation Workbench」** 内,登录后即见。
建议用两个浏览器窗口(一普通一无痕)分别登录,体验角色交接。

## 10 分钟评审路径

1. **admin** 登录 → 工作区驾驶舱:
   `https://aipert.top/workspaces/c149ecf9-99fd-5adc-9a5e-1418f23d0e89`
2. **拖拽设计器**(左物料/中画布/右属性,产物为可序列化 JSON Schema):
   `https://aipert.top/admin/forms/72a43297-8246-5063-a973-74604b672af1`
3. **AI 审核 Agent 配置**(加权维度 + 阈值 + 自一致采样 + 试运行):
   任务页 → AI agent,或直达
   `https://aipert.top/workspaces/c149ecf9-99fd-5adc-9a5e-1418f23d0e89/tasks/de616cde-aecd-5219-8e83-655ddd83a8f7/ai-agent`
4. **labeler** 登录(无痕窗口)→ `https://aipert.top/my/queue` 领题 → 作答
   (注意自动保存指示)→ 提交 → 自动进入下一题并提示「上一题已提交」。
5. 回 **admin** → `https://aipert.top/review`:约 15 秒后可见 AI verdict
   (逐维分数 + 证据 + 原始 prompt 轨迹)。打开详情:顶部是**两段审核步进条**
   (提交 → AI 预审 → 初审 → 终审 → 入库,对齐课题 §9.3)——
   点「初审通过」(快捷键 Q)再点「终审通过 · 入库」(A);打回则必须填理由。
6. **计费闭环**:`…/billing` 给标注员充值 → labeler 在 `https://aipert.top/my/earnings`
   看到余额并发起提现 → admin 在 billing 队列 批准 → 标记已付,全程台账可查。
7. **导出**:任务页底部 Export 构建器,JSON / JSONL / CSV / Excel 四格式 +
   字段映射(选字段/重命名/含审核记录);历史在 `https://aipert.top/admin/exports`。

更完整的五条主线点击路径见 [`../docs/DEMO.md`](../docs/DEMO.md)。

## 注意事项

- 演示工作区数据可随意操作(领题/提交/审核/充值都行),不影响系统其它部分;
  题库共 30 + 12 道,耗尽可由 admin 通过导入向导补充。
- AI 预审为异步流水线:提交后回到审核队列稍等即可;若某条卡在 pending,
  详情页有「重试」入口(幂等,不会重复扣配额)。
- 两段审核是任务级开关(任务编辑页「两段人工审核」),默认开;
  关闭后管理员可单段直接验收。
- 本地一键起站(自带 Docker Postgres):见 [`../README.md`](../README.md) Quickstart;
  健康体检:`npm run doctor`(对线上)/ `npm run doctor -- --deep`(全链路)。

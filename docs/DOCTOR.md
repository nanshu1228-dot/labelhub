# `npm run doctor` — 流程体检(flow health-check)

一条命令、一张总览,看清**每条业务流程通不通、有没有 bug**。三层,缺哪层就**醒目跳过(SKIP),绝不假绿**。

```bash
npm run doctor                 # 默认 target=prod(aipert.top):Tier 0 + Tier 1
npm run doctor -- --target local   # 打 http://localhost:3000(需先 npm run dev)
npm run doctor -- --target https://x.example   # 打任意部署
npm run doctor:deep            # 追加 Tier 2 全链路(需 Docker + .env.e2e)
npm run doctor -- --json       # 机读 JSON(CI/监控)
npm run doctor -- --quiet      # 只打印非 PASS 行 + 汇总
npm run doctor -- --allow-writes   # 允许写型探针(默认仅 local 跑)
```

退出码:任一 required 检查 FAIL → `1`,否则 `0`(SKIP/WARN 不致失败)。

---

## 三层各查什么

### Tier 0 · 静态接线(0 搭建)
复用 `scripts/verify-spec.mjs`:把 spec §3–§7 的每条功能 + 隐含项编码成对真实
源码的断言,只查「接线在不在」。防的是「某功能在重构里被悄悄删/断链而无人察觉」。

### Tier 1 · 实时 HTTP/健康探针(~15s,0 搭建,prod/local 通用)
纯 `fetch`,**对 prod 严格只读**(写型探针仅 `local` 或 `--allow-writes`):
- `GET /api/health` → DB 存活/延迟;有 `HEALTH_DETAILED_TOKEN` 再解锁 5min 错误率·p95·版本。
- 公共页 `/`、`/signin`、`/docs`、未知路由 → 200/404 且渲染正常(免浏览器版 public-smoke)。
- `GET /api/demo/info` → 取公开 demo bearer key。
- 持 demo key 读客户 API:`/api/annotations`、`/api/trajectories`、`/api/quality/summary` → 200。
  - 若三者全 401,doctor 会诊断为「`settings.demoApiKey` 与 `workspace_api_keys` 失同步」,
    并提示在 VPS 上 `DATABASE_URL=… npx tsx scripts/debug/seed-demo-key.ts` 重铸。

### Tier 2 · 深度全链路(`--deep`,对【真实服务器】+【隔离 smoke 工作区】跑)
整站(应用 + Postgres + 鉴权)都在服务器上、服务器 DB 不对外开放,所以深度层用
Playwright **远程模式直打线上**(默认 aipert.top),用一个**专门的 smoke admin**
登录,只在一个**隔离 smoke 工作区**里跑:**登录 → 领取 → 作答 → 提交 →
(AI 预审)→ admin 通过 → payout 在该 admin 自己的 /my/earnings 页面(UI)断言
→ 导出**,逐步硬断言 + 截图(`e2e/__screenshots__/doctor/`)。
- **无需 Docker、无需连服务器 DB、无需 service-role**。
- 数据只落**隔离 smoke 工作区**,绝不碰 demo 数据。
- 同一个 smoke admin 既作答又审批——`reviewAnnotation` 允许 admin 审自己的提交
  (`annotations.ts:690`),故 payout 落在该 admin 自己的 `/my/earnings`。
- 顺带**自动化关掉「审批一条标注→确认生成 payout」的人工冒烟(#7)**。

#### 跑 Tier 2 的前置(一次性把 smoke 工作区备好)
1. 线上 `/signup` 注册一个 smoke admin(只让它属于 smoke 工作区)。
2. 登录后新建一个工作区(如 “SMOKE · doctor”),记下它的 uuid;在其中建一个任务、
   导入几条题目并发布(留出可领取题目)。
3. `cp .env.e2e.example .env.e2e`,填 `E2E_ADMIN_EMAIL/PASSWORD` + `E2E_SMOKE_WORKSPACE_ID`。
4. `npm run doctor:deep`(题目被领取/审批会消耗,题少时再导入几条)。

缺 `.env.e2e` 凭据 → **醒目 SKIP** 并指明缺哪个 env(绝不假绿)。首跑可能需按你
真实 UI 微调选择器——每步独立 try/catch + 截图,断哪步会精确告诉你。

---

## 设计取舍
- 平台原有检测面零散(verify-spec / public-smoke / annotation-lifecycle / security:smoke /
  test:customer-api / `/api/health` / labelhub-debug MCP),doctor 把它们整合成**一张总览**,
  并补深最弱一环(原 `annotation-lifecycle.spec.ts` 很浅且无凭据时静默跳过)。
- owner→labeler→reviewer→payout 全链路是 Supabase cookie 鉴权 + server action,**脚本调不到**,
  故深度层走浏览器(Playwright);便利的 HTTP/健康/客户 API 切片则零搭建直打 live。

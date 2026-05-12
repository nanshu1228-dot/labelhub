# Infrastructure & Portability

> **Design principle**: LabelHub couples to specific providers only at well-defined seams. Business logic, schema, and Server Actions are provider-agnostic. When a sponsor offers servers, we swap providers without rewriting features.

## Current providers (MVP)

| 关切 | 选型 | 为什么 | 锁定层 | 自建/替代成本 |
|---|---|---|---|---|
| **PostgreSQL** | Supabase 托管 PG 17 | 免费 tier + 自带 PgBouncer + UI 表编辑 | 0% — Drizzle + postgres-js 跟任何 PG 都跑 | **改 `DATABASE_URL` 一行** |
| **Auth** | Supabase Auth via `@supabase/ssr` | Cookies 自动处理 + Next 16 async cookies 兼容 | ⚠️ 中等 — 3 个文件直接调 | 改 3 个文件，~半天 |
| **AI / LLM** | Anthropic Claude API | Sonnet/Haiku/Opus 三档 + prompt caching + tool use | ⚠️ 中等 — 4 个文件直接调 SDK | 改 4 个文件，~半天 |
| **Object Storage** | _未启用_ | — | — | — |
| **Email / SMS** | _未启用_ | — | — | — |
| **Realtime** | _未启用_ | — | — | — |
| **Job Queue** | _未启用_ | — | — | — |

## 设计层面已经 portable 的

这些组件**不依赖任何特定 provider**——业务逻辑独立：

| 层 | 实现 | 为什么是 portable 的 |
|---|---|---|
| Schema | 17 张表用标准 PostgreSQL | 没用 Supabase 特有扩展（pg_jsonschema / pgmq / 等） |
| 查询 | Drizzle ORM | 任何 PG 都跑 |
| 业务逻辑 | Server Actions / 守卫 / 投影器 | Next.js 原生，无 vendor SDK |
| 适配层 | `lib/trajectories/adapters/*` | Anthropic / OpenAI / canonical 已经多适配 |
| API key 体系 | 我们自己的 `workspace_api_keys` 表 | 不依赖 Supabase Auth |
| Audit log | 我们自己的 `api_request_log` 表 | 同上 |
| Trust score | 我们自己的 `trust_scores` + projector | 完全独立 |
| Event sourcing | `events` 表 + 纯函数投影器 | 独立 |

## Migration recipes

### 📦 替换 PostgreSQL provider

**选项**：Neon · Railway · Render · Fly.io · 自建 Postgres · AWS RDS · 阿里云 RDS …

**改动**：
```diff
# .env.local
- DATABASE_URL="postgresql://postgres.xxx:pwd@aws-0-xxx.pooler.supabase.com:6543/postgres"
+ DATABASE_URL="postgresql://user:pwd@your-pg-host:5432/labelhub"
```

注意事项：
- 如果新 provider **不用 PgBouncer transaction mode**，把 `lib/db/client.ts` 里 `postgres(url, { prepare: false })` 的 `prepare: false` 去掉（性能反而更好）
- 跑 `npm run db:push` 把 schema 复制到新 DB

### 🔐 替换 Auth provider

**选项**：Lucia · NextAuth (Auth.js) · Better Auth · Clerk · 自建 JWT · 自托管 Supabase

**接触面**（3 个文件 + 1 个 proxy 文件）：
```
src/lib/supabase/server.ts       # 替换为新 Auth client (server-side)
src/lib/supabase/client.ts       # 替换为新 Auth client (browser-side)  
src/lib/supabase/proxy.ts        # 替换 session refresh 逻辑
proxy.ts                         # 用新 provider 的 middleware
```

**业务代码不动**：`lib/auth/guards.ts` 的 `requireUser` / `requireWorkspaceAdmin` 接口契约不变，调用方（所有 Server Actions）零改动。

**典型 swap 流程**（以 Lucia 为例，半天内能完成）：
1. `npm install lucia oslo @lucia-auth/adapter-drizzle`
2. 把 `lib/supabase/*` 三个文件改名 → `lib/auth/providers/lucia/*`
3. 把 `supabase.auth.getUser()` 调用换成 Lucia 的 `lucia.validateSession()`
4. `lib/actions/auth.ts` 里的 `signIn/signUp/signOut` 换成 Lucia 等价物
5. 提交一个 PR，build + 4 个测试都过 = 完成

### 🤖 替换 AI / LLM provider

**选项**：OpenAI · Mistral · Google Gemini · 通义千问 · 自建 vLLM / SGLang

**接触面**（4 个文件）：
```
src/lib/ai/anthropic.ts          # 替换为新 SDK 的 lazy client
src/lib/ai/spec-generator.ts     # 适配新 SDK 的 messages.create / responses API
src/lib/ai/pair-suggester.ts     # 同上
src/lib/ai/agent-runtime.ts      # 适配 tool-use 格式（OpenAI tools / Gemini function_declarations / ...）
```

**保留不动**：
- `escape.ts`（prompt-injection 防御）
- `quota.ts`（成本控制）
- AI Server Actions (`actions/ai.ts`)

**国内场景**：建议直接换成通义千问 / 智谱 / Moonshot，Anthropic 国内访问需要 VPN。换法跟 OpenAI 类似——把 `messages.create` 调用换成对应 SDK。

### 📦 增加 Object Storage（未来）

**未启用**，但设计已就位：
- 数据库 `meta` 字段是 jsonb，可以放 S3 引用
- 未来 `lib/storage/` 抽象层接 R2 / S3 / MinIO / OSS

### 🚀 部署目标

设计上对部署平台中立：

| 平台 | 兼容性 | 注意 |
|---|---|---|
| **Vercel** | 🟢 一流 | Next.js 原产，零配置 |
| **Cloudflare Pages + Workers** | 🟡 需要 Node 兼容性 | Server Actions 用 Node runtime |
| **Self-hosted (Docker)** | 🟢 直接跑 | `next start` 即可 |
| **Fly.io / Railway / Render** | 🟢 都行 | 用各自的 Dockerfile / Procfile |
| **Kubernetes** | 🟢 Docker 兼容 | 准备 Helm chart 当国内 partner 提供集群时 |

`proxy.ts` 跑在 nodejs runtime（Next 16 默认），不依赖 Vercel Edge。

## 自建全栈（"全部自己来"）的拓扑

如果 sponsor 给一台 VM，最小可跑配置：

```
┌─────────────────────────────────────────────────┐
│ Linux VM (4 vCPU / 8 GB / 100 GB)                │
│ ┌──────────────┐  ┌─────────────────┐           │
│ │ PostgreSQL   │  │ Next.js (Docker) │           │
│ │ (Docker)     │←─│  next start      │           │
│ └──────────────┘  └────────┬─────────┘           │
│                            │ HTTPS                │
│                            ▼                      │
│                       Caddy / Nginx              │
└─────────────────────────────────────────────────┘
                            │
                            ▼
                       公网用户
```

需要的额外组件（替换 Supabase 的内置功能）：
- **Auth**: Lucia (DB-backed) / 自建 JWT
- **Email**: 国内 → 阿里云 DM；海外 → Resend / Postmark
- **Backups**: cron + pg_dump 到 S3 / OSS

预估成本：1 台中等 VM ~$30-50/月 (北美) 或 ¥150-300/月 (阿里云)。**不含 Anthropic token 费用**。

## 当 sponsor 提供基础设施时的迁移 checklist

按重要性排序：

1. ✅ DB：拿到新 PG 连接串 → 改 `.env.local` → `db:push` → 备份+迁移老数据（pg_dump + psql）
2. ✅ Auth：决定继续 Supabase Auth（可以指向新数据库）还是切 Lucia/自建（按上面 recipe）
3. ✅ AI：决定继续走外部 API（账单转给 sponsor）还是改用国产模型 / 自建推理
4. ✅ 部署：Docker 化（Dockerfile 见后续 PR）→ 部署到 sponsor 的环境
5. ✅ 域名 + SSL：Caddy 自动 / 或 sponsor 提供的负载均衡器
6. ✅ Backups：cron pg_dump 起来
7. ✅ Monitoring：上 Sentry + UptimeRobot / Vercel Analytics
8. ✅ TOS / Privacy：把 `Eval-Run 数据归属` 条款重新审一遍（涉及数据所有权）

## 反例：我们故意没做的反 portable 设计

明确**没**做这些，保留迁移空间：

- ❌ Supabase RLS 作为唯一授权层 — 我们用服务端守卫做主，RLS 是 defense-in-depth（可选）
- ❌ Supabase Realtime 通道 — 不引入。需要实时时上 Postgres LISTEN/NOTIFY（PG 标准）
- ❌ Supabase Storage 写死 — 还没用；以后通过 `lib/storage` 抽象
- ❌ Supabase Edge Functions — 业务在 Next.js Server Actions / Route Handlers 里，框架原生
- ❌ Vercel-only API (KV / Postgres / Blob) — 没用，标准 Postgres 即可

## TL;DR

**今天能做的最大风险**：把所有 Auth 调用塞进 lib/auth/guards.ts 一层（已经做了）。  
**今天写下的最大保护**：env 走 lib/env.ts、Auth 走 guards.ts、AI 走 lib/ai/anthropic.ts —— 三个收口点，谁要换谁知道改哪。

迁移到 sponsor infra **最快 2 小时，最慢 1 天**（取决于要换几个 provider）。

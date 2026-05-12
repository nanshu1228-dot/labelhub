# LabelHub Setup

> 第一次跑起来需要 ~30 分钟（包括去注册账号的时间）。

## Prerequisites

| 工具 | 版本 | 检查命令 |
|---|---|---|
| Node | 20.9+ (推荐 22+) | `node -v` |
| npm | 11+ | `npm -v` |
| Git | 2.40+ | `git --version` |

## 第一步 · 安装依赖

```bash
cd D:\Challenge\labelhub
npm install
```

跑完应该看到 `node_modules/` 文件夹 + `package-lock.json`。

## 第二步 · 决定 providers

MVP 默认用：
- **Postgres**: Supabase 托管（免费 tier 够用）
- **Auth**: Supabase Auth
- **AI**: Anthropic Claude

🔁 想换？看 `INFRASTRUCTURE.md`，每个 provider 都有 swap recipe。**业务代码不用动**，只换适配层。

## 第三步 · 注册账号 + 拿 key

### 3.1 Supabase（建数据库）

1. 打开 https://supabase.com → 用 GitHub 登录
2. 点 **New Project**
3. 填：
   - **Name**: `labelhub`（随便）
   - **Database Password**: **设强密码并存起来**（这是 PG 的 root 密码，**拿不到第二次**）
   - **Region**: 离你近的（Tokyo / Singapore / Mumbai）
4. 等 ~2 分钟项目 provisioning 完成

### 3.2 Supabase → 拿 4 个值

进 Project Dashboard 后：

| 你要的字段 | 在哪 | 注意 |
|---|---|---|
| `DATABASE_URL` | Settings → **Database** → Connection string → **Transaction pooler** | **必须用 port 6543**（不是 5432，prepare=false 要求） |
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → **API** → Project URL | 长这样：`https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → **API** → Project API keys → **`anon` public** | 公开 key，进浏览器没事 |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → **API** → Project API keys → **`service_role`** | 🔒 **机密**！admin 权限，**绝不能进客户端** |

### 3.3 Anthropic（AI 调用）

1. https://console.anthropic.com/settings/keys
2. 点 **Create Key** → 起名 `labelhub-dev`
3. 复制 `sk-ant-xxxxxxxxx`

> 💡 如果你不想立刻调 AI，**这个 key 可以先不填**。代码全是 lazy，没有 key 时只是 AI 相关功能（Eval-Run / Spec Generator / Pair Suggester）会报错，其他都正常。

## 第四步 · 写 `.env.local`

在 `D:\Challenge\labelhub\` 目录下建文件 `.env.local`：

```bash
# ── Database (required) ──────────────────────────────────
DATABASE_URL="postgresql://postgres.PROJECT:PASSWORD@aws-0-xxx.pooler.supabase.com:6543/postgres"

# ── Auth provider (Supabase by default) ──────────────────
AUTH_PROVIDER="supabase"
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIs..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIs..."

# ── AI provider (Anthropic) ──────────────────────────────
AI_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxx"

# ── Quotas (optional, defaults work) ─────────────────────
AI_DAILY_LIMIT_PER_USER=100
```

> 🛡️ **`.env.local` 默认在 `.gitignore` 里**，不会进 git。绝对不要 `git add .env.local`。

## 第五步 · 推 schema 到数据库

```bash
npm run db:push
```

成功后去 Supabase Dashboard → Table Editor，能看到 **17 张表**：
- users · workspaces · tasks · topics · annotations
- events · gold_standards · trust_scores
- guidelines · guideline_patches · ai_call_log
- workspace_api_keys · api_request_log
- tool_providers · trajectories · trajectory_steps · step_annotations

## 第六步 · 启动 dev server

```bash
npm run dev
```

打开 http://localhost:3000 — 看到 LabelHub 落地页就成。

## 验证一切正常

```bash
npm run build   # 应该 0 errors
npm test        # 应该 4/4 passing
```

## 常见坑

| 症状 | 原因 | 修法 |
|---|---|---|
| `db:push` 卡住 | DATABASE_URL 用了错误的 port (5432) | 改成 transaction pooler 的 **6543** |
| `db:push` 报 `prepared statements not supported` | 同上 | 同上 |
| Build OK 但 `/workspaces/[id]` 显示 "Database not configured" | env 没填 / 重启 dev 没读到 | 改完 `.env.local` 重启 `npm run dev` |
| `Invalid credentials` 但密码对的 | Supabase Auth 默认要邮箱确认 | 项目 Authentication → Providers → Email → 关掉 "Confirm email"（仅 dev！） |
| `ANTHROPIC_API_KEY not set` | key 没填或 dev 没重启 | 同上 |

## Next steps

- [ ] 跑通后端 → 等 Claude Design 出 UI → 串起来
- [ ] 实测 Eval-Run：`POST /api/eval-runs` 用 curl / Insomnia
- [ ] 用 `@labelhub/trace` SDK（`src/sdk/labelhub-trace.ts`）做一次端到端示例

后续要换 provider（自建 PG / 自建 Auth / OpenAI）见 `INFRASTRUCTURE.md`。

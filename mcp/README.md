# LabelHub project MCP — `labelhub-debug`

A dev-only MCP server that lets Claude inspect LabelHub's server-side state
(captured trajectories, audit log, inferred tool providers) without spinning
through the browser. Complements — does not replace — the Chrome MCP, which
is still the right tool for clicking around the annotation UI.

## How to use

### 1. From Claude Code (recommended)

`.mcp.json` at the repo root registers this server. Restart Claude Code from
inside `D:\Challenge\labelhub` and the seven tools below appear under the
`labelhub-debug` namespace.

### 2. From the CLI

Each tool has a sibling script under `scripts/debug/` that mirrors its logic
and can be invoked directly:

```bash
tsx scripts/debug/dev-health.ts
tsx scripts/debug/proxy-call.ts --prompt "你是谁？"
tsx scripts/debug/list-trajectories.ts --limit 10
tsx scripts/debug/get-trajectory.ts --id <uuid>
tsx scripts/debug/tail-audit-log.ts --failures
tsx scripts/debug/reset-demo.ts --dry-run
tsx scripts/debug/eval-run-call.ts --system "..." --input "..." --cookie "..."
```

All scripts auto-load `.env.local` then `.env`, exactly like
`scripts/seed-demo.ts` and `scripts/bootstrap-demo.ts`.

### 3. Boot the MCP server standalone

```bash
npm run mcp
```

Writes a single `[labelhub-mcp] ready` line to stderr, then serves the MCP
protocol on stdio. Useful when wiring into other MCP clients (Cursor,
Inspector, etc.). Note: with no client attached it will sit idle waiting for
stdin frames — that's expected, just `Ctrl+C` to exit.

## Tools

| Tool | When to reach for it |
| --- | --- |
| `dev_health` | First call when something acts up — surfaces missing env vars, DB unreachable, dev server down, demo workspace not seeded. |
| `proxy_call` | Send a prompt through `/api/proxy/doubao/chat/completions` and confirm the trajectory + steps were captured. End-to-end smoke test of the Doubao ingest pipeline. |
| `list_trajectories` | Recent rows, filterable by `workspaceId`, `agentName`, `source`. |
| `get_trajectory` | Full row + every step (with resolved tool_provider names). Use after `list_trajectories` flags a row to drill into. |
| `tail_audit_log` | Last N entries from `api_request_log` — endpoint, status, error_code, duration. Filter by `failuresOnly` to chase 4xx/5xx. |
| `reset_demo` | Drop captured trajectories + inferred providers from the demo workspace. Preserves the workspace, tasks, declared providers, and API keys. Pass `dryRun: true` first. |
| `eval_run_call` | POST `/api/eval-runs` programmatically. Requires a Supabase session cookie (`cookie` field); for an unauth path use `proxy_call`. |

## Constraints

- Local-only. Trust boundary = local `DATABASE_URL` access. No per-tool auth.
- Demo workspace UUID: `00000000-0000-0000-0000-000000000010`.
- Demo admin UUID: `00000000-0000-0000-0000-000000000001`.
- `proxy_call` mints workspace API keys with the `debug-mcp-` name prefix so
  they're distinguishable from `bootstrap-` keys minted via `npm run bootstrap`.
- Cached API key lives in process memory only — a fresh `npm run mcp` mints
  one on its first `proxy_call`.

## Editing / extending

Hard cap of 7 tools by design. Tight scope > comprehensive coverage.

To change behavior, edit the `scripts/debug/<name>.ts` script — the `mcp/tools/*.ts`
file is a thin schema + wrapper that delegates to the same `run*` function the
CLI uses.

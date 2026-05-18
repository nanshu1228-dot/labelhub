import type { ToolProviderStats } from '@/lib/queries/tool-call-audit'

/**
 * Tool-providers audit lens (Phase-20) — server-rendered block on the
 * /analyze page. Surfaces "which upstream is making my agent slow /
 * expensive / flaky" in a single table.
 *
 * Empty state: shows when the workspace has captured trajectories but
 * none of them carry tool calls (e.g. pure chat agents). Not the same
 * as the analyze-level "no data" — that's gated above this block.
 */
export function ToolProvidersPanel({
  rows,
}: {
  rows: ToolProviderStats[]
}) {
  if (rows.length === 0) {
    return (
      <section>
        <div className="lbl mb-2" style={{ color: 'var(--mute)' }}>
          § TOOL PROVIDERS
        </div>
        <div
          className="rounded-md px-4 py-6 text-center ts-13"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line)',
            color: 'var(--mute2)',
          }}
        >
          No tool calls captured yet — agents in this workspace only
          chat (no MCP / function / CLI providers in the trace).
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="lbl mb-2" style={{ color: 'var(--mute)' }}>
        § TOOL PROVIDERS · failure / latency / cost
      </div>
      <div
        className="rounded-md overflow-hidden"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <table className="w-full ts-13">
          <thead>
            <tr
              style={{
                background: 'var(--panel2)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <th
                className="text-left px-4 py-2 mono ts-11"
                style={{ color: 'var(--mute)' }}
              >
                PROVIDER
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-right"
                style={{ color: 'var(--mute)', width: 70 }}
              >
                CALLS
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-right"
                style={{ color: 'var(--mute)', width: 100 }}
              >
                FAIL RATE
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-right"
                style={{ color: 'var(--mute)', width: 100 }}
              >
                p95 LATENCY
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-right"
                style={{ color: 'var(--mute)', width: 100 }}
              >
                TOKENS
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-right"
                style={{ color: 'var(--mute)', width: 100 }}
              >
                LAST USED
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.providerId}
                style={{
                  borderTop:
                    i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <td className="px-4 py-2">
                  <span
                    className="lh-mono lh-caption mr-2 px-1.5 py-0.5 rounded"
                    style={{
                      color: 'oklch(0.6 0.18 280)',
                      background: 'oklch(0.6 0.18 280 / 0.1)',
                      border: '1px solid oklch(0.6 0.18 280 / 0.3)',
                    }}
                  >
                    {r.kind}
                  </span>
                  <span
                    className="ts-13"
                    style={{ color: 'var(--text)' }}
                  >
                    {r.name}
                  </span>
                  <div
                    className="ts-11 mono mt-0.5"
                    style={{ color: 'var(--mute2)' }}
                  >
                    {r.identifier}
                  </div>
                </td>
                <td
                  className="px-4 py-2 mono ts-13 text-right"
                  style={{ color: 'var(--text)' }}
                >
                  {r.calls.toLocaleString()}
                </td>
                <td
                  className="px-4 py-2 mono ts-13 text-right"
                  style={{
                    color:
                      r.failureRate >= 0.2
                        ? 'var(--danger)'
                        : r.failureRate >= 0.05
                          ? 'oklch(0.55 0.14 75)'
                          : 'oklch(0.65 0.18 200)',
                    fontWeight: 600,
                  }}
                >
                  {(r.failureRate * 100).toFixed(0)}%
                </td>
                <td
                  className="px-4 py-2 mono ts-13 text-right"
                  style={{
                    color:
                      r.p95LatencyMs >= 2000
                        ? 'var(--danger)'
                        : r.p95LatencyMs >= 500
                          ? 'oklch(0.55 0.14 75)'
                          : 'var(--text)',
                  }}
                >
                  {r.p95LatencyMs > 0
                    ? `${formatMs(r.p95LatencyMs)}`
                    : '—'}
                </td>
                <td
                  className="px-4 py-2 mono ts-12 text-right"
                  style={{ color: 'var(--mute)' }}
                >
                  {(r.totalTokensIn + r.totalTokensOut > 0
                    ? formatTokens(r.totalTokensIn + r.totalTokensOut)
                    : '—'
                  ).toString()}
                </td>
                <td
                  className="px-4 py-2 mono ts-11 text-right"
                  style={{ color: 'var(--mute2)' }}
                >
                  {r.lastSeenAt
                    ? formatRel(r.lastSeenAt)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className="ts-11 mono mt-2"
        style={{ color: 'var(--mute2)' }}
      >
        Failure heuristic: tool_call without a matching tool_result,
        or whose result content carries an `error` field. Approximate —
        click into the trajectory for the exact step.
      </p>
    </section>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatRel(d: Date): string {
  const diff = Date.now() - new Date(d).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

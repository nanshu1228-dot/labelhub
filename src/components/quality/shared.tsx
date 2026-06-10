/**
 * Shared presentational bits for the /quality page sections.
 *
 * Extracted verbatim from the old monolithic quality page so the
 * leaderboard sections (calibration, trust, elapsed) can share the same
 * empty-state card, table chrome, and percentage rendering. Pure
 * server-renderable presentation — no hooks, no state.
 */

export function EmptyLeaderboardCard({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        {message}
      </p>
    </div>
  )
}

export function LeaderboardTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: Array<{ key: string; cells: React.ReactNode[] }>
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <table className="w-full ts-13">
        <thead
          style={{
            color: 'var(--mute2)',
            borderBottom: '1px solid var(--line)',
            fontSize: 11,
            fontFamily: 'var(--font-geist-mono), monospace',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left p-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.key}
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className="p-3"
                  style={{ color: i === 0 ? 'var(--hi)' : 'var(--text)' }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pct({
  value,
  tone,
}: {
  value: number
  tone: 'success' | 'default' | 'warn' | 'danger'
}) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--hi)'
  return (
    <span className="mono" style={{ color, fontWeight: 600 }}>
      {value}%
    </span>
  )
}

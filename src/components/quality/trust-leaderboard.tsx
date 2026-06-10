import Link from 'next/link'
import { type UserTrust } from '@/lib/queries/trust-consensus'
import { TrustBadge } from '@/components/quality/trust-badge'
import { SectionHeader } from '@/components/ui/section-header'
import { EmptyLeaderboardCard } from './shared'

// ─── Trust leaderboard ───────────────────────────────────────────────────

export function TrustLeaderboard({
  workspaceId,
  rows,
}: {
  workspaceId: string
  rows: UserTrust[]
}) {
  return (
    <section>
      <SectionHeader
        title="TRUST"
        hint={`${rows.length} rater${rows.length === 1 ? '' : 's'} · admin verdicts override peer consensus where available · click name to drill`}
      />
      {rows.length === 0 ? (
        <EmptyLeaderboardCard message="No annotation activity in this workspace yet." />
      ) : (
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
                <th className="text-left p-3">rater</th>
                <th className="text-left p-3">source</th>
                <th className="text-left p-3">badge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.userId}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="p-3">
                    <Link
                      href={`/workspaces/${workspaceId}/quality/raters/${r.userId}`}
                      className="hover:underline"
                      style={{
                        color: 'var(--hi)',
                        textDecoration: 'none',
                      }}
                    >
                      {r.displayName ?? r.userId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-3">
                    <SourceTag source={r.source} />
                  </td>
                  <td className="p-3">
                    <TrustBadge trust={r} viewerIsAdmin />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SourceTag({ source }: { source: 'admin' | 'peer' }) {
  const label = source === 'admin' ? 'admin verdict' : 'peer consensus'
  const tone =
    source === 'admin'
      ? {
          bg: 'var(--accent-soft)',
          fg: 'var(--accent)',
          bord: 'var(--accent-line)',
        }
      : {
          bg: 'var(--panel2)',
          fg: 'var(--mute)',
          bord: 'var(--line)',
        }
  return (
    <span
      className="mono ts-11"
      style={{
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.bord}`,
        padding: '2px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      }}
      title={
        source === 'admin'
          ? 'Score is derived from admin approval/rejection events — authoritative.'
          : 'Score is derived from median-of-other-raters agreement — preliminary, no admin verdicts yet.'
      }
    >
      {label}
    </span>
  )
}

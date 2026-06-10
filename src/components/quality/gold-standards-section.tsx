import Link from 'next/link'
import { type GoldStandardRow } from '@/lib/queries/gold-standards'
import { GoldBadge } from '@/components/quality/gold-badge'
import { SectionHeader } from '@/components/ui/section-header'

// ─── Gold standards section ──────────────────────────────────────────────

export function GoldStandardsSection({
  workspaceId,
  golds,
}: {
  workspaceId: string
  golds: GoldStandardRow[]
}) {
  return (
    <section>
      <SectionHeader
        title="GOLD STANDARDS"
        hint={`${golds.length} reference answer${golds.length === 1 ? '' : 's'} frozen`}
      />
      {golds.length === 0 ? (
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <p className="ts-13" style={{ color: 'var(--mute)' }}>
            No gold standards yet. To freeze a reference answer: annotate a
            trajectory yourself, then open it and click{' '}
            <strong style={{ color: 'var(--text)' }}>★ promote to gold</strong>.
            Every other rater&apos;s marks will be calibrated against it.
          </p>
        </div>
      ) : (
        <ul
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          {golds.map((g, idx) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 p-3"
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <GoldBadge size="sm" />
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${workspaceId}/trajectories/${g.trajectoryId}`}
                    className="ts-13 hover:underline trunc-1"
                    style={{ color: 'var(--hi)' }}
                  >
                    trajectory {g.trajectoryId.slice(0, 8)}…
                  </Link>
                  <div
                    className="mono ts-11 mt-0.5"
                    style={{ color: 'var(--mute2)' }}
                  >
                    promoted{' '}
                    {g.promotedAt.toISOString().slice(0, 10)} by{' '}
                    {g.promotedByDisplayName ?? g.promotedByUserId.slice(0, 8)}{' '}
                    · {g.rubricCount} mark{g.rubricCount === 1 ? '' : 's'} frozen
                  </div>
                </div>
              </div>
              <Link
                href={`/workspaces/${workspaceId}/trajectories/${g.trajectoryId}`}
                className="ts-12 mono"
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                open →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

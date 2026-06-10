import Link from 'next/link'
import { type CriticalViolation } from '@/lib/queries/critical-violations'
import { SectionHeader } from '@/components/ui/section-header'

// ─── Critical violations ─────────────────────────────────────────────────

export function CriticalViolationsSection({
  workspaceId,
  violations,
}: {
  workspaceId: string
  violations: CriticalViolation[]
}) {
  return (
    <section>
      <SectionHeader
        title="CRITICAL VIOLATIONS"
        hint={
          violations.length === 0
            ? 'no critical-rubric flags raised yet'
            : `${violations.length} flag${violations.length === 1 ? '' : 's'} — one bad rating on a critical rubric vetoes a trajectory's quality`
        }
      />
      {violations.length === 0 ? (
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <p className="ts-13" style={{ color: 'var(--mute)' }}>
            No critical-rubric flags. A rubric marked{' '}
            <strong style={{ color: 'var(--danger)' }}>severity: critical</strong>{' '}
            (e.g. <em>Safety</em>) raises a flag when a rater scores it the
            worst possible value — likert 1, bool false, or the last enum
            option. This is the closest LabelHub gets to a one-veto override.
          </p>
        </div>
      ) : (
        <ul
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--panel)',
            border: '1px solid oklch(0.55 0.2 25 / 0.4)',
          }}
        >
          {violations.slice(0, 12).map((v, idx) => (
            <li
              key={`${v.trajectoryId}-${v.rubricId}-${v.annotatorId}-${idx}`}
              className="flex items-center justify-between gap-3 p-3"
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="mono shrink-0"
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  🔥 {v.rubricName}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${workspaceId}/trajectories/${v.trajectoryId}`}
                    className="ts-13 hover:underline trunc-1"
                    style={{ color: 'var(--hi)' }}
                  >
                    {v.trajectoryAgentName}
                  </Link>
                  <div
                    className="mono ts-11 mt-0.5"
                    style={{ color: 'var(--mute2)' }}
                  >
                    flagged by{' '}
                    {v.annotatorDisplayName ?? v.annotatorId.slice(0, 8)} ·{' '}
                    {v.level === 'step'
                      ? `on step ${v.stepId?.slice(0, 8) ?? ''}…`
                      : 'trajectory-level'}
                  </div>
                </div>
              </div>
              <Link
                href={`/workspaces/${workspaceId}/trajectories/${v.trajectoryId}`}
                className="ts-12 mono shrink-0"
                style={{
                  color: 'var(--danger)',
                  textDecoration: 'none',
                }}
              >
                inspect →
              </Link>
            </li>
          ))}
          {violations.length > 12 && (
            <li
              className="p-3 ts-11 mono text-center"
              style={{
                color: 'var(--mute2)',
                borderTop: '1px solid var(--line)',
              }}
            >
              + {violations.length - 12} more
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

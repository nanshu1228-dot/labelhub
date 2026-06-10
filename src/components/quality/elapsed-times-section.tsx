import Link from 'next/link'
import {
  formatElapsed,
  type AnnotationTimeRow,
} from '@/lib/queries/annotation-time'
import { SectionHeader } from '@/components/ui/section-header'
import { EmptyLeaderboardCard } from './shared'

// ─── Elapsed times ───────────────────────────────────────────────────────

export function ElapsedTimesSection({
  workspaceId,
  times,
}: {
  workspaceId: string
  times: AnnotationTimeRow[]
}) {
  const flagged = times.filter((t) => t.flag === 'fast' || t.flag === 'slow')
  const shown = flagged.length > 0 ? flagged : times.slice(0, 8)
  return (
    <section>
      <SectionHeader
        title="ANNOTATION TIME"
        hint={
          times.length === 0
            ? 'no submitted annotations yet'
            : flagged.length > 0
              ? `${flagged.length} flagged · ${times.length} total`
              : `${times.length} submitted · no flags`
        }
      />
      {times.length === 0 ? (
        <EmptyLeaderboardCard message="No annotations have been submitted yet — once they are, wall-clock time will appear here." />
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
                <th className="text-left p-3">trajectory</th>
                <th className="text-left p-3">elapsed</th>
                <th className="text-left p-3">flag</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t, idx) => (
                <tr
                  key={t.annotationId}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="p-3" style={{ color: 'var(--hi)' }}>
                    {t.annotatorDisplayName ?? t.annotatorId.slice(0, 8)}
                  </td>
                  <td className="p-3">
                    {t.trajectoryId ? (
                      <Link
                        href={`/workspaces/${workspaceId}/trajectories/${t.trajectoryId}`}
                        className="ts-12 mono hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        {t.trajectoryAgentName ?? t.trajectoryId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
                        —
                      </span>
                    )}
                  </td>
                  <td className="p-3 mono" style={{ color: 'var(--text)' }}>
                    {formatElapsed(t.elapsedSeconds)}
                  </td>
                  <td className="p-3">
                    <TimeFlag flag={t.flag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {flagged.length === 0 && times.length > shown.length && (
            <div
              className="p-3 ts-11 mono text-center"
              style={{
                color: 'var(--mute2)',
                borderTop: '1px solid var(--line)',
              }}
            >
              + {times.length - shown.length} more · no flags raised on the rest
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function TimeFlag({ flag }: { flag: 'fast' | 'slow' | 'ok' | null }) {
  if (!flag || flag === 'ok') {
    return (
      <span
        className="mono ts-11"
        style={{ color: 'var(--mute2)' }}
        title="No threshold set on this task, or within bounds."
      >
        —
      </span>
    )
  }
  const palette =
    flag === 'fast'
      ? {
          bg: 'oklch(0.7 0.14 75 / 0.08)',
          fg: 'var(--warn)',
          bord: 'oklch(0.7 0.14 75 / 0.4)',
          label: '⚡ fast',
          title:
            'Annotation submitted faster than the task\'s minExpectedSeconds — possible speed-skip without reading.',
        }
      : {
          bg: 'var(--danger-soft)',
          fg: 'var(--danger)',
          bord: 'oklch(0.55 0.2 25 / 0.4)',
          label: '⏱ over',
          title:
            'Annotation exceeded the task\'s maxBillableSeconds — possible idle time or stuck rater.',
        }
  return (
    <span
      className="mono ts-11"
      title={palette.title}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.bord}`,
        borderRadius: 4,
        padding: '1px 8px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {palette.label}
    </span>
  )
}

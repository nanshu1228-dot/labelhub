import type { TimelineEntry } from '@/lib/queries/annotation-timeline'

/**
 * Vertical event timeline for one annotation. Server-rendered; pure
 * markup + CSS. Shows every event from the audit log (drafted /
 * submitted / qc_passed / revised / approved / rejected / replied)
 * with timestamp + actor + role + message preview.
 *
 * Where ReviewThread is the conversation view (verdict + replies as a
 * chat), this is the engineering view: every state change visible,
 * with collapsed repeating drafts. The two coexist on the review page
 * and serve different reader needs.
 */

const EVENT_META: Record<
  TimelineEntry['type'],
  { dot: string; label: string; bg: string; fg: string }
> = {
  'annotation.drafted': {
    dot: '·',
    label: 'drafted',
    bg: 'var(--panel2)',
    fg: 'var(--mute)',
  },
  'annotation.submitted': {
    dot: '▶',
    label: 'submitted',
    bg: 'oklch(0.55 0.15 220 / 0.1)',
    fg: 'oklch(0.65 0.15 220)',
  },
  'annotation.qc_passed': {
    dot: '✓',
    label: 'QC passed',
    bg: 'oklch(0.94 0.04 200 / 0.5)',
    fg: 'oklch(0.45 0.15 200)',
  },
  'annotation.revised': {
    dot: '↻',
    label: '打回 (revise)',
    bg: 'oklch(0.7 0.14 75 / 0.15)',
    fg: 'oklch(0.7 0.14 75)',
  },
  'annotation.approved': {
    dot: '✓',
    label: 'approved',
    bg: 'var(--success-soft)',
    fg: 'var(--success)',
  },
  'annotation.rejected': {
    dot: '✗',
    label: 'rejected',
    bg: 'var(--danger-soft)',
    fg: 'var(--danger)',
  },
  'annotation.review_replied': {
    dot: '↳',
    label: 'replied',
    bg: 'var(--panel2)',
    fg: 'var(--mute)',
  },
}

/**
 * Collapse consecutive `annotation.drafted` events by the same actor
 * into a single "drafted ×N" row — drafts can fire every blur on a
 * busy form, and showing 20 of them just clutters the audit view.
 */
function collapseDrafts(entries: TimelineEntry[]): Array<
  TimelineEntry & { draftCount?: number }
> {
  const out: Array<TimelineEntry & { draftCount?: number }> = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (
      e.type === 'annotation.drafted' &&
      last &&
      last.type === 'annotation.drafted' &&
      last.actorId === e.actorId
    ) {
      last.draftCount = (last.draftCount ?? 1) + 1
      last.ts = e.ts // latest timestamp wins so the row stays useful
      last.eventId = e.eventId
    } else {
      out.push({ ...e })
    }
  }
  return out
}

export function AnnotationAuditTimeline({
  entries,
}: {
  entries: TimelineEntry[]
}) {
  if (entries.length === 0) return null
  const collapsed = collapseDrafts(entries)

  return (
    <section>
      <div className="lbl mb-3">§ AUDIT TIMELINE</div>
      <ol
        className="rounded-md"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}
      >
        {collapsed.map((e, idx) => {
          const m = EVENT_META[e.type]
          const actor =
            e.actorDisplayName ??
            e.actorEmail?.split('@')[0] ??
            (e.actorId ? e.actorId.slice(0, 8) : 'system')
          const ts = e.ts.toISOString().slice(0, 16).replace('T', ' ')
          return (
            <li
              key={e.eventId}
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '10px 14px',
              }}
            >
              <span
                aria-hidden
                className="mono"
                style={{
                  background: m.bg,
                  color: m.fg,
                  border: `1px solid ${m.fg}33`,
                  borderRadius: 4,
                  padding: '1px 6px',
                  minWidth: 22,
                  textAlign: 'center',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {m.dot}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="ts-13"
                    style={{ color: 'var(--text)', fontWeight: 500 }}
                  >
                    {m.label}
                    {e.draftCount && e.draftCount > 1 && (
                      <span
                        className="mono ts-11 ml-2"
                        style={{ color: 'var(--mute2)' }}
                      >
                        ×{e.draftCount}
                      </span>
                    )}
                  </span>
                  <span
                    className="mono ts-11"
                    style={{ color: 'var(--mute2)' }}
                  >
                    by{' '}
                    <span style={{ color: 'var(--hi)', fontWeight: 500 }}>
                      {actor}
                    </span>
                    {e.reviewerRole && (
                      <span style={{ color: 'var(--mute2)' }}>
                        {' '}
                        · {e.reviewerRole}
                      </span>
                    )}
                  </span>
                  <span
                    className="mono ts-11 ml-auto"
                    style={{ color: 'var(--mute2)' }}
                    title={e.ts.toISOString()}
                  >
                    {ts}
                  </span>
                </div>
                {e.message && (
                  <p
                    className="ts-12 mt-1"
                    style={{
                      color: 'var(--mute)',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.5,
                    }}
                  >
                    {e.message}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

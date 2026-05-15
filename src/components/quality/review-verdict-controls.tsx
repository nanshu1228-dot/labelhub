'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { qcReviewAnnotation } from '@/lib/actions/qc-review'
import { reviewAnnotation } from '@/lib/actions/annotations'

/**
 * Role/status-aware verdict controls. Drops onto the trajectory detail
 * page when the URL has `?annotationId=...` so QC + admin can render
 * a decision without leaving the trajectory view.
 *
 * Permission matrix:
 *
 *                          | annotator | qc        | admin
 *   ─────────────────────────────────────────────────────────
 *   submitted / reviewing  | (await)   | pass ·    | pass · accept ·
 *                          |           | 打回      | reject · 打回
 *   awaiting_acceptance    | (await)   | (read)    | accept · reject · 打回
 *   revising               | (resubmit | (read)    | (read)
 *                          | flow elsewhere)
 *   approved / rejected    | (final)   | (read)    | (read)
 *
 * QC can't terminally reject — that's deliberately kept admin-only so
 * the workspace has one source of authority for kill decisions.
 * Admin can collapse the QC step (act directly on `submitted`).
 *
 * Verdict actions are optimistic-locked on `topic.version` server-side;
 * UI handles ConflictError with a "refresh and try again" inline message.
 */

export type ViewerRole = 'admin' | 'qc' | 'annotator' | 'viewer'

export type TopicStatus =
  | 'drafting'
  | 'revising'
  | 'submitted'
  | 'reviewing'
  | 'awaiting_acceptance'
  | 'approved'
  | 'rejected'

export interface ReviewVerdictControlsProps {
  annotationId: string
  topicStatus: TopicStatus
  viewerRole: ViewerRole
  /** True when the viewer IS the original submitter — they don't review themselves. */
  viewerIsSubmitter: boolean
  submitterDisplayName: string | null
}

export function ReviewVerdictControls(props: ReviewVerdictControlsProps) {
  const { topicStatus, viewerRole, viewerIsSubmitter } = props

  // Terminal states — nothing to do, just render a status note.
  if (topicStatus === 'approved' || topicStatus === 'rejected') {
    return <TerminalNote status={topicStatus} />
  }

  // Submitter looking at their own work in flight — show a status note
  // instead of buttons. (They CAN'T review themselves; the server
  // action rejects with ConflictError anyway.)
  if (viewerIsSubmitter) {
    return <SubmitterStatusNote status={topicStatus} />
  }

  // Non-reviewer roles see read-only context.
  if (viewerRole !== 'qc' && viewerRole !== 'admin') {
    return null
  }

  // Build the button set per status × role.
  const canQCPass =
    (topicStatus === 'submitted' || topicStatus === 'reviewing') &&
    (viewerRole === 'qc' || viewerRole === 'admin')
  const canAccept =
    viewerRole === 'admin' &&
    (topicStatus === 'submitted' ||
      topicStatus === 'reviewing' ||
      topicStatus === 'awaiting_acceptance')
  const canReject = canAccept
  const canRequestRevision =
    (topicStatus === 'submitted' ||
      topicStatus === 'reviewing' ||
      topicStatus === 'awaiting_acceptance') &&
    (viewerRole === 'qc' || viewerRole === 'admin')

  return (
    <VerdictForm
      {...props}
      canQCPass={canQCPass}
      canAccept={canAccept}
      canReject={canReject}
      canRequestRevision={canRequestRevision}
    />
  )
}

// ─── The active form ─────────────────────────────────────────────────────

function VerdictForm({
  annotationId,
  topicStatus,
  viewerRole,
  submitterDisplayName,
  canQCPass,
  canAccept,
  canReject,
  canRequestRevision,
}: ReviewVerdictControlsProps & {
  canQCPass: boolean
  canAccept: boolean
  canReject: boolean
  canRequestRevision: boolean
}) {
  const router = useRouter()
  const [feedback, setFeedback] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function doQCPass() {
    fire(async () => {
      await qcReviewAnnotation({
        annotationId,
        decision: 'pass',
        feedback: feedback.trim() || undefined,
      })
      setInfo('Marked QC-passed. Forwarded to admin for acceptance.')
      setFeedback('')
      router.refresh()
    })
  }

  function doAccept() {
    fire(async () => {
      await reviewAnnotation({
        annotationId,
        decision: 'approve',
        feedback: feedback.trim() || undefined,
      })
      setInfo('Annotation accepted. Locked for payout + IAA.')
      setFeedback('')
      router.refresh()
    })
  }

  function doReject() {
    if (
      !confirm(
        'Terminally reject this annotation? The submitter cannot revise; the work is killed for billing.',
      )
    ) {
      return
    }
    fire(async () => {
      await reviewAnnotation({
        annotationId,
        decision: 'reject',
        feedback: feedback.trim() || undefined,
      })
      setInfo('Annotation rejected.')
      setFeedback('')
      router.refresh()
    })
  }

  function doRequestRevision() {
    const trimmed = feedback.trim()
    if (!trimmed) {
      setError(
        'Add feedback before 打回 — the submitter needs to know what to fix.',
      )
      return
    }
    fire(async () => {
      if (viewerRole === 'qc') {
        await qcReviewAnnotation({
          annotationId,
          decision: 'request_revision',
          feedback: trimmed,
        })
      } else {
        await reviewAnnotation({
          annotationId,
          decision: 'request_revision',
          feedback: trimmed,
        })
      }
      setInfo('Sent back to submitter for revision.')
      setFeedback('')
      router.refresh()
    })
  }

  function fire(fn: () => Promise<void>) {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Verdict failed.')
      }
    })
  }

  // If no buttons render (shouldn't happen with the gate above), bail
  // out so we don't show an empty card.
  if (!canQCPass && !canAccept && !canReject && !canRequestRevision) {
    return null
  }

  return (
    <section
      className="rounded-xl p-4 space-y-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--accent-line)',
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="lbl" style={{ color: 'var(--accent)' }}>
            § REVIEW
          </div>
          <p
            className="ts-13 mt-0.5"
            style={{ color: 'var(--text)', lineHeight: 1.5 }}
          >
            Reviewing{' '}
            <strong style={{ color: 'var(--hi)' }}>
              {submitterDisplayName ?? 'this annotator'}
            </strong>
            &apos;s annotation · current state{' '}
            <span
              className="mono"
              style={{ color: 'var(--mute2)' }}
            >
              {topicStatus}
            </span>
          </p>
        </div>
        <RoleBadge role={viewerRole} />
      </div>

      <label>
        <span className="lbl mb-1.5 block">feedback (required for 打回)</span>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="What needs fixing? Concrete examples land in the review thread for the submitter."
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'var(--font-geist-sans), system-ui',
          }}
        />
      </label>

      {error && (
        <div
          className="ts-11 mono rounded-md p-2"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
      {info && (
        <div
          className="ts-11 mono rounded-md p-2"
          style={{
            background: 'var(--success-soft)',
            border: '1px solid oklch(0.5 0.13 150 / 0.35)',
            color: 'var(--success)',
          }}
        >
          {info}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-end">
        {canRequestRevision && (
          <Btn
            onClick={doRequestRevision}
            disabled={pending}
            label="↻ 打回 revision"
            tone="warn"
          />
        )}
        {canQCPass && (
          <Btn
            onClick={doQCPass}
            disabled={pending}
            label="✓ QC pass"
            tone="qc"
          />
        )}
        {canReject && (
          <Btn
            onClick={doReject}
            disabled={pending}
            label="✗ reject (terminal)"
            tone="danger"
          />
        )}
        {canAccept && (
          <Btn
            onClick={doAccept}
            disabled={pending}
            label="✓ accept"
            tone="success"
          />
        )}
      </div>
    </section>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────

function RoleBadge({ role }: { role: ViewerRole }) {
  const palette: Record<ViewerRole, { bg: string; fg: string; bord: string; label: string }> = {
    admin: {
      bg: 'var(--accent-soft)',
      fg: 'var(--accent)',
      bord: 'var(--accent-line)',
      label: 'admin · acceptor',
    },
    qc: {
      bg: 'oklch(0.94 0.04 200 / 0.5)',
      fg: 'oklch(0.45 0.15 200)',
      bord: 'oklch(0.6 0.15 200 / 0.3)',
      label: 'qc · quality check',
    },
    annotator: {
      bg: 'oklch(0.94 0 0)',
      fg: 'var(--hi)',
      bord: 'var(--line)',
      label: 'annotator',
    },
    viewer: {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      bord: 'var(--line)',
      label: 'viewer',
    },
  }
  const v = palette[role]
  return (
    <span
      className="mono shrink-0"
      style={{
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.bord}`,
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      {v.label}
    </span>
  )
}

function Btn({
  onClick,
  disabled,
  label,
  tone,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  tone: 'qc' | 'warn' | 'success' | 'danger'
}) {
  const palette = {
    qc: {
      bg: 'oklch(0.45 0.15 200)',
      fg: 'white',
      bord: 'oklch(0.45 0.15 200)',
    },
    warn: {
      bg: 'var(--warn)',
      fg: 'white',
      bord: 'var(--warn)',
    },
    success: {
      bg: 'var(--success)',
      fg: 'white',
      bord: 'var(--success)',
    },
    danger: {
      bg: 'transparent',
      fg: 'var(--danger)',
      bord: 'oklch(0.55 0.2 25 / 0.35)',
    },
  }
  const p = palette[tone]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="ts-12 mono"
      style={{
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.bord}`,
        borderRadius: 6,
        padding: '6px 14px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}

function TerminalNote({ status }: { status: 'approved' | 'rejected' }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background:
          status === 'approved' ? 'var(--success-soft)' : 'var(--danger-soft)',
        border: `1px solid ${
          status === 'approved'
            ? 'oklch(0.5 0.13 150 / 0.4)'
            : 'oklch(0.55 0.2 25 / 0.4)'
        }`,
      }}
    >
      <div
        className="lbl"
        style={{
          color: status === 'approved' ? 'var(--success)' : 'var(--danger)',
        }}
      >
        § {status === 'approved' ? 'ACCEPTED' : 'REJECTED'}
      </div>
      <p className="ts-13 mt-1" style={{ color: 'var(--text)' }}>
        This annotation has reached a terminal state. No further verdicts
        possible.
      </p>
    </div>
  )
}

function SubmitterStatusNote({ status }: { status: TopicStatus }) {
  const msg =
    status === 'submitted' || status === 'reviewing'
      ? 'Awaiting QC review. You can’t take action until a reviewer responds.'
      : status === 'awaiting_acceptance'
        ? 'QC passed. Awaiting admin acceptance.'
        : status === 'revising'
          ? 'A reviewer 打回 your annotation — open the review thread above for feedback, then re-submit.'
          : `Status: ${status}.`
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <div className="lbl" style={{ color: 'var(--mute2)' }}>
        § YOUR ANNOTATION
      </div>
      <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
        {msg}
      </p>
    </div>
  )
}

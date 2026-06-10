'use client'

import type { ReactNode } from 'react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { qcReviewAnnotation } from '@/lib/actions/qc-review'
import { reviewAnnotation } from '@/lib/actions/annotations'
import { getErrorMessage } from '@/lib/errors/client-utils'
import { isBlockedByPolicy } from '@/lib/quality/state-machine'

/**
 * Role/status-aware verdict controls. Drops onto the trajectory detail
 * page when the URL has `?annotationId=...` so QC + admin can render
 * a decision without leaving the trajectory view.
 *
 * Permission matrix (with twoStage ON — the default — admin's `accept`
 * in the first row is hidden; QC 初审 must move the topic to
 * awaiting_acceptance first):
 *
 *                          | annotator | qc        | admin
 *   ─────────────────────────────────────────────────────────
 *   submitted / reviewing  | (await)   | pass ·    | pass · accept* ·
 *                          |           | 打回      | reject · 打回
 *                          |           |           | (*single-stage only)
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
  /**
   * Task-level two-stage review policy (spec §9.3). When true, admin
   * accept is hidden until QC 初审 moved the topic to awaiting_acceptance
   * — mirrors the server's `isBlockedByPolicy` gate so the UI never
   * offers a button the action would reject. Defaults to true to match
   * the server-side default (`DEFAULT_TASK_SETTINGS.twoStageReview`).
   */
  twoStage?: boolean
}

export function ReviewVerdictControls(props: ReviewVerdictControlsProps) {
  const { topicStatus, viewerRole, viewerIsSubmitter, twoStage = true } = props

  // Terminal states — nothing to do, just render a status note.
  if (topicStatus === 'approved' || topicStatus === 'rejected') {
    return <TerminalNote status={topicStatus} />
  }

  // Submitter looking at their own work in flight — show a status note
  // instead of buttons. Exception: an ADMIN viewing their own work keeps
  // the terminal accept/reject actions — `reviewAnnotation` explicitly
  // allows admin self-review (annotations.ts "admin reviewing their own
  // annotation — unusual but possible"; the solo-owner workspace would
  // otherwise dead-end). Self-QC stays hidden for everyone: qc-review.ts
  // rejects it server-side.
  if (viewerIsSubmitter && viewerRole !== 'admin') {
    return <SubmitterStatusNote status={topicStatus} />
  }

  // Non-reviewer roles see read-only context.
  if (viewerRole !== 'qc' && viewerRole !== 'admin') {
    return null
  }

  // Build the button set per status × role. Self-QC is server-rejected
  // (qc-review.ts), so the QC-pass button never renders on own work.
  const canQCPass =
    (topicStatus === 'submitted' || topicStatus === 'reviewing') &&
    (viewerRole === 'qc' || viewerRole === 'admin') &&
    !viewerIsSubmitter
  const canAccept =
    viewerRole === 'admin' &&
    (topicStatus === 'submitted' ||
      topicStatus === 'reviewing' ||
      topicStatus === 'awaiting_acceptance') &&
    !isBlockedByPolicy(topicStatus, 'admin_accept', { twoStage })
  // Terminal reject stays legal pre-初审 even under two-stage — the
  // policy only forces the accept path through QC.
  const canReject =
    viewerRole === 'admin' &&
    (topicStatus === 'submitted' ||
      topicStatus === 'reviewing' ||
      topicStatus === 'awaiting_acceptance')
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
  const [confirmingReject, setConfirmingReject] = useState(false)

  function doQCPass() {
    fire(async () => {
      await qcReviewAnnotation({
        annotationId,
        decision: 'pass',
        feedback: feedback.trim() || undefined,
      })
      setInfo('Marked QC-passed. Forwarded to admin for acceptance.')
      setConfirmingReject(false)
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
      setConfirmingReject(false)
      setFeedback('')
      router.refresh()
    })
  }

  function doReject() {
    setError(null)
    setInfo(null)
    setConfirmingReject(true)
  }

  function confirmReject() {
    fire(async () => {
      await reviewAnnotation({
        annotationId,
        decision: 'reject',
        feedback: feedback.trim() || undefined,
      })
      setInfo('Annotation rejected.')
      setConfirmingReject(false)
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
      setConfirmingReject(false)
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
        setError(getErrorMessage(e, 'Verdict failed.'))
      }
    })
  }

  // Keyboard shortcuts for fast review — ignored while typing in the
  // feedback box or mid-action. A accept · Q QC pass · S 打回 · R reject.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          el.isContentEditable)
      )
        return
      if (pending) return
      const k = e.key.toLowerCase()
      if (k === 'a' && canAccept) {
        e.preventDefault()
        doAccept()
      } else if (k === 'q' && canQCPass) {
        e.preventDefault()
        doQCPass()
      } else if (k === 's' && canRequestRevision) {
        e.preventDefault()
        doRequestRevision()
      } else if (k === 'r' && canReject) {
        e.preventDefault()
        doReject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // doX are stable function declarations; feedback feeds doRequestRevision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, canAccept, canQCPass, canRequestRevision, canReject, feedback])

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
            REVIEW
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

      {confirmingReject && (
        <div
          className="rounded-md p-3"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded"
              style={{
                width: 30,
                height: 30,
                color: 'var(--danger)',
                background: 'var(--bg)',
                border: '1px solid oklch(0.55 0.2 25 / 0.3)',
              }}
            >
              <ShieldAlert size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="lbl" style={{ color: 'var(--danger)' }}>
                TERMINAL REJECT
              </div>
              <p
                className="ts-12 mt-1"
                style={{ color: 'var(--text)', lineHeight: 1.5 }}
              >
                This closes the annotation instead of sending it back for
                revision. Add a feedback note if the submitter should see why.
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingReject(false)}
                  disabled={pending}
                  className="ts-12 mono inline-flex items-center justify-center rounded-md px-3"
                  style={{
                    minHeight: 34,
                    color: 'var(--text)',
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    cursor: pending ? 'not-allowed' : 'pointer',
                    opacity: pending ? 0.55 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmReject}
                  disabled={pending}
                  className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded-md px-3"
                  style={{
                    minHeight: 34,
                    color: 'white',
                    background: 'var(--danger)',
                    border: '1px solid var(--danger)',
                    cursor: pending ? 'not-allowed' : 'pointer',
                    opacity: pending ? 0.55 : 1,
                  }}
                >
                  {pending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <XCircle size={14} />
                  )}
                  Reject annotation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-end">
        {canRequestRevision && (
          <Btn
            onClick={doRequestRevision}
            disabled={pending}
            icon={<RotateCcw size={14} />}
            label="打回修订"
            tone="warn"
          />
        )}
        {canQCPass && (
          <Btn
            onClick={doQCPass}
            disabled={pending}
            icon={<ClipboardCheck size={14} />}
            label="初审通过"
            tone="qc"
          />
        )}
        {canReject && (
          <Btn
            onClick={doReject}
            disabled={pending}
            icon={<XCircle size={14} />}
            label="终拒"
            tone="danger"
          />
        )}
        {canAccept && (
          <Btn
            onClick={doAccept}
            disabled={pending}
            icon={<CheckCircle2 size={14} />}
            label="终审通过 · 入库"
            tone="success"
          />
        )}
      </div>

      <div
        className="ts-11 mono"
        style={{ color: 'var(--mute2)', textAlign: 'right' }}
      >
        快捷键:
        {[
          canAccept && 'A 终审通过',
          canQCPass && 'Q 初审通过',
          canRequestRevision && 'S 打回',
          canReject && 'R 终拒',
        ]
          .filter(Boolean)
          .join(' · ')}
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
  icon,
  label,
  tone,
}: {
  onClick: () => void
  disabled: boolean
  icon: ReactNode
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
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ts-12 mono inline-flex items-center justify-center gap-1.5"
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
      {icon}
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
        {status === 'approved' ? 'ACCEPTED' : 'REJECTED'}
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
        YOUR ANNOTATION
      </div>
      <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
        {msg}
      </p>
    </div>
  )
}

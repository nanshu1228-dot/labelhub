'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setTrustStatus, type TrustStatus } from '@/lib/actions/trust-status'

/**
 * Admin control for flipping a rater's trust lifecycle. Lives inside
 * the per-rater drilldown page so the admin has all the context (axis
 * scores, time stats, recent verdicts) before making the call.
 *
 * UI:
 *   - three pill buttons: active / probation / suspended
 *   - required reason textarea when picking non-active
 *   - confirm button → server action → router.refresh()
 *
 * The action emits a notification to the affected rater AND writes an
 * audit event, so we don't need to surface anything else here.
 */
export function TrustStatusControls({
  workspaceId,
  userId,
  currentStatus,
  raterName,
}: {
  workspaceId: string
  userId: string
  currentStatus: TrustStatus
  raterName: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<TrustStatus>(currentStatus)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const dirty = status !== currentStatus
  const requiresReason = status !== 'active'

  function submit() {
    setError(null)
    setInfo(null)
    if (requiresReason && !reason.trim()) {
      setError(
        `Add a reason — the rater sees this in their /my/quality page.`,
      )
      return
    }
    startTransition(async () => {
      try {
        await setTrustStatus({
          workspaceId,
          userId,
          status,
          reason: requiresReason ? reason.trim() : undefined,
        })
        setInfo(
          status === 'active'
            ? `Restored ${raterName} to active.`
            : status === 'probation'
              ? `Moved ${raterName} to probation. They'll see the reason in their inbox.`
              : `Suspended ${raterName}. Claims + payouts halted until lifted.`,
        )
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed.')
      }
    })
  }

  return (
    <div
      className="rounded-md p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex gap-2 mb-3">
        <PillButton
          label="active"
          hint="default · full claim + earn"
          on={status === 'active'}
          fg="oklch(0.5 0.13 150)"
          onClick={() => setStatus('active')}
        />
        <PillButton
          label="probation"
          hint="closer admin review"
          on={status === 'probation'}
          fg="oklch(0.55 0.14 75)"
          onClick={() => setStatus('probation')}
        />
        <PillButton
          label="suspended"
          hint="no new claims · payouts halt"
          on={status === 'suspended'}
          fg="var(--danger)"
          onClick={() => setStatus('suspended')}
        />
      </div>

      {requiresReason && (
        <div className="mb-3">
          <label
            className="ts-12 mono block mb-1.5"
            style={{ color: 'var(--mute)' }}
          >
            REASON (shown to the rater) *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={
              status === 'probation'
                ? "e.g. 'Drift on safety rubric for 3 weeks — let's pair on calibration before continuing.'"
                : "e.g. 'Repeated < 10s submissions flagged as speed-skipping. Suspended pending review.'"
            }
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>
      )}

      {error && (
        <div
          className="ts-12 mono mb-2 p-2 rounded"
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
          className="ts-12 mono mb-2 p-2 rounded"
          style={{
            background: 'var(--success-soft)',
            border: '1px solid oklch(0.5 0.13 150 / 0.35)',
            color: 'oklch(0.45 0.15 150)',
          }}
        >
          {info}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setStatus(currentStatus)
              setReason('')
              setError(null)
            }}
            className="ts-13 mono"
            style={{
              background: 'transparent',
              color: 'var(--mute)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || pending}
          className="ts-13 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 500,
            cursor: dirty && !pending ? 'pointer' : 'not-allowed',
            opacity: dirty && !pending ? 1 : 0.5,
          }}
        >
          {pending ? 'saving…' : dirty ? 'apply change' : 'no change'}
        </button>
      </div>
    </div>
  )
}

function PillButton({
  label,
  hint,
  on,
  fg,
  onClick,
}: {
  label: string
  hint: string
  on: boolean
  fg: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ts-13 mono text-left"
      style={{
        background: on ? `${fg}1f` : 'transparent',
        color: on ? fg : 'var(--text)',
        border: `1px solid ${on ? fg : 'var(--line)'}`,
        borderRadius: 6,
        padding: '6px 12px',
        fontWeight: on ? 600 : 500,
        cursor: 'pointer',
        flex: 1,
      }}
    >
      <div>{label}</div>
      <div
        className="ts-11 mt-0.5"
        style={{ color: 'var(--mute2)', fontWeight: 400 }}
      >
        {hint}
      </div>
    </button>
  )
}

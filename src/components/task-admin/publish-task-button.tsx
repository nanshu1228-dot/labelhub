'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Archive,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Play,
  RotateCcw,
  StopCircle,
} from 'lucide-react'
import {
  closeTask,
  pauseTask,
  publishTask,
  resumeTask,
} from '@/lib/actions/tasks'

/**
 * Owner lifecycle controls for the spec's task state machine:
 * draft -> open -> paused/resumed -> closed, with archive kept as a
 * deeper storage state for hiding old work without deleting evidence.
 */
export function TaskLifecycleActions({
  taskId,
  status,
  publishDisabledReason,
  compact = false,
}: {
  taskId: string
  status: string
  publishDisabledReason?: string | null
  compact?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<{
    label: string
    message: string
    action: () => Promise<unknown>
  } | null>(null)
  const [pending, startTransition] = useTransition()

  function execute({
    action,
    label,
  }: {
    action: () => Promise<unknown>
    label: string
  }) {
    setError(null)
    setPendingAction(label)
    startTransition(async () => {
      try {
        await action()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : `${label} failed.`)
      } finally {
        setPendingAction(null)
      }
    })
  }

  function run({
    action,
    label,
    confirm,
  }: {
    action: () => Promise<unknown>
    label: string
    confirm?: string
  }) {
    if (confirm) {
      setError(null)
      setConfirmRequest({ action, label, message: confirm })
      return
    }
    execute({ action, label })
  }

  const disabled = pending || pendingAction !== null

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {status === 'draft' ? (
        <>
          <LifecycleButton
            icon={<Play size={14} />}
            loading={pendingAction === 'Publish'}
            disabled={disabled || Boolean(publishDisabledReason)}
            tone="accent"
            compact={compact}
            title={publishDisabledReason ?? undefined}
            onClick={() =>
              run({
                label: 'Publish',
                action: () => publishTask({ taskId }),
              })
            }
          >
            Publish
          </LifecycleButton>
          {publishDisabledReason ? (
            <span
              className="ts-11"
              style={{ color: 'var(--mute2)', maxWidth: compact ? 150 : 260 }}
            >
              {publishDisabledReason}
            </span>
          ) : null}
        </>
      ) : null}

      {status === 'open' ? (
        <>
          <StatusChip icon={<CheckCircle2 size={14} />} tone="success">
            Published
          </StatusChip>
          <LifecycleButton
            icon={<PauseCircle size={14} />}
            loading={pendingAction === 'Pause'}
            disabled={disabled}
            compact={compact}
            onClick={() =>
              run({
                label: 'Pause',
                action: () => pauseTask({ taskId }),
              })
            }
          >
            Pause
          </LifecycleButton>
          <LifecycleButton
            icon={<StopCircle size={14} />}
            loading={pendingAction === 'Close'}
            disabled={disabled}
            compact={compact}
            onClick={() =>
              run({
                label: 'Close',
                action: () => closeTask({ taskId }),
                confirm:
                  'Close this task? Labelers will no longer be able to claim it, but exports and audit records stay available.',
              })
            }
          >
            Close
          </LifecycleButton>
        </>
      ) : null}

      {status === 'paused' ? (
        <>
          <StatusChip icon={<PauseCircle size={14} />} tone="warning">
            Paused
          </StatusChip>
          <LifecycleButton
            icon={<RotateCcw size={14} />}
            loading={pendingAction === 'Resume'}
            disabled={disabled}
            tone="accent"
            compact={compact}
            onClick={() =>
              run({
                label: 'Resume',
                action: () => resumeTask({ taskId }),
              })
            }
          >
            Resume
          </LifecycleButton>
          <LifecycleButton
            icon={<StopCircle size={14} />}
            loading={pendingAction === 'Close'}
            disabled={disabled}
            compact={compact}
            onClick={() =>
              run({
                label: 'Close',
                action: () => closeTask({ taskId }),
                confirm:
                  'Close this task? Labelers will no longer be able to claim it, but exports and audit records stay available.',
              })
            }
          >
            Close
          </LifecycleButton>
        </>
      ) : null}

      {status === 'closed' ? (
        <StatusChip icon={<StopCircle size={14} />}>Closed</StatusChip>
      ) : null}

      {status === 'archived' ? (
        <StatusChip icon={<Archive size={14} />}>Archived</StatusChip>
      ) : null}

      {error ? (
        <span className="ts-11 mono" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
      {confirmRequest ? (
        <span
          className="inline-flex flex-wrap items-center gap-2 rounded px-2 py-1"
          style={{
            minHeight: compact ? 34 : 40,
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
          }}
        >
          <span
            className="ts-11"
            style={{ color: 'var(--text)', maxWidth: compact ? 220 : 360 }}
          >
            {confirmRequest.message}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirmRequest(null)}
            className="ts-11 mono rounded px-2"
            style={{
              minHeight: 28,
              color: 'var(--mute)',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const request = confirmRequest
              setConfirmRequest(null)
              execute({ action: request.action, label: request.label })
            }}
            className="ts-11 mono rounded px-2"
            style={{
              minHeight: 28,
              color: 'white',
              background: 'var(--danger)',
              border: '1px solid var(--danger)',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {confirmRequest.label}
          </button>
        </span>
      ) : null}
    </span>
  )
}

/**
 * Backward-compatible export for older call sites. It now renders the
 * full lifecycle action set instead of a publish-only control.
 */
export function PublishTaskButton({
  taskId,
  status,
  publishDisabledReason,
}: {
  taskId: string
  status: string
  publishDisabledReason?: string | null
}) {
  return (
    <TaskLifecycleActions
      taskId={taskId}
      status={status}
      publishDisabledReason={publishDisabledReason}
    />
  )
}

function LifecycleButton({
  children,
  icon,
  loading,
  disabled,
  tone = 'ghost',
  compact,
  title,
  onClick,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  loading: boolean
  disabled: boolean
  tone?: 'accent' | 'ghost'
  compact?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-3"
      style={{
        minHeight: compact ? 34 : 40,
        background: tone === 'accent' ? 'var(--accent)' : 'transparent',
        color: tone === 'accent' ? 'white' : 'var(--text)',
        border:
          tone === 'accent'
            ? '1px solid var(--accent)'
            : '1px solid var(--line)',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {compact ? null : children}
    </button>
  )
}

function StatusChip({
  children,
  icon,
  tone = 'neutral',
}: {
  children: React.ReactNode
  icon: React.ReactNode
  tone?: 'success' | 'warning' | 'neutral'
}) {
  const colors =
    tone === 'success'
      ? {
          bg: 'oklch(0.65 0.18 200 / 0.12)',
          fg: 'oklch(0.65 0.18 200)',
          border: 'oklch(0.65 0.18 200 / 0.35)',
        }
      : tone === 'warning'
        ? {
            bg: 'oklch(0.68 0.16 70 / 0.12)',
            fg: 'oklch(0.55 0.14 75)',
            border: 'oklch(0.68 0.16 70 / 0.35)',
          }
        : {
            bg: 'var(--panel2)',
            fg: 'var(--mute2)',
            border: 'var(--line)',
          }
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2"
      style={{
        minHeight: 34,
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {icon}
      {children}
    </span>
  )
}

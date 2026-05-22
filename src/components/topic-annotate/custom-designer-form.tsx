'use client'

/**
 * CustomDesignerForm — Labeler entry-point for `custom-designer`
 * tasks. Finals D19-B.
 *
 * Mounts the FormRenderer with the task's saved schema + the topic's
 * itemData; wires `useAutosaveDraft` for persistence; renders the
 * autosave status badge so the labeler can see "Saved 30s ago" at a
 * glance; binds Cmd/Ctrl+Enter to submit.
 *
 * Mirrors the shape of `pair-rubric-form.tsx` so the page-level
 * branch can render this the same way it renders the other modes.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FormRenderer } from '@/components/form-renderer/form-renderer'
import { TopicHeader } from './topic-header'
import {
  autosaveStatusLabel,
  useAutosaveDraft,
} from './use-autosave-draft'
import { submitAnnotation } from '@/lib/actions/annotations'
import type { FormSchema } from '@/lib/form-designer/schema'

export interface CustomDesignerFormProps {
  workspaceId: string
  workspaceName: string
  taskId: string
  taskName: string
  topicId: string
  topicStatus: string
  itemData: Record<string, unknown>
  schema: FormSchema
  initialPayload: Record<string, unknown>
}

export function CustomDesignerForm({
  workspaceId,
  workspaceName,
  taskId,
  taskName,
  topicId,
  topicStatus,
  itemData,
  schema,
  initialPayload,
}: CustomDesignerFormProps) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, unknown>>(
    () => initialPayload ?? {},
  )
  const [isSubmitting, startSubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isReadOnly =
    topicStatus !== 'drafting' && topicStatus !== 'revising'

  const autosave = useAutosaveDraft({
    topicId,
    taskId,
    readOnly: isReadOnly,
  })

  // Restore IndexedDB-stored draft if it's fresher than the
  // server payload — mirrors the pattern from pair-rubric-form.
  useEffect(() => {
    if (isReadOnly) return
    let cancelled = false
    void (async () => {
      const local = await autosave.restoreLocal()
      if (cancelled || !local) return
      if (local && typeof local === 'object') {
        setValues((prev) => ({ ...prev, ...(local as Record<string, unknown>) }))
      }
    })()
    return () => {
      cancelled = true
    }
    // Run-once on mount; autosave object is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = useCallback(
    (next: Record<string, unknown>) => {
      setValues(next)
      if (!isReadOnly) {
        autosave.markDirty(next)
      }
    },
    [autosave, isReadOnly],
  )

  const submit = useCallback(() => {
    if (isReadOnly) return
    setError(null)
    startSubmit(async () => {
      try {
        // Flush any pending autosave first so the submit reflects
        // the latest values.
        await autosave.flush(values)
        await submitAnnotation({
          topicId,
          payload: values,
        })
        router.push('/my/queue')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Submit failed.')
      }
    })
  }, [autosave, isReadOnly, router, topicId, values])

  // Cmd/Ctrl+Enter submit. Ignored when readOnly or already
  // submitting. The listener is window-bound so it works regardless
  // of focus position — matches a common annotation-tool convention
  // (Label Studio, Surge, Scale all bind Cmd+Enter).
  useEffect(() => {
    if (isReadOnly) return
    if (typeof window === 'undefined') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      if (!(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isReadOnly, submit])

  const statusBadgeText = useMemo(
    () => autosaveStatusLabel(autosave.status, autosave.lastSavedAt),
    [autosave.status, autosave.lastSavedAt],
  )

  return (
    <>
      <TopicHeader
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        taskName={taskName}
        itemData={itemData}
        badge="CUSTOM DESIGNER"
      />

      <section className="mt-8 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <AutosaveBadge label={statusBadgeText} status={autosave.status} />
          {!isReadOnly ? (
            <kbd
              className="ts-11 mono"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '2px 8px',
                color: 'var(--mute)',
              }}
              title="Press Cmd/Ctrl + Enter to submit"
            >
              ⌘ + Enter to submit
            </kbd>
          ) : null}
        </div>

        <FormRenderer
          schema={schema}
          value={values}
          onChange={handleChange}
          itemData={itemData}
          readOnly={isReadOnly}
        />

        {error ? (
          <div
            className="rounded p-2 ts-12"
            style={{
              background: 'oklch(0.55 0.2 25 / 0.05)',
              border: '1px solid oklch(0.55 0.2 25 / 0.4)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        ) : null}

        {!isReadOnly ? (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className="ts-13 mono px-4 py-2 rounded"
              style={{
                background: 'oklch(0.6 0.18 280)',
                color: 'white',
                border: '1px solid oklch(0.6 0.18 280 / 0.6)',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? 'Submitting…' : 'Submit annotation'}
            </button>
            <button
              type="button"
              onClick={() => void autosave.flush(values)}
              disabled={isSubmitting || autosave.status === 'saving'}
              className="ts-13 mono px-3 py-2 rounded"
              style={{
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--line)',
                cursor: 'pointer',
              }}
            >
              Save draft
            </button>
          </div>
        ) : null}
      </section>
    </>
  )
}

function AutosaveBadge({
  label,
  status,
}: {
  label: string
  status: ReturnType<typeof useAutosaveDraft>['status']
}) {
  const palette = (() => {
    if (status === 'error')
      return {
        bg: 'oklch(0.55 0.2 25 / 0.05)',
        fg: 'var(--danger)',
        border: 'oklch(0.55 0.2 25 / 0.4)',
      }
    if (status === 'saving' || status === 'dirty')
      return {
        bg: 'oklch(0.6 0.18 60 / 0.08)',
        fg: 'oklch(0.6 0.18 60)',
        border: 'oklch(0.6 0.18 60 / 0.4)',
      }
    if (status === 'saved')
      return {
        bg: 'oklch(0.62 0.16 145 / 0.08)',
        fg: 'oklch(0.62 0.16 145)',
        border: 'oklch(0.62 0.16 145 / 0.4)',
      }
    return {
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
      border: 'var(--line)',
    }
  })()
  return (
    <span
      className="ts-11 mono px-2 py-1 rounded"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
      aria-live="polite"
    >
      {label}
    </span>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { saveDraftAnnotation } from '@/lib/actions/annotations'
import { getLocalDb } from '@/lib/local-store'

/**
 * Shared autosave engine for the topic annotation forms (pair-rubric +
 * arena-gsb). Designed around the AGENTS.md hard rule: never save on
 * keystroke — only on blur or after a debounced settle period.
 *
 * Behavior:
 *   1. `markDirty(payload)` — called by form on every input change.
 *      Schedules a save 1500ms after the last call (cancels prior
 *      timer). Also writes to IndexedDB IMMEDIATELY so a crash /
 *      tab-close before the server save still preserves the draft.
 *   2. `flush()` — fire the save right now (used by onBlur of text
 *      inputs and the explicit "save draft" button).
 *   3. `beforeunload` listener — when state is dirty + unsynced,
 *      browser shows the standard "leave site?" prompt. Removed when
 *      the form is read-only or when the latest save succeeded.
 *   4. `restoreLocal()` — on mount, read the most-recent IndexedDB
 *      draft for this (topicId, userId) pair, return it for the form
 *      to merge into initial state. Useful when the server returned
 *      stale payload (e.g. the user's last save lost a race with a
 *      previous tab).
 *
 * Returns a stable `status` for the form to render: 'idle' / 'dirty' /
 * 'saving' / 'saved' / 'error'. The form decides how to surface it.
 */

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface UseAutosaveDraftOpts {
  topicId: string
  taskId: string
  readOnly: boolean
  /** Debounce window for rating/dimension changes. 1500ms feels
   *  responsive (rater sees "saving" within 2s) without firing on
   *  every click in a fast multi-input session. */
  debounceMs?: number
}

export interface UseAutosaveDraft {
  status: AutosaveStatus
  /** Last successful server save timestamp, or null. */
  lastSavedAt: Date | null
  /** Last save error message, if any. */
  errorMessage: string | null
  /** Mark the form dirty and schedule a debounced save. */
  markDirty: (payload: Record<string, unknown>) => void
  /** Force a save NOW. Used by onBlur of text inputs + manual save. */
  flush: (payload: Record<string, unknown>) => Promise<void>
  /** Hook to call on mount — returns any locally-cached payload that
   *  the form should merge over its server-loaded initialPayload. */
  restoreLocal: () => Promise<Record<string, unknown> | null>
}

export function useAutosaveDraft(
  opts: UseAutosaveDraftOpts,
): UseAutosaveDraft {
  const debounceMs = opts.debounceMs ?? 1500
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPayloadRef = useRef<Record<string, unknown> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)

  const writeLocal = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const db = getLocalDb()
        await db.drafts.put({
          // Keyed by topicId so re-entering the same topic restores
          // the same draft. Cross-user collision impossible because
          // IndexedDB is per-origin × per-browser-profile anyway.
          id: opts.topicId,
          topicId: opts.topicId,
          taskId: opts.taskId,
          payload,
          dirtyAt: Date.now(),
          syncedAt: null,
        })
      } catch {
        // IndexedDB blocked (private mode, quota, browser bug). Not
        // fatal — server save is the source of truth; local is just
        // an extra safety net.
      }
    },
    [opts.topicId, opts.taskId],
  )

  const markSyncedLocal = useCallback(async () => {
    try {
      const db = getLocalDb()
      const row = await db.drafts.get(opts.topicId)
      if (row) {
        await db.drafts.put({
          ...row,
          syncedAt: Date.now(),
          dirtyAt: row.dirtyAt,
        })
      }
    } catch {
      /* */
    }
  }, [opts.topicId])

  const doSave = useCallback(
    async (payload: Record<string, unknown>): Promise<void> => {
      // Coalesce concurrent saves — if one is already in flight, wait
      // for it and let the trailing call subsume.
      if (inFlightRef.current) {
        await inFlightRef.current
      }
      setStatus('saving')
      const promise = (async () => {
        try {
          await saveDraftAnnotation({
            topicId: opts.topicId,
            payload,
          })
          await markSyncedLocal()
          setStatus('saved')
          setLastSavedAt(new Date())
          setErrorMessage(null)
        } catch (e) {
          setStatus('error')
          setErrorMessage(
            e instanceof Error ? e.message : 'Save failed.',
          )
        } finally {
          inFlightRef.current = null
        }
      })()
      inFlightRef.current = promise
      return promise
    },
    [opts.topicId, markSyncedLocal],
  )

  const markDirty = useCallback(
    (payload: Record<string, unknown>) => {
      if (opts.readOnly) return
      latestPayloadRef.current = payload
      setStatus('dirty')
      // Always write local IMMEDIATELY so a crash before the debounce
      // fires still preserves the change. This is the local-first
      // promise of Pillar 1 — IndexedDB is the truth until synced.
      void writeLocal(payload)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const p = latestPayloadRef.current
        if (p) void doSave(p)
      }, debounceMs)
    },
    [opts.readOnly, writeLocal, doSave, debounceMs],
  )

  const flush = useCallback(
    async (payload: Record<string, unknown>) => {
      if (opts.readOnly) return
      latestPayloadRef.current = payload
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      await writeLocal(payload)
      await doSave(payload)
    },
    [opts.readOnly, writeLocal, doSave],
  )

  const restoreLocal = useCallback(async (): Promise<
    Record<string, unknown> | null
  > => {
    try {
      const db = getLocalDb()
      const row = await db.drafts.get(opts.topicId)
      if (!row) return null
      // Only return if local is fresher than server (i.e. dirtyAt is
      // set AND syncedAt is null or older than dirtyAt). Otherwise
      // the form's server-loaded payload IS the truth.
      if (
        row.dirtyAt &&
        (row.syncedAt == null || row.syncedAt < row.dirtyAt)
      ) {
        return (row.payload ?? null) as Record<string, unknown> | null
      }
      return null
    } catch {
      return null
    }
  }, [opts.topicId])

  // beforeunload guard — show the browser's "are you sure" prompt
  // when there are unsaved changes. Browsers ignore custom messages
  // since Chrome 51 (https://chromestatus.com/feature/5349061406228480),
  // so we just set returnValue to anything truthy.
  useEffect(() => {
    if (opts.readOnly) return
    const handler = (e: BeforeUnloadEvent) => {
      if (status === 'dirty' || status === 'saving') {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [status, opts.readOnly])

  // Cleanup pending debounce timer on unmount — ALSO try to flush.
  // Most browsers will execute synchronous code up to the navigation
  // but server actions are network calls and will be cancelled. The
  // local IndexedDB write is what actually survives.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const p = latestPayloadRef.current
      if (p) void writeLocal(p)
    }
  }, [writeLocal])

  return {
    status,
    lastSavedAt,
    errorMessage,
    markDirty,
    flush,
    restoreLocal,
  }
}

/**
 * Render-only — pure label string for a given autosave status.
 * Centralized so pair + arena forms show consistent wording.
 */
export function autosaveStatusLabel(
  status: AutosaveStatus,
  lastSavedAt: Date | null,
): string {
  if (status === 'idle') return ''
  if (status === 'saving') return 'saving…'
  if (status === 'dirty') return 'unsaved changes · saving in ~1s'
  if (status === 'error') return 'save failed — kept locally'
  if (lastSavedAt) {
    const secAgo = Math.max(
      0,
      Math.floor((Date.now() - lastSavedAt.getTime()) / 1000),
    )
    if (secAgo < 5) return 'saved'
    if (secAgo < 60) return `saved ${secAgo}s ago`
    return `saved ${Math.floor(secAgo / 60)}m ago`
  }
  return 'saved'
}

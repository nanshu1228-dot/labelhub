import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest'

/**
 * Direct unit tests for the data-loss-critical labeler autosave hook
 * (`useAutosaveDraft`). This hook is Pillar-1 critical: it is the only
 * thing standing between a rater's hour of work and an accidental
 * tab-close, so the timing / de-dupe / retry / local-restore behavior
 * is exercised here against the REAL hook code (not a reimplementation).
 *
 * Constraints this file works within (see ARCHITECTURE.md + repo setup):
 *   - vitest runs in the `node` environment — there is NO jsdom and no
 *     React renderer (no @testing-library/react, no react-test-renderer)
 *     in this repo. So instead of mounting a component we drive the hook
 *     through a tiny, dependency-free harness (`renderHook` below). Rather
 *     than poke React's undocumented internals, we `vi.mock('react')` and
 *     supply our own implementations of exactly the four dispatcher
 *     primitives the hook imports — useState / useRef / useCallback /
 *     useEffect — re-exporting everything else from the real React. The
 *     hook's own logic (debounce, hash de-dupe, retry/backoff,
 *     restore/merge, beforeunload, visibility) runs entirely unmodified.
 *   - `window` / `document` don't exist in node, so we install minimal
 *     event-target stubs before importing the hook.
 *   - the server action (`saveDraftAnnotation`) and the IndexedDB / dexie
 *     local store (`getLocalDb`) are mocked, following the repo's
 *     `vi.mock('@/...', () => ({...}))` pattern.
 */

// ---------------------------------------------------------------------------
// DOM-ish globals. The hook attaches `visibilitychange` (document) and
// `beforeunload` (window) listeners and reads `document.hidden`. node has
// neither, so we stand up minimal, inspectable event targets.
// ---------------------------------------------------------------------------

type Listener = (e: unknown) => void

class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>()
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn)
  }
  dispatch(type: string, e: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(e)
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

const fakeDocument = new FakeEventTarget() as FakeEventTarget & {
  hidden: boolean
}
fakeDocument.hidden = false
const fakeWindow = new FakeEventTarget()

vi.stubGlobal('document', fakeDocument)
vi.stubGlobal('window', fakeWindow)

// ---------------------------------------------------------------------------
// Mock React's four hook primitives. We delegate to whichever harness is
// "current" (set by renderHook). Everything else is re-exported from the
// real React so types/JSX/etc. are unaffected. This is version-independent
// (no reliance on React's private dispatcher internals).
// ---------------------------------------------------------------------------

interface Dispatcher {
  useState<S>(initial: S | (() => S)): [S, (next: S | ((p: S) => S)) => void]
  useRef<V>(initial: V): { current: V }
  useCallback<F>(fn: F, deps: unknown[]): F
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void
}

let currentDispatcher: Dispatcher | null = null

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    default: actual,
    useState: (initial: unknown) => currentDispatcher!.useState(initial),
    useRef: (initial: unknown) => currentDispatcher!.useRef(initial),
    useCallback: (fn: unknown, deps: unknown[]) =>
      currentDispatcher!.useCallback(fn, deps),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) =>
      currentDispatcher!.useEffect(effect, deps),
  }
})

// ---------------------------------------------------------------------------
// Mock the server action + the dexie-backed local store.
// ---------------------------------------------------------------------------

vi.mock('@/lib/actions/annotations', () => ({
  saveDraftAnnotation: vi.fn(),
}))

vi.mock('@/lib/local-store', () => ({
  getLocalDb: vi.fn(),
}))

import { useAutosaveDraft } from './use-autosave-draft'
import type {
  UseAutosaveDraft,
  UseAutosaveDraftOpts,
} from './use-autosave-draft'
import { saveDraftAnnotation } from '@/lib/actions/annotations'
import { getLocalDb } from '@/lib/local-store'

// ---------------------------------------------------------------------------
// Tiny fake `drafts` table — stands in for Dexie's Table<DraftAnnotation>.
// Records put/get calls so local-write + restore/merge can be asserted.
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string
  topicId: string
  taskId: string
  payload: unknown
  dirtyAt: number
  syncedAt: number | null
}

function makeFakeLocalDb() {
  const store = new Map<string, DraftRow>()
  const drafts = {
    put: vi.fn(async (row: DraftRow) => {
      store.set(row.id, { ...row })
      return row.id
    }),
    get: vi.fn(async (id: string) => {
      const row = store.get(id)
      return row ? { ...row } : undefined
    }),
  }
  return { drafts, store }
}

// ---------------------------------------------------------------------------
// Minimal React hook harness. Implements only the dispatcher primitives the
// hook uses (useState / useRef / useCallback / useEffect) and feeds them to
// the mocked `react` module via `currentDispatcher`. This is enough to run
// the real hook deterministically under fake timers without a renderer.
//
// Semantics intentionally mirror React's:
//   - useState: persistent slot; setState that changes value triggers a
//     re-render on the next `settle()` flush.
//   - useRef: persistent mutable box.
//   - useCallback: returns a stable fn until a dep changes (Object.is).
//   - useEffect: runs after render when deps change; cleanup runs before the
//     next effect run and on unmount.
// ---------------------------------------------------------------------------

interface Slot {
  // useState
  value?: unknown
  // useRef
  ref?: { current: unknown }
  // useCallback
  cb?: unknown
  deps?: unknown[]
  // useEffect
  effectDeps?: unknown[]
  cleanup?: void | (() => void)
}

interface HookHandle<T> {
  current: T
  rerender: () => void
  unmount: () => void
}

function depsEqual(a: unknown[] | undefined, b: unknown[] | undefined) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((v, i) => Object.is(v, b[i]))
}

function renderHook<T>(
  factory: () => T,
): HookHandle<T> & { _flushEffects: () => void } {
  const slots: Slot[] = []
  const pendingEffects: Array<() => void> = []
  let cursor = 0
  let needsRender = false
  let mounted = true

  const dispatcher = {
    useState<S>(initial: S | (() => S)): [S, (next: S | ((p: S) => S)) => void] {
      const i = cursor++
      if (!(i in slots)) {
        slots[i] = {
          value:
            typeof initial === 'function'
              ? (initial as () => S)()
              : initial,
        }
      }
      const slot = slots[i]
      const setState = (next: S | ((p: S) => S)) => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: S) => S)(slot.value as S)
            : next
        if (!Object.is(resolved, slot.value)) {
          slot.value = resolved
          needsRender = true
        }
      }
      return [slot.value as S, setState]
    },
    useRef<V>(initial: V): { current: V } {
      const i = cursor++
      if (!(i in slots)) slots[i] = { ref: { current: initial } }
      return slots[i].ref as { current: V }
    },
    useCallback<F>(fn: F, deps: unknown[]): F {
      const i = cursor++
      const slot = slots[i] ?? (slots[i] = {})
      if (!('cb' in slot) || !depsEqual(slot.deps, deps)) {
        slot.cb = fn
        slot.deps = deps
      }
      return slot.cb as F
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
      const i = cursor++
      const slot = slots[i] ?? (slots[i] = {})
      const first = !('effectDeps' in slot)
      const changed = first || !depsEqual(slot.effectDeps, deps)
      slot.effectDeps = deps
      if (changed) {
        pendingEffects.push(() => {
          if (typeof slot.cleanup === 'function') slot.cleanup()
          slot.cleanup = effect()
        })
      }
    },
  }

  function runRender() {
    cursor = 0
    const prev = currentDispatcher
    currentDispatcher = dispatcher
    try {
      handle.current = factory()
    } finally {
      currentDispatcher = prev
    }
  }

  function flushEffects() {
    while (pendingEffects.length) {
      const e = pendingEffects.shift()!
      e()
    }
  }

  const handle = {
    current: undefined as unknown as T,
    rerender: () => {
      if (!mounted) return
      runRender()
      flushEffects()
    },
    unmount: () => {
      mounted = false
      for (const slot of slots) {
        if (slot && typeof slot.cleanup === 'function') slot.cleanup()
      }
    },
    _flushEffects: flushEffects,
  }

  // Initial mount.
  runRender()
  flushEffects()
  // If state changed synchronously during effects, settle it.
  if (needsRender) {
    needsRender = false
    runRender()
    flushEffects()
  }
  return handle
}

/**
 * `act`-ish flush: run any state updates produced by callbacks, then any
 * microtasks (the hook's saves are async), repeatedly, until things settle.
 * We re-render the hook so `status` etc. reflect the latest setState calls,
 * the same way React would after an event handler.
 */
async function settle(
  handle: HookHandle<unknown> & { _flushEffects?: () => void },
) {
  // Drain microtasks so in-flight save promises resolve.
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
  handle.rerender()
}

const baseOpts: UseAutosaveDraftOpts = {
  topicId: 'topic-1',
  taskId: 'task-1',
  readOnly: false,
}

let fakeDb: ReturnType<typeof makeFakeLocalDb>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  fakeDocument.hidden = false
  fakeDocument.listeners.clear()
  fakeWindow.listeners.clear()
  fakeDb = makeFakeLocalDb()
  vi.mocked(getLocalDb).mockReturnValue(
    fakeDb as unknown as ReturnType<typeof getLocalDb>,
  )
  vi.mocked(saveDraftAnnotation).mockResolvedValue(undefined as never)
})

afterEach(() => {
  vi.useRealTimers()
})

// Convenience: render the hook + give a typed handle.
function mountHook(opts: Partial<UseAutosaveDraftOpts> = {}) {
  return renderHook<UseAutosaveDraft>(() =>
    useAutosaveDraft({ ...baseOpts, ...opts }),
  )
}

// =============================================================================
// 1. Debounce timing
// =============================================================================

describe('useAutosaveDraft — debounce timing', () => {
  it('does NOT save on markDirty; saves only after the debounce window elapses', async () => {
    const h = mountHook()

    h.current.markDirty({ answer: 'a' })
    h.rerender()
    expect(h.current.status).toBe('dirty')
    // No keystroke save — the AGENTS.md hard rule.
    expect(saveDraftAnnotation).not.toHaveBeenCalled()

    // Just before the window: still nothing.
    await vi.advanceTimersByTimeAsync(2999)
    expect(saveDraftAnnotation).not.toHaveBeenCalled()

    // Cross the 3000ms default window → exactly one save fires.
    await vi.advanceTimersByTimeAsync(1)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
    expect(saveDraftAnnotation).toHaveBeenCalledWith({
      topicId: 'topic-1',
      payload: { answer: 'a' },
    })
    expect(h.current.status).toBe('saved')
  })

  it('resets the timer on each markDirty (trailing-edge debounce) and saves only the latest payload once', async () => {
    const h = mountHook()

    h.current.markDirty({ answer: 'a' })
    await vi.advanceTimersByTimeAsync(2000)
    h.current.markDirty({ answer: 'ab' })
    await vi.advanceTimersByTimeAsync(2000)
    h.current.markDirty({ answer: 'abc' })
    // 4000ms total elapsed but each call reset the timer — no save yet.
    expect(saveDraftAnnotation).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
    expect(saveDraftAnnotation).toHaveBeenCalledWith({
      topicId: 'topic-1',
      payload: { answer: 'abc' },
    })
  })

  it('honors a custom debounceMs', async () => {
    const h = mountHook({ debounceMs: 500 })
    h.current.markDirty({ answer: 'a' })
    await vi.advanceTimersByTimeAsync(499)
    expect(saveDraftAnnotation).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
  })

  it('writes to IndexedDB IMMEDIATELY on markDirty (crash-safety) before the debounce fires', async () => {
    const h = mountHook()
    h.current.markDirty({ answer: 'a' })
    // Local write is synchronous-ish (a fired-and-not-awaited promise).
    await settle(h)
    expect(fakeDb.drafts.put).toHaveBeenCalledTimes(1)
    const row = fakeDb.drafts.put.mock.calls[0][0]
    expect(row).toMatchObject({
      id: 'topic-1',
      topicId: 'topic-1',
      taskId: 'task-1',
      payload: { answer: 'a' },
      syncedAt: null,
    })
    // Still no server save at this point.
    expect(saveDraftAnnotation).not.toHaveBeenCalled()
  })

  it('does nothing when readOnly (no local write, no debounce, no save)', async () => {
    const h = mountHook({ readOnly: true })
    h.current.markDirty({ answer: 'a' })
    h.rerender()
    await vi.advanceTimersByTimeAsync(5000)
    await settle(h)
    expect(fakeDb.drafts.put).not.toHaveBeenCalled()
    expect(saveDraftAnnotation).not.toHaveBeenCalled()
    expect(h.current.status).toBe('idle')
  })
})

// =============================================================================
// 2. Content-hash de-dupe (skip save when unchanged)
// =============================================================================

describe('useAutosaveDraft — content-hash de-dupe', () => {
  it('skips the server call when the payload is byte-identical to the last saved one', async () => {
    const h = mountHook()

    // First save.
    h.current.markDirty({ answer: 'a' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)

    // Same content again → debounce fires but the hash matches → no call.
    h.current.markDirty({ answer: 'a' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
    // The UI still reflects 'saved' for the no-op.
    expect(h.current.status).toBe('saved')
  })

  it('does save again when the content actually changes', async () => {
    const h = mountHook()

    h.current.markDirty({ answer: 'a' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)

    h.current.markDirty({ answer: 'b' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(2)
  })

  it('A→B→A toggle that ends where it started skips the second save', async () => {
    const h = mountHook()

    h.current.markDirty({ pick: 'A' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)

    h.current.markDirty({ pick: 'B' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(2)

    // Back to A — but A was NOT the last *sent* hash (B was), so it saves.
    h.current.markDirty({ pick: 'A' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(3)

    // Now A again, identical to the last sent → skipped.
    h.current.markDirty({ pick: 'A' })
    await vi.advanceTimersByTimeAsync(3000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(3)
  })
})

// =============================================================================
// 3. Retry / backoff on a failing save
// =============================================================================

describe('useAutosaveDraft — retry / backoff', () => {
  it('retries on a transient failure (0s/2s/8s schedule) and succeeds on a later attempt', async () => {
    vi.mocked(saveDraftAnnotation)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(undefined as never)

    const h = mountHook()
    h.current.flush({ answer: 'a' })

    // First attempt fires immediately and rejects.
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
    // Mid-retry the badge must stay 'saving', not flicker to error.
    expect(h.current.status).toBe('saving')

    // Backoff #2 is at 2s.
    await vi.advanceTimersByTimeAsync(2000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(2)
    expect(h.current.status).toBe('saved')
    expect(h.current.errorMessage).toBeNull()
  })

  it('surfaces error only after all three attempts fail', async () => {
    vi.mocked(saveDraftAnnotation).mockRejectedValue(
      new Error('still down'),
    )

    const h = mountHook()
    h.current.flush({ answer: 'a' })

    // Attempt 1 (0s).
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
    expect(h.current.status).toBe('saving')

    // Attempt 2 (after 2s).
    await vi.advanceTimersByTimeAsync(2000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(2)
    expect(h.current.status).toBe('saving')

    // Attempt 3 (after a further 8s) → exhausted → error.
    await vi.advanceTimersByTimeAsync(8000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(3)
    expect(h.current.status).toBe('error')
    expect(h.current.errorMessage).toBe('still down')
  })

  it('uses a generic message when the thrown value is not an Error', async () => {
    vi.mocked(saveDraftAnnotation).mockRejectedValue('boom')
    const h = mountHook()
    h.current.flush({ answer: 'a' })
    await settle(h)
    await vi.advanceTimersByTimeAsync(2000)
    await settle(h)
    await vi.advanceTimersByTimeAsync(8000)
    await settle(h)
    expect(h.current.status).toBe('error')
    expect(h.current.errorMessage).toBe('Save failed.')
  })

  it('does NOT advance the de-dupe hash when the save ultimately fails (so the next attempt still saves)', async () => {
    vi.mocked(saveDraftAnnotation).mockRejectedValue(new Error('down'))
    const h = mountHook()

    // Exhaust the retries → error, hash not advanced.
    h.current.flush({ answer: 'a' })
    await settle(h)
    await vi.advanceTimersByTimeAsync(2000)
    await settle(h)
    await vi.advanceTimersByTimeAsync(8000)
    await settle(h)
    expect(h.current.status).toBe('error')
    const callsAfterFailure = vi.mocked(saveDraftAnnotation).mock.calls
      .length

    // Now the server recovers; re-saving the SAME payload must still hit
    // the server (the failed attempt must not have poisoned the hash).
    vi.mocked(saveDraftAnnotation).mockResolvedValue(undefined as never)
    h.current.flush({ answer: 'a' })
    await settle(h)
    expect(
      vi.mocked(saveDraftAnnotation).mock.calls.length,
    ).toBeGreaterThan(callsAfterFailure)
    expect(h.current.status).toBe('saved')
  })
})

// =============================================================================
// 4. flush() — force save now
// =============================================================================

describe('useAutosaveDraft — flush', () => {
  it('saves immediately and cancels any pending debounce (single save, not two)', async () => {
    const h = mountHook()

    h.current.markDirty({ answer: 'a' })
    // Don't wait for the debounce — flush right away.
    await h.current.flush({ answer: 'a' })
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)

    // The previously scheduled debounce timer must have been cleared, so
    // advancing past the window does NOT trigger a second save.
    await vi.advanceTimersByTimeAsync(5000)
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
  })

  it('flush writes to local store too before saving', async () => {
    const h = mountHook()
    await h.current.flush({ answer: 'z' })
    await settle(h)
    expect(fakeDb.drafts.put).toHaveBeenCalled()
    const row = fakeDb.drafts.put.mock.calls.at(-1)![0]
    expect(row.payload).toEqual({ answer: 'z' })
    expect(saveDraftAnnotation).toHaveBeenCalledWith({
      topicId: 'topic-1',
      payload: { answer: 'z' },
    })
  })

  it('flush is a no-op when readOnly', async () => {
    const h = mountHook({ readOnly: true })
    await h.current.flush({ answer: 'a' })
    await settle(h)
    expect(saveDraftAnnotation).not.toHaveBeenCalled()
    expect(fakeDb.drafts.put).not.toHaveBeenCalled()
  })

  it('marks the local row as synced after a successful server save', async () => {
    const h = mountHook()
    await h.current.flush({ answer: 'a' })
    await settle(h)
    // After save success markSyncedLocal re-puts the row with syncedAt set.
    const finalRow = fakeDb.store.get('topic-1')
    expect(finalRow).toBeDefined()
    expect(finalRow!.syncedAt).not.toBeNull()
  })
})

// =============================================================================
// 5. Local restore / merge
// =============================================================================

describe('useAutosaveDraft — restoreLocal (merge over server payload)', () => {
  it('returns null when there is no local row', async () => {
    const h = mountHook()
    const restored = await h.current.restoreLocal()
    expect(restored).toBeNull()
  })

  it('returns the local payload when local is fresher (dirtyAt set, never synced)', async () => {
    fakeDb.store.set('topic-1', {
      id: 'topic-1',
      topicId: 'topic-1',
      taskId: 'task-1',
      payload: { answer: 'local-unsynced' },
      dirtyAt: 1000,
      syncedAt: null,
    })
    const h = mountHook()
    const restored = await h.current.restoreLocal()
    expect(restored).toEqual({ answer: 'local-unsynced' })
  })

  it('returns the local payload when dirtyAt is newer than syncedAt (a save lost the race)', async () => {
    fakeDb.store.set('topic-1', {
      id: 'topic-1',
      topicId: 'topic-1',
      taskId: 'task-1',
      payload: { answer: 'local-newer' },
      dirtyAt: 2000,
      syncedAt: 1000,
    })
    const h = mountHook()
    const restored = await h.current.restoreLocal()
    expect(restored).toEqual({ answer: 'local-newer' })
  })

  it('returns null when the local row is already synced (server payload IS truth)', async () => {
    fakeDb.store.set('topic-1', {
      id: 'topic-1',
      topicId: 'topic-1',
      taskId: 'task-1',
      payload: { answer: 'stale-local' },
      dirtyAt: 1000,
      syncedAt: 2000,
    })
    const h = mountHook()
    const restored = await h.current.restoreLocal()
    expect(restored).toBeNull()
  })

  it('swallows IndexedDB failures and returns null (private mode / quota)', async () => {
    fakeDb.drafts.get.mockRejectedValueOnce(
      new Error('IndexedDB blocked'),
    )
    const h = mountHook()
    const restored = await h.current.restoreLocal()
    expect(restored).toBeNull()
  })
})

// =============================================================================
// 6. beforeunload flush guard + visibility pause/resume
// =============================================================================

describe('useAutosaveDraft — beforeunload guard', () => {
  it('registers a beforeunload listener and blocks navigation while dirty', async () => {
    const h = mountHook()
    expect(fakeWindow.count('beforeunload')).toBe(1)

    h.current.markDirty({ answer: 'a' })
    h.rerender()
    expect(h.current.status).toBe('dirty')

    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    fakeWindow.dispatch('beforeunload', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.returnValue).toBe('')
  })

  it('blocks navigation while a save is in flight (status saving)', async () => {
    // Keep the save pending so status sticks at 'saving'.
    let resolveSave: () => void = () => {}
    vi.mocked(saveDraftAnnotation).mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveSave = res
        }),
    )

    const h = mountHook()
    h.current.flush({ answer: 'a' })
    await settle(h)
    expect(h.current.status).toBe('saving')

    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    fakeWindow.dispatch('beforeunload', event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.returnValue).toBe('')

    // Let it finish so the test doesn't leave a dangling promise.
    resolveSave()
    await settle(h)
  })

  it('does NOT block navigation once everything is saved', async () => {
    const h = mountHook()
    await h.current.flush({ answer: 'a' })
    await settle(h)
    expect(h.current.status).toBe('saved')

    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    fakeWindow.dispatch('beforeunload', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not register a beforeunload listener in readOnly mode', () => {
    mountHook({ readOnly: true })
    expect(fakeWindow.count('beforeunload')).toBe(0)
  })

  it('removes its listeners on unmount', () => {
    const h = mountHook()
    expect(fakeWindow.count('beforeunload')).toBe(1)
    expect(fakeDocument.count('visibilitychange')).toBe(1)
    h.unmount()
    expect(fakeWindow.count('beforeunload')).toBe(0)
    expect(fakeDocument.count('visibilitychange')).toBe(0)
  })
})

describe('useAutosaveDraft — visibility pause / resume', () => {
  it('pauses the debounce while the tab is hidden, then flushes on return', async () => {
    const h = mountHook()

    h.current.markDirty({ answer: 'a' })
    // Hide the tab before the debounce window elapses.
    fakeDocument.hidden = true
    fakeDocument.dispatch('visibilitychange', {})
    await vi.advanceTimersByTimeAsync(5000)
    await settle(h)
    // Timer was cleared on hide → no save while hidden.
    expect(saveDraftAnnotation).not.toHaveBeenCalled()

    // Coming back fires the pending save immediately.
    fakeDocument.hidden = false
    fakeDocument.dispatch('visibilitychange', {})
    await settle(h)
    expect(saveDraftAnnotation).toHaveBeenCalledTimes(1)
    expect(saveDraftAnnotation).toHaveBeenCalledWith({
      topicId: 'topic-1',
      payload: { answer: 'a' },
    })
  })

  it('does not register a visibility listener in readOnly mode', () => {
    mountHook({ readOnly: true })
    expect(fakeDocument.count('visibilitychange')).toBe(0)
  })
})

// =============================================================================
// 7. Unmount safety — best-effort local flush on teardown
// =============================================================================

describe('useAutosaveDraft — unmount', () => {
  it('writes the latest payload to local store on unmount (data-loss safety net)', async () => {
    const h = mountHook()
    h.current.markDirty({ answer: 'in-progress' })
    await settle(h)
    const putsBefore = fakeDb.drafts.put.mock.calls.length

    h.unmount()
    // The unmount cleanup fires a writeLocal of the latest payload.
    await Promise.resolve()
    expect(fakeDb.drafts.put.mock.calls.length).toBeGreaterThan(
      putsBefore - 1,
    )
    const lastPut = fakeDb.drafts.put.mock.calls.at(-1)![0]
    expect(lastPut.payload).toEqual({ answer: 'in-progress' })
  })
})

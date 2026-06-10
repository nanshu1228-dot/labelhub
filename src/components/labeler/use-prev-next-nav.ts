'use client'

/**
 * Keyboard prev/next navigation hook — Finals P5 D16.
 *
 * Annotators clearing a queue benefit from vim-style J/K and arrow-
 * key navigation between topics — no mouse round-trip after each
 * submit. The hook attaches a global keydown listener while the
 * Labeler page is mounted; the listener calls the parent's
 * onPrev / onNext callbacks but ignores key events that originate
 * inside a text input / textarea / contenteditable / select (so
 * typing letter "j" in a textarea doesn't navigate).
 *
 *   J / ArrowDown / N  → next
 *   K / ArrowUp   / P  → prev
 *   S              → skip
 *
 * Vim conventions where the keys overlap with form inputs; arrow
 * keys give a discoverable fallback.
 */

import { useEffect } from 'react'

export interface UsePrevNextNavOptions {
  /** Called when the user presses J / ArrowDown / N. */
  onNext?: () => void
  /** Called when the user presses K / ArrowUp / P. */
  onPrev?: () => void
  /** Called when the user presses S. */
  onSkip?: () => void
  /** Set to false to temporarily disable the listener (e.g. modal open). */
  enabled?: boolean
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export type NavigationIntent = 'next' | 'prev' | 'skip'

export function navigationIntentForKey(key: string): NavigationIntent | null {
  if (key === 'j' || key === 'J' || key === 'ArrowDown' || key === 'n' || key === 'N') {
    return 'next'
  }
  if (key === 'k' || key === 'K' || key === 'ArrowUp' || key === 'p' || key === 'P') {
    return 'prev'
  }
  if (key === 's' || key === 'S') {
    return 'skip'
  }
  return null
}

export function usePrevNextNav({
  onNext,
  onPrev,
  onSkip,
  enabled = true,
}: UsePrevNextNavOptions): void {
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    function handler(e: KeyboardEvent) {
      // Ignore modifier-key combinations entirely — Ctrl+J etc. is
      // browser/OS territory.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Ignore key events originating from a form element.
      const target = e.target as HTMLElement | null
      if (target) {
        if (FORM_TAGS.has(target.tagName)) return
        if (target.isContentEditable) return
      }
      const intent = navigationIntentForKey(e.key)
      if (intent === 'next') {
        if (onNext) {
          e.preventDefault()
          onNext()
        }
      } else if (intent === 'prev') {
        if (onPrev) {
          e.preventDefault()
          onPrev()
        }
      } else if (intent === 'skip') {
        if (onSkip) {
          e.preventDefault()
          onSkip()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [onNext, onPrev, onSkip, enabled])
}

/**
 * Pure decision function — given a current id and an ordered id
 * list, return the prev / next ids. Used by both the hook caller
 * (to compute hrefs) and the unit tests.
 */
export function neighborIds(
  ids: ReadonlyArray<string>,
  currentId: string,
): { prev: string | null; next: string | null } {
  const i = ids.indexOf(currentId)
  if (i === -1) return { prev: null, next: null }
  return {
    prev: i > 0 ? ids[i - 1] : null,
    next: i < ids.length - 1 ? ids[i + 1] : null,
  }
}

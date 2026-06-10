'use client'

import Link from 'next/link'

/**
 * Root runtime-error boundary. Client component (Next requires `"use client"`
 * for `error.tsx`). Catches uncaught render/data errors below the root layout
 * and renders the light `.app-light` shell so a crash stays on-theme. `reset`
 * re-attempts rendering the segment; the home link is the escape hatch.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main
      className="app-light min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="text-center" style={{ maxWidth: 440 }}>
        <div className="lbl mb-3" style={{ color: 'var(--danger)' }}>
          SOMETHING WENT WRONG
        </div>
        <h1 className="ts-32" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          An unexpected error occurred
        </h1>
        <p className="ts-14 mt-3" style={{ color: 'var(--mute)' }}>
          Sorry about that. You can try again, or head back home and pick up
          where you left off.
        </p>
        {error.digest && (
          <p className="ts-12 mono mt-2" style={{ color: 'var(--mute2)' }}>
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button type="button" className="lh-btn lh-btn-accent" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/" className="lh-btn lh-btn-ghost">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

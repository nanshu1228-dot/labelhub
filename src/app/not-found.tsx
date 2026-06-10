import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Page not found — LabelHub',
}

/**
 * Root 404 boundary. Server component — caught by Next when a route or
 * `notFound()` resolves to nothing. Renders the light `.app-light` shell so a
 * bad URL stays on-theme instead of falling back to the off-theme Next default.
 */
export default function NotFound() {
  return (
    <main
      className="app-light min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="text-center" style={{ maxWidth: 440 }}>
        <div className="lbl mb-3" style={{ color: 'var(--mute2)' }}>
          ERROR 404
        </div>
        <h1 className="ts-32" style={{ color: 'var(--hi)', fontWeight: 500 }}>
          Page not found
        </h1>
        <p className="ts-14 mt-3" style={{ color: 'var(--mute)' }}>
          The page you&apos;re looking for doesn&apos;t exist, moved, or the
          link was mistyped.
        </p>
        <div className="mt-6 flex items-center justify-center">
          <Link href="/" className="lh-btn lh-btn-accent">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

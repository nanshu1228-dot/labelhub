'use client'

/**
 * Root-level crash boundary. When the root layout itself throws, Next replaces
 * the WHOLE document with this component — so it must render its own
 * `<html><body>`. globals.css may not be applied, so the themed copy is
 * inline-styled to the light palette (matching `.app-light` token values) and
 * kept deliberately minimal. `reset` re-attempts the root render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          background: 'oklch(0.99 0 0)',
          color: 'oklch(0.20 0 0)',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 440 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.04em',
              color: 'oklch(0.55 0.2 25)',
              marginBottom: 12,
            }}
          >
            SOMETHING WENT WRONG
          </div>
          <h1
            style={{
              fontSize: 32,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              fontWeight: 500,
              margin: 0,
              color: 'oklch(0.13 0 0)',
            }}
          >
            The app hit an unexpected error
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, marginTop: 12, color: 'oklch(0.50 0 0)' }}>
            Sorry about that. Try reloading, or head back home.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, marginTop: 8, color: 'oklch(0.62 0 0)' }}>
              Reference: {error.digest}
            </p>
          )}
          <div
            style={{
              marginTop: 24,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                background: 'oklch(0.6 0.18 280)',
                color: 'white',
                border: '1px solid oklch(0.6 0.18 280)',
              }}
            >
              Try again
            </button>
            {/* global-error replaces the root layout on a root-level crash —
                the Next router/<Link> context is gone, so a plain anchor
                (full reload) is the correct way home here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                height: 36,
                padding: '0 14px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                background: 'transparent',
                color: 'oklch(0.20 0 0)',
                border: '1px solid oklch(0.92 0 0)',
              }}
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}

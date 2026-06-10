'use client'

/**
 * Auth controls on the right of the top nav.
 *
 * Two states:
 *   - Signed out → "Sign in" link + "Sign up" CTA.
 *   - Signed in  → email pill + sign-out form (POST /signout).
 *
 * The sign-out is a native `<form>` so it works without JS — better UX
 * if the user is already on a slow page that hasn't hydrated yet.
 */

const ARROW = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M3 6h6m0 0L6 3m3 3L6 9"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
    />
  </svg>
)

export function NavAuthControls({ userEmail }: { userEmail: string | null }) {
  if (userEmail) {
    return (
      <>
        <a
          href="/account"
          className="hidden sm:inline mono"
          style={{
            fontSize: 12,
            color: 'var(--text)',
            padding: '4px 10px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            transition: 'color 120ms, border-color 120ms',
          }}
          title={`Account: ${userEmail}`}
        >
          {userEmail}
        </a>
        <form action="/signout" method="post">
          <button type="submit" className="nav-link" style={{ background: 'transparent', border: 0, cursor: 'pointer' }}>
            Sign out
          </button>
        </form>
      </>
    )
  }

  return (
    <>
      <a href="/signin" className="nav-link hidden sm:inline">
        Sign in
      </a>
      <a href="/signup" className="lh-btn lh-btn-solid">
        Sign up
        {ARROW}
      </a>
    </>
  )
}

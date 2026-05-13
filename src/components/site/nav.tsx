import { optionalUser } from '@/lib/auth/guards'
import { LangSwitch } from './lang-switch'
import { NavAuthControls } from './nav-auth-controls'

/**
 * Top nav for marketing surfaces.
 *
 * Server-rendered to inline the user's session state in the first paint —
 * judges should see "Sign in / Sign up" or their email immediately, with no
 * flicker. The login state itself is read via `optionalUser()` (returns
 * null when no session).
 *
 * Auth controls + lang switch are split into client subcomponents so the
 * outer wrapper can stay an RSC.
 */
export async function SiteNav() {
  const user = await optionalUser()
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'oklch(0.13 0 0 / 0.78)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid oklch(0.22 0 0)',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <a href="/" className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="0.5" y="0.5" width="17" height="17" rx="4" stroke="oklch(0.6 0.18 280)" />
              <path
                d="M5 4.5V13.5H13"
                stroke="oklch(0.6 0.18 280)"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
            </svg>
            <span
              className="lh-body font-medium"
              style={{ color: 'oklch(0.92 0 0)', letterSpacing: '-0.01em' }}
            >
              LabelHub
            </span>
          </a>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#templates" className="nav-link">Templates</a>
            <a href="/workspaces/00000000-0000-0000-0000-000000000010" className="nav-link">
              Demo workspace
            </a>
            <a href="https://github.com/nanshu1228-dot/labelhub" className="nav-link" target="_blank" rel="noreferrer">
              Docs
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LangSwitch />
          <NavAuthControls userEmail={user?.email ?? null} />
        </div>
      </div>
    </header>
  )
}

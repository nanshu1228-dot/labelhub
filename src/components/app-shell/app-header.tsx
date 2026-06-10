import Link from 'next/link'
import { optionalUser, resolveRoleSummary } from '@/lib/auth/guards'
import { countUnreadNotifications } from '@/lib/queries/notifications'

/**
 * AppHeader — Finals D20-A.
 *
 * Persistent top bar mounted via the `(app)` route-group layout so
 * every signed-in surface (`/my/*`, `/admin/*`, `/review/*`,
 * `/workspaces/*`) gets the same nav for free.
 *
 * Role-aware entry pills:
 *   - "Tasks"  → /my/tasks   — shown to any user with any role
 *   - "Review" → /review     — shown iff qc or admin role somewhere
 *   - "Admin"  → /admin      — shown iff admin role somewhere
 *
 * Mobile (< 768px): wordmark + a CSS-only `<details>` drawer hides
 * the pills behind a hamburger so the header doesn't dominate
 * narrow viewports. The drawer summary itself is a 44px touch
 * target.
 *
 * Server component. Renders only once per page and only fires the
 * role-summary query + unread-count query once thanks to
 * `React.cache`. Zero client JS for the popular case (signed-out
 * landing pages don't even mount this — they live outside (app)).
 */
export async function AppHeader() {
  const user = await optionalUser()
  const [roleSummary, unread] = await Promise.all([
    resolveRoleSummary(user?.id ?? null),
    user ? countUnreadNotifications(user.id).catch(() => 0) : Promise.resolve(0),
  ])

  const canReview = roleSummary.hasAdmin || roleSummary.hasQc
  const canAdmin = roleSummary.hasAdmin
  const canAnnotate =
    !!user &&
    (roleSummary.hasAdmin ||
      roleSummary.hasQc ||
      roleSummary.hasAnnotator)

  return (
    <header
      className="border-b"
      style={{
        background: 'var(--bg)',
        borderColor: 'var(--line)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}
    >
      <div className="mx-auto max-w-[1280px] flex items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="ts-13 mono inline-flex items-center"
          style={{
            color: 'var(--hi)',
            textDecoration: 'none',
            fontWeight: 600,
            minHeight: 44,
          }}
        >
          LabelHub
        </Link>

        {/* Desktop pills — hidden under 768px. */}
        <nav
          className="hidden md:flex items-center gap-1"
          aria-label="Primary"
        >
          {canAnnotate ? <HeaderPill href="/my/tasks" label="Tasks" /> : null}
          {canReview ? <HeaderPill href="/review" label="Review" /> : null}
          {canAdmin ? <HeaderPill href="/admin" label="Admin" /> : null}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/my/inbox"
                className="hidden md:inline-flex items-center gap-1.5 ts-12 mono rounded"
                style={{
                  minHeight: 44,
                  padding: '0 12px',
                  background: unread > 0 ? 'var(--accent-soft)' : 'transparent',
                  color: unread > 0 ? 'var(--accent)' : 'var(--mute)',
                  border: `1px solid ${unread > 0 ? 'var(--accent-line)' : 'var(--line)'}`,
                  textDecoration: 'none',
                }}
                aria-label={`Inbox${unread > 0 ? ` (${unread} unread)` : ''}`}
              >
                <span aria-hidden>✉</span>
                <span>Inbox</span>
                {unread > 0 ? (
                  <span
                    className="ts-11"
                    style={{
                      background: 'var(--accent)',
                      color: 'white',
                      borderRadius: 999,
                      padding: '0 8px',
                      minWidth: 20,
                      textAlign: 'center',
                      lineHeight: '18px',
                    }}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </Link>
              <UserMenu
                displayName={user.email}
                email={user.email}
              />
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/signup"
                className="hidden sm:inline-flex items-center ts-12 mono rounded"
                style={{
                  minHeight: 44,
                  padding: '0 12px',
                  background: 'transparent',
                  color: 'var(--text)',
                  border: '1px solid var(--line)',
                  textDecoration: 'none',
                }}
              >
                Sign up
              </Link>
              <Link
                href="/signin"
                className="ts-12 mono rounded inline-flex items-center"
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  background: 'oklch(0.6 0.18 280)',
                  color: 'white',
                  border: '1px solid oklch(0.6 0.18 280 / 0.6)',
                  textDecoration: 'none',
                }}
              >
                Sign in
              </Link>
            </div>
          )}

          {/* Mobile hamburger drawer — pure CSS via <details>. */}
          {user ? (
            <details className="md:hidden relative">
              <summary
                className="ts-13 mono inline-flex items-center justify-center rounded"
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                  color: 'var(--text)',
                  listStyle: 'none',
                  cursor: 'pointer',
                }}
                aria-label="Open menu"
              >
                ☰
              </summary>
              <div
                className="absolute right-0 mt-2 flex flex-col rounded"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  minWidth: 200,
                  padding: 6,
                  boxShadow: '0 8px 24px oklch(0 0 0 / 0.25)',
                  zIndex: 40,
                }}
              >
                {canAnnotate ? <DrawerLink href="/my/tasks" label="Tasks" /> : null}
                {canReview ? <DrawerLink href="/review" label="Review" /> : null}
                {canAdmin ? <DrawerLink href="/admin" label="Admin" /> : null}
                <DrawerLink
                  href="/my/inbox"
                  label={unread > 0 ? `Inbox (${unread})` : 'Inbox'}
                />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function HeaderPill({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center rounded"
      style={{
        minHeight: 44,
        padding: '0 14px',
        background: 'transparent',
        color: 'var(--text)',
        border: '1px solid transparent',
        textDecoration: 'none',
      }}
    >
      {label}
    </Link>
  )
}

function DrawerLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="ts-13 mono rounded"
      style={{
        minHeight: 44,
        padding: '10px 12px',
        color: 'var(--text)',
        textDecoration: 'none',
        display: 'block',
      }}
    >
      {label}
    </Link>
  )
}

function UserMenu({
  displayName,
  email,
}: {
  displayName: string
  email: string
}) {
  return (
    <details className="relative">
      <summary
        className="ts-12 mono inline-flex items-center gap-2 rounded"
        style={{
          minHeight: 44,
          padding: '0 12px',
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          listStyle: 'none',
          cursor: 'pointer',
        }}
        aria-label={`Account · ${displayName}`}
      >
        <span
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: 24,
            height: 24,
            background: 'oklch(0.6 0.18 280)',
            color: 'white',
            fontSize: 12,
          }}
          aria-hidden
        >
          {initials(displayName)}
        </span>
        <span className="hidden lg:inline">{displayName}</span>
      </summary>
      <div
        className="absolute right-0 mt-2 flex flex-col rounded"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          minWidth: 220,
          padding: 6,
          boxShadow: '0 8px 24px oklch(0 0 0 / 0.25)',
          zIndex: 40,
        }}
      >
        <div
          className="ts-11 mono"
          style={{
            color: 'var(--mute2)',
            padding: '6px 10px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          {email}
        </div>
        <DrawerLink href="/my/tasks" label="My tasks" />
        <DrawerLink href="/my/queue" label="Flat queue" />
        <DrawerLink href="/my/submissions" label="My submissions" />
        <DrawerLink href="/my/quality" label="My quality" />
        <DrawerLink href="/my/earnings" label="Earnings" />
        <DrawerLink href="/account" label="Account" />
        <DrawerLink href="/signout" label="Sign out" />
      </div>
    </details>
  )
}

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const at = trimmed.indexOf('@')
  const base = at > 0 ? trimmed.slice(0, at) : trimmed
  const parts = base.split(/\s+|[._-]/).filter(Boolean)
  if (parts.length === 0) return base.charAt(0).toUpperCase()
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

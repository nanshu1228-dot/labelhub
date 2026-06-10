'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Persistent in-workspace navigation spine.
 *
 * Before this existed, every workspace section hung off a single tile
 * grid on the hub page — once you navigated in there was no way to hop
 * between sections or back to the workspace except the browser back
 * button (the global header wordmark exits to `/`). This bar fixes that:
 * a breadcrumb back to the workspace overview plus tabs for every
 * visible section (the server already filtered them through focus mode +
 * template-mode rules via `visibleWorkspaceSections`).
 *
 * Client component so it can resolve the active tab from `usePathname`
 * and self-hide on the immersive, full-bleed surfaces (the annotator and
 * the trajectory inspector) where a top bar would fight the 100vh panes.
 */

export interface SubnavSection {
  key: string
  label: string
  /** Path suffix after `/workspaces/[id]` (`''` is the overview hub). */
  path: string
}

export function WorkspaceSubnav({
  workspaceId,
  workspaceName,
  sections,
}: {
  workspaceId: string
  workspaceName: string
  sections: SubnavSection[]
}) {
  const pathname = usePathname() ?? ''
  const base = `/workspaces/${workspaceId}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname

  // Immersive, full-bleed routes own the whole viewport — don't stack a
  // nav bar on top of their 100vh layouts.
  const immersive = /\/annotate$/.test(rest) || /^\/trajectories\/[^/]+/.test(rest)
  if (immersive) return null

  // Active = the most specific section whose path prefixes the current
  // route. Overview (path '') only wins when we're exactly on the hub.
  let activeKey = 'overview'
  let bestLen = -1
  for (const s of sections) {
    const matches =
      s.path === ''
        ? rest === '' || rest === '/'
        : rest === s.path || rest.startsWith(s.path + '/')
    if (matches && s.path.length > bestLen) {
      activeKey = s.key
      bestLen = s.path.length
    }
  }

  return (
    <nav
      aria-label="Workspace"
      className="hairline-b"
      style={{ background: 'var(--panel2)' }}
    >
      <div className="mx-auto max-w-[1280px] flex items-center gap-3 px-4 sm:px-6 overflow-x-auto">
        <Link
          href={base}
          className="ts-12 mono whitespace-nowrap inline-flex items-center"
          style={{
            color: 'var(--mute)',
            textDecoration: 'none',
            padding: '10px 0',
          }}
        >
          <span style={{ color: 'var(--hi)', fontWeight: 600 }}>
            {workspaceName}
          </span>
        </Link>
        <span className="ts-12 mono" style={{ color: 'var(--line2)' }} aria-hidden>
          /
        </span>
        <div className="flex items-center gap-1">
          {sections.map((s) => {
            const active = s.key === activeKey
            return (
              <Link
                key={s.key}
                href={base + s.path}
                aria-current={active ? 'page' : undefined}
                className="ts-12 mono whitespace-nowrap inline-flex items-center rounded"
                style={{
                  color: active ? 'var(--hi)' : 'var(--mute)',
                  background: active ? 'oklch(0.94 0 0)' : 'transparent',
                  textDecoration: 'none',
                  padding: '6px 10px',
                  margin: '6px 0',
                  borderBottom: active
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                }}
              >
                {s.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

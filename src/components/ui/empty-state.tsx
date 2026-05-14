import Link from 'next/link'

/**
 * Shared empty-state primitive — one sentence + one CTA, per design brief.
 *
 *   "Empty states: 1 sentence + 1 CTA. No illustrations."
 *
 * Used wherever a list / dashboard would otherwise render "0 items + blank
 * table" — that's a worst-of-both signal (looks broken, gives no guidance).
 * This component is the single source of truth for the visual: a centered
 * card with a label / heading / description / optional CTA. Three callsites
 * picking different colors would drift; one component pinned.
 *
 * Pure server-renderable. Use from .tsx pages without `'use client'`.
 */

export interface EmptyStateProps {
  /** Small mono caps eyebrow ("§ NO TRAJECTORIES YET", "ANNOTATIONS"). */
  label?: string
  /** The "headline" line — what's missing. */
  title: string
  /** One sentence explaining what would fill this space + how. */
  description: string
  /** Optional CTA button — either an internal route or external URL. */
  cta?:
    | { kind: 'link'; href: string; label: string }
    | { kind: 'external'; href: string; label: string }
  /** Optional secondary link below the CTA (e.g. "Or read the docs"). */
  secondary?: { href: string; label: string }
  /**
   * Visual scale.
   * - 'page' (default): full-card with generous padding, used as the only
   *   content of a list/dashboard page.
   * - 'inline': compact, used inline inside other layouts.
   */
  scale?: 'page' | 'inline'
}

export function EmptyState({
  label,
  title,
  description,
  cta,
  secondary,
  scale = 'page',
}: EmptyStateProps) {
  const padding = scale === 'page' ? '48px 32px' : '24px 20px'
  const titleSize = scale === 'page' ? 'ts-20' : 'ts-16'
  const maxWidth = scale === 'page' ? 460 : 360

  return (
    <div
      className="rounded-xl mx-auto text-center"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        padding,
        maxWidth,
      }}
    >
      {label && (
        <div className="lbl mb-3" style={{ color: 'var(--mute2)' }}>
          {label}
        </div>
      )}
      <h3
        className={titleSize}
        style={{ color: 'var(--hi)', fontWeight: 500 }}
      >
        {title}
      </h3>
      <p
        className="ts-13 mt-2"
        style={{ color: 'var(--mute)', lineHeight: 1.5 }}
      >
        {description}
      </p>
      {cta && (
        <div className="mt-5 flex items-center justify-center gap-3">
          {cta.kind === 'link' ? (
            <Link
              href={cta.href}
              className="lh-btn lh-btn-sm inline-flex"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {cta.label}
            </Link>
          ) : (
            <a
              href={cta.href}
              target="_blank"
              rel="noreferrer"
              className="lh-btn lh-btn-sm inline-flex"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {cta.label} ↗
            </a>
          )}
        </div>
      )}
      {secondary && (
        <div className="mt-3 ts-12 mono" style={{ color: 'var(--mute2)' }}>
          <Link
            href={secondary.href}
            style={{ color: 'var(--accent)', textDecoration: 'none' }}
          >
            {secondary.label} →
          </Link>
        </div>
      )}
    </div>
  )
}

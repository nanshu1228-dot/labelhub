/**
 * Shared "database not reachable" panel.
 *
 * Pages tolerate a missing/unreachable DB so the design still renders in
 * local dev without Supabase. Previously each page hand-rolled a
 * byte-identical (or near-identical) copy of this panel; this is the single
 * source of truth. `title` and `description` are optional so a page can keep
 * its exact wording (e.g. a per-surface "Couldn't load this trajectory.").
 *
 * Pure server-renderable — use from .tsx pages without `'use client'`.
 */
export function DbError({
  message,
  title = '§ DATABASE NOT REACHABLE',
  description,
}: {
  message: string
  title?: string
  description?: string
}) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.05em' }}
      >
        {title}
      </div>
      {description && (
        <p className="ts-13" style={{ color: 'var(--text)' }}>
          {description}
        </p>
      )}
      <pre
        className={`${description ? 'mt-4' : 'mt-2'} ts-12 mono p-3 overflow-auto whitespace-pre-wrap`}
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
    </div>
  )
}

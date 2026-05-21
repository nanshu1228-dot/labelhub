'use client'

/**
 * Annotation-revision diff view — Finals P3 D11.
 *
 * Compares two revision snapshots (or the latest revision against
 * the current payload) field-by-field. The result is a list of
 * `{key, prev, next, status}` rows where status is one of:
 *   added   — key in next but not prev
 *   removed — key in prev but not next
 *   changed — both present, values differ
 *   same    — both present, equal (suppressed by default)
 *
 * Pure-function diff lives at the bottom of this file so the
 * audit-timeline can reuse it without mounting the React tree.
 */

import { useMemo } from 'react'

export interface DiffRevision {
  id: string
  kind: string
  ts: Date
  payload: Record<string, unknown>
}

export function DiffView({
  prev,
  next,
  title,
}: {
  prev: DiffRevision | null
  next: DiffRevision
  title?: string
}) {
  const diff = useMemo(
    () => diffPayloads(prev?.payload ?? {}, next.payload),
    [prev, next],
  )
  const changedRows = diff.filter((d) => d.status !== 'same')

  return (
    <section
      className="rounded p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <div
          className="lh-mono lh-caption"
          style={{ color: 'var(--mute)' }}
        >
          {title ?? 'CHANGES'}
        </div>
        <div
          className="ts-11 mono"
          style={{ color: 'var(--mute2)' }}
        >
          {prev ? (
            <>
              <span>{labelOf(prev)}</span>{' '}
              <span>→</span>{' '}
              <span>{labelOf(next)}</span>
            </>
          ) : (
            <span>{labelOf(next)} (initial)</span>
          )}
        </div>
      </div>
      {changedRows.length === 0 ? (
        <p className="ts-12" style={{ color: 'var(--mute2)' }}>
          No payload differences.
        </p>
      ) : (
        <table
          className="w-full ts-12 mono"
          style={{ borderCollapse: 'separate', borderSpacing: 0 }}
        >
          <thead>
            <tr style={{ color: 'var(--mute2)' }}>
              <th
                className="text-left px-2 py-1"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                Field
              </th>
              <th
                className="text-left px-2 py-1"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                Before
              </th>
              <th
                className="text-left px-2 py-1"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {changedRows.map((row) => (
              <tr
                key={row.key}
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <td className="px-2 py-1 align-top">
                  <code style={{ color: 'var(--text)' }}>{row.key}</code>
                  <span
                    className="ts-11 ml-2"
                    style={{ color: tintFor(row.status) }}
                  >
                    {row.status}
                  </span>
                </td>
                <td
                  className="px-2 py-1 align-top"
                  style={{ color: 'var(--mute)', whiteSpace: 'pre-wrap' }}
                >
                  {formatValue(row.prev)}
                </td>
                <td
                  className="px-2 py-1 align-top"
                  style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}
                >
                  {formatValue(row.next)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function labelOf(r: DiffRevision): string {
  return `${r.kind}@${r.ts.toISOString().slice(11, 16)}`
}

function tintFor(s: DiffRow['status']): string {
  if (s === 'added') return 'oklch(0.62 0.16 145)'
  if (s === 'removed') return 'var(--danger)'
  if (s === 'changed') return 'oklch(0.6 0.18 60)'
  return 'var(--mute2)'
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/**
 * Pure shallow-keys diff. Top-level keys only — nested objects
 * stringify and compare as a unit so the diff stays readable in a
 * 3-column table. (A deeper recursive diff is overkill for D11; the
 * stretch list keeps the per-revision side-by-side as a stretch.)
 */
export interface DiffRow {
  key: string
  prev: unknown
  next: unknown
  status: 'added' | 'removed' | 'changed' | 'same'
}

export function diffPayloads(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): DiffRow[] {
  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(next)])
  const out: DiffRow[] = []
  for (const k of keys) {
    const a = prev[k]
    const b = next[k]
    if (!(k in prev)) {
      out.push({ key: k, prev: undefined, next: b, status: 'added' })
    } else if (!(k in next)) {
      out.push({ key: k, prev: a, next: undefined, status: 'removed' })
    } else if (jsonEqual(a, b)) {
      out.push({ key: k, prev: a, next: b, status: 'same' })
    } else {
      out.push({ key: k, prev: a, next: b, status: 'changed' })
    }
  }
  return out
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

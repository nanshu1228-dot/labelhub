'use client'

/**
 * Import wizard — Finals D21-C.
 *
 * 4-step flow inside one page:
 *   1. Pick a file (drag-drop or browse). Format auto-detected via
 *      `detectFormat()`; PM can override the dropdown.
 *   2. Parse client-side via `pickParserFor(format)`. Show preview
 *      (first 10 successful rows + per-row error count).
 *   3. Configure distribution strategy (random / round-robin /
 *      quota). Annotator list is passed in from the server.
 *   4. Submit. Chunks of 100 → `createTopicsBatch` (the action's
 *      Zod cap is 100). Aggregates per-chunk counts + failed-row
 *      reports into one final summary.
 *
 * No new deps: reuses D14 parsers (`src/lib/import/parsers/`),
 * D14 distribution (`src/lib/import/distribution.ts`), and the
 * existing `createTopicsBatch` server action.
 */

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  detectFormat,
  pickParserFor,
  type ImportFormat,
  type ParsedRow,
} from '@/lib/import/parsers'
import {
  distributeTopics,
  type DistributionStrategy,
} from '@/lib/import/distribution'

export interface ImportWizardProps {
  taskId: string
  taskName: string
  templateMode: string
  /** Annotator pool for the workspace; UI shows weighted-quota when present. */
  annotators: ReadonlyArray<{ id: string; label: string }>
  /** Server action. Returns { created, failed }. */
  importBatch: (input: {
    taskId: string
    items: Record<string, unknown>[]
    assignments?: Array<string | null>
  }) => Promise<{ created: number; failed: Array<{ index: number; error: string }> }>
}

const FORMAT_LABELS: Record<ImportFormat, string> = {
  jsonl: 'JSON Lines (.jsonl)',
  json: 'JSON array (.json)',
  csv: 'CSV (.csv)',
  excel: 'Excel (.xlsx)',
}

const CHUNK_SIZE = 100

export function ImportWizard({
  taskId,
  taskName,
  templateMode,
  annotators,
  importBatch,
}: ImportWizardProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<ImportFormat | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [strategy, setStrategy] =
    useState<DistributionStrategy>('round-robin')
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting'; progress: number; total: number }
    | { kind: 'done'; created: number; failed: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const [, startSubmit] = useTransition()

  const successRows = useMemo(
    () => rows.filter((r) => r.row !== null && r.error === undefined),
    [rows],
  )
  const parseFailedRows = useMemo(
    () => rows.filter((r) => r.error !== undefined),
    [rows],
  )

  async function onFile(picked: File) {
    setFile(picked)
    setRows([])
    setParseError(null)
    setSubmitState({ kind: 'idle' })
    const detected = detectFormat(picked.name)
    if (detected) setFormat(detected)
  }

  async function parseFile() {
    if (!file || !format) return
    setParsing(true)
    setParseError(null)
    try {
      const parser = pickParserFor(format)
      // The browser File → Uint8Array path. parseExcel needs an
      // ArrayBuffer; parseJSON/JSONL/CSV accept Uint8Array. Either
      // way an ArrayBuffer works — collectToBuffer in each parser
      // handles ArrayBuffer + Uint8Array + string + iterable.
      const buf = new Uint8Array(await file.arrayBuffer())
      const collected: ParsedRow[] = []
      for await (const r of parser(buf)) {
        collected.push(r)
        // Hard cap to keep the browser from freezing on a runaway
        // file. createTopicsBatch will still chunk these in 100s.
        if (collected.length >= 5_000) break
      }
      setRows(collected)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Parse failed.')
    } finally {
      setParsing(false)
    }
  }

  function submit() {
    if (successRows.length === 0) return
    setSubmitState({
      kind: 'submitting',
      progress: 0,
      total: successRows.length,
    })
    startSubmit(async () => {
      try {
        // Per-row assignment computed up-front. distributeTopics
        // gives an array same-length as successRows so we can chunk
        // the assignments alongside the items.
        const distribution = distributeTopics(strategy, {
          topicCount: successRows.length,
          annotators: annotators.map((a) => ({ id: a.id })),
        })
        let createdTotal = 0
        let failedTotal = 0
        for (let i = 0; i < successRows.length; i += CHUNK_SIZE) {
          const chunkRows = successRows.slice(i, i + CHUNK_SIZE)
          const chunkAssignments = distribution
            .slice(i, i + CHUNK_SIZE)
            .map((a) => a.annotatorId)
          const result = await importBatch({
            taskId,
            // parsers always yield row=object on success (parseFailedRows
            // filters out the null+error rows). Cast is safe.
            items: chunkRows.map(
              (r) => r.row as Record<string, unknown>,
            ),
            assignments: annotators.length > 0 ? chunkAssignments : undefined,
          })
          createdTotal += result.created
          failedTotal += result.failed.length
          setSubmitState({
            kind: 'submitting',
            progress: Math.min(i + chunkRows.length, successRows.length),
            total: successRows.length,
          })
        }
        setSubmitState({
          kind: 'done',
          created: createdTotal,
          failed: failedTotal,
        })
        router.refresh()
      } catch (e) {
        setSubmitState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Submit failed.',
        })
      }
    })
  }

  return (
    <main
      className="min-h-screen p-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto max-w-[860px] flex flex-col gap-6">
        <header>
          <div className="lbl" style={{ color: 'var(--mute)' }}>
            § IMPORT
          </div>
          <h1
            className="ts-22 mt-1"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            Import topics into {taskName}
          </h1>
          <p className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
            Upload JSON / JSONL / CSV / Excel. Rows are validated
            against the &quot;{templateMode}&quot; template before insert;
            bad rows are reported, the rest succeed.
          </p>
        </header>

        {/* Step 1 — file picker */}
        <section
          className="rounded p-4"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <div
            className="lh-mono lh-caption mb-2"
            style={{ color: 'var(--mute)' }}
          >
            1. PICK A FILE
          </div>
          <input
            type="file"
            accept=".jsonl,.ndjson,.json,.csv,.tsv,.xlsx,.xls,.xlsm"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
            className="ts-13"
            style={{
              padding: 8,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              color: 'var(--text)',
              width: '100%',
            }}
          />
          {file ? (
            <div
              className="ts-12 mono mt-2"
              style={{ color: 'var(--mute2)' }}
            >
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </div>
          ) : null}
          {file ? (
            <div className="flex items-center gap-2 mt-3">
              <label
                className="ts-12 mono inline-flex items-center gap-2"
                style={{ color: 'var(--mute)' }}
              >
                Format:
                <select
                  value={format ?? ''}
                  onChange={(e) =>
                    setFormat((e.target.value as ImportFormat) || null)
                  }
                  className="ts-13"
                  style={{
                    padding: '4px 8px',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    color: 'var(--text)',
                    minHeight: 36,
                  }}
                >
                  <option value="">— select —</option>
                  {(Object.keys(FORMAT_LABELS) as ImportFormat[]).map(
                    (f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABELS[f]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="button"
                onClick={parseFile}
                disabled={!format || parsing}
                className="ts-12 mono px-4 rounded inline-flex items-center justify-center"
                style={{
                  minHeight: 40,
                  background: 'var(--accent)',
                  color: 'white',
                  border: '1px solid var(--accent)',
                  cursor: !format || parsing ? 'not-allowed' : 'pointer',
                }}
              >
                {parsing ? 'Parsing…' : 'Parse'}
              </button>
            </div>
          ) : null}
          {parseError ? (
            <div
              className="rounded p-2 ts-12 mt-2"
              style={{
                background: 'oklch(0.55 0.2 25 / 0.05)',
                border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                color: 'var(--danger)',
              }}
            >
              {parseError}
            </div>
          ) : null}
        </section>

        {/* Step 2 — preview */}
        {rows.length > 0 ? (
          <section
            className="rounded p-4"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              className="lh-mono lh-caption mb-2"
              style={{ color: 'var(--mute)' }}
            >
              2. PREVIEW · {successRows.length} valid ·{' '}
              {parseFailedRows.length > 0 ? (
                <span style={{ color: 'var(--danger)' }}>
                  {parseFailedRows.length} parse errors
                </span>
              ) : (
                'no parse errors'
              )}
            </div>
            <PreviewTable rows={rows.slice(0, 10)} />
            {parseFailedRows.length > 0 ? (
              <details className="ts-12 mt-2">
                <summary
                  style={{ color: 'var(--danger)', cursor: 'pointer' }}
                >
                  {parseFailedRows.length} row error(s) — expand
                </summary>
                <ul className="ts-11 mono mt-1">
                  {parseFailedRows.slice(0, 20).map((r) => (
                    <li
                      key={r.lineNumber}
                      style={{ color: 'var(--danger)' }}
                    >
                      line {r.lineNumber}: {r.error}
                    </li>
                  ))}
                  {parseFailedRows.length > 20 ? (
                    <li style={{ color: 'var(--mute2)' }}>
                      … and {parseFailedRows.length - 20} more
                    </li>
                  ) : null}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        {/* Step 3 — distribution */}
        {successRows.length > 0 ? (
          <section
            className="rounded p-4"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              className="lh-mono lh-caption mb-2"
              style={{ color: 'var(--mute)' }}
            >
              3. DISTRIBUTION ·{' '}
              {annotators.length > 0
                ? `${annotators.length} eligible annotator(s)`
                : 'no annotators — rows land in open queue'}
            </div>
            {annotators.length === 0 ? (
              <p className="ts-12" style={{ color: 'var(--mute2)' }}>
                Add annotators to this workspace to enable per-row
                assignment. For now rows will be left unassigned and
                anyone can pick them up.
              </p>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                {(
                  ['round-robin', 'random', 'quota-by-annotator'] as DistributionStrategy[]
                ).map((s) => (
                  <label
                    key={s}
                    className="ts-13 mono inline-flex items-center gap-2 px-3 rounded"
                    style={{
                      minHeight: 36,
                      background:
                        strategy === s ? 'var(--accent-soft)' : 'var(--panel2)',
                      border: `1px solid ${strategy === s ? 'var(--accent-line)' : 'var(--line)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      checked={strategy === s}
                      onChange={() => setStrategy(s)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* Step 4 — submit */}
        {successRows.length > 0 ? (
          <section
            className="rounded p-4 flex flex-col gap-3"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute)' }}
            >
              4. SUBMIT
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={submit}
                disabled={submitState.kind === 'submitting'}
                className="ts-13 mono px-4 rounded inline-flex items-center justify-center"
                style={{
                  minHeight: 40,
                  background: 'oklch(0.6 0.18 280)',
                  color: 'white',
                  border: '1px solid oklch(0.6 0.18 280 / 0.6)',
                  cursor:
                    submitState.kind === 'submitting'
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                Import {successRows.length} row(s)
              </button>
              {submitState.kind === 'submitting' ? (
                <span className="ts-12 mono" style={{ color: 'var(--mute)' }}>
                  {submitState.progress}/{submitState.total} …
                </span>
              ) : null}
              {submitState.kind === 'done' ? (
                <span
                  className="ts-12 mono"
                  style={{ color: 'var(--accent)' }}
                >
                  ✓ created {submitState.created} ·{' '}
                  {submitState.failed > 0
                    ? `${submitState.failed} template-validation failures`
                    : 'all rows valid'}
                </span>
              ) : null}
              {submitState.kind === 'error' ? (
                <span
                  className="ts-12 mono"
                  style={{ color: 'var(--danger)' }}
                >
                  ✗ {submitState.message}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  // Derive a column list from the union of the first few row keys
  // (cap 6 columns so the table fits the panel).
  const columns = useMemo(() => {
    const keys = new Set<string>()
    for (const r of rows) {
      if (r.row && typeof r.row === 'object') {
        for (const k of Object.keys(r.row as Record<string, unknown>)) {
          keys.add(k)
        }
      }
    }
    return Array.from(keys).slice(0, 6)
  }, [rows])

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        className="ts-12"
        style={{
          width: '100%',
          minWidth: 480,
          borderCollapse: 'separate',
          borderSpacing: 0,
        }}
      >
        <thead>
          <tr style={{ color: 'var(--mute)' }}>
            <th
              className="ts-11 mono text-left px-2 py-1"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              #
            </th>
            {columns.map((c) => (
              <th
                key={c}
                className="ts-11 mono text-left px-2 py-1"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.lineNumber}
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <td className="px-2 py-1 mono" style={{ color: 'var(--mute2)' }}>
                {r.lineNumber}
              </td>
              {r.row === null ? (
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="px-2 py-1 ts-11 mono"
                  style={{ color: 'var(--danger)' }}
                >
                  {r.error}
                </td>
              ) : (
                columns.map((c) => (
                  <td
                    key={c}
                    className="px-2 py-1 mono"
                    style={{
                      color: 'var(--text)',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={renderCell((r.row as Record<string, unknown>)[c])}
                  >
                    {renderCell((r.row as Record<string, unknown>)[c])}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

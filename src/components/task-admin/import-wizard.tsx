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
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Database,
  Loader2,
  Shuffle,
  TableProperties,
  UploadCloud,
  Users,
  XCircle,
} from 'lucide-react'
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
import { getErrorMessage } from '@/lib/errors/client-utils'
import {
  FORMAT_LABELS,
  STRATEGY_LABELS,
  deriveColumns,
  formatTemplateMode,
  ghostButtonStyle,
} from './import-wizard-helpers'
import {
  EmptyPanel,
  ImportRules,
  Message,
  Metric,
  PreviewTable,
  SectionTitle,
  StatusPill,
  SupportedFormats,
  WorkflowRail,
} from './import-wizard-parts'

export interface ImportWizardProps {
  taskId: string
  taskName: string
  templateMode: string
  /** Annotator pool for the workspace; UI shows weighted-quota when present. */
  annotators: ReadonlyArray<{ id: string; label: string }>
  backHref?: string
  initialStrategy?: DistributionStrategy
  /** Server action. Returns { created, failed }. */
  importBatch: (input: {
    taskId: string
    items: Record<string, unknown>[]
    assignments?: Array<string | null>
  }) => Promise<{ created: number; failed: Array<{ index: number; error: string }> }>
}

const CHUNK_SIZE = 100

export function ImportWizard({
  taskId,
  taskName,
  templateMode,
  annotators,
  backHref,
  initialStrategy = 'open-queue',
  importBatch,
}: ImportWizardProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<ImportFormat | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [strategy, setStrategy] =
    useState<DistributionStrategy>(initialStrategy)
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
  const firstColumns = useMemo(() => deriveColumns(rows), [rows])
  const detectedStep: 'file' | 'preview' | 'distribution' | 'submit' =
    submitState.kind === 'done'
      ? 'submit'
      : successRows.length > 0
        ? 'distribution'
        : rows.length > 0
          ? 'preview'
          : 'file'

  async function onFile(picked: File) {
    setFile(picked)
    setRows([])
    setParseError(null)
    setSubmitState({ kind: 'idle' })
    const detected = detectFormat(picked.name)
    setFormat(detected ?? null)
  }

  async function parseFile() {
    if (!file || !format) return
    setParsing(true)
    setParseError(null)
    setSubmitState({ kind: 'idle' })
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
      setRows([])
      setParseError(getErrorMessage(e, 'Parse failed.'))
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
          message: getErrorMessage(e, 'Submit failed.'),
        })
      }
    })
  }

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          {backHref ? (
            <Link
              href={backHref}
              className="ts-12 mono inline-flex items-center gap-2 rounded px-3"
              style={ghostButtonStyle}
            >
              <ArrowLeft size={14} />
              Task
            </Link>
          ) : null}
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            Dataset import
          </span>
        </div>

        <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div className="min-w-0">
            <div className="lbl">DATASET INTAKE</div>
            <h1
              className="ts-24 mt-2"
              style={{ color: 'var(--hi)', fontWeight: 560 }}
            >
              Import topics into {taskName}
            </h1>
            <p className="ts-13 mt-2 max-w-[780px]" style={{ color: 'var(--mute)' }}>
              Bring in JSON, JSONL, CSV, or Excel data, preview validation
              results, choose a distribution strategy, then commit clean rows
              into the task.
            </p>
          </div>
          <div
            className="rounded p-4"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div className="lbl">TASK TEMPLATE</div>
            <div className="ts-16 mt-1" style={{ color: 'var(--hi)', fontWeight: 560 }}>
              {formatTemplateMode(templateMode)}
            </div>
            <div className="ts-12 mt-1" style={{ color: 'var(--mute2)' }}>
              Rows are validated against this template before insert.
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="File" value={file ? file.name : 'Not selected'} icon={<UploadCloud size={17} />} />
          <Metric
            label="Valid Rows"
            value={String(successRows.length)}
            icon={<BadgeCheck size={17} />}
            tone="success"
          />
          <Metric
            label="Parse Errors"
            value={String(parseFailedRows.length)}
            icon={<AlertTriangle size={17} />}
            tone={parseFailedRows.length > 0 ? 'warning' : 'neutral'}
          />
          <Metric
            label="Assignment Pool"
            value={annotators.length > 0 ? String(annotators.length) : 'Open queue'}
            icon={<Users size={17} />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <SectionTitle
                label="STEP 1"
                title="Upload dataset file"
                body="The parser reads the first sheet for Excel and a shared row shape for every format."
              />
              <div
                className="mt-4 rounded p-5"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const picked = e.dataTransfer.files?.[0]
                  if (picked) void onFile(picked)
                }}
                style={{
                  background: 'var(--bg)',
                  border: '1px dashed var(--line2)',
                }}
              >
                <label
                  htmlFor="dataset-file"
                  className="flex cursor-pointer flex-col items-center justify-center gap-3 text-center"
                >
                  <span
                    className="inline-flex items-center justify-center rounded"
                    style={{
                      width: 44,
                      height: 44,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent-line)',
                    }}
                  >
                    <UploadCloud size={20} />
                  </span>
                  <span className="ts-14" style={{ color: 'var(--text)', fontWeight: 600 }}>
                    Drop a file here or browse
                  </span>
                  <span className="ts-12" style={{ color: 'var(--mute2)' }}>
                    .jsonl, .ndjson, .json, .csv, .tsv, .xlsx, .xls, .xlsm
                  </span>
                  <input
                    id="dataset-file"
                    type="file"
                    accept=".jsonl,.ndjson,.json,.csv,.tsv,.xlsx,.xls,.xlsm"
                    onChange={(e) => {
                      const picked = e.target.files?.[0]
                      if (picked) void onFile(picked)
                    }}
                    className="sr-only"
                  />
                </label>
              </div>

              {file ? (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="ts-13 mono truncate" style={{ color: 'var(--text)' }}>
                      {file.name}
                    </div>
                    <div className="ts-12 mono mt-1" style={{ color: 'var(--mute2)' }}>
                      {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={format ?? ''}
                      onChange={(e) =>
                        setFormat((e.target.value as ImportFormat) || null)
                      }
                      className="ts-13"
                      style={{
                        minHeight: 40,
                        padding: '0 10px',
                        background: 'var(--bg)',
                        border: '1px solid var(--line)',
                        borderRadius: 6,
                        color: 'var(--text)',
                      }}
                    >
                      <option value="">Select format</option>
                      {(Object.keys(FORMAT_LABELS) as ImportFormat[]).map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={parseFile}
                      disabled={!format || parsing}
                      className="ts-12 mono inline-flex items-center justify-center gap-2 rounded px-4"
                      style={{
                        minHeight: 40,
                        background: 'var(--accent)',
                        color: 'white',
                        border: '1px solid var(--accent)',
                        cursor: !format || parsing ? 'not-allowed' : 'pointer',
                        opacity: !format || parsing ? 0.55 : 1,
                      }}
                    >
                      {parsing ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                      {parsing ? 'Parsing' : 'Parse preview'}
                    </button>
                  </div>
                </div>
              ) : null}

              {parseError ? (
                <Message tone="danger" icon={<XCircle size={15} />}>
                  {parseError}
                </Message>
              ) : null}
            </section>

            <section
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <SectionTitle
                label="STEP 2"
                title="Validate and preview rows"
                body="Review the parsed row shape before committing data. Row-level parse errors stay visible and are not imported."
                action={
                  rows.length > 0 ? (
                    <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
                      showing first {Math.min(rows.length, 10)}
                    </span>
                  ) : null
                }
              />
              {rows.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      icon={<CheckCircle2 size={13} />}
                      label={`${successRows.length} valid`}
                      tone="success"
                    />
                    <StatusPill
                      icon={<AlertTriangle size={13} />}
                      label={`${parseFailedRows.length} parse error${parseFailedRows.length === 1 ? '' : 's'}`}
                      tone={parseFailedRows.length > 0 ? 'warning' : 'neutral'}
                    />
                    <StatusPill
                      icon={<TableProperties size={13} />}
                      label={`${firstColumns.length} preview column${firstColumns.length === 1 ? '' : 's'}`}
                      tone="neutral"
                    />
                  </div>
                  <PreviewTable rows={rows.slice(0, 10)} />
                  {parseFailedRows.length > 0 ? (
                    <details className="ts-12">
                      <summary
                        style={{ color: 'var(--danger)', cursor: 'pointer' }}
                      >
                        Show row errors
                      </summary>
                      <ul className="ts-11 mono mt-2 grid gap-1">
                        {parseFailedRows.slice(0, 20).map((r) => (
                          <li key={r.lineNumber} style={{ color: 'var(--danger)' }}>
                            line {r.lineNumber}: {r.error}
                          </li>
                        ))}
                        {parseFailedRows.length > 20 ? (
                          <li style={{ color: 'var(--mute2)' }}>
                            ... and {parseFailedRows.length - 20} more
                          </li>
                        ) : null}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : (
                <EmptyPanel
                  icon={<TableProperties size={18} />}
                  title="No preview yet"
                  body="Upload and parse a file to inspect rows before import."
                />
              )}
            </section>

            <section
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <SectionTitle
                label="STEP 3"
                title="Choose distribution"
                body="Assign rows during import, or leave them in the open queue when no annotator pool is configured."
              />
              {successRows.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  {annotators.length === 0 ? (
                    <Message tone="neutral" icon={<Users size={15} />}>
                      No eligible annotators are in this workspace. Imported
                      rows will stay unassigned and appear in the open queue.
                    </Message>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-4">
                      {(
                        [
                          'open-queue',
                          'round-robin',
                          'random',
                          'quota-by-annotator',
                        ] as DistributionStrategy[]
                      ).map((s) => (
                        <label
                          key={s}
                          className="ts-13 mono flex cursor-pointer items-center gap-2 rounded px-3"
                          style={{
                            minHeight: 44,
                            background:
                              strategy === s ? 'var(--accent-soft)' : 'var(--bg)',
                            border: `1px solid ${strategy === s ? 'var(--accent-line)' : 'var(--line)'}`,
                            color: strategy === s ? 'var(--accent)' : 'var(--text)',
                          }}
                        >
                          <input
                            type="radio"
                            checked={strategy === s}
                            onChange={() => setStrategy(s)}
                            style={{ accentColor: 'var(--accent)' }}
                          />
                          <span className="inline-flex items-center gap-2">
                            {s === 'random' ? <Shuffle size={14} /> : <Users size={14} />}
                            {STRATEGY_LABELS[s]}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {annotators.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {annotators.slice(0, 10).map((a) => (
                        <span
                          key={a.id}
                          className="ts-11 mono rounded px-2 py-1"
                          style={{
                            color: 'var(--mute)',
                            background: 'var(--bg)',
                            border: '1px solid var(--line)',
                          }}
                        >
                          {a.label}
                        </span>
                      ))}
                      {annotators.length > 10 ? (
                        <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
                          +{annotators.length - 10} more
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyPanel
                  icon={<Users size={18} />}
                  title="Waiting for valid rows"
                  body="Distribution activates after the parser finds importable rows."
                />
              )}
            </section>

            <section
              className="rounded p-4"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <SectionTitle
                label="STEP 4"
                title="Commit dataset"
                body={`Rows are imported in chunks of ${CHUNK_SIZE} so large datasets stay inside the server action limit.`}
              />
              {successRows.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitState.kind === 'submitting'}
                      className="ts-13 mono inline-flex items-center justify-center gap-2 rounded px-4"
                      style={{
                        minHeight: 42,
                        background: 'var(--accent)',
                        color: 'white',
                        border: '1px solid var(--accent)',
                        cursor:
                          submitState.kind === 'submitting'
                            ? 'not-allowed'
                            : 'pointer',
                        opacity: submitState.kind === 'submitting' ? 0.65 : 1,
                        fontWeight: 600,
                      }}
                    >
                      {submitState.kind === 'submitting' ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Database size={15} />
                      )}
                      Import {successRows.length} row{successRows.length === 1 ? '' : 's'}
                    </button>
                    {submitState.kind === 'submitting' ? (
                      <span className="ts-12 mono" style={{ color: 'var(--mute)' }}>
                        {submitState.progress}/{submitState.total}
                      </span>
                    ) : null}
                  </div>
                  {submitState.kind === 'done' ? (
                    <Message tone="success" icon={<CheckCircle2 size={15} />}>
                      Created {submitState.created}.{' '}
                      {submitState.failed > 0
                        ? `${submitState.failed} rows failed template validation.`
                        : 'All imported rows passed template validation.'}
                    </Message>
                  ) : null}
                  {submitState.kind === 'error' ? (
                    <Message tone="danger" icon={<XCircle size={15} />}>
                      {submitState.message}
                    </Message>
                  ) : null}
                </div>
              ) : (
                <EmptyPanel
                  icon={<Database size={18} />}
                  title="Nothing to import yet"
                  body="The submit action unlocks after at least one row parses successfully."
                />
              )}
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <WorkflowRail active={detectedStep} />
            <SupportedFormats selected={format} />
            <ImportRules />
          </aside>
        </div>
      </div>
    </main>
  )
}

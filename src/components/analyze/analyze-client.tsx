'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { askWorkspaceAnalyst } from '@/lib/actions/analyze'
import type { AnalyzeAggregates } from '@/lib/queries/analyze'
import type { BatchAnalystResponse } from '@/lib/ai/batch-analyst'

/**
 * /analyze page client — owns the filter input, the aggregate display,
 * the row preview list, and the "Ask Claude" chat widget.
 *
 * Server pre-renders the current filter's results; typing a new filter
 * pushes a new URL (?q=...) which re-runs the server query. Chat lives
 * entirely client-side; backend exchange handles LLM round-trip.
 */

interface RowPreview {
  id: string
  agentName: string
  createdAt: string
  outcome: string
  stepCount: number
  loopDetected: boolean
  summary: string | null
  summaryPattern: string | null
  topTool: string | null
}

interface AnalyzeClientProps {
  workspaceId: string
  initialFilterString: string
  canonicalFilter: string
  rowsPreview: RowPreview[]
  rowsTotal: number
  aggregates: AnalyzeAggregates
}

export function AnalyzeClient({
  workspaceId,
  initialFilterString,
  canonicalFilter,
  rowsPreview,
  rowsTotal,
  aggregates,
}: AnalyzeClientProps) {
  return (
    <div className="space-y-8">
      <FilterBar
        workspaceId={workspaceId}
        initialFilterString={initialFilterString}
        canonicalFilter={canonicalFilter}
        rowsTotal={rowsTotal}
      />
      <AggregateCards aggregates={aggregates} total={rowsTotal} />
      <BatchAnalystChat
        workspaceId={workspaceId}
        filterString={initialFilterString}
        rowsTotal={rowsTotal}
      />
      <RowPreviewList
        workspaceId={workspaceId}
        rows={rowsPreview}
        rowsTotal={rowsTotal}
      />
    </div>
  )
}

// ─── Filter bar ──────────────────────────────────────────────────────────

function FilterBar({
  workspaceId,
  initialFilterString,
  canonicalFilter,
  rowsTotal,
}: {
  workspaceId: string
  initialFilterString: string
  canonicalFilter: string
  rowsTotal: number
}) {
  const router = useRouter()
  const [value, setValue] = useState(initialFilterString)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    const url = trimmed
      ? `/workspaces/${workspaceId}/analyze?q=${encodeURIComponent(trimmed)}`
      : `/workspaces/${workspaceId}/analyze`
    router.push(url as `/${string}`)
  }

  function applyPreset(preset: string) {
    setValue(preset)
    router.push(
      `/workspaces/${workspaceId}/analyze?q=${encodeURIComponent(preset)}` as `/${string}`,
    )
  }

  return (
    <section>
      <form
        onSubmit={submit}
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <label>
          <span className="lbl mb-1.5 block">filter (DSL)</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. outcome:errored loop:true tool>web_search:3"
              className="flex-1 px-3 py-2 ts-13 rounded-md mono"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                outline: 'none',
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              className="ts-12 mono"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '8px 16px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              apply
            </button>
          </div>
        </label>
        <div className="flex items-center flex-wrap gap-2">
          <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
            presets:
          </span>
          {[
            ['outcome:errored', 'errored'],
            ['outcome:incomplete', 'incomplete'],
            ['loop:true', 'has loop'],
            ['steps>40', '40+ steps'],
            ['tool:web_search', 'used web_search'],
          ].map(([q, label]) => (
            <button
              key={q}
              type="button"
              onClick={() => applyPreset(q)}
              className="mono shrink-0"
              style={{
                background: 'var(--panel2)',
                color: 'var(--mute)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="ts-11 mono"
          style={{ color: 'var(--mute2)', lineHeight: 1.5 }}
        >
          matched <span style={{ color: 'var(--hi)' }}>{rowsTotal}</span>{' '}
          trajectories
          {canonicalFilter && (
            <>
              {' '}— canonical:{' '}
              <code style={{ color: 'var(--accent)' }}>{canonicalFilter}</code>
            </>
          )}
        </div>
      </form>
    </section>
  )
}

// ─── Aggregate cards ─────────────────────────────────────────────────────

function AggregateCards({
  aggregates,
  total,
}: {
  aggregates: AnalyzeAggregates
  total: number
}) {
  if (total === 0) {
    return (
      <section>
        <div
          className="rounded-xl p-5"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line2)',
          }}
        >
          <p className="ts-13" style={{ color: 'var(--mute)' }}>
            No matches. Try a looser filter — start with{' '}
            <code>outcome:completed</code>.
          </p>
        </div>
      </section>
    )
  }
  return (
    <section>
      <div className="lbl mb-3">§ AGGREGATES</div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
      >
        <Card label="outcomes">
          <OutcomeBars byOutcome={aggregates.byOutcome} total={total} />
        </Card>
        {aggregates.stepCount && (
          <Card label="step count">
            <div className="ts-13 mono space-y-1">
              <div>min: <span style={{ color: 'var(--hi)' }}>{aggregates.stepCount.min}</span></div>
              <div>median: <span style={{ color: 'var(--hi)' }}>{aggregates.stepCount.median}</span></div>
              <div>mean: <span style={{ color: 'var(--hi)' }}>{aggregates.stepCount.mean}</span></div>
              <div>max: <span style={{ color: 'var(--hi)' }}>{aggregates.stepCount.max}</span></div>
            </div>
          </Card>
        )}
        <Card label="risk signals">
          <div className="ts-13 space-y-1.5">
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--mute)' }}>loop rate</span>
              <span
                className="mono"
                style={{
                  color: aggregates.loopRate > 0.2 ? 'var(--warn)' : 'var(--hi)',
                  fontWeight: 600,
                }}
              >
                {(aggregates.loopRate * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--mute)' }}>error rate</span>
              <span
                className="mono"
                style={{
                  color: aggregates.errorRate > 0.1 ? 'var(--danger)' : 'var(--hi)',
                  fontWeight: 600,
                }}
              >
                {(aggregates.errorRate * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </Card>
        {aggregates.toolFrequency.length > 0 && (
          <Card label="top tools">
            <ol className="ts-12 mono space-y-1">
              {aggregates.toolFrequency.slice(0, 6).map((t, i) => (
                <li key={t.tool} className="flex items-center justify-between gap-2">
                  <span style={{ color: 'var(--mute2)', minWidth: 16 }}>
                    {i + 1}.
                  </span>
                  <span
                    className="flex-1 trunc-1"
                    style={{ color: 'var(--hi)' }}
                  >
                    {t.tool}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>{t.count}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
        {aggregates.byAgent.length > 0 && (
          <Card label="top agents">
            <ol className="ts-12 mono space-y-1">
              {aggregates.byAgent.slice(0, 6).map((a, i) => (
                <li key={a.agentName} className="flex items-center justify-between gap-2">
                  <span style={{ color: 'var(--mute2)', minWidth: 16 }}>
                    {i + 1}.
                  </span>
                  <span
                    className="flex-1 trunc-1"
                    style={{ color: 'var(--hi)' }}
                  >
                    {a.agentName}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>{a.count}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
        {Object.keys(aggregates.byPattern).length > 0 && (
          <Card label="behavior patterns">
            <ol className="ts-12 mono space-y-1">
              {Object.entries(aggregates.byPattern)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([k, v], i) => (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span style={{ color: 'var(--mute2)', minWidth: 16 }}>
                      {i + 1}.
                    </span>
                    <span
                      className="flex-1 trunc-1"
                      style={{ color: 'var(--hi)' }}
                    >
                      {k}
                    </span>
                    <span style={{ color: 'var(--accent)' }}>{v}</span>
                  </li>
                ))}
            </ol>
          </Card>
        )}
      </div>
    </section>
  )
}

function Card({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="lbl mb-2"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function OutcomeBars({
  byOutcome,
  total,
}: {
  byOutcome: AnalyzeAggregates['byOutcome']
  total: number
}) {
  const items: Array<{
    key: keyof AnalyzeAggregates['byOutcome']
    label: string
    color: string
  }> = [
    { key: 'completed', label: 'completed', color: 'var(--success)' },
    { key: 'incomplete', label: 'incomplete', color: 'var(--warn)' },
    { key: 'errored', label: 'errored', color: 'var(--danger)' },
  ]
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const v = byOutcome[it.key]
        const pct = total > 0 ? (v / total) * 100 : 0
        return (
          <div key={it.key}>
            <div className="flex items-center justify-between ts-12 mono mb-0.5">
              <span style={{ color: 'var(--mute)' }}>{it.label}</span>
              <span style={{ color: it.color, fontWeight: 600 }}>
                {v} · {pct.toFixed(0)}%
              </span>
            </div>
            <div
              style={{
                background: 'var(--bg)',
                height: 5,
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: it.color,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Batch analyst chat ──────────────────────────────────────────────────

function BatchAnalystChat({
  workspaceId,
  filterString,
  rowsTotal,
}: {
  workspaceId: string
  filterString: string
  rowsTotal: number
}) {
  const router = useRouter()
  const [question, setQuestion] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<BatchAnalystResponse | null>(null)

  function ask() {
    setError(null)
    setResponse(null)
    const q = question.trim()
    if (!q) {
      setError('Type a question first.')
      return
    }
    if (rowsTotal === 0) {
      setError('No matching trajectories — loosen the filter first.')
      return
    }
    startTransition(async () => {
      try {
        const r = await askWorkspaceAnalyst({
          workspaceId,
          filterString,
          question: q,
        })
        if (r.ok) {
          setResponse(r.response)
        } else {
          setError(r.error)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Analyst call failed.')
      }
    })
  }

  function followup(filter: string) {
    router.push(
      `/workspaces/${workspaceId}/analyze?q=${encodeURIComponent(filter)}` as `/${string}`,
    )
  }

  return (
    <section>
      <div className="lbl mb-3">§ ASK CLAUDE</div>
      <div
        className="rounded-xl p-4 space-y-3"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            rowsTotal > 0
              ? `Ask about these ${rowsTotal} trajectories — e.g. "Why are so many erroring?", "What pattern do the looped ones share?"`
              : 'Filter to at least one trajectory before asking.'
          }
          rows={3}
          maxLength={2000}
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'var(--font-geist-sans), system-ui',
          }}
        />
        {error && (
          <div
            className="ts-11 mono rounded-md p-2"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-end">
          <button
            onClick={ask}
            disabled={isPending || !question.trim() || rowsTotal === 0}
            className="ts-12 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 500,
              cursor:
                isPending || !question.trim() || rowsTotal === 0
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                isPending || !question.trim() || rowsTotal === 0 ? 0.5 : 1,
            }}
          >
            {isPending ? 'analyzing…' : 'ask claude'}
          </button>
        </div>

        {response && (
          <div
            className="rounded-md p-3 space-y-3"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--accent-line)',
            }}
          >
            <div>
              <div className="lbl mb-1">diagnosis</div>
              <p
                className="ts-13"
                style={{ color: 'var(--text)', lineHeight: 1.6 }}
              >
                {response.diagnosis}
              </p>
            </div>
            {response.hypotheses.length > 0 && (
              <div>
                <div className="lbl mb-1">hypotheses</div>
                <ul className="ts-12 space-y-1">
                  {response.hypotheses.map((h, i) => (
                    <li
                      key={i}
                      style={{ color: 'var(--text)', paddingLeft: 16 }}
                    >
                      <span style={{ color: 'var(--mute2)' }}>·</span> {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {response.followups.length > 0 && (
              <div>
                <div className="lbl mb-1">follow-up filters</div>
                <div className="flex flex-wrap gap-2">
                  {response.followups.map((f, i) => (
                    <button
                      key={i}
                      onClick={() => followup(f)}
                      className="mono ts-11"
                      style={{
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent-line)',
                        borderRadius: 4,
                        padding: '4px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      {f} →
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Row preview ─────────────────────────────────────────────────────────

function RowPreviewList({
  workspaceId,
  rows,
  rowsTotal,
}: {
  workspaceId: string
  rows: RowPreview[]
  rowsTotal: number
}) {
  if (rows.length === 0) return null
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <div className="lbl">§ MATCHED TRAJECTORIES (preview)</div>
        <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
          showing {rows.length} of {rowsTotal}
        </span>
      </div>
      <ul
        className="rounded-xl overflow-hidden"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        {rows.map((r, idx) => (
          <li
            key={r.id}
            style={{
              borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              padding: '12px 16px',
            }}
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <Link
                href={`/workspaces/${workspaceId}/trajectories/${r.id}`}
                className="ts-13 hover:underline"
                style={{ color: 'var(--hi)' }}
              >
                {r.agentName}
              </Link>
              <div className="flex items-center gap-2">
                <OutcomeChip outcome={r.outcome} />
                {r.loopDetected && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      background: 'oklch(0.7 0.14 75 / 0.08)',
                      color: 'var(--warn)',
                      border: '1px solid oklch(0.7 0.14 75 / 0.4)',
                      borderRadius: 4,
                      padding: '1px 6px',
                      fontWeight: 600,
                    }}
                  >
                    🔁 loop
                  </span>
                )}
                <span
                  className="mono ts-11"
                  style={{ color: 'var(--mute2)' }}
                >
                  {r.stepCount} steps
                </span>
                {r.topTool && (
                  <span
                    className="mono ts-11"
                    style={{ color: 'var(--mute2)' }}
                  >
                    · {r.topTool}
                  </span>
                )}
              </div>
            </div>
            {r.summary && (
              <p
                className="ts-12"
                style={{ color: 'var(--mute)', lineHeight: 1.5 }}
              >
                {r.summary.length > 220
                  ? r.summary.slice(0, 220) + '…'
                  : r.summary}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function OutcomeChip({ outcome }: { outcome: string }) {
  const p =
    outcome === 'completed'
      ? { bg: 'var(--success-soft)', fg: 'var(--success)' }
      : outcome === 'errored'
        ? { bg: 'var(--danger-soft)', fg: 'var(--danger)' }
        : { bg: 'oklch(0.7 0.14 75 / 0.08)', fg: 'var(--warn)' }
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.fg}33`,
        borderRadius: 4,
        padding: '1px 6px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {outcome}
    </span>
  )
}

'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { runWorkspaceDawidSkene } from '@/lib/actions/dawid-skene'
import {
  describeCellKey,
  formatInferredClass,
  type DsRunReport,
} from '@/lib/quality/dawid-skene-display'

/**
 * Dawid-Skene EM panel for the admin /quality page (Phase-11).
 *
 * Reads the latest run report (server-rendered into props) and exposes
 * a "Run DS now" button that triggers a fresh EM pass on every
 * submitted annotation. Shows:
 *   - run header (iterations, convergence, cellcount, raters)
 *   - per-rater confusion table with bias note + accuracy
 *   - per-topic cell table sorted by lowest confidence first
 *
 * UX choice: the topic table is "weakest-confidence first" because the
 * admin's main use case is "where should I look for noisy disagreement"
 * — not "show me confident things." High-confidence cells are boring;
 * 60% cells are the ones an admin should review.
 */
export function DawidSkeneSection({
  workspaceId,
  initial,
}: {
  workspaceId: string
  initial: DsRunReport | null
}) {
  const [report, setReport] = useState<DsRunReport | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setError(null)
    startTransition(async () => {
      try {
        await runWorkspaceDawidSkene({ workspaceId })
        // The action revalidates the /quality path; trigger a soft
        // refetch by reloading the page so server data flows through.
        // (We could SWR/fetch here, but the page is a server component
        // — a plain reload is simpler and consistent with the rest of
        // the admin actions on this surface.)
        window.location.reload()
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Dawid-Skene run failed.',
        )
      }
    })
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="lbl" style={{ color: 'var(--mute)' }}>
          § DAWID-SKENE TRUTH INFERENCE
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="ts-12 mono inline-flex items-center gap-2"
          style={{
            background: pending ? 'var(--panel)' : 'var(--accent)',
            color: pending ? 'var(--mute)' : 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: pending ? 'wait' : 'pointer',
          }}
        >
          {pending ? 'running EM…' : report ? '↻ rerun' : '▶ run DS'}
        </button>
      </div>

      {error && (
        <div
          className="ts-12 mono rounded-md p-3 mb-3"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {!report ? (
        <EmptyDsCard />
      ) : (
        <div className="space-y-4">
          <RunHeader report={report} />
          <RaterConfusionTable report={report} />
          <TopicConfidenceTable
            report={report}
            workspaceId={workspaceId}
          />
        </div>
      )}
    </section>
  )
}

function EmptyDsCard() {
  return (
    <div
      className="rounded-md px-4 py-6 text-center ts-13"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
        color: 'var(--mute2)',
      }}
    >
      No DS run yet. Click <strong>▶ run DS</strong> to estimate truth
      from per-rater confusion matrices. Recommended once you have
      multi-rater coverage on a few topics.
    </div>
  )
}

function RunHeader({ report }: { report: DsRunReport }) {
  const { run } = report
  return (
    <div
      className="rounded-md p-4 ts-13"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat label="mode" value={run.templateMode} />
        <Stat label="classes" value={String(run.numClasses)} />
        <Stat label="cells" value={String(run.cellCount)} />
        <Stat label="raters" value={String(run.raterCount)} />
        <Stat
          label="iters"
          value={`${run.iterations}${run.converged ? ' ✓' : ' (cap)'}`}
        />
        <Stat
          label="log-lik"
          value={run.logLikelihood.toFixed(2)}
        />
        <Stat
          label="ran"
          value={new Date(run.createdAt).toLocaleString()}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lbl mb-0.5" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <div className="ts-13 mono" style={{ color: 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

function RaterConfusionTable({ report }: { report: DsRunReport }) {
  if (report.raters.length === 0) return null
  return (
    <div>
      <div className="lbl mb-2" style={{ color: 'var(--mute)' }}>
        § PER-RATER CONFUSION
      </div>
      <div
        className="rounded-md overflow-hidden"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <table className="w-full ts-13">
          <thead>
            <tr
              style={{
                background: 'var(--panel2)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <th
                className="text-left px-4 py-2 mono ts-11"
                style={{ color: 'var(--mute)' }}
              >
                RATER
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-center"
                style={{ color: 'var(--mute)', width: 90 }}
              >
                N
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-center"
                style={{ color: 'var(--mute)', width: 110 }}
              >
                ACCURACY
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-left"
                style={{ color: 'var(--mute)' }}
              >
                BIAS
              </th>
            </tr>
          </thead>
          <tbody>
            {report.raters.map((r, i) => (
              <tr
                key={r.userId}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <td
                  className="px-4 py-2 ts-13"
                  style={{ color: 'var(--text)' }}
                >
                  {r.displayName ?? (
                    <span
                      className="mono ts-12"
                      style={{ color: 'var(--mute2)' }}
                    >
                      {r.userId.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-2 mono ts-12 text-center"
                  style={{ color: 'var(--mute)' }}
                >
                  {r.nObservations}
                </td>
                <td
                  className="px-4 py-2 mono ts-12 text-center"
                  style={{
                    color:
                      r.accuracy >= 0.8
                        ? 'oklch(0.65 0.18 200)'
                        : r.accuracy >= 0.5
                          ? 'oklch(0.7 0.14 75)'
                          : 'var(--danger)',
                    fontWeight: 600,
                  }}
                >
                  {(r.accuracy * 100).toFixed(0)}%
                </td>
                <td
                  className="px-4 py-2 ts-13"
                  style={{
                    color: r.biasSummary
                      ? 'var(--danger)'
                      : 'var(--mute2)',
                  }}
                >
                  {r.biasSummary ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TopicConfidenceTable({
  report,
  workspaceId,
}: {
  report: DsRunReport
  workspaceId: string
}) {
  // Cap the table at 50 rows — admins reviewing should focus on the
  // bottom of the confidence list anyway. Anything past 50 is rarely
  // useful and would force virtualization (Pillar 4 perf budget).
  const TOPIC_CAP = 50
  const truncated = report.topics.length > TOPIC_CAP
  const visible = report.topics.slice(0, TOPIC_CAP)

  return (
    <div>
      <div className="lbl mb-2" style={{ color: 'var(--mute)' }}>
        § PER-TOPIC DS TRUTH (lowest-confidence first)
      </div>
      <div
        className="rounded-md overflow-hidden"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <table className="w-full ts-13">
          <thead>
            <tr
              style={{
                background: 'var(--panel2)',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <th
                className="text-left px-4 py-2 mono ts-11"
                style={{ color: 'var(--mute)' }}
              >
                TOPIC
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-center"
                style={{ color: 'var(--mute)', width: 80 }}
              >
                CELLS
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-center"
                style={{ color: 'var(--mute)', width: 110 }}
              >
                MIN CONF
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-center"
                style={{ color: 'var(--mute)', width: 110 }}
              >
                MEAN CONF
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-left"
                style={{ color: 'var(--mute)' }}
              >
                LOW-CONF CELLS
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              // Only show cells whose confidence is below the topic mean
              // — i.e. the "weakest links" inside this topic. Caps at 3
              // so the row stays readable.
              const weak = t.cells
                .filter((c) => c.confidence < t.meanConfidence)
                .sort((a, b) => a.confidence - b.confidence)
                .slice(0, 3)
              return (
                <tr
                  key={t.topicId}
                  style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <td className="px-4 py-2 mono ts-12">
                    <Link
                      href={`/workspaces/${workspaceId}/topics/${t.topicId}`}
                      style={{
                        color: 'var(--accent)',
                        textDecoration: 'none',
                      }}
                    >
                      {t.topicId.slice(0, 8)}
                    </Link>
                  </td>
                  <td
                    className="px-4 py-2 mono ts-12 text-center"
                    style={{ color: 'var(--mute)' }}
                  >
                    {t.cellCount}
                  </td>
                  <td
                    className="px-4 py-2 mono ts-12 text-center"
                    style={{
                      color:
                        t.minConfidence >= 0.85
                          ? 'oklch(0.65 0.18 200)'
                          : t.minConfidence >= 0.65
                            ? 'oklch(0.7 0.14 75)'
                            : 'var(--danger)',
                      fontWeight: 600,
                    }}
                  >
                    {(t.minConfidence * 100).toFixed(0)}%
                  </td>
                  <td
                    className="px-4 py-2 mono ts-12 text-center"
                    style={{ color: 'var(--text)' }}
                  >
                    {(t.meanConfidence * 100).toFixed(0)}%
                  </td>
                  <td
                    className="px-4 py-2 ts-12"
                    style={{ color: 'var(--mute)' }}
                  >
                    {weak.length === 0 ? (
                      <span style={{ color: 'var(--mute2)' }}>
                        all aligned
                      </span>
                    ) : (
                      weak.map((c, k) => {
                        const parts = describeCellKey(c.cellKey)
                        const label = formatInferredClass({
                          numClasses: report.run.numClasses,
                          inferredClass: c.inferredClass,
                        })
                        return (
                          <span
                            key={c.cellKey}
                            className="inline-block mr-2 mono ts-11"
                            title={`${c.cellKey} → ${label} @ ${(c.confidence * 100).toFixed(0)}%`}
                          >
                            <span style={{ color: 'var(--mute2)' }}>
                              {parts.itemId}/{parts.side}
                            </span>
                            <span style={{ color: 'var(--text)' }}>
                              →{label}
                            </span>
                            <span style={{ color: 'var(--danger)' }}>
                              {' '}
                              {(c.confidence * 100).toFixed(0)}%
                            </span>
                            {k < weak.length - 1 && (
                              <span style={{ color: 'var(--line)' }}>
                                {' '}
                                ·
                              </span>
                            )}
                          </span>
                        )
                      })
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p
          className="ts-11 mono mt-2"
          style={{ color: 'var(--mute2)' }}
        >
          showing {visible.length} of {report.topics.length} topics
          (lowest-confidence first)
        </p>
      )}
    </div>
  )
}

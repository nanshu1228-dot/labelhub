'use client'

/**
 * Single-annotation review surface — Finals P3 D11.
 *
 * Renders the submitted payload (read-only via the Renderer when the
 * task is custom-designer, else JSON), the AI verdict panel, the
 * revision diff list, and the human-decision form (pass /
 * request_revision).
 *
 * Server actions are wired by the parent page; this client component
 * is pure UI + form state.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FormRenderer } from '@/components/form-renderer/form-renderer'
import type { FormSchema } from '@/lib/form-designer/schema'
import { DiffView, type DiffRevision } from './diff-view'
import type { AnnotationDetail } from '@/lib/queries/annotation-detail'

export interface ReviewDetailProps {
  detail: AnnotationDetail
  qcReview: (input: {
    annotationId: string
    decision: 'pass' | 'request_revision'
    feedback?: string
  }) => Promise<unknown>
}

export function ReviewDetail({ detail, qcReview }: ReviewDetailProps) {
  const router = useRouter()
  const [pending, startReview] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  const latestVerdict = detail.verdicts[detail.verdicts.length - 1] ?? null
  const customSchema = detail.formSchema as FormSchema | null

  // Most-recent two revisions for the diff. If only one, diff against
  // the empty payload.
  const revs: DiffRevision[] = detail.revisions.map((r) => ({
    id: r.id,
    kind: r.kind,
    ts: r.ts,
    payload: r.payload,
  }))
  const nextRev: DiffRevision | null = revs.length > 0 ? revs[revs.length - 1] : null
  const prevRev: DiffRevision | null = revs.length > 1 ? revs[revs.length - 2] : null

  function applyDecision(decision: 'pass' | 'request_revision') {
    setError(null)
    if (decision === 'request_revision' && !feedback.trim()) {
      setError('A reason is required when sending the work back.')
      return
    }
    startReview(async () => {
      try {
        await qcReview({
          annotationId: detail.annotation.id,
          decision,
          feedback: feedback.trim() || undefined,
        })
        router.push('/review')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Review failed.')
      }
    })
  }

  return (
    <div className="lh-review-detail-grid">
      <style>{`
        /* Review-detail responsive — D20-B.
         * Desktop (≥1024px): 2-column with the form payload on the
         *   left + AI verdict / decision form on the right.
         * Tablet / mobile (<1024px): stacked — verdict + decision
         *   stack ABOVE the form payload so the reviewer sees the
         *   AI signal first, then reads the labeling on a long
         *   single-column scroll.
         */
        .lh-review-detail-grid {
          display: grid;
          gap: 24px;
          grid-template-columns: 1fr;
        }
        .lh-review-detail-grid > [data-pane='right'] {
          order: -1;
        }
        @media (min-width: 1024px) {
          .lh-review-detail-grid {
            grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
          }
          .lh-review-detail-grid > [data-pane='right'] {
            order: 0;
          }
        }
      `}</style>
      {/* LEFT — form + diff */}
      <div data-pane="left" className="flex flex-col gap-6">
        <section
          className="rounded p-4"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          <div
            className="lh-mono lh-caption mb-3"
            style={{ color: 'var(--mute)' }}
          >
            SUBMISSION
          </div>
          {customSchema ? (
            <FormRenderer
              schema={customSchema}
              value={detail.annotation.payload}
              onChange={() => {
                /* read-only — Renderer's controlled API requires a setter */
              }}
              itemData={detail.topic.itemData}
              readOnly
            />
          ) : (
            <pre
              className="ts-12 mono rounded"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                padding: '8px 12px',
                margin: 0,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {jsonPretty(detail.annotation.payload)}
            </pre>
          )}
        </section>

        {nextRev ? (
          <DiffView
            prev={prevRev}
            next={nextRev}
            title="MOST-RECENT CHANGES"
          />
        ) : null}

        {revs.length > 2 ? (
          <section
            className="rounded p-4 flex flex-col gap-2"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute)' }}
            >
              REVISION HISTORY ({revs.length})
            </div>
            <ul className="ts-12 mono flex flex-col gap-1">
              {[...revs].reverse().map((r) => (
                <li key={r.id} style={{ color: 'var(--mute)' }}>
                  · {r.kind} @ {r.ts.toISOString().slice(0, 16).replace('T', ' ')}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* RIGHT — AI verdict panel + review form */}
      <div data-pane="right" className="flex flex-col gap-6">
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
            AI VERDICT
          </div>
          {latestVerdict ? (
            <div className="flex flex-col gap-1.5">
              <div className="ts-13 flex items-center gap-2">
                <strong style={{ color: 'var(--text)' }}>
                  {latestVerdict.verdict ?? latestVerdict.status}
                </strong>
                {(latestVerdict.scores as { __priority?: boolean } | null)?.__priority ? (
                  <span
                    className="ts-11 mono"
                    style={{ color: 'oklch(0.6 0.18 60)' }}
                  >
                    ⚑ priority
                  </span>
                ) : null}
              </div>
              {latestVerdict.reasoning ? (
                <p
                  className="ts-12"
                  style={{ color: 'var(--mute)', whiteSpace: 'pre-wrap' }}
                >
                  {latestVerdict.reasoning}
                </p>
              ) : null}
              {latestVerdict.scores ? (
                <ScoresTable scores={latestVerdict.scores} />
              ) : null}
              <div
                className="ts-11 mono mt-1"
                style={{ color: 'var(--mute2)' }}
              >
                attempts: {latestVerdict.attempts} ·{' '}
                {latestVerdict.startedAt.toISOString().slice(0, 16).replace('T', ' ')}
                {latestVerdict.errorText ? (
                  <span style={{ color: 'var(--danger)' }}>
                    {' '}
                    · err: {latestVerdict.errorText.slice(0, 120)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="ts-12" style={{ color: 'var(--mute2)' }}>
              No AI verdict yet (agent disabled or still in flight).
            </p>
          )}
        </section>

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
            HUMAN REVIEW
          </div>
          <label className="ts-12 flex flex-col gap-1">
            <span
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute2)' }}
            >
              REASON (REQUIRED FOR SEND-BACK)
            </span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="Why is this work returning to drafting?"
              className="w-full ts-13 resize-y"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                color: 'var(--text)',
              }}
            />
          </label>
          {error ? (
            <div
              className="rounded p-2 ts-12"
              style={{
                background: 'oklch(0.55 0.2 25 / 0.05)',
                border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyDecision('pass')}
              disabled={pending}
              className="ts-12 mono px-3 py-1.5 rounded"
              style={{
                background: 'oklch(0.6 0.18 280)',
                color: 'white',
                border: '1px solid oklch(0.6 0.18 280 / 0.6)',
                cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              {pending ? 'Working…' : 'Approve (→ awaiting_acceptance)'}
            </button>
            <button
              type="button"
              onClick={() => applyDecision('request_revision')}
              disabled={pending}
              className="ts-12 mono px-3 py-1.5 rounded"
              style={{
                background: 'transparent',
                color: 'var(--danger)',
                border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              Send back
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function ScoresTable({
  scores,
}: {
  scores: Record<string, unknown>
}) {
  const entries = Object.entries(scores).filter(
    ([k, v]) => k !== '__priority' && typeof v === 'number',
  ) as Array<[string, number]>
  if (entries.length === 0) return null
  return (
    <table
      className="w-full ts-12 mono mt-1"
      style={{ borderCollapse: 'separate', borderSpacing: 0 }}
    >
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td
              className="px-1 py-0.5"
              style={{ color: 'var(--mute)' }}
            >
              {k}
            </td>
            <td
              className="px-1 py-0.5 text-right"
              style={{ color: 'var(--text)' }}
            >
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

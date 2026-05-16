import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getRunDetail } from '@/lib/queries/llm-judges'

export const metadata: Metadata = {
  title: 'Judge run — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /workspaces/[id]/judges/[judgeId]/runs/[runId]
 *
 * Detail of one judge run. Three sections:
 *   1. Run summary — status, sample count, overall agreement, duration
 *   2. Per-rubric aggregate — mean agreement across all verdicts in
 *      this run, grouped by rubric id (helps spot which rubric items
 *      the judge nails vs misses)
 *   3. Per-verdict list — link each row back to the annotation it was
 *      paired with, sorted highest-agreement first
 */
export default async function RunDetailPage(props: {
  params: Promise<{ id: string; judgeId: string; runId: string }>
}) {
  const { id: workspaceId, judgeId, runId } = await props.params
  const me = await optionalUser()
  if (!me) {
    redirect(
      `/signin?next=/workspaces/${workspaceId}/judges/${judgeId}/runs/${runId}`,
    )
  }
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) notFound()

  const detail = await getRunDetail(runId)
  if (!detail || detail.run.workspaceId !== workspaceId) notFound()

  // Per-rubric aggregate: avg per-verdict score keyed by rubric id.
  const aggMap = new Map<string, { sum: number; n: number }>()
  for (const v of detail.verdicts) {
    for (const [rubricId, score] of Object.entries(v.perRubricBreakdown)) {
      const slot = aggMap.get(rubricId) ?? { sum: 0, n: 0 }
      slot.sum += score
      slot.n += 1
      aggMap.set(rubricId, slot)
    }
  }
  const perRubric = Array.from(aggMap.entries())
    .map(([id, s]) => ({ id, mean: s.sum / s.n, n: s.n }))
    .sort((a, b) => a.mean - b.mean) // worst first

  const durationSec =
    detail.run.finishedAt && detail.run.startedAt
      ? Math.round(
          (detail.run.finishedAt.getTime() -
            detail.run.startedAt.getTime()) /
            1000,
        )
      : null

  return (
    <div
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <main className="mx-auto max-w-[1000px]">
        <nav className="ts-12 mono flex items-center gap-1.5 mb-4">
          <Link
            href={`/workspaces/${workspaceId}/judges`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            judges
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <Link
            href={`/workspaces/${workspaceId}/judges/${judgeId}`}
            style={{ color: 'var(--mute)' }}
            className="hover:underline"
          >
            {detail.run.judgeName}
          </Link>
          <span style={{ color: 'var(--mute2)' }}>·</span>
          <span style={{ color: 'var(--text)' }}>
            run {runId.slice(0, 8)}
          </span>
        </nav>

        <div className="lbl mb-1">§ RUN SUMMARY</div>
        <h1 className="ts-24 mb-4" style={{ color: 'var(--hi)' }}>
          {detail.run.agreementScore != null
            ? `${Math.round(detail.run.agreementScore * 100)}% agreement`
            : detail.run.status}
        </h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Tile
            label="STATUS"
            value={detail.run.status}
          />
          <Tile
            label="SAMPLES"
            value={String(detail.run.sampleCount)}
          />
          <Tile
            label="TIER"
            value={detail.run.judgeTier}
          />
          <Tile
            label="DURATION"
            value={durationSec != null ? `${durationSec}s` : '—'}
          />
        </div>

        <section className="mb-8">
          <div className="lbl mb-2">§ AGREEMENT BY RUBRIC ITEM (worst first)</div>
          {perRubric.length === 0 ? (
            <div
              className="rounded-md p-4 text-center ts-13 mono"
              style={{
                background: 'var(--panel)',
                border: '1px dashed var(--line)',
                color: 'var(--mute2)',
              }}
            >
              No per-rubric data — likely an empty rubric or all
              samples failed.
            </div>
          ) : (
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
                      RUBRIC ID
                    </th>
                    <th
                      className="px-4 py-2 mono ts-11 text-center"
                      style={{ color: 'var(--mute)', width: 100 }}
                    >
                      N
                    </th>
                    <th
                      className="px-4 py-2 mono ts-11 text-center"
                      style={{ color: 'var(--mute)', width: 140 }}
                    >
                      AGREEMENT
                    </th>
                    <th
                      className="px-4 py-2 mono ts-11"
                      style={{ color: 'var(--mute)', width: 220 }}
                    >

                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perRubric.map((r, i) => (
                    <tr
                      key={r.id}
                      style={{
                        borderTop:
                          i === 0 ? 'none' : '1px solid var(--line)',
                      }}
                    >
                      <td
                        className="px-4 py-2 mono ts-12"
                        style={{ color: 'var(--text)' }}
                      >
                        {r.id}
                      </td>
                      <td
                        className="px-4 py-2 mono ts-12 text-center"
                        style={{ color: 'var(--mute)' }}
                      >
                        {r.n}
                      </td>
                      <td
                        className="px-4 py-2 mono ts-12 text-center"
                        style={{
                          color: agreementColor(r.mean),
                          fontWeight: 600,
                        }}
                      >
                        {Math.round(r.mean * 100)}%
                      </td>
                      <td className="px-4 py-2">
                        <Bar pct={r.mean} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="lbl mb-2">
            § PER-SAMPLE VERDICTS · {detail.verdicts.length}
          </div>
          {detail.verdicts.length === 0 ? (
            <div
              className="rounded-md p-4 text-center ts-13 mono"
              style={{
                background: 'var(--panel)',
                border: '1px dashed var(--line)',
                color: 'var(--mute2)',
              }}
            >
              No verdicts in this run.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {detail.verdicts.map((v) => (
                <li
                  key={v.id}
                  className="rounded-md px-3 py-2 flex items-center justify-between gap-3"
                  style={{
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <span
                    className="ts-12 mono"
                    style={{ color: 'var(--mute)' }}
                  >
                    annotation {v.annotationId.slice(0, 8)} ·{' '}
                    {v.tokensIn + v.tokensOut} tokens
                  </span>
                  <span
                    className="ts-13 mono"
                    style={{
                      color: agreementColor(v.agreementScore),
                      fontWeight: 600,
                    }}
                  >
                    {Math.round(v.agreementScore * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="ts-11 mono mb-1"
        style={{ color: 'var(--mute2)' }}
      >
        {label}
      </div>
      <div
        className="ts-15 mono"
        style={{ color: 'var(--text)', fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  )
}

function Bar({ pct }: { pct: number }) {
  const w = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`
  return (
    <div
      className="rounded-full"
      style={{
        height: 6,
        background: 'var(--panel2)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: w,
          height: '100%',
          background: agreementColor(pct),
          transition: 'width 200ms',
        }}
      />
    </div>
  )
}

function agreementColor(pct: number): string {
  if (pct >= 0.8) return 'oklch(0.5 0.13 150)' // green
  if (pct >= 0.6) return 'oklch(0.6 0.18 280)' // violet
  if (pct >= 0.4) return 'oklch(0.7 0.14 75)' // amber
  return 'var(--danger)'
}

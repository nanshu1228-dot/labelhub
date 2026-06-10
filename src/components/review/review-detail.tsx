'use client'

/**
 * Single-annotation review surface.
 *
 * Keeps the existing server-action contract while presenting the
 * annotation as a reviewer workbench: source material, submitted payload,
 * revision trail, AI pre-review, and the human decision form.
 */

import type { ReactNode } from 'react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bot,
  Clock3,
  ClipboardList,
  Cpu,
  FileJson,
  FileText,
  Gauge,
  History,
  Layers,
  ListTree,
  Loader2,
  MessageSquareText,
  Quote,
  RotateCcw,
  ShieldCheck,
  Thermometer,
  Timer,
} from 'lucide-react'
import { FormRenderer } from '@/components/form-renderer/form-renderer'
import {
  ReviewVerdictControls,
  type TopicStatus,
  type ViewerRole,
} from '@/components/quality/review-verdict-controls'
import { retryAiReview } from '@/lib/actions/ai-agent-ops'
import type { FormSchema } from '@/lib/form-designer/schema'
import { readTaskOperationalSettings } from '@/lib/tasks/settings'
import { stageLabel } from '@/lib/quality/stage-labels'
import { StageStepper } from './stage-stepper'
import { DiffView, type DiffRevision } from './diff-view'
import type { AnnotationDetail } from '@/lib/queries/annotation-detail'
import { getErrorMessage } from '@/lib/errors/client-utils'

export interface ReviewDetailProps {
  detail: AnnotationDetail
  viewerRole: Extract<ViewerRole, 'admin' | 'qc'>
  viewerUserId: string
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function ReviewDetail({
  detail,
  viewerRole,
  viewerUserId,
}: ReviewDetailProps) {
  const latestVerdict = detail.verdicts[detail.verdicts.length - 1] ?? null
  const customSchema = detail.formSchema as FormSchema | null
  const priority = Boolean(
    (latestVerdict?.scores as { __priority?: boolean } | null)?.__priority,
  )
  const rawPrompt = readRawPromptTrace(latestVerdict?.scores ?? null)
  // The owner-configured rubric the AI was told to grade against. Prefer
  // the structured task config (the true owner intent); fall back to the
  // dimensions/prompt embedded in the verdict's raw prompt trace so the
  // section still renders for older verdicts or non-custom-designer tasks.
  const rubric = readReviewRubric(detail.task.templateConfig, rawPrompt)

  const revs: DiffRevision[] = detail.revisions.map((r) => ({
    id: r.id,
    kind: r.kind,
    ts: r.ts,
    payload: r.payload,
  }))
  const nextRev: DiffRevision | null = revs.length > 0 ? revs[revs.length - 1] : null
  const prevRev: DiffRevision | null = revs.length > 1 ? revs[revs.length - 2] : null
  const topicStatus = toTopicStatus(detail.topic.status)
  const twoStage = readTaskOperationalSettings(
    detail.task.templateConfig,
  ).twoStageReview

  return (
    <div className="lh-review-detail-grid">
      <style>{`
        .lh-review-detail-grid {
          display: grid;
          gap: 24px;
          grid-template-columns: 1fr;
          align-items: start;
        }
        .lh-review-detail-grid > [data-pane='right'] {
          order: -1;
        }
        .lh-review-card {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 12px;
          box-shadow: var(--shadow-sm);
        }
        .lh-review-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--panel2);
          border: 1px solid var(--line);
          color: var(--mute);
          flex: 0 0 auto;
        }
        @media (min-width: 1024px) {
          .lh-review-detail-grid {
            grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
          }
          .lh-review-detail-grid > [data-pane='right'] {
            order: 0;
            position: sticky;
            top: 72px;
          }
        }
      `}</style>

      <div data-pane="left" className="flex min-w-0 flex-col gap-5">
        <Panel
          eyebrow="SOURCE MATERIAL"
          title="Review context"
          icon={<FileText size={16} />}
          action={<Pill tone="neutral">{detail.task.templateMode}</Pill>}
        >
          <JsonBlock value={detail.topic.itemData} />
        </Panel>

        <Panel
          eyebrow="SUBMISSION"
          title="Submitted annotation"
          icon={<FileJson size={16} />}
          action={<Pill tone="accent">{stageLabel(detail.topic.status)}</Pill>}
        >
          {customSchema ? (
            <div
              className="rounded"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                padding: 14,
              }}
            >
              <FormRenderer
                schema={customSchema}
                value={detail.annotation.payload}
                onChange={() => {
                  /* read-only: Renderer keeps a controlled API */
                }}
                itemData={detail.topic.itemData}
                readOnly
              />
            </div>
          ) : (
            <JsonBlock value={detail.annotation.payload} />
          )}
        </Panel>

        {nextRev ? (
          <DiffView
            prev={prevRev}
            next={nextRev}
            title="LATEST REVISION DIFF"
          />
        ) : null}

        <RevisionHistory revs={revs} />
      </div>

      <div data-pane="right" className="flex min-w-0 flex-col gap-5">
        <div
          className="lh-review-card"
          style={{ padding: '14px 16px' }}
        >
          <div className="lbl mb-2.5" style={{ color: 'var(--accent)' }}>
            审核流程 · {twoStage ? '两段(初审→终审)' : '单段'}
          </div>
          <StageStepper status={detail.topic.status} twoStage={twoStage} />
        </div>
        <Panel
          eyebrow="AI PRE-REVIEW"
          title="Agent verdict"
          icon={<Bot size={16} />}
          action={
            latestVerdict ? (
              <Pill tone={toneForVerdict(latestVerdict.verdict ?? latestVerdict.status)}>
                {latestVerdict.verdict ?? latestVerdict.status}
              </Pill>
            ) : (
              <Pill tone="neutral">pending</Pill>
            )
          }
        >
          {latestVerdict ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Metric
                  label="Status"
                  value={latestVerdict.status}
                  tone={toneForVerdict(latestVerdict.status)}
                />
                <Metric
                  label="Priority"
                  value={priority ? 'Needs focus' : 'Normal'}
                  tone={priority ? 'warning' : 'neutral'}
                />
                <Metric
                  label="Attempts"
                  value={String(latestVerdict.attempts)}
                  tone="neutral"
                />
                <Metric
                  label="Finished"
                  value={formatDateTime(latestVerdict.finishedAt)}
                  tone="neutral"
                />
              </div>

              <ProvenanceTiles scores={latestVerdict.scores} />

              {latestVerdict.reasoning ? (
                <div
                  className="rounded p-3"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <div
                    className="mb-2 flex items-center gap-2 lh-mono lh-caption"
                    style={{ color: 'var(--mute)' }}
                  >
                    <MessageSquareText size={14} />
                    REASONING
                  </div>
                  <p
                    className="ts-13"
                    style={{
                      color: 'var(--text)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {latestVerdict.reasoning}
                  </p>
                </div>
              ) : null}

              {rubric ? (
                <ReviewRubric rubric={rubric} scores={latestVerdict.scores} />
              ) : null}

              <ScoresTable scores={latestVerdict.scores} />

              {rawPrompt ? <RawPromptTrace prompt={rawPrompt} /> : null}

              {latestVerdict.errorText ? (
                <Callout tone="danger" icon={<AlertTriangle size={15} />}>
                  {latestVerdict.errorText.slice(0, 180)}
                </Callout>
              ) : null}

              {latestVerdict.status === 'failed' ? (
                <RetryAiReviewButton annotationId={detail.annotation.id} />
              ) : null}

              {latestVerdict.status === 'pending' ||
              latestVerdict.status === 'running' ? (
                <PendingVerdictPoll />
              ) : null}
            </div>
          ) : (
            <Callout tone="neutral" icon={<Clock3 size={15} />}>
              No AI verdict has been recorded for this submission.
            </Callout>
          )}
        </Panel>

        {topicStatus ? (
          <ReviewVerdictControls
            annotationId={detail.annotation.id}
            topicStatus={topicStatus}
            viewerRole={viewerRole}
            twoStage={twoStage}
            viewerIsSubmitter={detail.annotation.userId === viewerUserId}
            submitterDisplayName={
              detail.submitter?.email?.split('@')[0] ?? null
            }
          />
        ) : (
          <Panel
            eyebrow="HUMAN REVIEW"
            title="Decision"
            icon={<ShieldCheck size={16} />}
          >
            <Callout tone="neutral" icon={<Clock3 size={15} />}>
              Human verdict actions unlock after AI pre-review moves this
              topic into a reviewable state.
            </Callout>
          </Panel>
        )}

        <Panel
          eyebrow="CASE SNAPSHOT"
          title="Submission facts"
          icon={<Clock3 size={16} />}
        >
          <dl className="grid gap-2">
            <Fact label="Submitter" value={detail.submitter?.email ?? 'Unknown'} />
            <Fact label="Submitted" value={formatDateTime(detail.annotation.submittedAt)} />
            <Fact label="Annotation ID" value={detail.annotation.id} mono />
            <Fact label="Topic ID" value={detail.topic.id} mono />
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function toTopicStatus(status: string): TopicStatus | null {
  if (
    status === 'drafting' ||
    status === 'revising' ||
    status === 'submitted' ||
    status === 'reviewing' ||
    status === 'awaiting_acceptance' ||
    status === 'approved' ||
    status === 'rejected'
  ) {
    return status
  }
  return null
}

function Panel({
  eyebrow,
  title,
  icon,
  action,
  children,
}: {
  eyebrow: string
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="lh-review-card p-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="lh-review-icon" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
              {eyebrow}
            </div>
            <h2
              className="ts-16"
              style={{
                color: 'var(--hi)',
                fontWeight: 520,
                margin: '2px 0 0',
              }}
            >
              {title}
            </h2>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: Tone
}) {
  return (
    <div
      className="rounded p-3"
      style={{
        background: tone === 'neutral' ? 'var(--bg)' : toneBg(tone),
        border: `1px solid ${toneLine(tone)}`,
        minHeight: 74,
      }}
    >
      <div className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <div
        className="ts-14 mt-1 truncate"
        style={{
          color: tone === 'neutral' ? 'var(--hi)' : toneFg(tone),
          fontWeight: 560,
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

/** Normalized per-dimension AI sub-verdict (new + legacy shapes). */
type DimensionScore = {
  score: number
  reasoning: string
  evidence: string[]
}

/**
 * Normalize one `scores[dimId]` cell. NEW verdicts store
 * `{ score, reasoning, evidence[] }`; LEGACY verdicts store a bare number.
 * Returns null only when the cell is neither (so callers skip it).
 */
function normalizeDimensionScore(v: unknown): DimensionScore | null {
  if (typeof v === 'number') {
    return { score: v, reasoning: '', evidence: [] }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const obj = v as Record<string, unknown>
  if (typeof obj.score !== 'number') return null
  const evidence = Array.isArray(obj.evidence)
    ? obj.evidence.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
    : []
  return {
    score: obj.score,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    evidence,
  }
}

function ScoresTable({
  scores,
}: {
  scores: Record<string, unknown> | null
}) {
  const entries = Object.entries(scores ?? {})
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => [k, normalizeDimensionScore(v)] as const)
    .filter((pair): pair is [string, DimensionScore] => pair[1] !== null)

  if (entries.length === 0) {
    return (
      <Callout tone="neutral" icon={<Bot size={15} />}>
        No score dimensions were returned.
      </Callout>
    )
  }

  return (
    <div
      className="rounded p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="mb-3 flex items-center gap-2 lh-mono lh-caption"
        style={{ color: 'var(--mute)' }}
      >
        <ShieldCheck size={14} />
        SCORE DIMENSIONS
      </div>
      <div className="flex flex-col gap-2">
        {entries.map(([key, dim]) => (
          <DimensionRow key={key} dimId={key} dim={dim} />
        ))}
      </div>
    </div>
  )
}

function DimensionRow({
  dimId,
  dim,
}: {
  dimId: string
  dim: DimensionScore
}) {
  const hasDetail = dim.reasoning.trim() !== '' || dim.evidence.length > 0
  const header = (
    <>
      <div className="min-w-0">
        <div
          className="ts-12 mono truncate"
          style={{ color: 'var(--text)' }}
          title={dimId}
        >
          {dimId}
        </div>
        <div
          className="mt-1 overflow-hidden rounded-full"
          style={{
            height: 6,
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
          }}
        >
          <div
            style={{
              width: `${scoreWidth(dim.score)}%`,
              height: '100%',
              background: scoreColor(dim.score),
            }}
          />
        </div>
      </div>
      <div
        className="ts-12 mono text-right"
        style={{ color: 'var(--hi)', fontWeight: 560 }}
      >
        {formatScore(dim.score)}
      </div>
    </>
  )

  if (!hasDetail) {
    // Legacy bare-number cell (or new cell with no prose/evidence): keep the
    // original compact two-column row, no disclosure affordance.
    return <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-3">{header}</div>
  }

  return (
    <details>
      <summary
        className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_44px] gap-3"
        title="Show the AI reasoning + evidence for this dimension"
      >
        {header}
      </summary>
      <div className="mt-2 flex flex-col gap-2 pl-0.5">
        {dim.reasoning.trim() ? (
          <p
            className="ts-12"
            style={{
              color: 'var(--mute)',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {dim.reasoning}
          </p>
        ) : null}
        {dim.evidence.length > 0 ? (
          <div className="flex flex-col gap-1">
            {dim.evidence.map((quote, i) => (
              <span
                key={`${dimId}-ev-${i}`}
                className="ts-11 inline-flex items-start gap-1 rounded px-2 py-1"
                style={{
                  color: 'var(--text)',
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                }}
              >
                <Quote
                  size={11}
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--mute2)' }}
                  aria-hidden
                />
                <span style={{ whiteSpace: 'pre-wrap' }}>{quote}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  )
}

/**
 * Stability + provenance tiles. Reads the `__`-prefixed metadata the engine
 * stamps onto `scores`. Renders nothing for absent fields so legacy verdicts
 * (which carry no metadata) show no empty chrome.
 */
function ProvenanceTiles({
  scores,
}: {
  scores: Record<string, unknown> | null
}) {
  if (!scores) return null

  const model = typeof scores.__model === 'string' ? scores.__model : null
  const provider =
    typeof scores.__provider === 'string' ? scores.__provider : null
  const temperature =
    typeof scores.__temperature === 'number' ? scores.__temperature : null
  const samples =
    typeof scores.__samples === 'number' ? scores.__samples : null
  const latencyMs =
    typeof scores.__latencyMs === 'number' ? scores.__latencyMs : null
  const confidence =
    typeof scores.__confidence === 'number' ? scores.__confidence : null
  const agreement =
    typeof scores.__agreement === 'number' ? scores.__agreement : null

  const tiles: Array<{ icon: ReactNode; label: string; value: string }> = []

  if (confidence !== null) {
    tiles.push({
      icon: <Gauge size={13} />,
      label: 'Confidence',
      value:
        agreement !== null
          ? `${Math.round(confidence)}% · ${Math.round(agreement * 100)}% agree`
          : `${Math.round(confidence)}%`,
    })
  }
  if (model !== null) {
    tiles.push({
      icon: <Cpu size={13} />,
      label: provider ? `Model · ${provider}` : 'Model',
      value: model,
    })
  }
  if (temperature !== null) {
    tiles.push({
      icon: <Thermometer size={13} />,
      label: 'Temperature',
      value: formatTemperature(temperature),
    })
  }
  if (samples !== null) {
    tiles.push({
      icon: <Layers size={13} />,
      label: 'Samples',
      value: String(samples),
    })
  }
  if (latencyMs !== null) {
    tiles.push({
      icon: <Timer size={13} />,
      label: 'Latency',
      value: `${Math.round(latencyMs)} ms`,
    })
  }

  if (tiles.length === 0) return null

  // A single-line provenance sentence reads more naturally than tiles alone.
  const summary = (() => {
    const parts: string[] = []
    if (model !== null) parts.push(`reviewed by ${model}`)
    if (temperature !== null) parts.push(`@ temp ${formatTemperature(temperature)}`)
    if (confidence !== null) parts.push(`confidence ${Math.round(confidence)}%`)
    if (samples !== null) parts.push(`over ${samples} sample${samples === 1 ? '' : 's'}`)
    return parts.join(' ')
  })()

  return (
    <div
      className="rounded p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        className="mb-3 flex items-center gap-2 lh-mono lh-caption"
        style={{ color: 'var(--mute)' }}
      >
        <Cpu size={14} />
        STABILITY &amp; PROVENANCE
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded px-3 py-2"
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              className="flex items-center gap-1.5 lh-mono lh-caption"
              style={{ color: 'var(--mute2)' }}
            >
              <span aria-hidden>{tile.icon}</span>
              {tile.label}
            </div>
            <div
              className="ts-13 mt-1 truncate"
              style={{ color: 'var(--hi)', fontWeight: 540 }}
              title={tile.value}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </div>
      {summary ? (
        <p
          className="ts-11 mt-2"
          style={{ color: 'var(--mute2)', margin: '8px 0 0' }}
        >
          {summary}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Failure-recovery affordance — only mounted for a `failed` latest verdict.
 * Re-runs the AI review via the frozen `retryAiReview` action and refreshes
 * the route so the new verdict row replaces the failed one.
 */
function RetryAiReviewButton({ annotationId }: { annotationId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function onRetry() {
    setError(null)
    setDone(false)
    startTransition(async () => {
      try {
        const result = await retryAiReview({ annotationId })
        if (result.ok) {
          setDone(true)
          router.refresh()
        } else {
          setError(result.reason ?? 'Re-run could not be started.')
        }
      } catch (err) {
        setError(getErrorMessage(err, 'Re-run failed.'))
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onRetry}
        disabled={pending}
        className="ts-13 inline-flex items-center justify-center gap-2 rounded px-3 py-2"
        style={{
          color: toneFg('accent'),
          background: toneBg('accent'),
          border: `1px solid ${toneLine('accent')}`,
          fontWeight: 540,
          cursor: pending ? 'progress' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? (
          <Loader2 size={15} className="lh-spin" aria-hidden />
        ) : (
          <RotateCcw size={15} aria-hidden />
        )}
        {pending ? 'Re-running AI review…' : 'Re-run AI review'}
      </button>
      <style>{`
        @keyframes lh-spin { to { transform: rotate(360deg); } }
        .lh-spin { animation: lh-spin 0.9s linear infinite; }
      `}</style>
      {error ? (
        <Callout tone="danger" icon={<AlertTriangle size={15} />}>
          {error}
        </Callout>
      ) : null}
      {done && !error ? (
        <Callout tone="success" icon={<RotateCcw size={15} />}>
          Re-run started. Refreshing the verdict…
        </Callout>
      ) : null}
    </div>
  )
}

type RubricDimension = {
  id: string
  name: string
  description?: string
}

type ReviewRubricValue = {
  /** Owner-authored review instructions (the standards prose). */
  instructions: string | null
  /** Scoring dimensions the AI was told to grade against. */
  dimensions: RubricDimension[]
  /** Pass / send-back thresholds, if the structured config carried them. */
  passAt: number | null
  sendBackAt: number | null
  /** True when read from the durable task config vs. parsed from the trace. */
  fromConfig: boolean
}

/**
 * Extract the owner's review rubric from the data this component already
 * receives. Prefers the structured `task.templateConfig.aiAgent` block
 * (the durable owner config); if that is absent, parses the dimensions +
 * owner prompt back out of the verdict's raw prompt trace (the
 * `<dimensions>` JSON + `<owner_prompt>` block the agent assembled).
 */
function readReviewRubric(
  templateConfig: Record<string, unknown> | null,
  rawPrompt: RawPromptTraceValue | null,
): ReviewRubricValue | null {
  const agent = (templateConfig as { aiAgent?: unknown } | null)?.aiAgent
  if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
    const cfg = agent as Record<string, unknown>
    const dimensions = normalizeDimensions(cfg.dimensions)
    const instructions =
      typeof cfg.promptTemplate === 'string' && cfg.promptTemplate.trim()
        ? cfg.promptTemplate
        : null
    if (dimensions.length > 0 || instructions) {
      return {
        instructions,
        dimensions,
        passAt: typeof cfg.passAt === 'number' ? cfg.passAt : null,
        sendBackAt: typeof cfg.sendBackAt === 'number' ? cfg.sendBackAt : null,
        fromConfig: true,
      }
    }
  }

  // Fallback: reconstruct from the raw prompt trace the verdict carries.
  const parsed = parseRubricFromTrace(rawPrompt)
  return parsed
}

function normalizeDimensions(raw: unknown): RubricDimension[] {
  if (!Array.isArray(raw)) return []
  const out: RubricDimension[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id : null
    const name = typeof obj.name === 'string' ? obj.name : null
    if (!id && !name) continue
    out.push({
      id: id ?? name ?? '',
      name: name ?? id ?? '',
      description:
        typeof obj.description === 'string' && obj.description.trim()
          ? obj.description
          : undefined,
    })
  }
  return out
}

function parseRubricFromTrace(
  rawPrompt: RawPromptTraceValue | null,
): ReviewRubricValue | null {
  if (!rawPrompt?.user) return null
  const user = rawPrompt.user
  const dimsMatch = /<dimensions>\s*([\s\S]*?)\s*<\/dimensions>/.exec(user)
  let dimensions: RubricDimension[] = []
  if (dimsMatch) {
    try {
      dimensions = normalizeDimensions(JSON.parse(dimsMatch[1].trim()))
    } catch {
      dimensions = []
    }
  }
  const promptMatch = /<owner_prompt>\s*([\s\S]*?)\s*<\/owner_prompt>/.exec(user)
  const instructions =
    promptMatch && promptMatch[1].trim() ? promptMatch[1].trim() : null

  let passAt: number | null = null
  let sendBackAt: number | null = null
  const thrMatch = /<thresholds>\s*([\s\S]*?)\s*<\/thresholds>/.exec(user)
  if (thrMatch) {
    try {
      const thr = JSON.parse(thrMatch[1].trim()) as Record<string, unknown>
      if (typeof thr.passAt === 'number') passAt = thr.passAt
      if (typeof thr.sendBackAt === 'number') sendBackAt = thr.sendBackAt
    } catch {
      /* leave thresholds null */
    }
  }

  if (dimensions.length === 0 && !instructions) return null
  return { instructions, dimensions, passAt, sendBackAt, fromConfig: false }
}

/**
 * Per-dimension status vs the verdict thresholds — gives the reviewer an
 * at-a-glance read of which rubric dimensions cleared the bar (达标), sit in
 * the human-review band (临界), or fell to the send-back band (不达标).
 * Pure derivation from the already-stored sub-score + the owner thresholds;
 * no pipeline change.
 */
function dimensionStatus(
  score: number,
  passAt: number | null,
  sendBackAt: number | null,
): { label: string; color: string } | null {
  if (passAt !== null && score >= passAt)
    return { label: '达标', color: 'oklch(0.5 0.13 150)' }
  if (sendBackAt !== null && score <= sendBackAt)
    return { label: '不达标', color: 'oklch(0.55 0.2 25)' }
  if (passAt !== null || sendBackAt !== null)
    return { label: '临界', color: 'oklch(0.6 0.14 75)' }
  return null
}

/**
 * Pending-verdict auto-poll. While the AI pre-review is in flight
 * (status pending/running) this soft-refreshes the route every 5s — up
 * to ~6 times (30s) — so the reviewer doesn't have to manually reload
 * to see the verdict land. Stops after the cap; a 再检 button restarts.
 * Unmounts (stops polling) the moment the verdict reaches a terminal
 * state, since the parent stops rendering it.
 */
function PendingVerdictPoll() {
  const router = useRouter()
  const [ticks, setTicks] = useState(0)
  useEffect(() => {
    if (ticks >= 6) return
    const t = setTimeout(() => {
      router.refresh()
      setTicks((n) => n + 1)
    }, 5000)
    return () => clearTimeout(t)
  }, [ticks, router])
  return (
    <Callout tone="accent" icon={<Loader2 size={15} className="animate-spin" />}>
      <span className="flex w-full items-center justify-between gap-3">
        <span>
          AI 预审进行中…
          {ticks >= 6 ? '自动刷新已停,点「再检」继续' : '自动刷新中'}
        </span>
        <button
          type="button"
          onClick={() => {
            setTicks(0)
            router.refresh()
          }}
          className="ts-12 mono shrink-0"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          再检
        </button>
      </span>
    </Callout>
  )
}

function ReviewRubric({
  rubric,
  scores,
}: {
  rubric: ReviewRubricValue
  scores: Record<string, unknown> | null
}) {
  const dimScores = scores ?? {}
  return (
    <div
      className="rounded p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--accent-line)',
      }}
    >
      <div
        className="mb-3 flex items-center justify-between gap-2"
        style={{ color: 'var(--mute)' }}
      >
        <span className="flex items-center gap-2 lh-mono lh-caption">
          <ClipboardList size={14} />
          REVIEW RUBRIC
        </span>
        {!rubric.fromConfig ? (
          <span
            className="lh-mono lh-caption"
            style={{ color: 'var(--mute2)' }}
            title="Reconstructed from the verdict's prompt trace; the task's live AI-agent config was not passed to this view."
          >
            FROM TRACE
          </span>
        ) : null}
      </div>

      <p
        className="ts-11"
        style={{ color: 'var(--mute2)', margin: '0 0 12px' }}
      >
        What the AI was told to grade on.
      </p>

      {rubric.instructions ? (
        <div className="mb-3">
          <div
            className="mb-1 lh-mono lh-caption"
            style={{ color: 'var(--mute2)' }}
          >
            OWNER INSTRUCTIONS
          </div>
          <p
            className="ts-12"
            style={{
              color: 'var(--text)',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {rubric.instructions}
          </p>
        </div>
      ) : null}

      {rubric.dimensions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            className="lh-mono lh-caption"
            style={{ color: 'var(--mute2)' }}
          >
            SCORING DIMENSIONS
          </div>
          {rubric.dimensions.map((dim) => {
            const normalized = normalizeDimensionScore(dimScores[dim.id])
            const achieved = normalized ? normalized.score : null
            return (
              <div
                key={dim.id || dim.name}
                className="rounded px-3 py-2"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="ts-13"
                    style={{ color: 'var(--hi)', fontWeight: 540 }}
                  >
                    {dim.name}
                  </span>
                  {achieved !== null ? (
                    <span className="flex items-center gap-2 shrink-0">
                      {(() => {
                        const st = dimensionStatus(
                          achieved,
                          rubric.passAt,
                          rubric.sendBackAt,
                        )
                        return st ? (
                          <span
                            className="ts-11 mono"
                            style={{
                              color: st.color,
                              background: `${st.color}1f`,
                              border: `1px solid ${st.color}66`,
                              borderRadius: 4,
                              padding: '1px 6px',
                              fontWeight: 600,
                            }}
                            title="该维度相对 pass/send-back 阈值的达标情况"
                          >
                            {st.label}
                          </span>
                        ) : null
                      })()}
                      <span
                        className="ts-12 mono"
                        style={{ color: scoreColor(achieved), fontWeight: 560 }}
                        title="AI sub-score for this dimension"
                      >
                        {formatScore(achieved)}
                      </span>
                    </span>
                  ) : null}
                </div>
                {dim.description ? (
                  <p
                    className="ts-12 mt-1"
                    style={{ color: 'var(--mute)', margin: '4px 0 0' }}
                  >
                    {dim.description}
                  </p>
                ) : null}
                {dim.id && dim.id !== dim.name ? (
                  <div
                    className="ts-11 mono mt-1"
                    style={{ color: 'var(--mute2)' }}
                  >
                    {dim.id}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {rubric.passAt !== null || rubric.sendBackAt !== null ? (
        <div
          className="mt-3 flex items-center gap-2 ts-11"
          style={{ color: 'var(--mute)' }}
        >
          <Gauge size={13} />
          <span>
            {rubric.sendBackAt !== null
              ? `Send back ≤ ${rubric.sendBackAt}`
              : null}
            {rubric.sendBackAt !== null && rubric.passAt !== null ? ' · ' : ''}
            {rubric.passAt !== null ? `Pass ≥ ${rubric.passAt}` : null}
          </span>
        </div>
      ) : null}
    </div>
  )
}

type RawPromptTraceValue = {
  system: string | null
  user: string
}

function readRawPromptTrace(
  scores: Record<string, unknown> | null,
): RawPromptTraceValue | null {
  const raw = scores?.__rawPrompt
  if (typeof raw === 'string' && raw.trim()) {
    return { system: null, user: raw }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const user = typeof obj.user === 'string' ? obj.user : null
  if (!user?.trim()) return null
  return {
    system: typeof obj.system === 'string' ? obj.system : null,
    user,
  }
}

function RawPromptTrace({ prompt }: { prompt: RawPromptTraceValue }) {
  return (
    <details
      className="rounded p-3"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 lh-mono lh-caption"
        style={{ color: 'var(--mute)' }}
      >
        <ListTree size={14} />
        RAW PROMPT
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {prompt.system ? (
          <PromptBlock label="SYSTEM" value={prompt.system} />
        ) : null}
        <PromptBlock label="USER" value={prompt.user} />
      </div>
    </details>
  )
}

function PromptBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
        {label}
      </div>
      <pre
        className="ts-11"
        style={{
          margin: 0,
          maxHeight: 220,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--text)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: 10,
        }}
      >
        {value}
      </pre>
    </div>
  )
}

function RevisionHistory({ revs }: { revs: DiffRevision[] }) {
  if (revs.length === 0) {
    return (
      <Panel
        eyebrow="REVISION HISTORY"
        title="No revision trail"
        icon={<History size={16} />}
      >
        <Callout tone="neutral" icon={<History size={15} />}>
          This submission has no saved revision events.
        </Callout>
      </Panel>
    )
  }

  return (
    <Panel
      eyebrow="REVISION HISTORY"
      title={`${revs.length} saved event${revs.length === 1 ? '' : 's'}`}
      icon={<History size={16} />}
    >
      <ol className="flex flex-col gap-2">
        {[...revs].reverse().map((r, index) => (
          <li
            key={r.id}
            className="grid grid-cols-[22px_minmax(0,1fr)] gap-3"
            style={{ color: 'var(--text)' }}
          >
            <span
              className="mt-1 inline-flex items-center justify-center rounded-full"
              style={{
                width: 22,
                height: 22,
                background: index === 0 ? 'var(--accent-soft)' : 'var(--panel2)',
                border: `1px solid ${index === 0 ? 'var(--accent-line)' : 'var(--line)'}`,
                color: index === 0 ? 'var(--accent)' : 'var(--mute)',
              }}
              aria-hidden
            >
              <History size={12} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ts-13" style={{ color: 'var(--hi)' }}>
                  {r.kind}
                </span>
                {index === 0 ? <Pill tone="accent">latest</Pill> : null}
              </div>
              <div
                className="ts-12 mono mt-0.5 truncate"
                style={{ color: 'var(--mute2)' }}
                title={r.id}
              >
                {formatDateTime(r.ts)} / {r.id}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div
      className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded px-3 py-2"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
      }}
    >
      <dt className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
        {label}
      </dt>
      <dd
        className={`ts-12 truncate ${mono ? 'mono' : ''}`}
        style={{ color: 'var(--text)', margin: 0 }}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: Tone
  children: ReactNode
}) {
  return (
    <span
      className="inline-flex items-center rounded lh-mono lh-caption"
      style={{
        minHeight: 24,
        padding: '2px 8px',
        color: toneFg(tone),
        background: toneBg(tone),
        border: `1px solid ${toneLine(tone)}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function Callout({
  tone,
  icon,
  children,
}: {
  tone: Tone
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className="ts-12 flex items-start gap-2 rounded p-3"
      style={{
        color: tone === 'neutral' ? 'var(--mute)' : toneFg(tone),
        background: tone === 'neutral' ? 'var(--bg)' : toneBg(tone),
        border: `1px solid ${toneLine(tone)}`,
      }}
    >
      <span className="mt-0.5" aria-hidden>
        {icon}
      </span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{children}</span>
    </div>
  )
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      className="ts-12 mono rounded"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        color: 'var(--text)',
        padding: '12px 14px',
        margin: 0,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        maxHeight: 420,
      }}
    >
      {jsonPretty(value)}
    </pre>
  )
}

function toneForVerdict(raw: string | null | undefined): Tone {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('pass') || value.includes('approved') || value === 'ok') {
    return 'success'
  }
  if (
    value.includes('send') ||
    value.includes('back') ||
    value.includes('reject') ||
    value.includes('fail') ||
    value.includes('error')
  ) {
    return 'danger'
  }
  if (value.includes('human') || value.includes('review') || value.includes('pending')) {
    return 'warning'
  }
  if (value.includes('running') || value.includes('started')) return 'accent'
  return 'neutral'
}

function toneFg(tone: Tone): string {
  if (tone === 'accent') return 'var(--accent)'
  if (tone === 'success') return 'var(--success)'
  if (tone === 'warning') return 'var(--warn)'
  if (tone === 'danger') return 'var(--danger)'
  return 'var(--mute)'
}

function toneBg(tone: Tone): string {
  if (tone === 'accent') return 'var(--accent-soft)'
  if (tone === 'success') return 'var(--success-soft)'
  if (tone === 'warning') return 'var(--warn-soft)'
  if (tone === 'danger') return 'var(--danger-soft)'
  return 'var(--panel2)'
}

function toneLine(tone: Tone): string {
  if (tone === 'accent') return 'var(--accent-line)'
  if (tone === 'success') return 'oklch(0.65 0.13 150 / 0.38)'
  if (tone === 'warning') return 'oklch(0.64 0.14 75 / 0.42)'
  if (tone === 'danger') return 'oklch(0.6 0.2 25 / 0.34)'
  return 'var(--line)'
}

function scoreWidth(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v >= 0 && v <= 1) return Math.round(v * 100)
  return Math.max(0, Math.min(100, Math.round(v)))
}

function scoreColor(v: number): string {
  const width = scoreWidth(v)
  if (width >= 80) return 'var(--success)'
  if (width >= 50) return 'var(--warn)'
  return 'var(--danger)'
}

function formatScore(v: number): string {
  if (v >= 0 && v <= 1) return `${Math.round(v * 100)}%`
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function formatTemperature(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v)
}

function formatDateTime(d: Date | null): string {
  if (!d) return 'Unknown'
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

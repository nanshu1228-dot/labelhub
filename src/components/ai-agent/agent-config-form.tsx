'use client'

/**
 * AI Review Agent config editor.
 *
 * Owner-only surface to tune the per-task Prompt + scoring dimensions +
 * verdict thresholds + on/off toggle. The server action is kept as the
 * persistence boundary.
 *
 * Two deeper affordances make the rubric a real, exercised contract:
 *   - per-dimension WEIGHTS (normalized readout) + collapsible ANCHORS, plus a
 *     self-consistency SAMPLES control — the "可配置评测标准" depth.
 *   - a DRY-RUN / 试运行 panel that runs the UNSAVED draft against a sample (or
 *     a real task item) via `previewAiAgentVerdict`, so owners can engineer the
 *     rubric before publishing — persisting nothing.
 */

import type { ReactNode } from 'react'
import { useMemo, useState, useTransition } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Gauge,
  ListChecks,
  Loader2,
  Play,
  Plus,
  Power,
  Quote,
  Save,
  Scale,
  Shapes,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react'
import type { AiAgentConfig } from '@/lib/actions/ai-agent-config-schema'
import {
  previewAiAgentVerdict,
  type PreviewVerdictResult,
} from '@/lib/actions/ai-agent-ops'
import { getErrorMessage } from '@/lib/errors/client-utils'

const TIER_OPTIONS = [
  { value: 'fast', label: 'Fast', detail: 'Low latency' },
  { value: 'default', label: 'Default', detail: 'Balanced' },
  { value: 'premium', label: 'Premium', detail: 'Deep review' },
] as const

const TASK_KIND_OPTIONS = [
  {
    value: 'generic',
    label: 'Generic',
    detail: 'Grade a single submission against the dimensions.',
  },
  {
    value: 'qa_quality',
    label: 'QA quality',
    detail: 'Judge one answer against a reference/gold answer.',
  },
  {
    value: 'preference_compare',
    label: 'Preference (A/B)',
    detail: 'Audit a pairwise A/B/tie preference, position-bias aware.',
  },
  {
    value: 'rubric_judgment',
    label: 'Rubric judgment',
    detail:
      'Meta-review: audit the labeler-authored rubric + whether their pass/fail call is correct.',
  },
] as const

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const

type DimensionAnchorKey = 'excellent' | 'acceptable' | 'failing'

const ANCHOR_FIELDS: ReadonlyArray<{
  key: DimensionAnchorKey
  label: string
  hint: string
}> = [
  { key: 'excellent', label: 'Excellent', hint: '90-100 band' },
  { key: 'acceptable', label: 'Acceptable', hint: '50-89 band' },
  { key: 'failing', label: 'Failing', hint: '0-49 band' },
]

const VERDICT_TONE: Record<
  PreviewVerdictResult['verdict'],
  { tone: 'success' | 'warning' | 'danger'; label: string }
> = {
  pass: { tone: 'success', label: 'pass' },
  human_review: { tone: 'warning', label: 'human_review' },
  send_back: { tone: 'danger', label: 'send_back' },
}

export interface AgentConfigFormProps {
  taskId: string
  initialConfig: AiAgentConfig
  save: (input: { taskId: string; config: AiAgentConfig }) => Promise<void>
}

export function AgentConfigForm({
  taskId,
  initialConfig,
  save,
}: AgentConfigFormProps) {
  const [draft, setDraft] = useState<AiAgentConfig>(initialConfig)
  const [savePending, startSave] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [touched, setTouched] = useState(false)
  const [openAnchors, setOpenAnchors] = useState<Record<number, boolean>>({})

  // Dry-run state (kept separate from the save path — it persists nothing).
  const [sampleSubmission, setSampleSubmission] = useState('')
  const [previewPending, startPreview] = useTransition()
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewVerdictResult | null>(null)
  const [showRawPrompt, setShowRawPrompt] = useState(false)

  const promptTokenEstimate = useMemo(
    () => Math.round(draft.promptTemplate.length / 4),
    [draft.promptTemplate],
  )
  const reviewBand = Math.max(0, draft.passAt - draft.sendBackAt)
  const statusLabel = saved ? 'Saved' : touched ? 'Unsaved' : 'Current'

  // Sum of positive weights — drives the normalized "= N%" readout. When no
  // dimension is weighted the engine keeps the model's free score, so we show a
  // neutral dash instead of dividing by zero.
  const weightSum = useMemo(
    () =>
      draft.dimensions.reduce(
        (sum, d) => sum + (d.weight && d.weight > 0 ? d.weight : 0),
        0,
      ),
    [draft.dimensions],
  )

  function touch() {
    setTouched(true)
    setSaved(false)
  }

  function patch<K extends keyof AiAgentConfig>(
    key: K,
    value: AiAgentConfig[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }))
    touch()
  }

  function setDimension(
    idx: number,
    next: Partial<AiAgentConfig['dimensions'][number]>,
  ) {
    setDraft((d) => ({
      ...d,
      dimensions: d.dimensions.map((dim, i) =>
        i === idx ? { ...dim, ...next } : dim,
      ),
    }))
    touch()
  }

  /**
   * Patch one anchor band. Empty inputs collapse the band away; when no band
   * carries text the whole `anchors` object is dropped to `undefined` so empty
   * anchors round-trip as absent (not forced empty strings).
   */
  function setAnchor(idx: number, key: DimensionAnchorKey, value: string) {
    setDraft((d) => ({
      ...d,
      dimensions: d.dimensions.map((dim, i) => {
        if (i !== idx) return dim
        const nextAnchors = { ...(dim.anchors ?? {}) }
        const trimmed = value
        if (trimmed) nextAnchors[key] = trimmed
        else delete nextAnchors[key]
        const hasAny =
          Boolean(nextAnchors.excellent) ||
          Boolean(nextAnchors.acceptable) ||
          Boolean(nextAnchors.failing)
        return { ...dim, anchors: hasAny ? nextAnchors : undefined }
      }),
    }))
    touch()
  }

  function toggleAnchors(idx: number) {
    setOpenAnchors((o) => ({ ...o, [idx]: !o[idx] }))
  }

  function removeDimension(idx: number) {
    setDraft((d) => ({
      ...d,
      dimensions: d.dimensions.filter((_, i) => i !== idx),
    }))
    touch()
  }

  function addDimension() {
    const idx = draft.dimensions.length + 1
    setDraft((d) => ({
      ...d,
      dimensions: [
        ...d.dimensions,
        { id: `dim_${idx}`, name: `Dimension ${idx}` },
      ],
    }))
    touch()
  }

  function submit() {
    setError(null)
    if (draft.sendBackAt >= draft.passAt) {
      setError('sendBackAt must be strictly less than passAt.')
      return
    }
    const dimensionIds = draft.dimensions.map((d) => d.id.trim())
    if (dimensionIds.some((id) => !id)) {
      setError('Every dimension needs a non-empty id.')
      return
    }
    if (new Set(dimensionIds).size !== dimensionIds.length) {
      setError('Dimension ids must be unique.')
      return
    }

    startSave(async () => {
      try {
        await save({ taskId, config: draft })
        setSaved(true)
        setTouched(false)
      } catch (e) {
        setError(getErrorMessage(e, 'Save failed.'))
      }
    })
  }

  /**
   * Dry-run the CURRENT (unsaved) draft against the pasted sample or — when
   * empty — a real task item, persisting nothing. Friendly inline error on
   * quota/validation/parse failures.
   */
  function runPreview() {
    setPreviewError(null)
    if (draft.sendBackAt >= draft.passAt) {
      setPreviewError('sendBackAt must be strictly less than passAt before previewing.')
      return
    }
    const sample = sampleSubmission.trim()
    startPreview(async () => {
      try {
        const result = await previewAiAgentVerdict({
          taskId,
          config: draft,
          sampleSubmission: sample ? sample : undefined,
        })
        setPreview(result)
        setShowRawPrompt(false)
      } catch (e) {
        setPreview(null)
        setPreviewError(
          getErrorMessage(e, 'Preview failed. Try again.'),
        )
      }
    })
  }

  return (
    <div className="lh-agent-grid">
      <style>{`
        .lh-agent-grid {
          display: grid;
          gap: 24px;
          grid-template-columns: 1fr;
          align-items: start;
        }
        .lh-agent-card {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 8px;
        }
        .lh-agent-icon {
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
        .lh-agent-switch {
          width: 52px;
          height: 30px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: var(--panel2);
          padding: 3px;
          transition: background 140ms, border-color 140ms;
        }
        .lh-agent-switch[data-on='true'] {
          background: var(--accent-soft);
          border-color: var(--accent-line);
        }
        .lh-agent-knob {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          border: 1px solid var(--line);
          color: var(--mute);
          transition: transform 140ms, color 140ms;
        }
        .lh-agent-switch[data-on='true'] .lh-agent-knob {
          transform: translateX(20px);
          color: var(--accent);
          border-color: var(--accent-line);
        }
        @media (min-width: 1024px) {
          .lh-agent-grid {
            grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.75fr);
          }
          .lh-agent-grid > [data-pane='right'] {
            position: sticky;
            top: 72px;
          }
        }
      `}</style>

      <div data-pane="left" className="flex min-w-0 flex-col gap-5">
        <Panel
          eyebrow="PROMPT"
          title="Review instructions"
          icon={<Bot size={16} />}
          action={
            <Pill tone={promptTokenEstimate > 1000 ? 'warning' : 'neutral'}>
              ~{promptTokenEstimate} tokens
            </Pill>
          }
        >
          <textarea
            value={draft.promptTemplate}
            onChange={(e) => patch('promptTemplate', e.target.value)}
            rows={12}
            className="ta"
            style={{
              minHeight: 260,
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            }}
          />
        </Panel>

        <Panel
          eyebrow="SCORING"
          title="Dimensions"
          icon={<ListChecks size={16} />}
          action={
            <div className="flex items-center gap-2">
              <Pill tone={weightSum > 0 ? 'neutral' : 'neutral'}>
                <Scale size={11} style={{ marginRight: 4 }} />
                {weightSum > 0 ? `Σ ${weightSum}` : 'unweighted'}
              </Pill>
              <button
                type="button"
                onClick={addDimension}
                disabled={draft.dimensions.length >= 10}
                className="lh-btn lh-btn-ghost lh-btn-sm"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-2">
            {draft.dimensions.length === 0 ? (
              <EmptyRow>No scoring dimensions configured.</EmptyRow>
            ) : (
              draft.dimensions.map((dim, idx) => {
                const w = dim.weight && dim.weight > 0 ? dim.weight : 0
                const normalized =
                  weightSum > 0 && w > 0
                    ? Math.round((w / weightSum) * 100)
                    : null
                const anchorsOpen = Boolean(openAnchors[idx])
                const anchorCount = dim.anchors
                  ? ANCHOR_FIELDS.filter((f) => Boolean(dim.anchors?.[f.key]))
                      .length
                  : 0
                return (
                  <div
                    key={idx}
                    className="flex flex-col gap-2 rounded p-3"
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div className="grid gap-2 lg:grid-cols-[120px_minmax(0,1fr)_92px_36px]">
                      <label className="flex min-w-0 flex-col gap-1">
                        <FieldLabel>ID</FieldLabel>
                        <input
                          type="text"
                          value={dim.id}
                          onChange={(e) =>
                            setDimension(idx, { id: e.target.value })
                          }
                          className="inp mono"
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <FieldLabel>Name</FieldLabel>
                        <input
                          type="text"
                          value={dim.name}
                          onChange={(e) =>
                            setDimension(idx, { name: e.target.value })
                          }
                          className="inp"
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <FieldLabel>Weight</FieldLabel>
                        <div className="flex flex-col gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={dim.weight ?? ''}
                            placeholder="—"
                            onChange={(e) => {
                              const raw = e.target.value
                              setDimension(idx, {
                                weight:
                                  raw === ''
                                    ? undefined
                                    : clampPercent(Number(raw)),
                              })
                            }}
                            className="inp mono"
                          />
                          <span
                            className="lh-mono lh-caption"
                            style={{
                              color:
                                normalized !== null
                                  ? 'var(--accent)'
                                  : 'var(--mute2)',
                            }}
                          >
                            {normalized !== null ? `= ${normalized}%` : '= —'}
                          </span>
                        </div>
                      </label>
                      <div className="flex items-start pt-[18px]">
                        <IconButton
                          label={`Remove ${dim.name || dim.id}`}
                          tone="danger"
                          onClick={() => removeDimension(idx)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </div>

                    <label className="flex min-w-0 flex-col gap-1">
                      <FieldLabel>Description</FieldLabel>
                      <input
                        type="text"
                        value={dim.description ?? ''}
                        onChange={(e) =>
                          setDimension(idx, {
                            description: e.target.value || undefined,
                          })
                        }
                        className="inp"
                      />
                    </label>

                    <div>
                      <button
                        type="button"
                        onClick={() => toggleAnchors(idx)}
                        aria-expanded={anchorsOpen}
                        className="inline-flex items-center gap-1.5 rounded ts-12"
                        style={{
                          color: 'var(--mute)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px 0',
                        }}
                      >
                        {anchorsOpen ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        Scoring anchors
                        {anchorCount > 0 ? (
                          <span
                            className="lh-mono lh-caption"
                            style={{ color: 'var(--accent)' }}
                          >
                            {anchorCount}/3
                          </span>
                        ) : (
                          <span
                            className="lh-mono lh-caption"
                            style={{ color: 'var(--mute2)' }}
                          >
                            optional
                          </span>
                        )}
                      </button>
                      {anchorsOpen ? (
                        <div className="mt-2 flex flex-col gap-2">
                          {ANCHOR_FIELDS.map((field) => (
                            <label
                              key={field.key}
                              className="flex min-w-0 flex-col gap-1"
                            >
                              <FieldLabel>
                                {field.label}
                                <span style={{ color: 'var(--mute2)' }}>
                                  {'  '}
                                  {field.hint}
                                </span>
                              </FieldLabel>
                              <input
                                type="text"
                                value={dim.anchors?.[field.key] ?? ''}
                                onChange={(e) =>
                                  setAnchor(idx, field.key, e.target.value)
                                }
                                placeholder={`What earns an ${field.label.toLowerCase()} score`}
                                className="inp"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Panel>

        <DryRunPanel
          sampleSubmission={sampleSubmission}
          onSampleChange={setSampleSubmission}
          pending={previewPending}
          error={previewError}
          preview={preview}
          showRawPrompt={showRawPrompt}
          onToggleRawPrompt={() => setShowRawPrompt((v) => !v)}
          onRun={runPreview}
          dimensionNames={draft.dimensions}
        />
      </div>

      <div data-pane="right" className="flex min-w-0 flex-col gap-5">
        <Panel
          eyebrow="STATUS"
          title="Agent control"
          icon={<Power size={16} />}
          action={<Pill tone={draft.enabled ? 'success' : 'neutral'}>{draft.enabled ? 'enabled' : 'off'}</Pill>}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="ts-13" style={{ color: 'var(--hi)' }}>
                Run on submit
              </div>
              <div className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
                Current policy is {draft.enabled ? 'active' : 'inactive'}.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              onClick={() => patch('enabled', !draft.enabled)}
              className="lh-agent-switch"
              data-on={draft.enabled}
            >
              <span className="lh-agent-knob">
                <Power size={13} />
              </span>
            </button>
          </div>
        </Panel>

        <Panel
          eyebrow="TASK SHAPE"
          title="Task shape"
          icon={<Shapes size={16} />}
        >
          <div className="grid gap-2">
            {TASK_KIND_OPTIONS.map((option) => {
              const active = draft.taskKind === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patch('taskKind', option.value)}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded p-3 text-left"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'var(--bg)',
                    border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                    color: 'var(--text)',
                    minHeight: 58,
                  }}
                >
                  <span className="min-w-0">
                    <span className="ts-13 block" style={{ color: 'var(--hi)' }}>
                      {option.label}
                    </span>
                    <span className="ts-12 block" style={{ color: 'var(--mute)' }}>
                      {option.detail}
                    </span>
                  </span>
                  {active ? <CheckCircle2 size={16} style={{ color: 'var(--accent)' }} /> : null}
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel
          eyebrow="MODEL"
          title="Review tier"
          icon={<Zap size={16} />}
        >
          <div className="grid gap-2">
            {TIER_OPTIONS.map((option) => {
              const active = draft.tier === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patch('tier', option.value)}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded p-3 text-left"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'var(--bg)',
                    border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                    color: 'var(--text)',
                    minHeight: 58,
                  }}
                >
                  <span className="min-w-0">
                    <span className="ts-13 block" style={{ color: 'var(--hi)' }}>
                      {option.label}
                    </span>
                    <span className="ts-12 block" style={{ color: 'var(--mute)' }}>
                      {option.detail}
                    </span>
                  </span>
                  {active ? <CheckCircle2 size={16} style={{ color: 'var(--accent)' }} /> : null}
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel
          eyebrow="STABILITY"
          title="Self-consistency"
          icon={<SlidersHorizontal size={16} />}
          action={
            <Pill tone={draft.samples > 1 ? 'success' : 'neutral'}>
              {draft.samples > 1 ? `${draft.samples}× vote` : 'single'}
            </Pill>
          }
        >
          <FieldLabel>Samples</FieldLabel>
          <div
            className="mt-1 grid gap-1"
            role="radiogroup"
            aria-label="Self-consistency samples"
            style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
          >
            {SAMPLE_OPTIONS.map((n) => {
              const active = draft.samples === n
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => patch('samples', n)}
                  className="rounded mono ts-13"
                  style={{
                    minHeight: 38,
                    background: active ? 'var(--accent-soft)' : 'var(--bg)',
                    border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                    color: active ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  {n}
                </button>
              )
            })}
          </div>
          <p className="ts-12 mt-2" style={{ color: 'var(--mute)' }}>
            1 = fast deterministic; 2-5 runs multiple samples and votes for a
            steadier, confidence-scored verdict.
          </p>
        </Panel>

        <Panel
          eyebrow="ROUTING"
          title="Verdict thresholds"
          icon={<Gauge size={16} />}
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Send back at"
              value={draft.sendBackAt}
              onChange={(value) => patch('sendBackAt', value)}
            />
            <NumberField
              label="Pass at"
              value={draft.passAt}
              onChange={(value) => patch('passAt', value)}
            />
          </div>

          <div className="mt-4">
            <div
              className="flex h-3 overflow-hidden rounded-full"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
              }}
            >
              <div
                style={{
                  width: `${clampPercent(draft.sendBackAt)}%`,
                  background: 'var(--danger)',
                }}
              />
              <div
                style={{
                  width: `${clampPercent(reviewBand)}%`,
                  background: 'var(--warn)',
                }}
              />
              <div
                style={{
                  flex: 1,
                  background: 'var(--success)',
                }}
              />
            </div>
            <div
              className="mt-2 grid grid-cols-3 gap-2 ts-11 mono"
              style={{ color: 'var(--mute2)' }}
            >
              <span>send_back</span>
              <span className="text-center">human_review</span>
              <span className="text-right">pass</span>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="SAVE"
          title="Publish config"
          icon={<SlidersHorizontal size={16} />}
          action={<Pill tone={saved ? 'success' : touched ? 'warning' : 'neutral'}>{statusLabel}</Pill>}
        >
          <div className="flex flex-col gap-3">
            {error ? (
              <Callout tone="danger" icon={<AlertTriangle size={15} />}>
                {error}
              </Callout>
            ) : null}
            {saved ? (
              <Callout tone="success" icon={<CheckCircle2 size={15} />}>
                Saved. New submissions use this policy.
              </Callout>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={savePending}
              className="lh-btn lh-btn-accent justify-center"
              style={{ minHeight: 42 }}
            >
              {savePending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {savePending ? 'Saving' : 'Save config'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}

/**
 * DRY-RUN / 试运行 — runs the UNSAVED draft against a sample submission (or a
 * real task item when blank) and renders the structured verdict. Persists
 * nothing; this is the engineer-before-publish affordance.
 */
function DryRunPanel({
  sampleSubmission,
  onSampleChange,
  pending,
  error,
  preview,
  showRawPrompt,
  onToggleRawPrompt,
  onRun,
  dimensionNames,
}: {
  sampleSubmission: string
  onSampleChange: (value: string) => void
  pending: boolean
  error: string | null
  preview: PreviewVerdictResult | null
  showRawPrompt: boolean
  onToggleRawPrompt: () => void
  onRun: () => void
  dimensionNames: AiAgentConfig['dimensions']
}) {
  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of dimensionNames) map.set(d.id, d.name)
    return map
  }, [dimensionNames])

  return (
    <Panel
      eyebrow="试运行"
      title="Dry-run preview"
      icon={<FlaskConical size={16} />}
      action={
        preview ? (
          <Pill tone="neutral">{sampleSourceLabel(preview.sampleSource)}</Pill>
        ) : (
          <Pill tone="neutral">persists nothing</Pill>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          <FieldLabel>Sample submission</FieldLabel>
          <textarea
            value={sampleSubmission}
            onChange={(e) => onSampleChange(e.target.value)}
            rows={5}
            placeholder='Paste a submission (JSON or text). Leave empty to use a real task item.'
            className="ta"
            style={{
              minHeight: 110,
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            }}
          />
          <span className="ts-12" style={{ color: 'var(--mute)' }}>
            Runs the UNSAVED draft above. Empty means a real task item is used.
          </span>
        </label>

        <button
          type="button"
          onClick={onRun}
          disabled={pending}
          className="lh-btn lh-btn-accent justify-center"
          style={{ minHeight: 42 }}
        >
          {pending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
          {pending ? 'Running preview' : 'Run preview'}
        </button>

        {error ? (
          <Callout tone="danger" icon={<AlertTriangle size={15} />}>
            {error}
          </Callout>
        ) : null}

        {preview ? (
          <PreviewResult
            preview={preview}
            nameById={nameById}
            showRawPrompt={showRawPrompt}
            onToggleRawPrompt={onToggleRawPrompt}
          />
        ) : null}
      </div>
    </Panel>
  )
}

function PreviewResult({
  preview,
  nameById,
  showRawPrompt,
  onToggleRawPrompt,
}: {
  preview: PreviewVerdictResult
  nameById: Map<string, string>
  showRawPrompt: boolean
  onToggleRawPrompt: () => void
}) {
  const verdictMeta = VERDICT_TONE[preview.verdict]
  // Filter out the metadata keys (none expected on a preview dimensions map,
  // but defend against any "__"-prefixed key per the verdict-row contract).
  const dimensionEntries = Object.entries(preview.dimensions).filter(
    ([key]) => !key.startsWith('__'),
  )

  return (
    <div
      className="flex flex-col gap-3 rounded p-3"
      style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={verdictMeta.tone}>{verdictMeta.label}</Pill>
        <Pill tone="neutral">
          score {Math.round(preview.score)}
        </Pill>
        {preview.consistency ? (
          <Pill
            tone={
              preview.consistency.confidence >= 70
                ? 'success'
                : preview.consistency.confidence >= 40
                  ? 'warning'
                  : 'danger'
            }
          >
            {preview.consistency.confidence}% confidence
          </Pill>
        ) : null}
      </div>

      {preview.consistency ? (
        <div className="ts-12 mono" style={{ color: 'var(--mute)' }}>
          {preview.consistency.samples} samples ·{' '}
          {Math.round(preview.consistency.agreement * 100)}% agreement · σ
          {preview.consistency.scoreStdDev} ·{' '}
          [{preview.consistency.sampleScores.join(', ')}]
        </div>
      ) : null}

      {dimensionEntries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {dimensionEntries.map(([id, raw]) => {
            // LEGACY rows may store a bare number — accept BOTH shapes.
            const v =
              typeof raw === 'number'
                ? { score: raw, reasoning: '', evidence: [] as string[] }
                : raw
            return (
              <div
                key={id}
                className="rounded p-3"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="ts-13" style={{ color: 'var(--hi)' }}>
                    {nameById.get(id) ?? id}
                    <span
                      className="lh-mono lh-caption ml-2"
                      style={{ color: 'var(--mute2)' }}
                    >
                      {id}
                    </span>
                  </span>
                  <span className="mono ts-13" style={{ color: 'var(--accent)' }}>
                    {Math.round(v.score)}
                  </span>
                </div>
                {v.reasoning ? (
                  <p className="ts-12 mt-1" style={{ color: 'var(--mute)' }}>
                    {v.reasoning}
                  </p>
                ) : null}
                {v.evidence.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {v.evidence.map((quote, i) => (
                      <EvidenceChip key={i}>{quote}</EvidenceChip>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <div>
        <FieldLabel>Overall reasoning</FieldLabel>
        <p className="ts-13 mt-1" style={{ color: 'var(--text)' }}>
          {preview.reasoning}
        </p>
        {preview.evidence.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {preview.evidence.map((quote, i) => (
              <EvidenceChip key={i}>{quote}</EvidenceChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
        {preview.usage.provider} · {preview.usage.model} · temp{' '}
        {preview.usage.temperature} · {preview.usage.inputTokens}↑/
        {preview.usage.outputTokens}↓ tokens
      </div>

      <div>
        <button
          type="button"
          onClick={onToggleRawPrompt}
          aria-expanded={showRawPrompt}
          className="inline-flex items-center gap-1.5 rounded ts-12"
          style={{
            color: 'var(--mute)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 0',
          }}
        >
          {showRawPrompt ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
          Raw prompt
        </button>
        {showRawPrompt ? (
          <div className="mt-2 flex flex-col gap-2">
            <RawPromptBlock label="system" value={preview.promptTrace.system} />
            <RawPromptBlock label="user" value={preview.promptTrace.user} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RawPromptBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <pre
        className="ts-11 mono mt-1 overflow-auto rounded p-3"
        style={{
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          color: 'var(--mute)',
          maxHeight: 220,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </pre>
    </div>
  )
}

function EvidenceChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="ts-11 inline-flex items-start gap-1 rounded"
      style={{
        padding: '2px 8px',
        color: 'var(--mute)',
        background: 'var(--panel2)',
        border: '1px solid var(--line)',
        maxWidth: '100%',
      }}
    >
      <Quote size={11} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

function sampleSourceLabel(
  source: PreviewVerdictResult['sampleSource'],
): string {
  switch (source) {
    case 'provided':
      return 'pasted sample'
    case 'task-item':
      return 'real task item'
    case 'placeholder':
      return 'placeholder'
  }
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
    <section className="lh-agent-card p-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="lh-agent-icon" aria-hidden>
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
                fontWeight: 560,
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="inp mono"
      />
    </label>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="lh-mono lh-caption" style={{ color: 'var(--mute2)' }}>
      {children}
    </span>
  )
}

function IconButton({
  label,
  tone,
  onClick,
  children,
}: {
  label: string
  tone?: 'danger'
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center rounded"
      style={{
        width: 36,
        height: 36,
        color: tone === 'danger' ? 'var(--danger)' : 'var(--mute)',
        background: tone === 'danger' ? 'var(--danger-soft)' : 'var(--panel2)',
        border: `1px solid ${tone === 'danger' ? 'oklch(0.6 0.2 25 / 0.34)' : 'var(--line)'}`,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  children: ReactNode
}) {
  const colors = {
    neutral: ['var(--mute)', 'var(--panel2)', 'var(--line)'],
    success: ['var(--success)', 'var(--success-soft)', 'oklch(0.65 0.13 150 / 0.38)'],
    warning: ['var(--warn)', 'var(--warn-soft)', 'oklch(0.64 0.14 75 / 0.42)'],
    danger: ['var(--danger)', 'var(--danger-soft)', 'oklch(0.6 0.2 25 / 0.34)'],
  } as const
  const [color, background, border] = colors[tone]

  return (
    <span
      className="inline-flex items-center rounded lh-mono lh-caption"
      style={{
        minHeight: 24,
        padding: '2px 8px',
        color,
        background,
        border: `1px solid ${border}`,
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
  tone: 'success' | 'danger'
  icon: ReactNode
  children: ReactNode
}) {
  const color = tone === 'success' ? 'var(--success)' : 'var(--danger)'
  const background = tone === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)'
  const border =
    tone === 'success'
      ? 'oklch(0.65 0.13 150 / 0.38)'
      : 'oklch(0.6 0.2 25 / 0.34)'

  return (
    <div
      className="ts-12 flex items-start gap-2 rounded p-3"
      style={{ color, background, border: `1px solid ${border}` }}
    >
      <span className="mt-0.5" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </div>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div
      className="ts-13 rounded p-4"
      style={{
        background: 'var(--bg)',
        border: '1px dashed var(--line2)',
        color: 'var(--mute)',
      }}
    >
      {children}
    </div>
  )
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

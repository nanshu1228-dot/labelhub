'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createTask } from '@/lib/actions/tasks'
import {
  generateTemplateFromDescription,
  generateTrajectoryRubricFromDescription,
} from '@/lib/actions/template-generator'
import type {
  ConditionalDisplay,
  PairChecklistItem,
  TemplateMode,
} from '@/lib/templates/types'
import type {
  RubricItem,
  RubricScale,
  RubricSeverity,
  RubricSpec,
  TrajectoryStepKind,
} from '@/lib/templates/rubric'

/**
 * Admin task-creation form.
 *
 * The reward config defaults to a cash-per-item baseline (10 CNY per row,
 * 1.0-1.5× quality multiplier) — admins can tweak once we add a fuller
 * payout-config editor; for now the focus is on getting the rubric
 * customization right since that's where mode differentiation matters.
 *
 * Rubric editing:
 *   - pair-rubric / arena-gsb: shows the template's preset list as the
 *     starting point. Admin can rename, edit descriptions, delete, or
 *     append new items. Submit ships `templateConfig` to the server,
 *     which validates snake_case ids + 30-item cap.
 *   - agent-trace-eval: hides the rubric editor (the flagship's rubric
 *     is multi-shaped and not exposed to per-task overrides yet).
 */

type EditableItem = PairChecklistItem & { _key: string }

let _seq = 0
function nextKey() {
  _seq += 1
  return `row_${_seq}_${Date.now()}`
}

function toEditable(items: readonly PairChecklistItem[]): EditableItem[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    showWhen: i.showWhen,
    _key: nextKey(),
  }))
}

function formatShowWhen(
  cond: ConditionalDisplay,
  mode: TemplateMode,
): string {
  if (typeof cond.when === 'boolean') {
    return `${cond.parentId} = ${cond.when ? 'yes' : 'no'}`
  }
  // arena-gsb: numeric threshold
  void mode
  return `${cond.parentId} ≥ ${cond.when}`
}

type EditableRubricItem = RubricItem & { _key: string }

function toEditableRubric(items: readonly RubricItem[]): EditableRubricItem[] {
  return items.map((i) => ({ ...i, _key: nextKey() }))
}

/**
 * Structural comparison for two rubric items — used to decide whether a
 * templateConfig.rubric override is actually different from the default.
 * Compares the user-facing fields; we don't bother with deep options
 * equality (re-ordered options are still "different" and an override
 * write is honest about that).
 */
function sameRubricItem(a: RubricItem, b: RubricItem): boolean {
  if (!a || !b) return false
  if (a.id !== b.id) return false
  if (a.name !== b.name) return false
  if ((a.description ?? '') !== (b.description ?? '')) return false
  if (a.scale !== b.scale) return false
  if (a.severity !== b.severity) return false
  if (!!a.requiresReason !== !!b.requiresReason) return false
  const optsA = (a.options ?? []).join('|')
  const optsB = (b.options ?? []).join('|')
  if (optsA !== optsB) return false
  const appliesA = (a.appliesTo ?? []).join('|')
  const appliesB = (b.appliesTo ?? []).join('|')
  if (appliesA !== appliesB) return false
  return true
}

export function CreateTaskForm({
  workspaceId,
  workspaceName,
  templateMode,
  templateName,
  templateDescription,
  defaultPairChecklist,
  defaultArenaDimensions,
  defaultTrajectoryRubric,
}: {
  workspaceId: string
  workspaceName: string
  templateMode: TemplateMode
  templateName: string
  templateDescription: string
  defaultPairChecklist: readonly PairChecklistItem[] | null
  defaultArenaDimensions: readonly PairChecklistItem[] | null
  defaultTrajectoryRubric: RubricSpec | null
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [guidelines, setGuidelines] = useState('')
  const [rewardAmount, setRewardAmount] = useState<string>('10')

  const initialChecklist =
    templateMode === 'pair-rubric'
      ? defaultPairChecklist ?? []
      : templateMode === 'arena-gsb'
        ? defaultArenaDimensions ?? []
        : []
  const [items, setItems] = useState<EditableItem[]>(() =>
    toEditable(initialChecklist),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 🪄 NL → rubric generator UI state. Modal stays self-contained so
  // the form's existing flow is unchanged when the admin doesn't use AI.
  const [genOpen, setGenOpen] = useState(false)
  const [genDescription, setGenDescription] = useState('')
  const [genPending, startGenTransition] = useTransition()
  const [genError, setGenError] = useState<string | null>(null)
  const [genSummary, setGenSummary] = useState<string | null>(null)

  // Trajectory rubric editor — only used when templateMode is
  // 'agent-trace-eval'. perStep and perTrajectory are edited as
  // separate lists; on save we ship templateConfig.rubric if changed.
  const initialTrajRubric =
    defaultTrajectoryRubric ?? { perStep: [], perTrajectory: [] }
  const [trajPerStep, setTrajPerStep] = useState<EditableRubricItem[]>(() =>
    toEditableRubric(initialTrajRubric.perStep),
  )
  const [trajPerTraj, setTrajPerTraj] = useState<EditableRubricItem[]>(() =>
    toEditableRubric(initialTrajRubric.perTrajectory),
  )
  const supportsTrajectoryEditor = templateMode === 'agent-trace-eval'

  const supportsRubricEditor =
    templateMode === 'pair-rubric' || templateMode === 'arena-gsb'

  const fieldLabel =
    templateMode === 'pair-rubric' ? 'rubric items (yes/no)' : 'dimensions (1–5)'

  function setItem(key: string, patch: Partial<PairChecklistItem>) {
    setItems((prev) =>
      prev.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    )
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it._key !== key))
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      { _key: nextKey(), id: '', name: '', description: '' },
    ])
  }
  function restoreDefaults() {
    setItems(toEditable(initialChecklist))
  }

  /**
   * Call the NL → rubric server action with the modal's description and
   * REPLACE the current rubric items with the result. The admin then
   * reviews each row + can edit names/descriptions before saving.
   *
   * We don't append — we replace. If the admin wanted to keep their
   * existing rows, they'd close the modal without generating.
   *
   * Two dispatch paths:
   *   - pair-rubric / arena-gsb → flat list, fills `items`
   *   - agent-trace-eval        → RubricSpec, fills both trajectory lists
   */
  function generateFromDescription() {
    const desc = genDescription.trim()
    if (desc.length < 8) {
      setGenError('Describe the task in a sentence or two (≥ 8 chars).')
      return
    }
    setGenError(null)
    setGenSummary(null)
    if (supportsRubricEditor) {
      startGenTransition(async () => {
        try {
          const r = await generateTemplateFromDescription({
            workspaceId,
            mode: templateMode as 'pair-rubric' | 'arena-gsb',
            description: desc,
          })
          setItems(
            r.template.items.map((i) => ({
              _key: nextKey(),
              id: i.id,
              name: i.name,
              description: i.description,
              showWhen: i.showWhen,
            })),
          )
          setGenSummary(r.template.summary)
        } catch (e) {
          setGenError(e instanceof Error ? e.message : 'Generation failed.')
        }
      })
      return
    }
    if (supportsTrajectoryEditor) {
      startGenTransition(async () => {
        try {
          const r = await generateTrajectoryRubricFromDescription({
            workspaceId,
            description: desc,
          })
          setTrajPerStep(toEditableRubric(r.rubric.perStep))
          setTrajPerTraj(toEditableRubric(r.rubric.perTrajectory))
          setGenSummary(r.generated.summary)
        } catch (e) {
          setGenError(e instanceof Error ? e.message : 'Generation failed.')
        }
      })
    }
  }

  // ─── Trajectory rubric editor helpers ──────────────────────────────
  function setTrajItem(
    list: 'perStep' | 'perTrajectory',
    key: string,
    patch: Partial<RubricItem>,
  ) {
    const setter = list === 'perStep' ? setTrajPerStep : setTrajPerTraj
    setter((prev) =>
      prev.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    )
  }
  function removeTrajItem(list: 'perStep' | 'perTrajectory', key: string) {
    const setter = list === 'perStep' ? setTrajPerStep : setTrajPerTraj
    setter((prev) => prev.filter((it) => it._key !== key))
  }
  function restoreTrajDefaults() {
    setTrajPerStep(toEditableRubric(initialTrajRubric.perStep))
    setTrajPerTraj(toEditableRubric(initialTrajRubric.perTrajectory))
  }

  function submit() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Task name is required.')
      return
    }
    const amountNumeric = Number(rewardAmount)
    if (!Number.isFinite(amountNumeric) || amountNumeric < 0) {
      setError('Reward amount must be a non-negative number.')
      return
    }

    let templateConfig:
      | {
          pairChecklist?: PairChecklistItem[]
          arenaDimensions?: PairChecklistItem[]
          rubric?: RubricSpec
        }
      | undefined
    if (supportsRubricEditor) {
      const cleaned: PairChecklistItem[] = []
      for (const it of items) {
        const idTrim = it.id.trim()
        const nameTrim = it.name.trim()
        if (!idTrim && !nameTrim) continue // skip empty rows
        if (!/^[a-z][a-z0-9_]*$/.test(idTrim)) {
          setError(
            `Item id "${idTrim || '(blank)'}" must be lowercase snake_case (letters, digits, underscore; start with a letter).`,
          )
          return
        }
        if (!nameTrim) {
          setError(`Item "${idTrim}" needs a display name.`)
          return
        }
        cleaned.push({
          id: idTrim,
          name: nameTrim,
          description: it.description?.trim() || undefined,
          // Preserve conditional follow-up from AI generation or
          // restore-defaults. The form doesn't yet expose direct
          // editing of showWhen — admins curate it via the modal +
          // delete-row workflow.
          showWhen: it.showWhen,
        })
      }
      if (cleaned.length === 0) {
        setError('Add at least one rubric item.')
        return
      }
      const ids = cleaned.map((c) => c.id)
      if (new Set(ids).size !== ids.length) {
        setError('Rubric item ids must be unique.')
        return
      }
      templateConfig =
        templateMode === 'pair-rubric'
          ? { pairChecklist: cleaned }
          : { arenaDimensions: cleaned }
      // Only ship the override if it actually differs from the preset —
      // saves a row of JSON in the DB and is honest about "default".
      // Compares showWhen too: a rubric that swaps a default item for a
      // conditional follow-up is NOT preset-equal even if the surface
      // text matches.
      const sameCondition = (
        a: ConditionalDisplay | undefined,
        b: ConditionalDisplay | undefined,
      ) => {
        if (!a && !b) return true
        if (!a || !b) return false
        return a.parentId === b.parentId && a.when === b.when
      }
      const presetEqual =
        cleaned.length === initialChecklist.length &&
        cleaned.every((c, i) => {
          const p = initialChecklist[i]
          return (
            p.id === c.id &&
            p.name === c.name &&
            (p.description ?? undefined) === c.description &&
            sameCondition(p.showWhen, c.showWhen)
          )
        })
      if (presetEqual) templateConfig = undefined
    }

    // Trajectory rubric override: only shipped when at least one
    // editable name/description (or item count) differs from the
    // template default. Validation here is minimal — server-side
    // `effective.parseConfig` runs the strict rubricSpecSchema and
    // falls back to defaults on bad shapes.
    if (supportsTrajectoryEditor) {
      const stripKey = (it: EditableRubricItem): RubricItem => {
        const { _key: _ignore, ...rest } = it
        void _ignore
        return rest
      }
      const candidatePerStep = trajPerStep.map(stripKey)
      const candidatePerTraj = trajPerTraj.map(stripKey)
      // Sanity: require unique ids in each list AND across lists
      // (per-step and per-trajectory share a storage namespace).
      const allIds = [
        ...candidatePerStep.map((i) => i.id),
        ...candidatePerTraj.map((i) => i.id),
      ]
      if (new Set(allIds).size !== allIds.length) {
        setError(
          'Trajectory rubric item ids must be unique across perStep and perTrajectory.',
        )
        return
      }
      // Skip if identical to the template default (avoid storing
      // a redundant override row).
      const sameAsDefault =
        candidatePerStep.length === initialTrajRubric.perStep.length &&
        candidatePerTraj.length === initialTrajRubric.perTrajectory.length &&
        candidatePerStep.every((c, i) => sameRubricItem(c, initialTrajRubric.perStep[i])) &&
        candidatePerTraj.every((c, i) =>
          sameRubricItem(c, initialTrajRubric.perTrajectory[i]),
        )
      if (!sameAsDefault) {
        templateConfig = templateConfig ?? {}
        templateConfig.rubric = {
          perStep: candidatePerStep,
          perTrajectory: candidatePerTraj,
        }
      }
    }

    setError(null)
    startTransition(async () => {
      try {
        const task = await createTask({
          workspaceId,
          name: trimmedName,
          description: description.trim() || undefined,
          guidelinesMarkdown: guidelines.trim() || undefined,
          templateMode,
          rewardConfig: {
            type: 'cash-per-item',
            currency: 'CNY',
            amount: Math.round(amountNumeric * 100), // store minor units (fen)
            qualityMultiplierMin: 1.0,
            qualityMultiplierMax: 1.5,
          },
          templateConfig,
          phase: 1,
        })
        router.push(`/workspaces/${workspaceId}/tasks/${task.id}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Create task failed.')
      }
    })
  }

  return (
    <div>
      <div className="flex items-center gap-3 ts-12 mono mb-3">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="hover:underline"
          style={{ color: 'var(--mute)' }}
        >
          {workspaceName}
        </Link>
        <span style={{ color: 'var(--mute2)' }}>·</span>
        <span style={{ color: 'var(--text)' }}>new task</span>
      </div>
      <h1
        className="ts-22 mb-2"
        style={{ color: 'var(--hi)', fontWeight: 600 }}
      >
        Create a task
      </h1>
      <p className="ts-13 mb-6" style={{ color: 'var(--mute)' }}>
        Template:{' '}
        <span className="mono" style={{ color: 'var(--accent)' }}>
          {templateName}
        </span>{' '}
        — {templateDescription}
      </p>

      <section className="mb-6">
        <div className="lbl mb-2">§ BASICS</div>
        <Field label="Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="Phase 1 · Open-Domain Q&A"
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={inputStyle}
          />
        </Field>
        <Field label="Description (admin-only context)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="What this task is for. Helps when you have multiple phases running."
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={inputStyle}
          />
        </Field>
        <Field label="Guidelines (shown to annotators, markdown OK)">
          <textarea
            value={guidelines}
            onChange={(e) => setGuidelines(e.target.value)}
            rows={4}
            maxLength={50000}
            placeholder="# How to rate&#10;Mark `yes` only when the response directly answers the prompt..."
            className="w-full px-3 py-2 ts-13 rounded-md mono"
            style={inputStyle}
          />
        </Field>
        <Field label="Reward (CNY per item)">
          <input
            type="number"
            min="0"
            step="0.5"
            value={rewardAmount}
            onChange={(e) => setRewardAmount(e.target.value)}
            className="w-32 px-3 py-2 ts-13 rounded-md mono"
            style={inputStyle}
          />
        </Field>
      </section>

      {supportsRubricEditor && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ {fieldLabel.toUpperCase()}</div>
            <div className="flex items-center gap-3 ts-11 mono">
              <button
                type="button"
                onClick={() => {
                  setGenOpen(true)
                  setGenError(null)
                }}
                className="ts-11 mono"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  border: '1px dashed var(--accent-line)',
                  borderRadius: 4,
                  padding: '2px 10px',
                  cursor: 'pointer',
                }}
                title="Describe the task in natural language and let Claude propose the rubric"
              >
                🪄 generate from description
              </button>
              <button
                type="button"
                onClick={restoreDefaults}
                style={{ color: 'var(--mute2)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                restore defaults
              </button>
              <button
                type="button"
                onClick={addItem}
                className="ts-11 mono"
                style={{
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: 4,
                  padding: '2px 10px',
                  cursor: 'pointer',
                }}
              >
                + add item
              </button>
            </div>
          </div>
          {genOpen && (
            <GenerateModal
              mode={templateMode}
              description={genDescription}
              setDescription={setGenDescription}
              pending={genPending}
              error={genError}
              summary={genSummary}
              onClose={() => {
                setGenOpen(false)
                setGenSummary(null)
              }}
              onGenerate={generateFromDescription}
            />
          )}
          <p
            className="ts-12 mb-3"
            style={{ color: 'var(--mute2)' }}
          >
            Each item is asked twice — once for model A, once for model B.
            ID is the storage key (snake_case, never rename after rows exist).
          </p>
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
                    className="text-left px-3 py-2 mono ts-11"
                    style={{ color: 'var(--mute)', width: 180 }}
                  >
                    ID
                  </th>
                  <th
                    className="text-left px-3 py-2 mono ts-11"
                    style={{ color: 'var(--mute)', width: 220 }}
                  >
                    NAME
                  </th>
                  <th
                    className="text-left px-3 py-2 mono ts-11"
                    style={{ color: 'var(--mute)' }}
                  >
                    DESCRIPTION
                  </th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it._key}
                    style={{ borderTop: '1px solid var(--line)' }}
                  >
                    <td className="px-3 py-2">
                      <input
                        value={it.id}
                        onChange={(e) =>
                          setItem(it._key, { id: e.target.value })
                        }
                        placeholder="snake_case_id"
                        className="w-full px-2 py-1 mono ts-12"
                        style={inlineInputStyle}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={it.name}
                        onChange={(e) =>
                          setItem(it._key, { name: e.target.value })
                        }
                        placeholder="Display name"
                        className="w-full px-2 py-1 ts-13"
                        style={inlineInputStyle}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={it.description ?? ''}
                        onChange={(e) =>
                          setItem(it._key, { description: e.target.value })
                        }
                        placeholder="Optional one-liner"
                        className="w-full px-2 py-1 ts-13"
                        style={inlineInputStyle}
                      />
                      {it.showWhen && (
                        <div
                          className="ts-11 mono mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{
                            background: 'var(--accent-soft)',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent-line)',
                          }}
                          title="Conditional follow-up — only shown to raters when the parent answer matches"
                        >
                          <span>↳</span>
                          <span>show when {formatShowWhen(it.showWhen, templateMode)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(it._key)}
                        title="Remove"
                        className="ts-12 mono"
                        style={{
                          color: 'var(--danger)',
                          background: 'transparent',
                          border: '1px solid transparent',
                          padding: '2px 6px',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center ts-12 mono"
                      style={{ color: 'var(--mute2)' }}
                    >
                      No items — click &quot;+ add item&quot; or &quot;restore defaults&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {supportsTrajectoryEditor && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ TRAJECTORY RUBRIC</div>
            <div className="flex items-center gap-3 ts-11 mono">
              <button
                type="button"
                onClick={() => {
                  setGenOpen(true)
                  setGenError(null)
                }}
                className="ts-11 mono"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  border: '1px dashed var(--accent-line)',
                  borderRadius: 4,
                  padding: '2px 10px',
                  cursor: 'pointer',
                }}
                title="Describe what raters should check; Claude generates the full per-step + per-trajectory rubric"
              >
                🪄 generate from description
              </button>
              <button
                type="button"
                onClick={restoreTrajDefaults}
                style={{
                  color: 'var(--mute2)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                restore defaults
              </button>
            </div>
          </div>
          {genOpen && (
            <GenerateModal
              mode={templateMode}
              description={genDescription}
              setDescription={setGenDescription}
              pending={genPending}
              error={genError}
              summary={genSummary}
              onClose={() => {
                setGenOpen(false)
                setGenSummary(null)
              }}
              onGenerate={generateFromDescription}
            />
          )}
          <p className="ts-12 mb-3" style={{ color: 'var(--mute2)' }}>
            Two-tier: per-step questions asked once per matching step, and
            per-trajectory questions asked once for the whole trace. Names
            + descriptions are editable; scale and step-kind filters are
            set by the AI (regenerate to change them).
          </p>
          <TrajRubricSubsection
            heading="PER-STEP"
            list="perStep"
            items={trajPerStep}
            setItem={setTrajItem}
            removeItem={removeTrajItem}
            showAppliesTo
          />
          <TrajRubricSubsection
            heading="PER-TRAJECTORY"
            list="perTrajectory"
            items={trajPerTraj}
            setItem={setTrajItem}
            removeItem={removeTrajItem}
            showAppliesTo={false}
          />
        </section>
      )}

      {error && (
        <div
          className="ts-12 mono mb-4 p-2 rounded"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="ts-13 mono"
          style={{
            color: 'var(--mute)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '6px 14px',
            textDecoration: 'none',
          }}
        >
          cancel
        </Link>
        <button
          onClick={submit}
          disabled={pending}
          className="ts-13 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 500,
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? 'creating…' : 'create task'}
        </button>
      </div>
    </div>
  )
}

const inputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'var(--font-geist-sans), system-ui',
} as const

const inlineInputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 4,
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'var(--font-geist-sans), system-ui',
} as const

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block mb-3">
      <span
        className="ts-12 mono mb-1.5 block"
        style={{ color: 'var(--mute)' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

/**
 * Trajectory rubric subsection — renders one of (perStep | perTrajectory)
 * as a table where name + description are editable inline; scale,
 * appliesTo, severity, and requiresReason render as readonly chips. The
 * admin can delete rows or regenerate via 🪄. Direct editing of those
 * structural fields is deliberately out of scope — admins curate via the
 * AI generator or live with the preset defaults.
 *
 * This is the minimum-viable trajectory rubric editor. The full version
 * (scale picker, options editor for enums, applies-to multi-select)
 * lives in the backlog under "trajectory template builder v2".
 */
function TrajRubricSubsection({
  heading,
  list,
  items,
  setItem,
  removeItem,
  showAppliesTo,
}: {
  heading: string
  list: 'perStep' | 'perTrajectory'
  items: EditableRubricItem[]
  setItem: (
    list: 'perStep' | 'perTrajectory',
    key: string,
    patch: Partial<RubricItem>,
  ) => void
  removeItem: (list: 'perStep' | 'perTrajectory', key: string) => void
  showAppliesTo: boolean
}) {
  return (
    <div className="mb-4">
      <div
        className="ts-11 mono mb-1"
        style={{ color: 'var(--mute)', letterSpacing: '0.06em' }}
      >
        {heading} · {items.length} {items.length === 1 ? 'item' : 'items'}
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
                className="text-left px-3 py-2 mono ts-11"
                style={{ color: 'var(--mute)', width: 160 }}
              >
                ID
              </th>
              <th
                className="text-left px-3 py-2 mono ts-11"
                style={{ color: 'var(--mute)', width: 180 }}
              >
                NAME
              </th>
              <th
                className="text-left px-3 py-2 mono ts-11"
                style={{ color: 'var(--mute)' }}
              >
                DESCRIPTION / META
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it._key}
                style={{ borderTop: '1px solid var(--line)' }}
              >
                <td
                  className="px-3 py-2 mono ts-12"
                  style={{ color: 'var(--mute2)' }}
                  title="Storage key — set by the AI generator, not editable inline"
                >
                  {it.id}
                </td>
                <td className="px-3 py-2">
                  <input
                    value={it.name}
                    onChange={(e) =>
                      setItem(list, it._key, { name: e.target.value })
                    }
                    placeholder="Display name"
                    className="w-full px-2 py-1 ts-13"
                    style={inlineInputStyle}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={it.description ?? ''}
                    onChange={(e) =>
                      setItem(list, it._key, {
                        description: e.target.value,
                      })
                    }
                    placeholder="Optional one-liner"
                    className="w-full px-2 py-1 ts-13"
                    style={inlineInputStyle}
                  />
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip color="oklch(0.6 0.18 280)" label={`scale: ${it.scale}`} />
                    {showAppliesTo && (
                      <Chip
                        color="oklch(0.55 0 0)"
                        label={`applies: ${formatAppliesTo(it.appliesTo)}`}
                      />
                    )}
                    {it.options && it.options.length > 0 && (
                      <Chip
                        color="oklch(0.65 0.18 200)"
                        label={`opts: ${it.options.join(' / ')}`}
                      />
                    )}
                    {it.severity && it.severity !== 'minor' && (
                      <Chip
                        color={
                          it.severity === 'critical'
                            ? 'var(--danger)'
                            : 'oklch(0.6 0.18 280)'
                        }
                        label={`severity: ${it.severity}`}
                      />
                    )}
                    {it.requiresReason && (
                      <Chip color="oklch(0.6 0.14 75)" label="needs reason" />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeItem(list, it._key)}
                    title="Remove"
                    className="ts-12 mono"
                    style={{
                      color: 'var(--danger)',
                      background: 'transparent',
                      border: '1px solid transparent',
                      padding: '2px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center ts-12 mono"
                  style={{ color: 'var(--mute2)' }}
                >
                  No items — click &quot;🪄 generate&quot; or
                  &quot;restore defaults&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="ts-11 mono px-1.5 py-0.5 rounded inline-block"
      style={{
        color,
        background: `${color}15`,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
    </span>
  )
}

function formatAppliesTo(
  a: readonly TrajectoryStepKind[] | readonly ['*'] | undefined,
): string {
  if (!a || a.length === 0) return 'all'
  if (a[0] === '*') return 'all'
  return (a as readonly TrajectoryStepKind[]).join(', ')
}

// Suppress unused warnings — RubricScale / RubricSeverity are referenced
// only through the imported types and helpers below; keeping the imports
// explicit so future direct uses (e.g. a scale picker) typecheck cleanly.
void (null as unknown as RubricScale | undefined)
void (null as unknown as RubricSeverity | undefined)

/**
 * NL → rubric generator modal.
 *
 * Admin describes the task in a textarea, clicks generate. The action
 * shows a summary line (so they spot misinterpretations) and replaces
 * the form's rubric items in-place. Closing without generating keeps
 * the existing items untouched.
 *
 * UX intent: this is a sketch tool, not a one-click "ship it". The
 * admin always reviews + tweaks individual items before saving the
 * task — same as if they'd typed the rubric by hand.
 */
function GenerateModal({
  mode,
  description,
  setDescription,
  pending,
  error,
  summary,
  onClose,
  onGenerate,
}: {
  mode: TemplateMode
  description: string
  setDescription: (v: string) => void
  pending: boolean
  error: string | null
  summary: string | null
  onClose: () => void
  onGenerate: () => void
}) {
  const example =
    mode === 'pair-rubric'
      ? '比如:评估两个客服回答的质量,检查回答是否切题、是否礼貌、是否提供了可执行步骤;如果提供了步骤,再检查步骤是否完整。'
      : '比如:评估两个翻译版本,从准确性、流畅度、文化适配三个维度1-5评分;如果准确性≥4,再细评术语精确度。'
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'oklch(0 0 0 / 0.45)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-md p-5"
        style={{
          width: 560,
          maxWidth: '100%',
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div className="flex items-baseline justify-between mb-2">
          <div className="lbl" style={{ color: 'var(--accent)' }}>
            🪄 GENERATE RUBRIC FROM DESCRIPTION
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ts-12 mono"
            style={{
              color: 'var(--mute2)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            close
          </button>
        </div>
        <p className="ts-12 mb-3" style={{ color: 'var(--mute)' }}>
          Describe what you want raters to check. Claude returns a draft
          rubric — you can edit every row before saving the task.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder={example}
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'var(--font-geist-sans), system-ui',
          }}
        />
        {summary && (
          <div
            className="ts-12 mt-2 p-2 rounded"
            style={{
              background: 'var(--success-soft)',
              border: '1px solid oklch(0.5 0.13 150 / 0.35)',
              color: 'var(--text)',
            }}
          >
            <span
              className="lbl mr-2"
              style={{ color: 'oklch(0.45 0.15 150)' }}
            >
              CLAUDE READ THIS AS:
            </span>
            {summary}
          </div>
        )}
        {error && (
          <div
            className="ts-12 mt-2 p-2 rounded"
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid oklch(0.55 0.2 25 / 0.35)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="ts-13 mono"
            style={{
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            className="ts-13 mono"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 500,
              cursor: pending ? 'not-allowed' : 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? 'generating…' : '✨ generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

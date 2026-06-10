'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { AGENT_TEMPLATES, INITIAL_ADVANCED_STATE, MODELS } from './catalog'
import { apiToUITrajectory } from './helpers'
import {
  FieldRow,
  Header,
  InputRow,
  QuickPaneBody,
  ToolRow,
  TrajCard,
} from './components'
import type { AdvancedState, InputItem, ToolDef, UITrajectory } from './types'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * EvalRunClient — the hero entry-point page.
 *
 * Two modes:
 *   - Quick: pick saved agent template + drop in test prompts + pick rubric → Run
 *   - Advanced: define agent (model + system prompt + tools) from scratch → Run
 *
 * Submit hits POST /api/eval-runs which uses our backend `runSimulatedAgent` loop
 * (Sonnet for the agent, Haiku for simulated tool outputs). Real trajectories
 * come back and render in the right pane as summary cards.
 *
 * This file is the stateful shell. Its static catalogs (catalog.ts), pure
 * helpers (helpers.tsx), shared types (types.ts) and presentational
 * sub-components (components.tsx) live in sibling modules; all state, hooks and
 * event handlers stay here.
 */

// ─────────────────────────────────────────────────────────────────────────
// Main client component
// ─────────────────────────────────────────────────────────────────────────

export function EvalRunClient({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick')
  const [selectedAgent, setSelectedAgent] = useState('tp-v2')
  const [selectedRubric, setSelectedRubric] = useState('fact-helpful')
  const [state, setState] = useState<AdvancedState>(INITIAL_ADVANCED_STATE)
  const [trajectories, setTrajectories] = useState<UITrajectory[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  // When the Quick-mode agent changes, sync the Advanced-mode state so the user
  // can flip to Advanced and see what they'd be editing.
  useEffect(() => {
    const tpl = AGENT_TEMPLATES.find((a) => a.id === selectedAgent)
    if (!tpl) return
    // Pre-existing one-way sync (Quick agent → Advanced state), preserved
    // verbatim through the decomposition — an intentional state mirror, not a
    // cascading-render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({
      ...s,
      agentName: tpl.name.toLowerCase().replace(/\s+/g, '-'),
      model: tpl.model,
      systemPrompt: tpl.systemPrompt,
      tools: tpl.tools,
    }))
  }, [selectedAgent])

  const validInputs = state.inputs.filter((i) => i.text.trim().length > 0).length
  const canRun =
    !running &&
    validInputs > 0 &&
    (mode === 'quick'
      ? !!selectedAgent && !!selectedRubric
      : state.agentName.trim().length > 0 && state.systemPrompt.trim().length > 0)

  // ── tools / inputs mutators (Advanced mode) ─────────────────────────
  const updateTool = (next: ToolDef) =>
    setState((s) => ({
      ...s,
      tools: s.tools.map((t) => (t.id === next.id ? next : t)),
    }))
  const toggleSchema = (id: string) =>
    setState((s) => ({
      ...s,
      tools: s.tools.map((t) => (t.id === id ? { ...t, open: !t.open } : t)),
    }))
  const removeTool = (id: string) =>
    setState((s) => ({ ...s, tools: s.tools.filter((t) => t.id !== id) }))
  const addTool = () =>
    setState((s) => ({
      ...s,
      tools: [
        ...s.tools,
        {
          id: `t${Date.now()}`,
          name: 'new_tool',
          desc: '',
          open: true,
          schema: '{\n  "type": "object",\n  "properties": {}\n}',
        },
      ],
    }))

  const updateInput = (next: InputItem) =>
    setState((s) => ({
      ...s,
      inputs: s.inputs.map((i) => (i.id === next.id ? next : i)),
    }))
  const removeInput = (id: string) =>
    setState((s) => ({ ...s, inputs: s.inputs.filter((i) => i.id !== id) }))
  const addInput = () =>
    setState((s) =>
      s.inputs.length >= 10
        ? s
        : {
            ...s,
            inputs: [...s.inputs, { id: `i${Date.now()}`, text: '' }],
          },
    )

  // ── submit ──────────────────────────────────────────────────────────
  const onRun = async () => {
    if (!canRun) return
    setRunning(true)
    setError(null)
    setTrajectories([])

    try {
      // Parse tool schemas (JSON strings → objects). Surface invalid JSON early.
      const parsedTools = state.tools.map((t) => {
        let inputSchema: Record<string, unknown> = {}
        try {
          inputSchema = JSON.parse(t.schema)
        } catch {
          throw new Error(
            `Tool "${t.name}" has invalid JSON schema. Fix it before running.`,
          )
        }
        return {
          name: t.name,
          description: t.desc || 'No description provided.',
          input_schema: inputSchema,
        }
      })

      const validInputTexts = state.inputs
        .map((i) => i.text.trim())
        .filter((s) => s.length > 0)

      const body = {
        workspaceId,
        agentName: state.agentName || 'eval-agent',
        agent: {
          model: state.model,
          systemPrompt: state.systemPrompt,
          tools: parsedTools,
        },
        inputs: validInputTexts,
      }

      const res = await fetch('/api/eval-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result?.error ?? `HTTP ${res.status}`)
      }

      const uiTrajs: UITrajectory[] = (result.trajectories ?? []).map(
        apiToUITrajectory,
      )
      setTrajectories(uiTrajs)
      setRunId(uiTrajs[0]?.id?.slice(0, 8) ?? null)

      // Optimistic: revalidate the workspace dashboard (in case it shows topic counts).
      router.refresh()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Unknown error'))
    } finally {
      setRunning(false)
    }
  }

  const totalSummary = useMemo(() => {
    if (trajectories.length === 0) {
      return { duration: '—', cost: '—', toolCalls: '—', success: '0 / 0' }
    }
    const dur = trajectories.reduce((a, t) => {
      const n = parseFloat(t.duration)
      return a + (Number.isFinite(n) ? n : 0)
    }, 0)
    const cost = trajectories.reduce((a, t) => {
      const n = parseFloat(t.cost.replace('$', ''))
      return a + (Number.isFinite(n) ? n : 0)
    }, 0)
    const toolCalls = trajectories.reduce(
      (a, t) => a + t.steps.filter((s) => s.kind === 'tool').length,
      0,
    )
    const ok = trajectories.filter((t) => t.status === 'done').length
    return {
      duration: `${dur.toFixed(1)}s`,
      cost: `$${cost.toFixed(3)}`,
      toolCalls: String(toolCalls),
      success: `${ok}/${trajectories.length}`,
    }
  }, [trajectories])

  const completed = trajectories.filter((t) => t.status === 'done').length

  return (
    <div className="app-light">
      <div className="app">
        {/* LEFT PANE */}
        <div className="left-pane hairline-r">
          <Header workspaceId={workspaceId} workspaceName={workspaceName} />
          <div className="scroll flex-1 px-8 pt-10 pb-6">
            <div className="max-w-[560px] mx-auto">
              <div
                className="mono ts-12 mb-4 rise"
                style={{ color: 'var(--accent)' }}
              >
                §&nbsp;01&nbsp;&nbsp;EVAL-RUN
              </div>
              <h1
                className="ts-48 rise"
                style={{
                  color: 'var(--hi2)',
                  textWrap: 'balance',
                  marginBottom: 16,
                } as React.CSSProperties}
              >
                Run an agent.
              </h1>
              <p
                className="ts-16 rise"
                style={{
                  color: 'var(--mute)',
                  maxWidth: 440,
                  marginBottom: 28,
                }}
              >
                {mode === 'quick'
                  ? "Pick a saved agent, drop in a few test prompts, choose a rubric. We'll handle the rest."
                  : "Define everything from scratch — model, prompt, tools, inputs. Save it as a template when you're done."}
              </p>

              <div
                className="mode-tabs mb-8 rise"
                role="tablist"
                aria-label="Setup mode"
              >
                <button
                  type="button"
                  className={cn('mode-tab', mode === 'quick' && 'on')}
                  role="tab"
                  aria-selected={mode === 'quick'}
                  onClick={() => setMode('quick')}
                >
                  <span className="dot" />
                  Quick
                </button>
                <button
                  type="button"
                  className={cn('mode-tab', mode === 'advanced' && 'on')}
                  role="tab"
                  aria-selected={mode === 'advanced'}
                  onClick={() => setMode('advanced')}
                >
                  <span className="dot" />
                  Advanced
                </button>
              </div>

              {mode === 'quick' ? (
                <QuickPaneBody
                  selectedAgent={selectedAgent}
                  setSelectedAgent={setSelectedAgent}
                  selectedRubric={selectedRubric}
                  setSelectedRubric={setSelectedRubric}
                  inputs={state.inputs}
                  setInputs={(next) =>
                    setState((s) => ({
                      ...s,
                      inputs:
                        typeof next === 'function'
                          ? (next as (prev: InputItem[]) => InputItem[])(s.inputs)
                          : next,
                    }))
                  }
                  onNewAgent={() => setMode('advanced')}
                />
              ) : (
                <>
                  <FieldRow label="AGENT NAME" hint={`${state.agentName.length} chars`}>
                    <input
                      className="inp mono"
                      placeholder="travel-planner-v2"
                      value={state.agentName}
                      onChange={(e) =>
                        setState((s) => ({ ...s, agentName: e.target.value }))
                      }
                    />
                  </FieldRow>

                  <FieldRow label="MODEL" hint={state.model}>
                    <div className="seg">
                      {MODELS.map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          className={cn('seg-btn', state.model === m.id && 'on')}
                          onClick={() => setState((s) => ({ ...s, model: m.id }))}
                        >
                          {m.short}
                          <span className="mono">·&nbsp;{m.tag}</span>
                        </button>
                      ))}
                    </div>
                  </FieldRow>

                  <FieldRow
                    label="SYSTEM PROMPT"
                    action={
                      <span
                        className="ts-12 mono"
                        style={{ color: 'var(--mute2)' }}
                      >
                        {state.systemPrompt.length} chars ·{' '}
                        {Math.ceil(state.systemPrompt.length / 4)} tok
                      </span>
                    }
                  >
                    <textarea
                      className="ta"
                      rows={8}
                      value={state.systemPrompt}
                      onChange={(e) =>
                        setState((s) => ({ ...s, systemPrompt: e.target.value }))
                      }
                      placeholder="You are an agent that..."
                    />
                  </FieldRow>

                  <FieldRow
                    label="TOOLS"
                    action={
                      <span
                        className="ts-12 mono"
                        style={{ color: 'var(--mute2)' }}
                      >
                        {state.tools.length} defined
                      </span>
                    }
                  >
                    <div className="space-y-2">
                      {state.tools.map((t) => (
                        <ToolRow
                          key={t.id}
                          tool={t}
                          onChange={updateTool}
                          onRemove={() => removeTool(t.id)}
                          onToggleSchema={() => toggleSchema(t.id)}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="lh-btn lh-btn-ghost lh-btn-sm mt-3"
                      onClick={addTool}
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M6 2v8M2 6h8"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="square"
                        />
                      </svg>
                      Add tool
                    </button>
                  </FieldRow>

                  <FieldRow
                    label="TEST INPUTS"
                    action={
                      <span
                        className="ts-12 mono"
                        style={{ color: 'var(--mute2)' }}
                      >
                        {state.inputs.length} / 10
                      </span>
                    }
                  >
                    <div className="space-y-2">
                      {state.inputs.map((i, idx) => (
                        <InputRow
                          key={i.id}
                          input={i}
                          index={idx}
                          onChange={updateInput}
                          onRemove={() => removeInput(i.id)}
                          canRemove={state.inputs.length > 1}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="lh-btn lh-btn-ghost lh-btn-sm mt-3"
                      disabled={state.inputs.length >= 10}
                      onClick={addInput}
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M6 2v8M2 6h8"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="square"
                        />
                      </svg>
                      Add input
                    </button>
                  </FieldRow>
                </>
              )}

              {error && (
                <div
                  className="ts-13 mb-3 px-3 py-2 rounded-md rise"
                  style={{
                    color: 'var(--danger)',
                    background: 'var(--danger-soft)',
                    border: '1px solid oklch(0.6 0.2 25 / 0.3)',
                  }}
                >
                  <span className="mono ts-12 mr-2" style={{ opacity: 0.7 }}>
                    ERROR
                  </span>
                  {error}
                </div>
              )}

              <div style={{ height: 24 }} />
            </div>
          </div>

          <div className="sticky-foot">
            <div className="max-w-[560px] mx-auto flex items-center justify-between gap-4">
              <div className="ts-12 mono" style={{ color: 'var(--mute)' }}>
                ≈{' '}
                <span style={{ color: 'var(--text)' }}>$0.05</span> per run ·{' '}
                <span style={{ color: 'var(--text)' }}>50/day</span> quota
                <span className="mx-1.5" style={{ color: 'var(--line2)' }}>
                  ·
                </span>
                <span
                  style={{
                    color: validInputs > 0 ? 'var(--accent)' : 'var(--mute2)',
                  }}
                >
                  {validInputs}
                </span>{' '}
                input{validInputs === 1 ? '' : 's'} ready
              </div>
              <button
                type="button"
                className="lh-btn lh-btn-accent"
                disabled={!canRun}
                onClick={onRun}
              >
                {running ? 'Running…' : 'Run eval'}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3 6h6m0 0L6 3m3 3L6 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="square"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANE */}
        <div className="right-pane">
          <div
            className="flex items-center justify-between px-7 h-12 hairline-b"
            style={{
              background: 'oklch(0.975 0 0 / 0.78)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="flex items-center gap-3">
              <h2
                className="ts-14"
                style={{
                  color: 'var(--hi)',
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                Live results
              </h2>
              <span
                className="mono ts-12"
                style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
              >
                {trajectories.length === 0
                  ? 'NO RUNS YET'
                  : `${completed} OF ${trajectories.length} COMPLETE`}
              </span>
              {running && (
                <span className="badge runn">
                  <span className="pulse" />
                  streaming
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 px-7 py-4 hairline-b">
            <div>
              <div className="lbl mb-1">TOTAL DURATION</div>
              <div
                className="mono"
                style={{ fontSize: 20, color: 'var(--hi)' }}
              >
                {totalSummary.duration}
              </div>
            </div>
            <div>
              <div className="lbl mb-1">TOTAL COST</div>
              <div
                className="mono"
                style={{ fontSize: 20, color: 'var(--hi)' }}
              >
                {totalSummary.cost}
              </div>
            </div>
            <div>
              <div className="lbl mb-1">TOOL CALLS</div>
              <div
                className="mono"
                style={{ fontSize: 20, color: 'var(--hi)' }}
              >
                {totalSummary.toolCalls}
              </div>
            </div>
            <div>
              <div className="lbl mb-1">SUCCESS</div>
              <div
                className="mono"
                style={{ fontSize: 20, color: 'var(--success)' }}
              >
                {totalSummary.success}
              </div>
            </div>
          </div>

          <div className="scroll flex-1 px-7 py-5 space-y-3">
            {trajectories.length === 0 ? (
              <div
                className="ts-13 text-center py-16"
                style={{ color: 'var(--mute2)' }}
              >
                Configure an agent + test inputs on the left, then hit{' '}
                <span className="mono" style={{ color: 'var(--text)' }}>
                  Run eval
                </span>{' '}
                to see trajectories stream in here.
              </div>
            ) : (
              trajectories.map((t, idx) => (
                <TrajCard
                  key={t.id}
                  traj={t}
                  idx={idx}
                  workspaceId={workspaceId}
                />
              ))
            )}

            {trajectories.length > 0 && !running && (
              <div
                className="mt-2 ts-12 mono flex items-center justify-between"
                style={{ color: 'var(--mute2)' }}
              >
                <span>
                  end of stream{' '}
                  {runId && (
                    <>
                      · run id{' '}
                      <span style={{ color: 'var(--text)' }}>{runId}</span>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

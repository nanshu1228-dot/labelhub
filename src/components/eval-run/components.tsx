'use client'
// ─────────────────────────────────────────────────────────────────────────
// Presentational sub-components for the eval-run client.
//
// Extracted verbatim from eval-run-client.tsx as part of a behavior-preserving
// decomposition. Each component receives its data via props; AgentPicker owns
// only its self-contained dropdown-open state. No shell state lives here.
// ─────────────────────────────────────────────────────────────────────────

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { AGENT_TEMPLATES, RUBRICS } from './catalog'
import type { InputItem, ToolDef, UITrajectory, UIStepKind } from './types'

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="17" height="17" rx="4" stroke="var(--accent)" />
        <path
          d="M5 4.5V13.5H13"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="square"
        />
      </svg>
      <span
        className="ts-13"
        style={{ color: 'var(--hi)', letterSpacing: '-0.01em', fontWeight: 500 }}
      >
        LabelHub
      </span>
    </Link>
  )
}

export function Crumb({ workspaceName }: { workspaceName: string }) {
  return (
    <nav
      className="flex items-center gap-1.5 ts-12 mono whitespace-nowrap min-w-0 overflow-hidden"
      style={{ color: 'var(--mute2)' }}
    >
      <span
        className="truncate-1"
        style={{ color: 'var(--text)', maxWidth: 160 }}
      >
        {workspaceName}
      </span>
      <span>/</span>
      <span style={{ color: 'var(--hi)' }}>eval-run · new</span>
    </nav>
  )
}

export function Header({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-6 h-12 hairline-b flex-shrink-0"
      style={{
        background: 'oklch(0.99 0 0 / 0.78)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-center gap-4 min-w-0">
        <Logo />
        <span
          className="hidden md:inline-block flex-shrink-0"
          style={{ width: 1, height: 16, background: 'var(--line)' }}
        />
        <Crumb workspaceName={workspaceName} />
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={`/workspaces/${workspaceId}/trajectories`}
          className="hidden md:inline-flex items-center ts-12 mono whitespace-nowrap gap-1.5 hover:underline"
          style={{ color: 'var(--mute)' }}
        >
          <span style={{ color: 'var(--accent)' }}>§</span>
          captured trajectories
        </a>
        <div className="avatar">YOU</div>
      </div>
    </div>
  )
}

export function FieldRow({
  label,
  hint,
  action,
  children,
}: {
  label: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="lbl">{label}</span>
        {action ? action : hint ? (
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function AgentPicker({
  value,
  onChange,
  onNewAgent,
}: {
  value: string
  onChange: (id: string) => void
  onNewAgent: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = AGENT_TEMPLATES.find((a) => a.id === value)

  return (
    <div className="agent-picker" ref={ref}>
      <button
        type="button"
        className="agent-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="min-w-0">
          {selected ? (
            <>
              <div className="name truncate-1">{selected.name}</div>
              <div className="sub truncate-1">
                {selected.modelLabel} · {selected.toolsCount} tools · updated{' '}
                {selected.updated}
              </div>
            </>
          ) : (
            <>
              <div className="name" style={{ color: 'var(--mute2)' }}>
                Select an agent template…
              </div>
              <div className="sub">
                e.g. Travel Planner v2 · Claude Sonnet 4.6 · 2 tools
              </div>
            </>
          )}
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            color: 'var(--mute)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms',
          }}
        >
          <path
            d="M3 4.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="square"
            fill="none"
          />
        </svg>
      </button>
      {open && (
        <div className="agent-gallery rise">
          {AGENT_TEMPLATES.map((a) => (
            <div
              key={a.id}
              className="agent-item"
              onClick={() => {
                onChange(a.id)
                setOpen(false)
              }}
            >
              <div className="min-w-0">
                <div className="name truncate-1">
                  {a.name}
                  {a.id === value && (
                    <span
                      className="mono ts-12 ml-2"
                      style={{ color: 'var(--accent)' }}
                    >
                      selected
                    </span>
                  )}
                </div>
                <div className="sub truncate-1">
                  {a.modelLabel} · {a.toolsCount} tools · by {a.author}
                </div>
              </div>
              <div className="runs">{a.runs} runs</div>
            </div>
          ))}
          <div
            className="agent-item new"
            onClick={() => {
              setOpen(false)
              onNewAgent()
            }}
          >
            <div>
              <div className="name">+ New agent</div>
              <div className="sub">Define a new agent in Advanced mode</div>
            </div>
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              style={{ color: 'var(--accent)' }}
            >
              <path
                d="M3 6h6m0 0L6 3m3 3L6 9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="square"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}

export function RubricPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {RUBRICS.map((r) => (
        <button
          key={r.id}
          type="button"
          className={cn('rubric-card', value === r.id && 'on')}
          onClick={() => onChange(r.id)}
        >
          <div className="min-w-0 text-left">
            <div className="name truncate-1">{r.name}</div>
            <div className="sub truncate-1">
              {'custom' in r && r.custom
                ? r.mode
                : `${r.criteria} criteria · ${r.mode}`}
            </div>
          </div>
          <span
            className="mono ts-12"
            style={{ color: value === r.id ? 'var(--accent)' : 'var(--mute2)' }}
          >
            {value === r.id ? '●' : '○'}
          </span>
        </button>
      ))}
    </div>
  )
}

export function ToolRow({
  tool,
  onChange,
  onRemove,
  onToggleSchema,
}: {
  tool: ToolDef
  onChange: (next: ToolDef) => void
  onRemove: () => void
  onToggleSchema: () => void
}) {
  return (
    <div className="tool-row rise">
      <div className="head">
        <input
          className="inp mono"
          style={{ padding: '7px 10px', fontSize: 12.5 }}
          value={tool.name}
          onChange={(e) => onChange({ ...tool, name: e.target.value })}
        />
        <input
          className="inp"
          style={{ padding: '7px 10px', fontSize: 13 }}
          value={tool.desc}
          placeholder="One-line description"
          onChange={(e) => onChange({ ...tool, desc: e.target.value })}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn"
            title={tool.open ? 'Hide schema' : 'Show schema'}
            onClick={onToggleSchema}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d={tool.open ? 'M3 5l3.5 3.5L10 5' : 'M5 3l3.5 3.5L5 10'}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="square"
              />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Remove tool"
            onClick={onRemove}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M3 3l7 7M10 3l-7 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="square"
              />
            </svg>
          </button>
        </div>
      </div>
      {tool.open && (
        <div className="schema rise">
          <div className="flex items-center justify-between mt-2 mb-1.5">
            <span className="lbl">JSON SCHEMA</span>
            <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
              {tool.schema.split('\n').length} lines
            </span>
          </div>
          <textarea
            className="ta"
            style={{ minHeight: 130 }}
            value={tool.schema}
            onChange={(e) => onChange({ ...tool, schema: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

export function InputRow({
  input,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  input: InputItem
  index: number
  onChange: (next: InputItem) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <div className="grid grid-cols-[28px_1fr_28px] gap-2 items-start rise">
      <div
        className="mono ts-12 pt-2.5 text-right"
        style={{ color: 'var(--mute2)' }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>
      <textarea
        className="ta"
        rows={2}
        value={input.text}
        onChange={(e) => onChange({ ...input, text: e.target.value })}
        placeholder="Type a test prompt…"
      />
      <button
        type="button"
        className="icon-btn mt-1"
        disabled={!canRemove}
        onClick={onRemove}
        title="Remove input"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path
            d="M3 6.5h7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="square"
          />
        </svg>
      </button>
    </div>
  )
}

export function StatusPill({ status }: { status: UITrajectory['status'] }) {
  if (status === 'running') {
    return (
      <span className="badge runn">
        <span className="pulse" />
        <span>running</span>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="badge red">
        <span className="dot" style={{ background: 'var(--danger)' }} />
        <span>error</span>
      </span>
    )
  }
  return (
    <span className="badge green">
      <span className="dot" style={{ background: 'var(--success)' }} />
      <span>done</span>
    </span>
  )
}

export function TrajCard({
  traj,
  idx,
  workspaceId,
}: {
  traj: UITrajectory
  idx: number
  workspaceId: string
}) {
  const promptId = String(idx + 1).padStart(2, '0')

  const order: UIStepKind[] = ['thinking', 'tool', 'result', 'final', 'error']
  const counts: Record<UIStepKind, number> = {
    thinking: 0,
    tool: 0,
    result: 0,
    final: 0,
    error: 0,
  }
  traj.steps.forEach((s) => {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1
  })
  const histEntries = order.filter((k) => counts[k] > 0)

  const usedTools = new Map<string, number>()
  traj.steps
    .filter((s) => s.kind === 'tool')
    .forEach((s) => {
      usedTools.set(s.title, (usedTools.get(s.title) ?? 0) + 1)
    })

  return (
    <article className={cn('traj-card', traj.status === 'running' && 'run')}>
      <header className="traj-head">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1.5">
            <span className="mono ts-12" style={{ color: 'var(--mute2)' }}>
              {promptId}
            </span>
            <StatusPill status={traj.status} />
            <span className="ts-12 mono" style={{ color: 'var(--mute)' }}>
              {traj.stepsCount} steps · {traj.duration} · {traj.cost}
            </span>
          </div>
          <div
            className="ts-13 truncate-1"
            style={{ color: 'var(--hi)' }}
            title={traj.promptText}
          >
            {traj.promptText}
          </div>
          <div className="ts-12 mono mt-1" style={{ color: 'var(--mute2)' }}>
            {traj.tokens}
          </div>
        </div>
        <a
          href={`/workspaces/${workspaceId}/trajectories/${traj.id}`}
          onClick={(e) => e.stopPropagation()}
          className="traj-link"
          style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}
        >
          <span>open trajectory</span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 6h6m0 0L6 3m3 3L6 9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
            />
          </svg>
        </a>
      </header>

      <div className="traj-summary">
        <div className="kind-hist">
          {histEntries.map((k, i) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {i > 0 && <span className="hist-sep">·</span>}
              <span className={`hist ${k}`}>
                <span className="hist-n">{counts[k]}</span>
                <span className="hist-label">
                  {k === 'tool'
                    ? 'tool_call'
                    : k === 'result'
                      ? 'tool_result'
                      : k}
                </span>
              </span>
            </span>
          ))}
        </div>
        <div className="tool-chips">
          {usedTools.size === 0 ? (
            <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
              no tools used
            </span>
          ) : (
            Array.from(usedTools.entries()).map(([name, n]) => (
              <span className="tool-chip" key={name}>
                <span className="mono">{name}</span>
                <span className="chip-n">×{n}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Quick pane body
// ─────────────────────────────────────────────────────────────────────────

export function QuickPaneBody({
  selectedAgent,
  setSelectedAgent,
  selectedRubric,
  setSelectedRubric,
  inputs,
  setInputs,
  onNewAgent,
}: {
  selectedAgent: string
  setSelectedAgent: (id: string) => void
  selectedRubric: string
  setSelectedRubric: (id: string) => void
  inputs: InputItem[]
  setInputs: Dispatch<SetStateAction<InputItem[]>>
  onNewAgent: () => void
}) {
  const updateInput = (next: InputItem) =>
    setInputs((arr) => arr.map((i) => (i.id === next.id ? next : i)))
  const removeInput = (id: string) =>
    setInputs((arr) => arr.filter((i) => i.id !== id))
  const addInput = () =>
    setInputs((arr) =>
      arr.length >= 10 ? arr : [...arr, { id: `i${Date.now()}`, text: '' }],
    )

  return (
    <div className="rise">
      <FieldRow label="AGENT">
        <AgentPicker
          value={selectedAgent}
          onChange={setSelectedAgent}
          onNewAgent={onNewAgent}
        />
        <div
          className="ts-12 mono mt-2 flex items-center gap-2"
          style={{ color: 'var(--mute2)' }}
        >
          <span style={{ color: 'var(--accent)' }}>tip</span>
          <span>
            Saved from Advanced mode via{' '}
            <span style={{ color: 'var(--text)' }}>&ldquo;Save as agent template&rdquo;</span>.
          </span>
        </div>
      </FieldRow>

      <FieldRow
        label="TEST INPUTS"
        action={
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            {inputs.length} / 10
          </span>
        }
      >
        <div className="space-y-2">
          {inputs.map((i, idx) => (
            <InputRow
              key={i.id}
              input={i}
              index={idx}
              onChange={updateInput}
              onRemove={() => removeInput(i.id)}
              canRemove={inputs.length > 1}
            />
          ))}
        </div>
        <button
          type="button"
          className="lh-btn lh-btn-ghost lh-btn-sm mt-3"
          disabled={inputs.length >= 10}
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

      <FieldRow label="RUBRIC TEMPLATE" hint="how annotators will score">
        <RubricPicker value={selectedRubric} onChange={setSelectedRubric} />
      </FieldRow>
    </div>
  )
}

'use client'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

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
 */

// ─────────────────────────────────────────────────────────────────────────
// Constants (Quick mode demo data — replace with real DB data once we add
// agent_templates + rubrics tables)
// ─────────────────────────────────────────────────────────────────────────

const MODELS = [
  { id: 'claude-sonnet-4-6', short: 'Sonnet 4.6', tag: 'balanced' },
  { id: 'claude-opus-4-7', short: 'Opus 4.7', tag: 'strongest' },
  { id: 'claude-haiku-4-5-20251001', short: 'Haiku 4.5', tag: 'fastest' },
] as const

type AgentTemplate = {
  id: string
  name: string
  model: string
  modelLabel: string
  systemPrompt: string
  tools: ToolDef[]
  toolsCount: number
  updated: string
  author: string
  runs: number
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'tp-v2',
    name: 'Travel Planner v2',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    systemPrompt:
      'You are a travel planning agent. Use the search_flights and book_hotel tools to assemble a 3-day itinerary within budget. Be concise, prefer mid-range options unless budget says otherwise.',
    tools: [
      {
        id: 't1',
        name: 'search_flights',
        desc: 'Search flights between two airports for a date range.',
        open: false,
        schema: `{
  "type": "object",
  "properties": {
    "origin": { "type": "string" },
    "destination": { "type": "string" },
    "dates": { "type": "object", "properties": { "depart": { "type": "string" }, "return": { "type": "string" } } },
    "budget_usd": { "type": "number" }
  },
  "required": ["origin", "destination", "dates"]
}`,
      },
      {
        id: 't2',
        name: 'book_hotel',
        desc: 'Book a hotel given city and price range.',
        open: false,
        schema: `{
  "type": "object",
  "properties": {
    "city": { "type": "string" },
    "check_in": { "type": "string" },
    "check_out": { "type": "string" },
    "price_max": { "type": "number" }
  },
  "required": ["city", "check_in", "check_out"]
}`,
      },
    ],
    toolsCount: 2,
    updated: '2d ago',
    author: 'demo',
    runs: 41,
  },
  {
    id: 'code-review',
    name: 'Code Review Bot',
    model: 'claude-opus-4-7',
    modelLabel: 'Claude Opus 4.7',
    systemPrompt:
      'You are a senior code reviewer. Inspect the diff using read_file and run_tests. Flag security issues first, then correctness, then style.',
    tools: [],
    toolsCount: 4,
    updated: '5d ago',
    author: 'demo',
    runs: 128,
  },
  {
    id: 'med-qa',
    name: 'Medical Q&A Triager',
    model: 'claude-sonnet-4-6',
    modelLabel: 'Claude Sonnet 4.6',
    systemPrompt:
      'You are a medical triage assistant. Never give diagnoses. Use search_kb to look up symptoms and escalate to a human if uncertain.',
    tools: [],
    toolsCount: 3,
    updated: '1w ago',
    author: 'team',
    runs: 92,
  },
  {
    id: 'support',
    name: 'Customer Support Agent',
    model: 'claude-haiku-4-5-20251001',
    modelLabel: 'Claude Haiku 4.5',
    systemPrompt:
      'You are a customer support agent. Use lookup_order, refund_request, and escalate_to_human as needed.',
    tools: [],
    toolsCount: 5,
    updated: '2w ago',
    author: 'team',
    runs: 311,
  },
]

const RUBRICS = [
  {
    id: 'fact-helpful',
    name: 'Factuality + Helpfulness',
    criteria: 4,
    mode: '1–4 Likert',
    desc: 'Standard correctness rubric.',
  },
  {
    id: 'tool-correct',
    name: 'Tool-use correctness',
    criteria: 3,
    mode: 'Pass / Fail / Partial',
    desc: 'Did the agent pick the right tools with the right args?',
  },
  {
    id: 'harms',
    name: 'Safety + Harms',
    criteria: 6,
    mode: 'Tags',
    desc: 'Multi-label harms taxonomy.',
  },
  {
    id: 'custom',
    name: 'Custom rubric',
    criteria: 0,
    mode: 'build inline',
    desc: 'Define your own criteria.',
    custom: true,
  },
] as const

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type ToolDef = {
  id: string
  name: string
  desc: string
  open: boolean
  schema: string
}

type InputItem = {
  id: string
  text: string
}

type AdvancedState = {
  agentName: string
  model: string
  systemPrompt: string
  tools: ToolDef[]
  inputs: InputItem[]
}

type UIStepKind = 'thinking' | 'tool' | 'result' | 'final' | 'error'

type UIStep = {
  kind: UIStepKind
  title: string
  meta?: string
  body?: string
  args?: string
  running?: boolean
}

type UITrajectory = {
  id: string
  promptText: string
  status: 'running' | 'done' | 'error'
  stepsCount: number
  duration: string
  cost: string
  tokens: string
  steps: UIStep[]
}

const INITIAL_ADVANCED_STATE: AdvancedState = {
  agentName: 'travel-planner-v2',
  model: 'claude-sonnet-4-6',
  systemPrompt: AGENT_TEMPLATES[0].systemPrompt,
  tools: AGENT_TEMPLATES[0].tools,
  inputs: [
    { id: 'i1', text: 'Plan a 3-day Tokyo trip in early March, mid-budget.' },
    {
      id: 'i2',
      text: 'Find me a hotel in Paris under $200/night for next weekend.',
    },
    { id: 'i3', text: 'Bangkok 5-day, beach + temples, ¥8000 budget.' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Map a canonical kind from the API to the compact UI kind. */
function uiKind(kind: string): UIStepKind {
  if (kind === 'tool_call') return 'tool'
  if (kind === 'tool_result') return 'result'
  if (kind === 'final_response') return 'final'
  if (kind === 'thinking') return 'thinking'
  return 'error'
}

/** Lightweight JSON syntax-highlight; safe for textual JSON pastes. */
function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = []
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|([{}\[\],])|(\btrue\b|\bfalse\b|\bnull\b)|(\s+)|([^\s])/g
  let m
  let i = 0
  while ((m = re.exec(src)) !== null) {
    if (m[1] && m[2]) {
      out.push(
        <span className="k" key={`k${i++}`}>
          {m[1]}
        </span>,
        <span className="p" key={`p${i++}`}>
          {m[2]}
        </span>,
      )
    } else if (m[1]) {
      out.push(
        <span className="s" key={`s${i++}`}>
          {m[1]}
        </span>,
      )
    } else if (m[3]) {
      out.push(
        <span className="n" key={`n${i++}`}>
          {m[3]}
        </span>,
      )
    } else if (m[4]) {
      out.push(
        <span className="p" key={`p${i++}`}>
          {m[4]}
        </span>,
      )
    } else if (m[5]) {
      out.push(
        <span className="n" key={`n${i++}`}>
          {m[5]}
        </span>,
      )
    } else {
      out.push(m[0])
    }
  }
  return out
}

/** Convert API trajectory response → UI shape (compact, summary-friendly). */
function apiToUITrajectory(api: {
  trajectoryId: string
  trajectory: {
    rootPrompt: string
    finalResponse?: string
    steps: Array<{
      kind: string
      content: unknown
      latencyMs?: number
    }>
  }
  rootPrompt: string
  tokensIn: number
  tokensOut: number
  stoppedReason: string
}): UITrajectory {
  const steps: UIStep[] = api.trajectory.steps.map((s) => {
    const kind = uiKind(s.kind)
    const meta = s.latencyMs ? `${(s.latencyMs / 1000).toFixed(2)}s` : undefined
    const content = s.content as Record<string, unknown>
    if (kind === 'thinking') {
      return { kind, title: 'thinking', meta, body: String(content.text ?? '') }
    }
    if (kind === 'tool') {
      return {
        kind,
        title: String(content.toolName ?? 'tool'),
        meta,
        args: JSON.stringify(content.args ?? {}, null, 2),
      }
    }
    if (kind === 'result') {
      const out = content.output
      return {
        kind,
        title: 'tool_result',
        meta,
        body: typeof out === 'string' ? out : JSON.stringify(out ?? {}, null, 2),
      }
    }
    if (kind === 'final') {
      return { kind, title: 'final response', meta, body: String(content.text ?? '') }
    }
    return { kind: 'error', title: 'error', meta, body: String(content.message ?? '') }
  })

  const totalLatencyMs = api.trajectory.steps.reduce(
    (s, st) => s + (st.latencyMs ?? 0),
    0,
  )
  // ~$3 per 1M input tokens for Sonnet, ~$15 per 1M output. Rough; UI hint only.
  const costUsd = (api.tokensIn / 1_000_000) * 3 + (api.tokensOut / 1_000_000) * 15

  return {
    id: api.trajectoryId,
    promptText: api.rootPrompt,
    status: api.stoppedReason === 'max_steps_exceeded' ? 'error' : 'done',
    stepsCount: steps.length,
    duration: totalLatencyMs > 0 ? `${(totalLatencyMs / 1000).toFixed(1)}s` : '—',
    cost: `$${costUsd.toFixed(3)}`,
    tokens: `${api.tokensIn.toLocaleString()} in · ${api.tokensOut.toLocaleString()} out`,
    steps,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2">
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
    </a>
  )
}

function Crumb({ workspaceName }: { workspaceName: string }) {
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

function Header({
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

function FieldRow({
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

function AgentPicker({
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

function RubricPicker({
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

function ToolRow({
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

function InputRow({
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

function StatusPill({ status }: { status: UITrajectory['status'] }) {
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

function TrajCard({
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
// Quick / Advanced panes
// ─────────────────────────────────────────────────────────────────────────

function QuickPaneBody({
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
      setError(e instanceof Error ? e.message : 'Unknown error')
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

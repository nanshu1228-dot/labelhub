'use client'

import { memo, useMemo } from 'react'
import type { StepView } from './types'
import { KindPill } from './kind-pill'

/**
 * The center panel — renders one step's full content.
 *
 * Kind-discriminated rendering:
 *   thinking / final_response / sub_agent_response / error
 *     → markdown-ish text body (whitespace preserved, links highlighted)
 *   tool_call / sub_agent_call
 *     → tool name + dark code block with the args JSON, syntax-highlighted
 *   tool_result
 *     → tool name + dark code block with the output JSON
 *
 * Perf note: the JSON highlighter result is memoized per step. JSON.stringify
 * + regex walk on a 5KB args object is ~1ms but adds up across rerenders.
 * We could LRU-cache across step instances but per-step memo is enough for
 * the 500-step ceiling.
 */

export const StepDetail = memo(function StepDetail({ step }: { step: StepView }) {
  return (
    <article className="rise" style={{ padding: '20px 24px' }}>
      <header
        className="flex items-center gap-2 mb-3"
        style={{ flexWrap: 'wrap' }}
      >
        <KindPill kind={step.kind} />
        <span
          className="mono ts-11"
          style={{ color: 'var(--mute2)' }}
        >
          step {String(step.sequence + 1).padStart(2, '0')}
        </span>
        {step.modelName && (
          <span className="badge violet">{step.modelName}</span>
        )}
        {step.latencyMs != null && (
          <span className="badge">{step.latencyMs}ms</span>
        )}
        {step.tokensIn != null && (
          <span className="badge">in {step.tokensIn}</span>
        )}
        {step.tokensOut != null && (
          <span className="badge">out {step.tokensOut}</span>
        )}
        {(step.kind === 'tool_call' ||
          step.kind === 'sub_agent_call' ||
          step.kind === 'tool_result') &&
          step.toolProvider && (
            <span className="badge">
              {step.toolProvider.kind}:{step.toolProvider.name}
            </span>
          )}
      </header>

      <StepBody step={step} />
    </article>
  )
})

function StepBody({ step }: { step: StepView }) {
  switch (step.kind) {
    case 'thinking':
    case 'sub_agent_response':
      return (
        <div
          className="ts-14"
          style={{
            color: 'var(--hi)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
          }}
        >
          {step.body}
        </div>
      )
    case 'final_response':
      return (
        <div
          className="ts-14 p-4 rounded-xl"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--accent-line)',
            color: 'var(--hi)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
          }}
        >
          {step.body}
        </div>
      )
    case 'error':
      return (
        <div
          className="ts-14 p-3 rounded-md mono"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {step.body}
        </div>
      )
    case 'tool_call':
    case 'sub_agent_call':
      return (
        <div className="space-y-2">
          <CodeBlock
            name={step.toolName}
            meta={step.toolCallId ?? undefined}
            body={step.args}
          />
        </div>
      )
    case 'tool_result':
      return (
        <CodeBlock
          name={`${step.toolName} ↩`}
          meta={step.toolCallId ?? undefined}
          body={step.output}
        />
      )
  }
}

function CodeBlock({
  name,
  meta,
  body,
}: {
  name: string
  meta?: string
  body: unknown
}) {
  const text = useMemo(
    () =>
      typeof body === 'string' ? body : safeStringify(body),
    [body],
  )
  const highlighted = useMemo(() => highlightJSON(text), [text])
  return (
    <div className="code">
      <div className="code-head">
        <span className="name">{name}</span>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <div className="code-body">{highlighted}</div>
    </div>
  )
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/**
 * Light JSON syntax highlighter — adapted from the design's helper but typed.
 * Keys are blue, strings green, numbers amber, punctuation muted.
 */
function highlightJSON(txt: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|([{}\[\],])|(\btrue\b|\bfalse\b|\bnull\b)|(\s+)|([^\s])/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(txt)) !== null) {
    if (m[1] && m[2]) {
      out.push(
        <span key={i++} className="k">
          {m[1]}
        </span>,
        <span key={i++} className="p">
          {m[2]}
        </span>,
      )
    } else if (m[1]) {
      out.push(
        <span key={i++} className="s">
          {m[1]}
        </span>,
      )
    } else if (m[3]) {
      out.push(
        <span key={i++} className="n">
          {m[3]}
        </span>,
      )
    } else if (m[4]) {
      out.push(
        <span key={i++} className="p">
          {m[4]}
        </span>,
      )
    } else if (m[5]) {
      out.push(
        <span key={i++} className="n">
          {m[5]}
        </span>,
      )
    } else {
      out.push(<span key={i++}>{m[0]}</span>)
    }
  }
  return out
}

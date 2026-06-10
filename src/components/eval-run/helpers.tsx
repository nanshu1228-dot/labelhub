// ─────────────────────────────────────────────────────────────────────────
// Pure helpers for the eval-run client.
//
// Extracted verbatim from eval-run-client.tsx as part of a behavior-preserving
// decomposition. These are stateless functions (one returns JSX, hence .tsx).
// ─────────────────────────────────────────────────────────────────────────

import { type ReactNode } from 'react'
import type { UIStep, UIStepKind, UITrajectory } from './types'

/** Map a canonical kind from the API to the compact UI kind. */
export function uiKind(kind: string): UIStepKind {
  if (kind === 'tool_call') return 'tool'
  if (kind === 'tool_result') return 'result'
  if (kind === 'final_response') return 'final'
  if (kind === 'thinking') return 'thinking'
  return 'error'
}

/** Lightweight JSON syntax-highlight; safe for textual JSON pastes. */
export function highlightJson(src: string): ReactNode[] {
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
export function apiToUITrajectory(api: {
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

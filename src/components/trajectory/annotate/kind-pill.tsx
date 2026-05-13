import type { TrajectoryStepKind } from './types'

/**
 * Compact pill that labels a step's kind (tool_call / thinking / final / etc.).
 *
 * Uses the design-token class names defined in src/app/globals.css:
 *   .kind-pill.{thinking|tool|result|final|error}
 * Each variant has its own color from our oklch palette — no ad-hoc colors.
 */

const KIND_CLASS: Record<TrajectoryStepKind, string> = {
  thinking: 'thinking',
  tool_call: 'tool',
  tool_result: 'result',
  sub_agent_call: 'tool',
  sub_agent_response: 'thinking',
  final_response: 'final',
  error: 'error',
}

const KIND_LABEL: Record<TrajectoryStepKind, string> = {
  thinking: 'thinking',
  tool_call: 'tool_call',
  tool_result: 'tool_result',
  sub_agent_call: 'sub_agent_call',
  sub_agent_response: 'sub_agent_response',
  final_response: 'final',
  error: 'error',
}

export function KindPill({ kind }: { kind: TrajectoryStepKind }) {
  return (
    <span className={`kind-pill ${KIND_CLASS[kind]}`}>
      <span className="kdot" />
      {KIND_LABEL[kind]}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Shared types for the eval-run client.
//
// Extracted verbatim from eval-run-client.tsx as part of a behavior-preserving
// decomposition. No logic lives here — only type declarations.
// ─────────────────────────────────────────────────────────────────────────

export type AgentTemplate = {
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

export type ToolDef = {
  id: string
  name: string
  desc: string
  open: boolean
  schema: string
}

export type InputItem = {
  id: string
  text: string
}

export type AdvancedState = {
  agentName: string
  model: string
  systemPrompt: string
  tools: ToolDef[]
  inputs: InputItem[]
}

export type UIStepKind = 'thinking' | 'tool' | 'result' | 'final' | 'error'

export type UIStep = {
  kind: UIStepKind
  title: string
  meta?: string
  body?: string
  args?: string
  running?: boolean
}

export type UITrajectory = {
  id: string
  promptText: string
  status: 'running' | 'done' | 'error'
  stepsCount: number
  duration: string
  cost: string
  tokens: string
  steps: UIStep[]
}

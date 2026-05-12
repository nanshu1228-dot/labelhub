import { z } from 'zod'
import type { PlatformTemplate } from '../types'
import { registerTemplate } from '../registry'

/**
 * Agent Trace Evaluation — **the flagship**.
 *
 * Each topic carries a `trajectoryId` referencing a row in `trajectories`.
 * The annotator evaluates the trajectory holistically (this responseSchema)
 * AND per-step (rows in `step_annotations` keyed to `trajectory_steps`).
 *
 * Path-choice rubric:
 *   optimal     — agent picked a near-best sequence of tool calls
 *   suboptimal  — agent reached the answer but with wasted/redundant steps
 *   incorrect   — agent's path was flawed (wrong tool, wrong order, missed branch)
 *
 * Final-answer rubric:
 *   correct     — answer satisfies the user's intent
 *   partial     — partially addresses the intent
 *   incorrect   — fails to address or contradicts the intent
 *
 * PerfBudget: trajectories can have many steps; we force virtualization +
 * atomic state. Per the platform's hard perf rule (rubric grids past 50 rows
 * killed prior platforms; we ship safe).
 */

const itemSchema = z.object({
  trajectoryId: z.string().uuid(),
})

const responseSchema = z.object({
  pathChoice: z.enum(['optimal', 'suboptimal', 'incorrect']),
  finalAnswer: z.enum(['correct', 'partial', 'incorrect']),
  overallRating: z.number().int().min(1).max(5),
  summaryReasoning: z.string().min(1).max(4000),
  /** Hint for UI: how many per-step marks the annotator left (truth in step_annotations table). */
  stepMarkCount: z.number().int().nonnegative().optional(),
})

export const agentTraceEvalTemplate: PlatformTemplate = {
  mode: 'agent-trace-eval',
  name: 'Agent Trace Evaluation',
  description:
    'Evaluate agent trajectories: tool calls, reasoning, path choice. The flagship mode for LLM-agent eval.',
  itemSchema,
  responseSchema,
  workflow: [
    'drafting',
    'revising',
    'submitted',
    'reviewing',
    'approved',
    'rejected',
  ],
  perfBudget: {
    /** Up to 500 steps per trajectory — long agent runs supported. */
    maxItemsPerCell: 500,
    virtualizationRequired: true,
    atomicStateRequired: true,
    autoSavePolicy: 'on-blur',
    maxResponseLengthChars: 50_000,
  },
  economy: {
    type: 'cash-per-item',
    currency: 'CNY',
    qualityMultiplierMin: 1.0,
    qualityMultiplierMax: 2.5, // highest tier — trajectory eval is high-value work
  },
  ui: { theme: 'minimal', layout: 'split-screen' },
}

registerTemplate(agentTraceEvalTemplate)

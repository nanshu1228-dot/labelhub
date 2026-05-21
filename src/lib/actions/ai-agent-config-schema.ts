/**
 * AI Review Agent config — pure schema + defaults (Finals P2 D9).
 *
 * Split out of `ai-agent-config.ts` because that file is 'use server'
 * and Next.js 16 restricts 'use server' modules to async-function
 * exports only. The schema + constants land here so both the server
 * action file and the client form can import them.
 */

import { z } from 'zod'
import { reviewDimensionSchema } from '@/lib/ai/review-agent'

export const aiAgentConfigSchema = z
  .object({
    enabled: z.boolean(),
    promptTemplate: z.string().max(8_000),
    dimensions: z.array(reviewDimensionSchema).max(10),
    passAt: z.number().min(0).max(100),
    sendBackAt: z.number().min(0).max(100),
    tier: z.enum(['fast', 'default', 'premium']).default('fast'),
  })
  .refine((c) => c.sendBackAt < c.passAt, {
    message: 'sendBackAt must be strictly less than passAt.',
    path: ['sendBackAt'],
  })

export type AiAgentConfig = z.infer<typeof aiAgentConfigSchema>

/**
 * Default starter config — what an owner sees the first time they
 * open the page. Matches the scheduler's hard-coded defaults so the
 * UI shows what's actually in flight before any save.
 */
export const DEFAULT_AI_AGENT_CONFIG: AiAgentConfig = {
  enabled: false,
  promptTemplate:
    'Review this annotation for completeness, accuracy, and adherence to the task instructions. Pass if it is publishable, send_back if it needs minor edits, human_review if it requires expert judgment.',
  dimensions: [
    { id: 'completeness', name: 'Completeness' },
    { id: 'accuracy', name: 'Accuracy' },
    { id: 'clarity', name: 'Clarity' },
  ],
  passAt: 70,
  sendBackAt: 40,
  tier: 'fast',
}

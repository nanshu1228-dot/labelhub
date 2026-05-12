import 'server-only'
import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (_client) return _client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set. See .env.example.')
  _client = new Anthropic({ apiKey: key })
  return _client
}

/**
 * Default model picks for LabelHub features. Keep in sync with Anthropic releases.
 * - fast: low-latency tasks (UI suggestions, auto-complete)
 * - default: general-purpose (spec generation, rubric refinement)
 * - premium: high-stakes (final QC, complex reasoning, "Guideline Refiner")
 */
export const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  default: 'claude-sonnet-4-6',
  premium: 'claude-opus-4-7',
} as const

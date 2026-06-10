/**
 * AI Review Agent — pure helpers — Finals P2 D7.
 *
 * Split out of `ai-review-submission.ts` because the 'use server'
 * file is restricted to async function exports. The helpers here
 * are pure and importable from anywhere (server + client tests).
 */

import { createHash } from 'node:crypto'

/**
 * Stable dedup key for an AI verdict. Same annotation + same agent
 * config + same schema version → same key, so re-submits don't
 * re-spend quota.
 */
export function idempotencyKey(args: {
  annotationId: string
  judgeId: string
  schemaVersion: number
  /** Hash of the effective prompt/dimensions/thresholds/tier. */
  configFingerprint?: string
  /**
   * The annotation's submit version (annotations.version, bumped on every
   * submit). Mixing it in means each RESUBMIT after a send_back gets a fresh
   * key → the AI re-reviews the corrected work, closing the
   * "AI 打回 → 标注员改 → AI 重查" loop (spec §4.5). True double-fires of the
   * SAME submission (same version) still de-dup. Defaults to 0 so callers that
   * don't care about re-review (and older tests) keep stable keys.
   */
  submissionVersion?: number
}): string {
  const h = createHash('sha256')
  h.update(args.annotationId)
  h.update('|')
  h.update(args.judgeId)
  h.update('|')
  h.update(String(args.schemaVersion))
  h.update('|')
  h.update(args.configFingerprint ?? '')
  h.update('|')
  h.update(String(args.submissionVersion ?? 0))
  return h.digest('hex')
}

export function aiReviewConfigFingerprint(args: {
  judgeId: string
  schemaVersion: number
  promptTemplate: string
  dimensions: Array<{
    id: string
    name: string
    description?: string
  }>
  passAt: number
  sendBackAt: number
  tier: 'fast' | 'default' | 'premium'
  formSchemaId?: string
}): string {
  const h = createHash('sha256')
  h.update(
    JSON.stringify({
      judgeId: args.judgeId,
      schemaVersion: args.schemaVersion,
      promptTemplate: args.promptTemplate,
      dimensions: args.dimensions.map((dimension) => ({
        id: dimension.id,
        name: dimension.name,
        description: dimension.description ?? '',
      })),
      passAt: args.passAt,
      sendBackAt: args.sendBackAt,
      tier: args.tier,
      formSchemaId: args.formSchemaId ?? '',
    }),
  )
  return h.digest('hex')
}

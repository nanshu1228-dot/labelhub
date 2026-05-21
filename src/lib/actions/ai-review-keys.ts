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
}): string {
  const h = createHash('sha256')
  h.update(args.annotationId)
  h.update('|')
  h.update(args.judgeId)
  h.update('|')
  h.update(String(args.schemaVersion))
  return h.digest('hex')
}

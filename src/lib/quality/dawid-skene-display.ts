/**
 * Pure presentation helpers for Dawid-Skene results. Lives outside
 * `server-only` boundaries so client components can import them without
 * dragging the DB client.
 *
 * Type definitions for the run report live here too — both the server
 * query file and client components reference them, so a shared file
 * keeps a single source of truth.
 */

export interface DsRunSummary {
  runId: string
  templateMode: string
  numClasses: number
  cellCount: number
  raterCount: number
  iterations: number
  converged: boolean
  logLikelihood: number
  createdAt: Date
}

export interface DsRaterRow {
  userId: string
  displayName: string | null
  confusion: number[][]
  nObservations: number
  accuracy: number
  biasSummary: string | null
}

export interface DsTopicCell {
  cellKey: string
  inferredClass: number
  confidence: number
  posterior: Record<string, number>
  voteCount: number
}

export interface DsTopicSummary {
  topicId: string
  meanConfidence: number
  cellCount: number
  minConfidence: number
  cells: DsTopicCell[]
}

export interface DsRunReport {
  run: DsRunSummary
  raters: DsRaterRow[]
  topics: DsTopicSummary[]
}

/**
 * Cell-key decoder for UI labels. Mirrors the encoding written by the
 * action: "{mode}:{rubricOrDim}:{side}".
 */
export function describeCellKey(cellKey: string): {
  mode: 'pair' | 'arena' | string
  itemId: string
  side: 'a' | 'b' | string
} {
  const parts = cellKey.split(':')
  if (parts.length === 3) {
    return { mode: parts[0], itemId: parts[1], side: parts[2] }
  }
  return { mode: 'unknown', itemId: cellKey, side: '' }
}

/** Format an inferred class for display given K and mode. */
export function formatInferredClass(opts: {
  numClasses: number
  inferredClass: number
}): string {
  if (opts.numClasses === 2) {
    return opts.inferredClass === 1 ? 'true' : 'false'
  }
  if (opts.numClasses === 5) {
    return String(opts.inferredClass + 1)
  }
  return String(opts.inferredClass)
}

import type { DistributionStrategy } from '@/lib/import/distribution'

export interface TaskOperationalSettings {
  tags: string[]
  quotaTotal: number | null
  distributionStrategy: DistributionStrategy
  /**
   * Two-stage human review (spec 9.3): when true, an annotation must
   * pass QC (初审) into `awaiting_acceptance` before an admin can do the
   * terminal accept (终审 · 入库) — admins can't short-circuit accept
   * straight from `submitted`/`reviewing`. When false, the single-stage
   * path stays (admin may accept directly).
   *
   * Defaults to TRUE (see DEFAULT_TASK_SETTINGS) so the platform models
   * the spec's 初审→终审 pipeline out of the box.
   */
  twoStageReview: boolean
}

export const DEFAULT_TASK_SETTINGS: TaskOperationalSettings = {
  tags: [],
  quotaTotal: null,
  distributionStrategy: 'open-queue',
  twoStageReview: true,
}

export function readTaskOperationalSettings(
  templateConfig: unknown,
): TaskOperationalSettings {
  if (!templateConfig || typeof templateConfig !== 'object') {
    return DEFAULT_TASK_SETTINGS
  }
  const raw = (templateConfig as Record<string, unknown>).taskSettings
  if (!raw || typeof raw !== 'object') return DEFAULT_TASK_SETTINGS
  const obj = raw as Record<string, unknown>

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12)
    : []

  const quotaTotal =
    typeof obj.quotaTotal === 'number' &&
    Number.isInteger(obj.quotaTotal) &&
    obj.quotaTotal > 0
      ? obj.quotaTotal
      : null

  const distributionStrategy = isDistributionStrategy(obj.distributionStrategy)
    ? obj.distributionStrategy
    : DEFAULT_TASK_SETTINGS.distributionStrategy

  // Absent / non-boolean → default ON (spec 9.3 two-stage by default).
  const twoStageReview =
    typeof obj.twoStageReview === 'boolean'
      ? obj.twoStageReview
      : DEFAULT_TASK_SETTINGS.twoStageReview

  return {
    tags,
    quotaTotal,
    distributionStrategy,
    twoStageReview,
  }
}

export function formatDistributionStrategy(strategy: DistributionStrategy): string {
  if (strategy === 'open-queue') return 'First come'
  if (strategy === 'round-robin') return 'Assigned'
  if (strategy === 'quota-by-annotator') return 'Quota pool'
  if (strategy === 'random') return 'Random'
  return strategy
}

function isDistributionStrategy(value: unknown): value is DistributionStrategy {
  return (
    value === 'open-queue' ||
    value === 'round-robin' ||
    value === 'quota-by-annotator' ||
    value === 'random'
  )
}

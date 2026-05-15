import 'server-only'
import type { PlatformTemplate, PairChecklistItem, TemplateMode } from './types'
import { getTemplate } from './registry'

/**
 * Per-task template overrides stored in `tasks.template_config`.
 *
 * Only fields that differ from the template's defaults need to be present.
 * Unknown keys are ignored at the merge layer (forward-compat).
 *
 * Shape rules:
 *   - `pairChecklist` / `arenaDimensions` — when provided, replaces the
 *     template's default list entirely. Item IDs must be snake_case
 *     (validated at the create-task action layer, not here).
 */
export interface TaskTemplateConfig {
  pairChecklist?: readonly PairChecklistItem[]
  arenaDimensions?: readonly PairChecklistItem[]
}

/**
 * Resolve the template for a task, merging any per-task overrides.
 * Returns `undefined` if the templateMode is not registered.
 *
 * The returned object is a shallow clone — mutating it does NOT alter
 * the in-memory registry. Callers that pass this to React props can
 * treat it as the source of truth for the rubric they see.
 */
export function getEffectiveTemplate(
  templateMode: string,
  taskConfig: unknown,
): PlatformTemplate | undefined {
  const base = getTemplate(templateMode as TemplateMode)
  if (!base) return undefined

  const cfg = parseConfig(taskConfig)
  if (!cfg) return base

  // Shallow clone — only the overridden lists swap in.
  const merged: PlatformTemplate = { ...base }
  if (cfg.pairChecklist) merged.pairChecklist = cfg.pairChecklist
  if (cfg.arenaDimensions) merged.arenaDimensions = cfg.arenaDimensions
  return merged
}

/**
 * Coerce an unknown DB value into the expected shape. Returns `null`
 * when it doesn't match — callers fall back to the template defaults.
 */
function parseConfig(raw: unknown): TaskTemplateConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const out: TaskTemplateConfig = {}
  if (Array.isArray(obj.pairChecklist)) {
    const items = obj.pairChecklist.filter(isChecklistItem)
    if (items.length > 0) out.pairChecklist = items
  }
  if (Array.isArray(obj.arenaDimensions)) {
    const items = obj.arenaDimensions.filter(isChecklistItem)
    if (items.length > 0) out.arenaDimensions = items
  }
  return Object.keys(out).length > 0 ? out : null
}

function isChecklistItem(v: unknown): v is PairChecklistItem {
  if (!v || typeof v !== 'object') return false
  const item = v as Record<string, unknown>
  if (typeof item.id !== 'string' || item.id.length === 0) return false
  if (typeof item.name !== 'string' || item.name.length === 0) return false
  if (
    item.description !== undefined &&
    typeof item.description !== 'string'
  ) {
    return false
  }
  return true
}

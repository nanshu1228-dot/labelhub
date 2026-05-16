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
    if (items.length > 0) out.pairChecklist = pruneOrphanConditions(items)
  }
  if (Array.isArray(obj.arenaDimensions)) {
    const items = obj.arenaDimensions.filter(isChecklistItem)
    if (items.length > 0) out.arenaDimensions = pruneOrphanConditions(items)
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
  // showWhen validation: when present, must be { parentId: string,
  // when: boolean | number }. We accept malformed showWhen by dropping
  // it (the item just renders unconditionally) rather than rejecting
  // the whole item — keeps forward-compat with future condition shapes.
  if (item.showWhen !== undefined) {
    if (!isConditionalDisplay(item.showWhen)) {
      // Drop the bad showWhen but keep the item.
      delete item.showWhen
    }
  }
  return true
}

function isConditionalDisplay(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  if (typeof c.parentId !== 'string' || c.parentId.length === 0) return false
  if (typeof c.when !== 'boolean' && typeof c.when !== 'number') return false
  if (typeof c.when === 'number') {
    if (!Number.isFinite(c.when) || c.when < 1 || c.when > 5) return false
  }
  return true
}

/**
 * Sweep an item list to remove any showWhen reference that points at a
 * missing parent OR creates a cycle. We allow only ONE level of nesting
 * (a conditional item's parent must itself be unconditional) to keep
 * eval simple and avoid the need for topological resolution.
 *
 * Bad references silently drop to "unconditional" — same forward-compat
 * stance as `isChecklistItem` above.
 */
function pruneOrphanConditions(
  items: readonly PairChecklistItem[],
): readonly PairChecklistItem[] {
  const idSet = new Set(items.map((i) => i.id))
  // Map parentId → does that parent itself have a showWhen
  const hasOwnCondition = new Set(
    items.filter((i) => i.showWhen).map((i) => i.id),
  )
  return items.map((i) => {
    if (!i.showWhen) return i
    const refOk =
      idSet.has(i.showWhen.parentId) &&
      i.showWhen.parentId !== i.id &&
      !hasOwnCondition.has(i.showWhen.parentId)
    if (!refOk) {
      const { showWhen: _drop, ...rest } = i
      void _drop
      return rest
    }
    return i
  })
}

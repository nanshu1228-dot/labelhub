import type { PlatformTemplate, TemplateMode } from './types'
import { validateTemplate } from './types'

const registry = new Map<TemplateMode, PlatformTemplate>()

export function registerTemplate(t: PlatformTemplate): void {
  const result = validateTemplate(t)
  if (!result.ok) {
    throw new Error(
      `Template "${t.name}" failed perf-budget validation:\n  - ${result.errors.join('\n  - ')}`,
    )
  }
  registry.set(t.mode, t)
}

export function getTemplate(mode: TemplateMode): PlatformTemplate | undefined {
  return registry.get(mode)
}

export function listTemplates(): PlatformTemplate[] {
  return Array.from(registry.values())
}

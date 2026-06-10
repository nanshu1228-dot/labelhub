import type { TemplateMode } from '@/lib/templates/types'

/**
 * Workspace navigation model — single source of truth for which
 * sections a workspace exposes, and the "focus mode" that hides the
 * gateway-era surfaces.
 *
 * Background: LabelHub is two products in one repo — the spec'd
 * annotation platform (tasks → topics → annotations → review →
 * quality → export) and an "LLM-gateway" layer. Part of that layer is
 * the self-serve trajectory loop the platform is built around — wrap
 * your API through the proxy → capture the trajectory → annotate your
 * own run (trajectories / API keys / providers / eval-run). Those four
 * are now treated as CORE for `agent-trace-eval` workspaces, so they
 * stay visible even in focus mode. The rest of the gateway layer is a
 * leftover marketplace (judges, disputes, analyze, billing) that, on a
 * plain annotation deployment, renders empty and makes the cockpit feel
 * full of dead-end entry points.
 *
 * `LABELHUB_FOCUS_MODE` (default ON) hides only those marketplace
 * sections from the cockpit tile grid and the workspace sub-nav so
 * users see the core annotation flow + the trajectory loop. Set
 * `LABELHUB_FOCUS_MODE=false` to surface the full marketplace again.
 * The routes themselves are never removed — only their entry points are
 * gated — so a direct URL still works when an operator needs it.
 *
 * Both the cockpit (`/workspaces/[id]`) and the workspace layout
 * sub-nav consume this module so the two stay in lockstep.
 */

export type SectionCategory = 'core' | 'gateway'

export interface WorkspaceSection {
  key: string
  /** Short label for the sub-nav tab + cockpit tile. */
  label: string
  /** Path suffix appended to `/workspaces/[id]`. `''` is the overview hub. */
  path: string
  category: SectionCategory
  /** When set, the section only applies to these template modes. */
  modes?: TemplateMode[]
}

/**
 * Canonical, ordered section list. `core` sections are the annotation
 * platform; `gateway` sections are the LLM-gateway extras hidden in
 * focus mode. The `modes` filter mirrors the cockpit's existing
 * per-mode gating (e.g. trajectories/API/providers/eval-run only make
 * sense for `agent-trace-eval`; judges only for the rubric/arena/
 * designer modes).
 */
export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  { key: 'overview', label: 'Overview', path: '', category: 'core' },
  { key: 'tasks', label: 'Tasks', path: '/tasks', category: 'core' },
  // ── self-serve trajectory loop: wrap your API → capture → annotate.
  //    Core to the agent-trace-eval flow, so visible even in focus mode;
  //    `modes` scopes them to that template (other modes never see them). ──
  { key: 'trajectories', label: 'Trajectories', path: '/trajectories', category: 'core', modes: ['agent-trace-eval'] },
  { key: 'api', label: 'API', path: '/api', category: 'core', modes: ['agent-trace-eval'] },
  { key: 'connections', label: 'Providers', path: '/connections', category: 'core', modes: ['agent-trace-eval'] },
  { key: 'evalRuns', label: 'Eval-run', path: '/eval-runs/new', category: 'core', modes: ['agent-trace-eval'] },
  { key: 'quality', label: 'Quality', path: '/quality', category: 'core' },
  { key: 'audit', label: 'Audit', path: '/audit', category: 'core' },
  { key: 'activity', label: 'Activity', path: '/activity', category: 'core' },
  { key: 'members', label: 'Members', path: '/members', category: 'core' },
  { key: 'settings', label: 'Settings', path: '/settings', category: 'core' },
  // ── gateway-era marketplace extras (hidden when focus mode is on) ──
  { key: 'judges', label: 'Judges', path: '/judges', category: 'gateway', modes: ['pair-rubric', 'arena-gsb', 'custom-designer'] },
  { key: 'disputes', label: 'Disputes', path: '/disputes', category: 'gateway' },
  { key: 'analyze', label: 'Analyze', path: '/analyze', category: 'gateway' },
  { key: 'billing', label: 'Billing', path: '/billing', category: 'gateway' },
] as const

/**
 * Focus mode: ON by default. Only an explicit opt-out env value
 * (`false` / `0` / `off` / `no`) surfaces the gateway product.
 * Read on the server; pass the boolean down to client components.
 */
export function isFocusMode(): boolean {
  const raw = (process.env.LABELHUB_FOCUS_MODE ?? '').toString().toLowerCase().trim()
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no'
}

/**
 * Sections to surface for a given workspace, honoring focus mode and
 * per-mode applicability. Pass `focus` explicitly so server and client
 * callers share one decision.
 */
export function visibleWorkspaceSections(
  templateMode: TemplateMode | string,
  focus: boolean,
): WorkspaceSection[] {
  return WORKSPACE_SECTIONS.filter((s) => {
    if (focus && s.category === 'gateway') return false
    if (s.modes && !s.modes.includes(templateMode as TemplateMode)) return false
    return true
  })
}

import type {
  ConditionalDisplay,
  PairChecklistItem,
  TemplateMode,
} from "@/lib/templates/types";
import type { DistributionStrategy } from "@/lib/import/distribution";
import type { RubricItem, TrajectoryStepKind } from "@/lib/templates/rubric";

/**
 * Pure helpers, types, and shared inline-style objects for the
 * task-creation form. Extracted from `create-task-form.tsx` so the
 * orchestrator component stays focused on state + composition. No React,
 * no JSX — just data shaping, so these are trivially unit-testable.
 */

export type EditableItem = PairChecklistItem & { _key: string };
export type TaskCreateDistributionStrategy = Extract<
  DistributionStrategy,
  "open-queue" | "round-robin" | "quota-by-annotator"
>;
export type EditableRubricItem = RubricItem & { _key: string };

let _seq = 0;
export function nextKey() {
  _seq += 1;
  return `row_${_seq}_${Date.now()}`;
}

export function toEditable(items: readonly PairChecklistItem[]): EditableItem[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    showWhen: i.showWhen,
    _key: nextKey(),
  }));
}

export function formatShowWhen(
  cond: ConditionalDisplay,
  mode: TemplateMode,
): string {
  if (typeof cond.when === "boolean") {
    return `${cond.parentId} = ${cond.when ? "yes" : "no"}`;
  }
  // arena-gsb: numeric threshold
  void mode;
  return `${cond.parentId} ≥ ${cond.when}`;
}

export function toEditableRubric(
  items: readonly RubricItem[],
): EditableRubricItem[] {
  return items.map((i) => ({ ...i, _key: nextKey() }));
}

/**
 * Structural comparison for two rubric items — used to decide whether a
 * templateConfig.rubric override is actually different from the default.
 * Compares the user-facing fields; we don't bother with deep options
 * equality (re-ordered options are still "different" and an override
 * write is honest about that).
 */
export function sameRubricItem(a: RubricItem, b: RubricItem): boolean {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if ((a.description ?? "") !== (b.description ?? "")) return false;
  if (a.scale !== b.scale) return false;
  if (a.severity !== b.severity) return false;
  if (!!a.requiresReason !== !!b.requiresReason) return false;
  const optsA = (a.options ?? []).join("|");
  const optsB = (b.options ?? []).join("|");
  if (optsA !== optsB) return false;
  const appliesA = (a.appliesTo ?? []).join("|");
  const appliesB = (b.appliesTo ?? []).join("|");
  if (appliesA !== appliesB) return false;
  return true;
}

export function parseTags(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, 24));
}

export function formatAppliesTo(
  a: readonly TrajectoryStepKind[] | readonly ["*"] | undefined,
): string {
  if (!a || a.length === 0) return "all";
  if (a[0] === "*") return "all";
  return (a as readonly TrajectoryStepKind[]).join(", ");
}

export const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  color: "var(--text)",
  outline: "none",
  fontFamily: "var(--font-geist-sans), system-ui",
} as const;

export const inlineInputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--text)",
  outline: "none",
  fontFamily: "var(--font-geist-sans), system-ui",
} as const;

import type { FieldNode } from "@/lib/form-designer/schema";
import { isContainerKind } from "@/components/form-materials/registry";

/** Recursive walker — find a node anywhere in the tree by id. */
export function findInTree(fields: FieldNode[], id: string): FieldNode | null {
  for (const f of fields) {
    if (f.id === id) return f;
    if (f.children) {
      const hit = findInTree(f.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export function summarizeSchema(fields: FieldNode[]) {
  const stats = {
    rootFields: fields.length,
    fields: 0,
    llm: 0,
    rules: 0,
    containers: 0,
  };
  function walk(nodes: FieldNode[]) {
    for (const field of nodes) {
      stats.fields += 1;
      if (field.kind === "llm-trigger") stats.llm += 1;
      if (isContainerKind(field.kind)) stats.containers += 1;
      stats.rules +=
        field.validation.length +
        (field.visibleWhen ? 1 : 0) +
        (field.requiredWhen ? 1 : 0);
      if (field.children) walk(field.children);
    }
  }
  walk(fields);
  return stats;
}

import {
  MATERIALS,
  PALETTE_ORDER,
  isContainerKind,
} from "@/components/form-materials/registry";

/**
 * Static palette copy + the child-material subset. Extracted verbatim
 * from designer-shell.tsx so the shell stays a thin DnD/state container.
 * These are pure data — no React, no state.
 */
export const MATERIAL_DESCRIPTIONS: Record<keyof typeof MATERIALS, string> = {
  text: "Short text answer",
  textarea: "Long text answer",
  "single-select": "One option",
  "multi-select": "Many options",
  "tag-select": "Tag chips",
  "rich-text": "Formatted notes",
  "file-upload": "Media evidence",
  "json-editor": "Structured JSON",
  "llm-trigger": "AI fill action",
  "show-item": "Source display",
  group: "Field section",
  "tab-layout": "Tabbed section",
};

export const CHILD_MATERIALS = PALETTE_ORDER.filter(
  (kind) => !isContainerKind(kind),
);

import { describe, expect, it } from "vitest";
import type { FieldNode } from "@/lib/form-designer/schema";
import {
  buildTopicAssistPrompt,
  collectLlmAssistPrompts,
  compactAssistPayload,
  summarizePayloadFields,
} from "./custom-designer-form";

const field = (overrides: Partial<FieldNode>): FieldNode => ({
  id: "f_text",
  kind: "text",
  label: "Text",
  config: {},
  validation: [],
  ...overrides,
});

describe("topic-level AI assist helpers", () => {
  it("collects nested llm-trigger prompts", () => {
    const fields: FieldNode[] = [
      field({
        id: "group",
        kind: "group",
        label: "Group",
        children: [
          field({ id: "answer", label: "Answer" }),
          field({
            id: "assist",
            kind: "llm-trigger",
            label: "Assist",
            config: { promptTemplate: "Use the rubric." },
          }),
        ],
      }),
    ];

    expect(collectLlmAssistPrompts(fields)).toEqual(["Use the rubric."]);
  });

  it("summarizes payload fields and skips non-payload widgets", () => {
    const fields: FieldNode[] = [
      field({
        id: "answer",
        label: "Final answer",
        validation: [{ kind: "required" }],
      }),
      field({
        id: "source",
        kind: "show-item",
        label: "Source",
      }),
      field({
        id: "assist",
        kind: "llm-trigger",
        label: "Assist",
      }),
    ];

    expect(summarizePayloadFields(fields)).toEqual([
      {
        id: "answer",
        label: "Final answer",
        kind: "text",
        required: true,
      },
    ]);
  });

  it("builds a topic prompt from owner rules and payload fields", () => {
    const prompt = buildTopicAssistPrompt(
      ["Use short labels."],
      [{ id: "answer", label: "Final answer", kind: "textarea" }],
    );

    expect(prompt).toContain("Owner rules");
    expect(prompt).toContain("Use short labels.");
    expect(prompt).toContain("answer: Final answer (textarea)");
  });

  it("caps oversized context before calling the assist endpoint", () => {
    const compacted = compactAssistPayload({ text: "x".repeat(9_000) });

    expect(compacted.__truncated).toBe(true);
    expect(String(compacted.json).length).toBe(8_000);
  });
});

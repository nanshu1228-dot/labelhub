"use client";

/**
 * CustomDesignerForm — Labeler entry-point for `custom-designer`
 * tasks. Finals D19-B.
 *
 * Mounts the FormRenderer with the task's saved schema + the topic's
 * itemData; wires `useAutosaveDraft` for persistence; renders the
 * autosave status badge so the labeler can see "Saved 30s ago" at a
 * glance; binds Cmd/Ctrl+Enter to submit.
 *
 * Mirrors the shape of `pair-rubric-form.tsx` so the page-level
 * branch can render this the same way it renders the other modes.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { FormRenderer } from "@/components/form-renderer/form-renderer";
import { TopicHeader } from "./topic-header";
import { CustomFormPrecheckButton } from "./custom-form-precheck";
import { navigateAfterSubmit } from "./after-submit-nav";
import { autosaveStatusLabel, useAutosaveDraft } from "./use-autosave-draft";
import { submitAnnotation } from "@/lib/actions/annotations";
import type { FieldNode, FormSchema } from "@/lib/form-designer/schema";
import { validateFormValues } from "@/lib/form-designer/validation";
import { getErrorMessage } from "@/lib/errors/client-utils";

export interface CustomDesignerFormProps {
  workspaceId: string;
  workspaceName: string;
  taskId: string;
  taskName: string;
  topicId: string;
  topicStatus: string;
  itemData: Record<string, unknown>;
  schema: FormSchema;
  initialPayload: Record<string, unknown>;
}

export function CustomDesignerForm({
  workspaceId,
  workspaceName,
  taskId,
  taskName,
  topicId,
  topicStatus,
  itemData,
  schema,
  initialPayload,
}: CustomDesignerFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(
    () => initialPayload ?? {},
  );
  const [isSubmitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const isReadOnly = topicStatus !== "drafting" && topicStatus !== "revising";

  const autosave = useAutosaveDraft({
    topicId,
    taskId,
    readOnly: isReadOnly,
  });

  // Restore IndexedDB-stored draft if it's fresher than the
  // server payload — mirrors the pattern from pair-rubric-form.
  useEffect(() => {
    if (isReadOnly) return;
    let cancelled = false;
    void (async () => {
      const local = await autosave.restoreLocal();
      if (cancelled || !local) return;
      if (local && typeof local === "object") {
        setValues((prev) => ({
          ...prev,
          ...(local as Record<string, unknown>),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run-once on mount; autosave object is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = useCallback(
    (next: Record<string, unknown>) => {
      setValues(next);
      if (Object.keys(validationErrors).length > 0) {
        setValidationErrors({});
      }
      if (!isReadOnly) {
        autosave.markDirty(next);
      }
    },
    [autosave, isReadOnly, validationErrors],
  );

  const submit = useCallback(() => {
    if (isReadOnly) return;
    setError(null);
    const validation = validateFormValues(schema.fields, values);
    if (!validation.success) {
      setValidationErrors(validation.fieldErrors);
      const first = validation.issues[0];
      const firstPath = first?.path.join(".");
      setError(
        first
          ? `Fix ${validation.issues.length} highlighted field${validation.issues.length === 1 ? "" : "s"}. First: ${firstPath}: ${first.message}`
          : "Fix the highlighted fields before submitting.",
      );
      return;
    }
    setValidationErrors({});
    startSubmit(async () => {
      try {
        // Flush any pending autosave first so the submit reflects
        // the latest values.
        await autosave.flush(values);
        await submitAnnotation({
          topicId,
          payload: values,
        });
        // Auto-advance to the next workable topic (falls back to the task page).
        await navigateAfterSubmit(router, { taskId, topicId });
      } catch (e) {
        setError(getErrorMessage(e, "Submit failed."));
      }
    });
  }, [autosave, isReadOnly, router, schema.fields, taskId, topicId, values]);

  // Cmd/Ctrl+Enter submit. Ignored when readOnly or already
  // submitting. The listener is window-bound so it works regardless
  // of focus position — matches a common annotation-tool convention
  // (Label Studio, Surge, Scale all bind Cmd+Enter).
  useEffect(() => {
    if (isReadOnly) return;
    if (typeof window === "undefined") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      submit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isReadOnly, submit]);

  const statusBadgeText = useMemo(
    () => autosaveStatusLabel(autosave.status, autosave.lastSavedAt),
    [autosave.status, autosave.lastSavedAt],
  );
  const uploadContext = useMemo(
    () => ({ workspaceId, taskId, topicId }),
    [workspaceId, taskId, topicId],
  );

  return (
    <>
      <TopicHeader
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        taskName={taskName}
        itemData={itemData}
        badge="CUSTOM DESIGNER"
      />

      <section className="mt-8 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <AutosaveBadge label={statusBadgeText} status={autosave.status} />
          {!isReadOnly ? (
            <kbd
              className="ts-11 mono"
              style={{
                background: "var(--panel2)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                padding: "2px 8px",
                color: "var(--mute)",
              }}
              title="Press Cmd/Ctrl + Enter to submit"
            >
              ⌘ + Enter to submit
            </kbd>
          ) : null}
        </div>

        <TopicAiAssistPanel
          schema={schema}
          values={values}
          itemData={itemData}
          readOnly={isReadOnly}
        />

        <FormRenderer
          schema={schema}
          value={values}
          onChange={handleChange}
          itemData={itemData}
          readOnly={isReadOnly}
          errors={validationErrors}
          uploadContext={uploadContext}
        />

        {error ? (
          <div
            className="rounded p-2 ts-12"
            style={{
              background: "oklch(0.55 0.2 25 / 0.05)",
              border: "1px solid oklch(0.55 0.2 25 / 0.4)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        ) : null}

        {!isReadOnly ? (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className="ts-13 mono px-4 py-2 rounded"
              style={{
                background: "oklch(0.6 0.18 280)",
                color: "white",
                border: "1px solid oklch(0.6 0.18 280 / 0.6)",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Submitting…" : "Submit annotation"}
            </button>
            <button
              type="button"
              onClick={() => void autosave.flush(values)}
              disabled={isSubmitting || autosave.status === "saving"}
              className="ts-13 mono px-3 py-2 rounded"
              style={{
                background: "transparent",
                color: "var(--text)",
                border: "1px solid var(--line)",
                cursor: "pointer",
              }}
            >
              Save draft
            </button>
          </div>
        ) : null}

        {!isReadOnly ? (
          <CustomFormPrecheckButton
            topicId={topicId}
            disabled={isReadOnly}
            buildPayload={() => ({
              fields: summarizePayloadFields(schema.fields).map((f) => ({
                id: f.id,
                label: f.label,
                kind: f.kind,
                required: !!f.required,
              })),
              values,
            })}
          />
        ) : null}
      </section>
    </>
  );
}

type AssistFieldSummary = {
  id: string;
  label: string;
  kind: string;
  required?: boolean;
};

type LlmTriggerConfig = {
  promptTemplate?: string;
};

export function collectLlmAssistPrompts(fields: FieldNode[]): string[] {
  const prompts: string[] = [];
  for (const field of fields) {
    if (field.kind === "llm-trigger") {
      const cfg = field.config as LlmTriggerConfig;
      const prompt = cfg.promptTemplate?.trim();
      prompts.push(
        prompt ||
          "Suggest a short answer based on the current topic and form context.",
      );
      continue;
    }
    if (field.children?.length) {
      prompts.push(...collectLlmAssistPrompts(field.children));
    }
  }
  return prompts;
}

export function summarizePayloadFields(fields: FieldNode[]): AssistFieldSummary[] {
  const summary: AssistFieldSummary[] = [];
  for (const field of fields) {
    if (field.children?.length) {
      summary.push(...summarizePayloadFields(field.children));
      continue;
    }
    if (field.kind === "show-item" || field.kind === "llm-trigger") continue;
    summary.push({
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.validation.some((rule) => rule.kind === "required"),
    });
  }
  return summary;
}

export function buildTopicAssistPrompt(
  prompts: string[],
  fields: AssistFieldSummary[],
): string {
  const ownerRules = prompts
    .map((prompt, idx) => `${idx + 1}. ${prompt}`)
    .join("\n");
  const fieldList = fields
    .map((field) => `${field.id}: ${field.label} (${field.kind})`)
    .join("\n");
  return [
    "Use the owner-configured field-level LLM assist rules as the task policy for this full topic.",
    "Produce concise topic-level draft notes that help the labeler fill the form accurately.",
    "Cover likely values, missing evidence, and any uncertainty. Do not invent facts that are not supported by the topic data.",
    "",
    "Owner rules:",
    ownerRules || "No owner rules were configured.",
    "",
    "Payload fields:",
    fieldList || "No payload fields were found.",
  ].join("\n");
}

export function compactAssistPayload(
  value: Record<string, unknown>,
  maxChars = 8_000,
): Record<string, unknown> {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return value;
  return {
    __truncated: true,
    json: text.slice(0, maxChars),
  };
}

function TopicAiAssistPanel({
  schema,
  values,
  itemData,
  readOnly,
}: {
  schema: FormSchema;
  values: Record<string, unknown>;
  itemData: Record<string, unknown>;
  readOnly: boolean;
}) {
  const prompts = useMemo(
    () => collectLlmAssistPrompts(schema.fields),
    [schema.fields],
  );
  const fields = useMemo(
    () => summarizePayloadFields(schema.fields),
    [schema.fields],
  );
  const promptTemplate = useMemo(
    () => buildTopicAssistPrompt(prompts, fields),
    [fields, prompts],
  );
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (readOnly || prompts.length === 0) return null;

  async function triggerTopicAssist() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/llm-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "topic",
          promptTemplate,
          context: compactAssistPayload(values),
          tier: "fast",
          itemData: compactAssistPayload(itemData),
          schemaSummary: fields,
        }),
      });
      if (!res.ok) {
        let msg = `AI assist failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // Keep the status message when the response is not JSON.
        }
        setError(msg);
        return;
      }
      const body = (await res.json()) as { text?: string };
      setAnswer(body.text?.trim() || "No suggestion returned.");
    } catch (e) {
      setError(getErrorMessage(e, "Network error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="rounded-md p-3"
      style={{
        background: "oklch(0.58 0.16 285 / 0.06)",
        border: "1px solid oklch(0.58 0.16 285 / 0.28)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="lbl" style={{ color: "oklch(0.5 0.18 285)" }}>
            TOPIC AI ASSIST
          </div>
          <div className="ts-12 mt-1" style={{ color: "var(--mute)" }}>
            {fields.length} fields · {prompts.length} trigger
            {prompts.length === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          onClick={triggerTopicAssist}
          disabled={pending}
          className="ts-12 mono inline-flex items-center justify-center gap-2 rounded-md px-3"
          style={{
            minHeight: 34,
            color: "white",
            background: "oklch(0.5 0.18 285)",
            border: "1px solid oklch(0.5 0.18 285 / 0.5)",
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.72 : 1,
          }}
          aria-label="Generate topic-level AI notes"
          title="Generate topic-level AI notes"
        >
          {pending ? (
            <Loader2 size={14} aria-hidden className="animate-spin" />
          ) : (
            <Sparkles size={14} aria-hidden />
          )}
          {pending ? "Generating" : "Generate"}
        </button>
      </div>
      {answer ? (
        <div
          className="mt-3 rounded ts-12 p-3"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            whiteSpace: "pre-wrap",
          }}
          aria-live="polite"
        >
          {answer}
        </div>
      ) : null}
      {error ? (
        <div
          className="mt-3 ts-12"
          style={{ color: "var(--danger)" }}
          aria-live="polite"
        >
          {error}
        </div>
      ) : null}
    </section>
  );
}

function AutosaveBadge({
  label,
  status,
}: {
  label: string;
  status: ReturnType<typeof useAutosaveDraft>["status"];
}) {
  const palette = (() => {
    if (status === "error")
      return {
        bg: "oklch(0.55 0.2 25 / 0.05)",
        fg: "var(--danger)",
        border: "oklch(0.55 0.2 25 / 0.4)",
      };
    if (status === "saving" || status === "dirty")
      return {
        bg: "oklch(0.6 0.18 60 / 0.08)",
        fg: "oklch(0.6 0.18 60)",
        border: "oklch(0.6 0.18 60 / 0.4)",
      };
    if (status === "saved")
      return {
        bg: "oklch(0.62 0.16 145 / 0.08)",
        fg: "oklch(0.62 0.16 145)",
        border: "oklch(0.62 0.16 145 / 0.4)",
      };
    return {
      bg: "var(--panel2)",
      fg: "var(--mute)",
      border: "var(--line)",
    };
  })();
  return (
    <span
      className="ts-11 mono px-2 py-1 rounded"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
      aria-live="polite"
    >
      {label}
    </span>
  );
}

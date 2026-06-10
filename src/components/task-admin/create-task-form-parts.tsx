"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  PencilLine,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { TemplateMode } from "@/lib/templates/types";
import type { RubricItem } from "@/lib/templates/rubric";
import {
  inputStyle,
  inlineInputStyle,
  formatAppliesTo,
  type EditableRubricItem,
} from "./create-task-form-helpers";

/**
 * Presentational + self-contained interactive subcomponents for the
 * task-creation form. Each takes props and closes over no orchestrator
 * state, so they live here instead of inline in `create-task-form.tsx`.
 */

export function Snapshot({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 ts-12"
      style={{ color: "var(--mute)" }}
    >
      <span className="mono" style={{ color: "var(--mute2)" }}>
        {label}
      </span>
      <span
        className="truncate"
        style={{ color: "var(--text)", fontWeight: 550 }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block mb-3">
      <span
        className="ts-12 mono mb-1.5 block"
        style={{ color: "var(--mute)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export function GuidelinesMarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");

  function replaceSelection(
    nextValue: string,
    selectionStart: number,
    selectionEnd: number,
  ) {
    onChange(nextValue);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function wrapSelection(prefix: string, suffix: string, fallback: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const nextValue =
      value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    const innerStart = start + prefix.length;
    replaceSelection(nextValue, innerStart, innerStart + selected.length);
  }

  function insertHeading() {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n\n" : "";
    const body = selected
      ? selected
          .split("\n")
          .map((line) => (line.trim() ? `## ${line}` : line))
          .join("\n")
      : "## Section title";
    const nextValue = value.slice(0, start) + prefix + body + value.slice(end);
    const titleStart = start + prefix.length + (selected ? 0 : 3);
    replaceSelection(nextValue, titleStart, titleStart + (selected ? body.length : 13));
  }

  function insertList() {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const prefix = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const body = selected
      ? selected
          .split("\n")
          .map((line) => (line.trim() ? `- ${line.replace(/^[-*]\s+/, "")}` : line))
          .join("\n")
      : "- First rule\n- Second rule";
    const nextValue = value.slice(0, start) + prefix + body + value.slice(end);
    const innerStart = start + prefix.length + (selected ? 0 : 2);
    replaceSelection(nextValue, innerStart, innerStart + (selected ? body.length : 10));
  }

  function insertLink() {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || "link text";
    const nextValue =
      value.slice(0, start) +
      `[${selected}](https://example.com)` +
      value.slice(end);
    const urlStart = start + selected.length + 3;
    replaceSelection(nextValue, urlStart, urlStart + 19);
  }

  const toolButtonStyle = {
    background: "transparent",
    border: "1px solid var(--line)",
    borderRadius: 5,
    color: "var(--mute)",
    cursor: "pointer",
    height: 28,
    width: 30,
  } as const;

  return (
    <div className="block mb-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor="task-guidelines-markdown"
          className="ts-12 mono"
          style={{ color: "var(--mute)" }}
        >
          Guidelines (shown to annotators)
        </label>
        <div className="seg" role="tablist" aria-label="Guidelines mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "write"}
            onClick={() => setMode("write")}
            className={`seg-btn ${mode === "write" ? "on" : ""}`}
          >
            <PencilLine size={13} />
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            onClick={() => setMode("preview")}
            className={`seg-btn ${mode === "preview" ? "on" : ""}`}
          >
            <Eye size={13} />
            Preview
          </button>
        </div>
      </div>

      <div
        className="rounded-md overflow-hidden"
        style={{ background: "var(--bg)", border: "1px solid var(--line)" }}
      >
        <div
          className="flex flex-wrap items-center gap-1.5 px-2 py-2"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <button
            type="button"
            title="Heading"
            aria-label="Heading"
            onClick={insertHeading}
            className="inline-flex items-center justify-center"
            style={toolButtonStyle}
          >
            <Heading2 size={14} />
          </button>
          <button
            type="button"
            title="Bold"
            aria-label="Bold"
            onClick={() => wrapSelection("**", "**", "important rule")}
            className="inline-flex items-center justify-center"
            style={toolButtonStyle}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            title="Italic"
            aria-label="Italic"
            onClick={() => wrapSelection("_", "_", "note")}
            className="inline-flex items-center justify-center"
            style={toolButtonStyle}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            title="Code"
            aria-label="Code"
            onClick={() => wrapSelection("`", "`", "field_name")}
            className="inline-flex items-center justify-center"
            style={toolButtonStyle}
          >
            <Code2 size={14} />
          </button>
          <button
            type="button"
            title="List"
            aria-label="List"
            onClick={insertList}
            className="inline-flex items-center justify-center"
            style={toolButtonStyle}
          >
            <List size={14} />
          </button>
          <button
            type="button"
            title="Link"
            aria-label="Link"
            onClick={insertLink}
            className="inline-flex items-center justify-center"
            style={toolButtonStyle}
          >
            <Link2 size={14} />
          </button>
        </div>

        {mode === "write" ? (
          <textarea
            id="task-guidelines-markdown"
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={7}
            maxLength={50000}
            placeholder={
              "# How to rate\nMark `yes` only when the response directly answers the prompt..."
            }
            className="w-full px-3 py-2 ts-13 mono"
            style={{
              ...inputStyle,
              border: "none",
              borderRadius: 0,
              minHeight: 188,
              resize: "vertical",
            }}
          />
        ) : (
          <div
            className="task-guidelines-preview"
            style={{ minHeight: 188 }}
          >
            {value.trim() ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                urlTransform={(href) => {
                  if (!href) return "";
                  if (/^(javascript|vbscript|file):/i.test(href)) return "";
                  return href;
                }}
                components={{
                  a: (props) => {
                    const { node, ...linkProps } = props;
                    void node;
                    return (
                      <a {...linkProps} target="_blank" rel="noreferrer" />
                    );
                  },
                }}
              >
                {value}
              </ReactMarkdown>
            ) : (
              <p className="ts-13" style={{ color: "var(--mute2)" }}>
                No guidelines yet.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Trajectory rubric subsection — renders one of (perStep | perTrajectory)
 * as a table where name + description are editable inline; scale,
 * appliesTo, severity, and requiresReason render as readonly chips. The
 * admin can delete rows or regenerate via 🪄. Direct editing of those
 * structural fields is deliberately out of scope — admins curate via the
 * AI generator or live with the preset defaults.
 *
 * This is the minimum-viable trajectory rubric editor. The full version
 * (scale picker, options editor for enums, applies-to multi-select)
 * lives in the backlog under "trajectory template builder v2".
 */
export function TrajRubricSubsection({
  heading,
  list,
  items,
  setItem,
  removeItem,
  showAppliesTo,
}: {
  heading: string;
  list: "perStep" | "perTrajectory";
  items: EditableRubricItem[];
  setItem: (
    list: "perStep" | "perTrajectory",
    key: string,
    patch: Partial<RubricItem>,
  ) => void;
  removeItem: (list: "perStep" | "perTrajectory", key: string) => void;
  showAppliesTo: boolean;
}) {
  return (
    <div className="mb-4">
      <div
        className="ts-11 mono mb-1"
        style={{ color: "var(--mute)", letterSpacing: "0.06em" }}
      >
        {heading} · {items.length} {items.length === 1 ? "item" : "items"}
      </div>
      <div
        className="rounded-md overflow-hidden"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
        }}
      >
        <table className="w-full ts-13">
          <thead>
            <tr
              style={{
                background: "var(--panel2)",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <th
                className="text-left px-3 py-2 mono ts-11"
                style={{ color: "var(--mute)", width: 160 }}
              >
                ID
              </th>
              <th
                className="text-left px-3 py-2 mono ts-11"
                style={{ color: "var(--mute)", width: 180 }}
              >
                NAME
              </th>
              <th
                className="text-left px-3 py-2 mono ts-11"
                style={{ color: "var(--mute)" }}
              >
                DESCRIPTION / META
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it._key} style={{ borderTop: "1px solid var(--line)" }}>
                <td
                  className="px-3 py-2 mono ts-12"
                  style={{ color: "var(--mute2)" }}
                  title="Storage key — set by the AI generator, not editable inline"
                >
                  {it.id}
                </td>
                <td className="px-3 py-2">
                  <input
                    value={it.name}
                    onChange={(e) =>
                      setItem(list, it._key, { name: e.target.value })
                    }
                    placeholder="Display name"
                    className="w-full px-2 py-1 ts-13"
                    style={inlineInputStyle}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={it.description ?? ""}
                    onChange={(e) =>
                      setItem(list, it._key, {
                        description: e.target.value,
                      })
                    }
                    placeholder="Optional one-liner"
                    className="w-full px-2 py-1 ts-13"
                    style={inlineInputStyle}
                  />
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip
                      color="oklch(0.6 0.18 280)"
                      label={`scale: ${it.scale}`}
                    />
                    {showAppliesTo && (
                      <Chip
                        color="oklch(0.55 0 0)"
                        label={`applies: ${formatAppliesTo(it.appliesTo)}`}
                      />
                    )}
                    {it.options && it.options.length > 0 && (
                      <Chip
                        color="oklch(0.65 0.18 200)"
                        label={`opts: ${it.options.join(" / ")}`}
                      />
                    )}
                    {it.severity && it.severity !== "minor" && (
                      <Chip
                        color={
                          it.severity === "critical"
                            ? "var(--danger)"
                            : "oklch(0.6 0.18 280)"
                        }
                        label={`severity: ${it.severity}`}
                      />
                    )}
                    {it.requiresReason && (
                      <Chip color="oklch(0.6 0.14 75)" label="needs reason" />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeItem(list, it._key)}
                    title="Remove"
                    className="ts-12 mono inline-flex items-center justify-center"
                    style={{
                      color: "var(--danger)",
                      background: "transparent",
                      border: "1px solid transparent",
                      padding: "2px 6px",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center ts-12 mono"
                  style={{ color: "var(--mute2)" }}
                >
                  No items — click &quot;generate&quot; or &quot;restore defaults&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="ts-11 mono px-1.5 py-0.5 rounded inline-block"
      style={{
        color,
        background: `${color}15`,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
    </span>
  );
}

/**
 * NL → rubric generator modal.
 *
 * Admin describes the task in a textarea, clicks generate. The action
 * shows a summary line (so they spot misinterpretations) and replaces
 * the form's rubric items in-place. Closing without generating keeps
 * the existing items untouched.
 *
 * UX intent: this is a sketch tool, not a one-click "ship it". The
 * admin always reviews + tweaks individual items before saving the
 * task — same as if they'd typed the rubric by hand.
 */
export function GenerateModal({
  mode,
  description,
  setDescription,
  pending,
  error,
  summary,
  onClose,
  onGenerate,
}: {
  mode: TemplateMode;
  description: string;
  setDescription: (v: string) => void;
  pending: boolean;
  error: string | null;
  summary: string | null;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const example =
    mode === "pair-rubric"
      ? "比如:评估两个客服回答的质量,检查回答是否切题、是否礼貌、是否提供了可执行步骤;如果提供了步骤,再检查步骤是否完整。"
      : "比如:评估两个翻译版本,从准确性、流畅度、文化适配三个维度1-5评分;如果准确性≥4,再细评术语精确度。";
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-md p-5"
        style={{
          width: 560,
          maxWidth: "100%",
          background: "var(--bg)",
          border: "1px solid var(--line)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div
            className="lbl inline-flex items-center gap-1.5"
            style={{ color: "var(--accent)" }}
          >
            <Sparkles size={14} />
            GENERATE RUBRIC
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ts-12 mono inline-flex items-center justify-center"
            style={{
              color: "var(--mute2)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
        <p className="ts-12 mb-3" style={{ color: "var(--mute)" }}>
          Describe what you want raters to check. Claude returns a draft rubric
          — you can edit every row before saving the task.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder={example}
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            outline: "none",
            resize: "vertical",
            fontFamily: "var(--font-geist-sans), system-ui",
          }}
        />
        {summary && (
          <div
            className="ts-12 mt-2 p-2 rounded"
            style={{
              background: "var(--success-soft)",
              border: "1px solid oklch(0.5 0.13 150 / 0.35)",
              color: "var(--text)",
            }}
          >
            <span
              className="lbl mr-2"
              style={{ color: "oklch(0.45 0.15 150)" }}
            >
              CLAUDE READ THIS AS:
            </span>
            {summary}
          </div>
        )}
        {error && (
          <div
            className="ts-12 mt-2 p-2 rounded"
            style={{
              background: "var(--danger-soft)",
              border: "1px solid oklch(0.55 0.2 25 / 0.35)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="ts-13 mono"
            style={{
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            className="ts-13 mono"
            style={{
              background: "var(--accent)",
              color: "white",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              padding: "6px 14px",
              fontWeight: 500,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "generating…" : "✨ generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

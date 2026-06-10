"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { submitAnnotation } from "@/lib/actions/annotations";
import { AIPrecheckButton } from "./ai-precheck";
import {
  autosaveStatusLabel,
  useAutosaveDraft,
  type AutosaveStatus,
} from "./use-autosave-draft";
import { getErrorMessage } from "@/lib/errors/client-utils";

/**
 * Rubric-Judgment annotator.
 *
 * Unlike pair-rubric (owner-preset rubric, two-model comparison), here the
 * EXPERT authors the rubric themselves for a SINGLE model response, then
 * judges that response pass/fail per criterion + an overall verdict.
 *
 * Screen layout (single-column):
 *   1. READ-ONLY context — the prompt + the one model response under review.
 *   2. AUTHORED rubric — rows the expert adds (name + optional description +
 *      optional expectation), each with a pass/fail toggle.
 *   3. OVERALL verdict — pass / fail (required).
 *   4. Optional notes (autosaved on blur, never on keystroke).
 *
 * Payload (matches the registered responseSchema exactly):
 *   {
 *     rubricItems: Array<{ id; name; description?; expectation? }>,  // 1..20
 *     judgments:   Record<id, 'pass' | 'fail'>,                       // only judged ids
 *     overallVerdict: 'pass' | 'fail',
 *     notes?: string,
 *   }
 *
 * State shape mirrors the payload but keeps `judgments` sparse — an id is
 * absent until the expert picks pass/fail, so a half-finished draft never
 * ships spurious verdicts.
 */

type Judgment = "pass" | "fail";

/**
 * One authored rubric criterion. `id` is stable once created
 * (snake_case-ish, via newCustomId) because `judgments` is keyed on it.
 */
interface RubricItem {
  id: string;
  name: string;
  description?: string;
  /** What a PASS looks like for this criterion (optional, sharpens it). */
  expectation?: string;
}

type JudgmentsState = Record<string, Judgment>;

/**
 * Stable-ish id for a new rubric criterion. Same shape as pair-rubric's
 * newCustomId: `custom_<slug>_<short-random>` — snake_case-ish so it
 * satisfies the rubric-id constraint (max 64 chars) and the random tail
 * avoids collisions across re-adds.
 */
function newCustomId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "item";
  const rand = Math.random().toString(36).slice(2, 6);
  return `custom_${slug}_${rand}`;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function initialRubricItems(payload: Record<string, unknown>): RubricItem[] {
  const raw = payload.rubricItems;
  if (!Array.isArray(raw)) return [];
  const out: RubricItem[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const item = v as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !item.id ||
      !item.name
    )
      continue;
    out.push({
      id: item.id,
      name: item.name,
      description:
        typeof item.description === "string" ? item.description : undefined,
      expectation:
        typeof item.expectation === "string" ? item.expectation : undefined,
    });
  }
  return out;
}

function initialJudgments(payload: Record<string, unknown>): JudgmentsState {
  const raw = payload.judgments;
  if (!raw || typeof raw !== "object") return {};
  const out: JudgmentsState = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val === "pass" || val === "fail") out[id] = val;
  }
  return out;
}

function initialVerdict(payload: Record<string, unknown>): Judgment | null {
  const v = payload.overallVerdict;
  return v === "pass" || v === "fail" ? v : null;
}

export function RubricJudgmentForm({
  workspaceId,
  topicId,
  taskId,
  topicStatus,
  itemData,
  initialPayload,
  taskName,
  workspaceName,
}: {
  workspaceId: string;
  topicId: string;
  taskId: string;
  topicStatus: string;
  itemData: Record<string, unknown>;
  initialPayload: Record<string, unknown>;
  taskName: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [rubricItems, setRubricItems] = useState<RubricItem[]>(() =>
    initialRubricItems(initialPayload),
  );
  const [judgments, setJudgments] = useState<JudgmentsState>(() =>
    initialJudgments(initialPayload),
  );
  const [overallVerdict, setOverallVerdict] = useState<Judgment | null>(() =>
    initialVerdict(initialPayload),
  );
  const [notes, setNotes] = useState<string>(() =>
    typeof initialPayload.notes === "string" ? initialPayload.notes : "",
  );
  const [isSubmitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isReadOnly = topicStatus !== "drafting" && topicStatus !== "revising";

  const autosave = useAutosaveDraft({
    topicId,
    taskId,
    readOnly: isReadOnly,
  });

  // Read-only context: the prompt + the single model response under review.
  const prompt = safeString(
    (itemData as { prompt?: unknown }).prompt,
    "(no prompt)",
  );
  const response = (itemData.response ?? {}) as {
    modelName?: unknown;
    content?: unknown;
  };
  const modelName = safeString(response.modelName, "Model");
  const responseBody = safeString(response.content, "(no response)");
  const ctx = safeString((itemData as { context?: unknown }).context, "");

  // On mount, restore a fresher local draft (crash / tab-close before the
  // debounced server save). Merge over current state by id so we don't
  // clobber an already-loaded server payload with an older local one.
  useEffect(() => {
    if (isReadOnly) return;
    let cancelled = false;
    void (async () => {
      const local = await autosave.restoreLocal();
      if (cancelled || !local) return;
      if (typeof local.notes === "string") setNotes(local.notes);
      const localItems = initialRubricItems(local);
      if (localItems.length > 0) setRubricItems(localItems);
      const localJudgments = initialJudgments(local);
      if (Object.keys(localJudgments).length > 0) {
        setJudgments(localJudgments);
      }
      const localVerdict = initialVerdict(local);
      if (localVerdict) setOverallVerdict(localVerdict);
    })();
    return () => {
      cancelled = true;
    };
    // restoreLocal is stable enough — we only want this on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, isReadOnly]);

  // Completion gate: at least one criterion, every authored criterion judged,
  // and an overall verdict picked.
  const judgedCount = rubricItems.filter(
    (it) => judgments[it.id] === "pass" || judgments[it.id] === "fail",
  ).length;
  const allJudged = rubricItems.length > 0 && judgedCount === rubricItems.length;
  const canSubmit =
    rubricItems.length > 0 && allJudged && overallVerdict !== null;

  function markDirty(next: {
    items?: RubricItem[];
    judg?: JudgmentsState;
    verdict?: Judgment | null;
  }) {
    autosave.markDirty(
      buildDraftPayload(
        next.items ?? rubricItems,
        next.judg ?? judgments,
        next.verdict === undefined ? overallVerdict : next.verdict,
        notes,
      ),
    );
  }

  function setItemJudgment(itemId: string, value: Judgment) {
    setJudgments((prev) => {
      const next = { ...prev, [itemId]: value };
      markDirty({ judg: next });
      return next;
    });
  }

  function setVerdict(value: Judgment) {
    setOverallVerdict(value);
    markDirty({ verdict: value });
  }

  function addRubricItem(name: string, description: string, expectation: string) {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (rubricItems.length >= 20) {
      setError("A rubric can have at most 20 criteria.");
      return;
    }
    const id = newCustomId(trimmedName);
    const next: RubricItem[] = [
      ...rubricItems,
      {
        id,
        name: trimmedName,
        description: description.trim() || undefined,
        expectation: expectation.trim() || undefined,
      },
    ];
    setRubricItems(next);
    markDirty({ items: next });
  }

  function removeRubricItem(id: string) {
    const nextItems = rubricItems.filter((c) => c.id !== id);
    const nextJudg = { ...judgments };
    delete nextJudg[id];
    setRubricItems(nextItems);
    setJudgments(nextJudg);
    markDirty({ items: nextItems, judg: nextJudg });
  }

  /**
   * Draft payload — used for autosave + AI 预检. Keeps the same shape as
   * the submit payload but tolerates an unset verdict (drafts are allowed
   * to be incomplete; the server schema only runs on submit).
   */
  function buildDraftPayload(
    items: RubricItem[],
    judg: JudgmentsState,
    verdict: Judgment | null,
    noteText: string,
  ): Record<string, unknown> {
    const judgmentsOut: JudgmentsState = {};
    for (const it of items) {
      const v = judg[it.id];
      if (v === "pass" || v === "fail") judgmentsOut[it.id] = v;
    }
    return {
      rubricItems: items.map((it) => ({
        id: it.id,
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
        ...(it.expectation ? { expectation: it.expectation } : {}),
      })),
      judgments: judgmentsOut,
      ...(verdict ? { overallVerdict: verdict } : {}),
      ...(noteText.trim() ? { notes: noteText.trim() } : {}),
    };
  }

  /**
   * Submit payload — EXACTLY the registered responseSchema shape.
   * `judgments` includes only ids the expert actually decided (which, at
   * the submit gate, is all of them).
   */
  function buildPayload(): Record<string, unknown> {
    return buildDraftPayload(rubricItems, judgments, overallVerdict, notes);
  }

  async function saveDraft() {
    if (isReadOnly) return;
    setError(null);
    await autosave.flush(buildPayload());
  }

  function submit() {
    if (isReadOnly) return;
    if (rubricItems.length === 0) {
      setError("Add at least one rubric criterion before submitting.");
      return;
    }
    if (!allJudged) {
      setError(
        `Judge every criterion pass/fail (${judgedCount}/${rubricItems.length}).`,
      );
      return;
    }
    if (overallVerdict === null) {
      setError("Pick an overall verdict (pass / fail) before submitting.");
      return;
    }
    setError(null);
    startSubmit(async () => {
      try {
        await submitAnnotation({
          topicId,
          payload: buildPayload(),
        });
        // No refresh() after push — it aborts the in-flight push
        // navigation on slow links (see after-submit-nav.ts).
        router.push(`/my/tasks/${taskId}`);
      } catch (e) {
        setError(getErrorMessage(e, "Submit failed."));
      }
    });
  }

  return (
    <>
      {/* ── READ-ONLY context: breadcrumb + prompt + single response ── */}
      <header className="border-b border-[var(--line)] pb-6 mb-6">
        <div className="flex items-center gap-3 ts-12 mono mb-3">
          <Link
            href={`/workspaces/${workspaceId}`}
            className="hover:underline"
            style={{ color: "var(--mute)" }}
          >
            {workspaceName}
          </Link>
          <span style={{ color: "var(--mute2)" }}>·</span>
          <span style={{ color: "var(--text)" }}>{taskName}</span>
          <span
            className="ts-11 mono ml-auto px-2 py-0.5 rounded"
            style={{
              color: "var(--accent)",
              background: "oklch(0.6 0.18 280 / 0.1)",
              border: "1px solid oklch(0.6 0.18 280 / 0.25)",
              letterSpacing: "0.06em",
            }}
          >
            RUBRIC JUDGMENT
          </span>
        </div>

        <div className="mb-4">
          <div className="lbl mb-1.5">§ PROMPT</div>
          <p
            className="ts-14"
            style={{
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              lineHeight: 1.55,
            }}
          >
            {prompt}
          </p>
          {ctx && (
            <details className="mt-2">
              <summary
                className="ts-12 mono cursor-pointer"
                style={{ color: "var(--mute2)" }}
              >
                show context
              </summary>
              <pre
                className="ts-12 mt-2 p-3 rounded"
                style={{
                  background: "var(--panel2)",
                  border: "1px solid var(--line)",
                  color: "var(--mute)",
                  whiteSpace: "pre-wrap",
                  overflowX: "auto",
                }}
              >
                {ctx}
              </pre>
            </details>
          )}
        </div>

        <div>
          <div className="lbl mb-1.5">§ RESPONSE UNDER REVIEW</div>
          <div
            className="rounded-md"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              overflow: "hidden",
            }}
          >
            <div
              className="px-3 py-2 flex items-center gap-2"
              style={{
                borderBottom: "1px solid var(--line)",
                background: "var(--panel2)",
              }}
            >
              <span
                className="ts-12 mono"
                style={{ color: "var(--mute)" }}
              >
                {modelName}
              </span>
            </div>
            <div
              className="px-3 py-3 ts-13"
              style={{
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.55,
                maxHeight: 480,
                overflowY: "auto",
              }}
            >
              {responseBody}
            </div>
          </div>
        </div>
      </header>

      {/* ── AUTHORED rubric + per-criterion pass/fail ── */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div className="lbl">§ RUBRIC · YOU AUTHOR · PASS / FAIL EACH</div>
          <div className="ts-11 mono" style={{ color: "var(--mute2)" }}>
            {judgedCount}/{rubricItems.length} judged
          </div>
        </div>

        <div
          className="rounded-md overflow-x-auto"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          {rubricItems.length === 0 ? (
            <div
              className="ts-13 px-4 py-6 text-center"
              style={{ color: "var(--mute2)" }}
            >
              No criteria yet — add the concrete pass/fail checks this response
              should satisfy for this prompt.
            </div>
          ) : (
            <table className="w-full min-w-[640px] ts-13">
              <thead>
                <tr
                  style={{
                    background: "var(--panel2)",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <th
                    className="text-left px-4 py-2.5 mono ts-11"
                    style={{ color: "var(--mute)", fontWeight: 500 }}
                  >
                    CRITERION
                  </th>
                  <th
                    className="px-4 py-2.5 mono ts-11"
                    style={{ color: "var(--mute)", width: 180 }}
                  >
                    JUDGMENT
                  </th>
                </tr>
              </thead>
              <tbody>
                {rubricItems.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{
                      borderTop: idx === 0 ? "none" : "1px solid var(--line)",
                    }}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span
                          className="ts-13"
                          style={{ color: "var(--text)", fontWeight: 500 }}
                        >
                          {item.name}
                        </span>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => removeRubricItem(item.id)}
                            className="ts-11 mono"
                            style={{
                              background: "transparent",
                              color: "var(--mute2)",
                              border: "none",
                              cursor: "pointer",
                              padding: "2px 4px",
                            }}
                            title="Remove this criterion"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {item.description && (
                        <div
                          className="ts-12 mt-0.5"
                          style={{ color: "var(--mute2)" }}
                        >
                          {item.description}
                        </div>
                      )}
                      {item.expectation && (
                        <div
                          className="ts-12 mt-1 flex items-start gap-1.5"
                          style={{ color: "var(--mute)" }}
                        >
                          <span
                            className="mono ts-11 shrink-0"
                            style={{ color: "oklch(0.5 0.13 150)" }}
                            title="What a PASS looks like for this criterion"
                          >
                            PASS=
                          </span>
                          <span>{item.expectation}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center align-middle">
                      <PassFailToggle
                        value={judgments[item.id] ?? null}
                        onChange={(v) => setItemJudgment(item.id, v)}
                        readOnly={isReadOnly}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!isReadOnly && (
            <RubricCriterionAdder
              onAdd={addRubricItem}
              atMax={rubricItems.length >= 20}
            />
          )}
        </div>

        {/* ── OVERALL verdict ── */}
        <div className="mt-6">
          <div className="lbl mb-2">§ OVERALL VERDICT</div>
          <div
            className="rounded-md p-4 flex items-center gap-3 flex-wrap"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
            }}
          >
            <span className="ts-13" style={{ color: "var(--mute)" }}>
              Does the response pass overall?
            </span>
            <PassFailToggle
              value={overallVerdict}
              onChange={(v) => setVerdict(v)}
              readOnly={isReadOnly}
              large
            />
            {overallVerdict === null && (
              <span className="ts-12 mono" style={{ color: "var(--mute2)" }}>
                required
              </span>
            )}
          </div>
        </div>

        {/* ── notes ── */}
        <div className="mt-4">
          <label className="lbl mb-1.5 block">notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => {
              // Local state changes per keystroke (cheap, render-only) but
              // the autosave only fires when the user blurs the field —
              // AGENTS.md hard rule: NEVER save on keystroke.
              setNotes(e.target.value);
            }}
            onBlur={() => void saveDraft()}
            disabled={isReadOnly}
            rows={3}
            maxLength={2000}
            placeholder="Rationale for your verdict — edge cases, why a borderline criterion passed/failed, etc."
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--line)",
              color: "var(--text)",
              outline: "none",
              resize: "vertical",
              fontFamily: "var(--font-geist-sans), system-ui",
            }}
          />
        </div>

        {error && (
          <div
            className="ts-12 mono mt-3 p-2 rounded"
            style={{
              background: "var(--danger-soft)",
              border: "1px solid oklch(0.55 0.2 25 / 0.35)",
              color: "var(--danger)",
            }}
          >
            {error}
          </div>
        )}

        <AIPrecheckButton
          topicId={topicId}
          buildDraft={buildPayload}
          disabled={isReadOnly}
        />

        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <button
            onClick={saveDraft}
            disabled={isReadOnly || autosave.status === "saving"}
            className="ts-13 mono"
            style={{
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "6px 14px",
              cursor: isReadOnly ? "not-allowed" : "pointer",
              opacity: isReadOnly || autosave.status === "saving" ? 0.5 : 1,
            }}
          >
            {autosave.status === "saving" ? "saving…" : "save now"}
          </button>
          <button
            onClick={submit}
            disabled={isReadOnly || isSubmitting || !canSubmit}
            className="ts-13 mono"
            style={{
              background: "var(--accent)",
              color: "white",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              padding: "6px 14px",
              fontWeight: 500,
              cursor: isReadOnly || !canSubmit ? "not-allowed" : "pointer",
              opacity: isReadOnly || isSubmitting || !canSubmit ? 0.5 : 1,
            }}
          >
            {isSubmitting ? "submitting…" : "submit"}
          </button>
          <AutosaveBadge
            status={autosave.status}
            lastSavedAt={autosave.lastSavedAt}
            errorMessage={autosave.errorMessage}
          />
          {isReadOnly && (
            <span
              className="ts-12 mono ml-auto px-2 py-0.5 rounded"
              style={{
                background: "var(--panel2)",
                border: "1px solid var(--line)",
                color: "var(--mute)",
              }}
            >
              {topicStatus.toUpperCase()} — read-only
            </span>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * Compact autosave status badge for the action row. Mirrors pair-rubric's
 * badge so both forms surface save state identically.
 */
function AutosaveBadge({
  status,
  lastSavedAt,
  errorMessage,
}: {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  errorMessage: string | null;
}) {
  const label = autosaveStatusLabel(status, lastSavedAt);
  const palette: Record<AutosaveStatus, { fg: string; bg: string }> = {
    idle: { fg: "var(--mute2)", bg: "transparent" },
    dirty: {
      fg: "oklch(0.55 0.14 75)",
      bg: "oklch(0.6 0.14 75 / 0.1)",
    },
    saving: { fg: "var(--accent)", bg: "var(--accent-soft)" },
    saved: {
      fg: "oklch(0.5 0.13 150)",
      bg: "oklch(0.5 0.13 150 / 0.1)",
    },
    error: { fg: "var(--danger)", bg: "var(--danger-soft)" },
  };
  const p = palette[status];
  return (
    <span
      className="ts-11 mono ml-auto px-2 py-0.5 rounded inline-flex items-center gap-1"
      style={{
        color: p.fg,
        background: p.bg,
        border: status === "idle" ? "none" : `1px solid ${p.fg}33`,
      }}
      title={
        status === "error" && errorMessage
          ? `${errorMessage} — your changes are still safe in your browser; reload the page to retry.`
          : status === "dirty"
            ? "Unsaved changes — auto-save fires in ~1 second. Local backup is already saved in your browser."
            : undefined
      }
    >
      {label || (status === "idle" ? "·" : status)}
    </span>
  );
}

/**
 * Pass / fail toggle. Green for pass, danger for fail — mirrors the
 * yes/no toggle styling in pair-rubric but with verdict semantics.
 */
function PassFailToggle({
  value,
  onChange,
  readOnly,
  large,
}: {
  value: Judgment | null;
  onChange: (v: Judgment) => void;
  readOnly?: boolean;
  large?: boolean;
}) {
  const passColor = "oklch(0.55 0.16 150)";
  const minWidth = large ? 72 : 56;
  const padding = large ? "6px 16px" : "4px 12px";
  return (
    <div className="inline-flex gap-1.5">
      <button
        type="button"
        onClick={() => onChange("pass")}
        disabled={readOnly}
        className="mono ts-12"
        style={{
          minWidth,
          padding,
          borderRadius: 5,
          fontWeight: 500,
          background: value === "pass" ? passColor : "transparent",
          color: value === "pass" ? "white" : passColor,
          border: `1px solid ${value === "pass" ? passColor : `${passColor}66`}`,
          cursor: readOnly ? "not-allowed" : "pointer",
          opacity: readOnly ? 0.6 : 1,
        }}
      >
        pass
      </button>
      <button
        type="button"
        onClick={() => onChange("fail")}
        disabled={readOnly}
        className="mono ts-12"
        style={{
          minWidth,
          padding,
          borderRadius: 5,
          fontWeight: 500,
          background: value === "fail" ? "var(--danger)" : "transparent",
          color: value === "fail" ? "white" : "var(--mute)",
          border: `1px solid ${value === "fail" ? "var(--danger)" : "var(--line)"}`,
          cursor: readOnly ? "not-allowed" : "pointer",
          opacity: readOnly ? 0.6 : 1,
        }}
      >
        fail
      </button>
    </div>
  );
}

/**
 * Inline "+ add rubric criterion" row. Built specifically for
 * rubric-judgment because criteria carry an extra `expectation` field
 * (what a PASS looks like) that the shared AddCustomItemRow doesn't
 * surface. Visual conventions match AddCustomItemRow exactly: collapsed
 * "+ add" chip → expands to name / description / expectation inputs;
 * stays open after each add so multiple adds are quick.
 */
function RubricCriterionAdder({
  onAdd,
  atMax,
}: {
  onAdd: (name: string, description: string, expectation: string) => void;
  atMax: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [expectation, setExpectation] = useState("");

  function submit() {
    if (!name.trim()) return;
    onAdd(name.trim(), desc.trim(), expectation.trim());
    setName("");
    setDesc("");
    setExpectation("");
    // Leave the row open so multiple adds are quick.
  }

  if (atMax) {
    return (
      <div
        className="mono ts-12 mt-2 px-3 py-2"
        style={{ color: "var(--mute2)" }}
      >
        rubric limit reached (20 criteria)
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mono ts-12 mt-2"
        style={{
          background: "transparent",
          color: "var(--accent)",
          border: "1px dashed oklch(0.6 0.18 280 / 0.4)",
          borderRadius: 5,
          padding: "6px 12px",
          cursor: "pointer",
        }}
      >
        + add rubric criterion
      </button>
    );
  }

  return (
    <div
      className="rounded-md p-3 mt-2"
      style={{
        background: "var(--bg)",
        border: "1px dashed oklch(0.6 0.18 280 / 0.4)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="lbl" style={{ color: "var(--accent)" }}>
          + NEW RUBRIC CRITERION
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
            setDesc("");
            setExpectation("");
          }}
          className="ts-11 mono ml-auto"
          style={{
            color: "var(--mute2)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          cancel
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder='e.g. "cites a source" — short label, judged pass/fail'
        maxLength={120}
        className="w-full px-3 py-1.5 ts-13 rounded-md mb-2"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line)",
          color: "var(--text)",
          outline: "none",
        }}
      />
      <input
        type="text"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="description (optional) — what specifically does this check mean?"
        maxLength={400}
        className="w-full px-3 py-1.5 ts-12 rounded-md mb-2"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line)",
          color: "var(--text)",
          outline: "none",
        }}
      />
      <input
        type="text"
        value={expectation}
        onChange={(e) => setExpectation(e.target.value)}
        placeholder="expectation (optional) — what a PASS looks like for this criterion"
        maxLength={400}
        className="w-full px-3 py-1.5 ts-12 rounded-md mb-2"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line)",
          color: "var(--text)",
          outline: "none",
        }}
      />
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          className="ts-12 mono"
          style={{
            background: "var(--accent)",
            color: "white",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            padding: "4px 12px",
            fontWeight: 500,
            cursor: name.trim() ? "pointer" : "not-allowed",
            opacity: name.trim() ? 1 : 0.5,
          }}
        >
          add
        </button>
      </div>
    </div>
  );
}

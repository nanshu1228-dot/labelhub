"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Coins,
  FileText,
  Gauge,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { createTask } from "@/lib/actions/tasks";
import type {
  ConditionalDisplay,
  PairChecklistItem,
  TemplateMode,
} from "@/lib/templates/types";
import type { RubricItem, RubricSpec } from "@/lib/templates/rubric";
import {
  sameRubricItem,
  formatShowWhen,
  parseTags,
  inputStyle,
  inlineInputStyle,
  type EditableRubricItem,
  type TaskCreateDistributionStrategy,
} from "./create-task-form-helpers";
import { getErrorMessage } from "@/lib/errors/client-utils";
import {
  useRubricEditor,
  useTrajectoryRubricEditor,
  useRubricGenerator,
} from "./create-task-form-hooks";
import {
  Snapshot,
  Field,
  GuidelinesMarkdownEditor,
  TrajRubricSubsection,
  GenerateModal,
} from "./create-task-form-parts";

/**
 * Admin task-creation form.
 *
 * The Owner configures task basics, deadline, payout baseline, and the
 * template-specific rubric/form binding before importing rows and publishing.
 * Pure helpers + types live in `./create-task-form-helpers`; the
 * self-contained subcomponents (Field, GuidelinesMarkdownEditor,
 * TrajRubricSubsection, GenerateModal, …) live in `./create-task-form-parts`.
 *
 * Rubric editing:
 *   - pair-rubric / arena-gsb: shows the template's preset list as the
 *     starting point. Admin can rename, edit descriptions, delete, or
 *     append new items. Submit ships `templateConfig` to the server,
 *     which validates snake_case ids + 30-item cap.
 *   - agent-trace-eval: hides the rubric editor (the flagship's rubric
 *     is multi-shaped and not exposed to per-task overrides yet).
 */
export function CreateTaskForm({
  workspaceId,
  workspaceName,
  templateMode,
  templateName,
  templateDescription,
  defaultPairChecklist,
  defaultArenaDimensions,
  defaultTrajectoryRubric,
  customFormSchemas = [],
}: {
  workspaceId: string;
  workspaceName: string;
  templateMode: TemplateMode;
  templateName: string;
  templateDescription: string;
  defaultPairChecklist: readonly PairChecklistItem[] | null;
  defaultArenaDimensions: readonly PairChecklistItem[] | null;
  defaultTrajectoryRubric: RubricSpec | null;
  customFormSchemas?: Array<{
    id: string;
    label: string;
    version: number;
    isTemplate: boolean;
    createdAt: Date;
  }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [rewardAmount, setRewardAmount] = useState<string>("10");
  const [currency, setCurrency] = useState<string>("CNY");
  const [qualityMultiplierMin, setQualityMultiplierMin] =
    useState<string>("1.0");
  const [qualityMultiplierMax, setQualityMultiplierMax] = useState<string>(
    templateMode === "arena-gsb" ? "1.8" : "1.5",
  );
  const [deadlineLocal, setDeadlineLocal] = useState<string>("");
  const [phase, setPhase] = useState<string>("1");
  const [tagsText, setTagsText] = useState<string>("");
  const [quotaTotal, setQuotaTotal] = useState<string>("");
  const [distributionStrategy, setDistributionStrategy] =
    useState<TaskCreateDistributionStrategy>("open-queue");
  const [formSchemaId, setFormSchemaId] = useState<string>(
    customFormSchemas[0]?.id ?? "",
  );

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const supportsTrajectoryEditor = templateMode === "agent-trace-eval";
  const supportsCustomDesigner = templateMode === "custom-designer";
  const supportsRubricEditor =
    templateMode === "pair-rubric" || templateMode === "arena-gsb";

  // Rubric editing, trajectory-rubric editing, and the 🪄 NL→rubric generator
  // live in co-located hooks (./create-task-form-hooks) so this orchestrator
  // stays a focused form shell. Pure relocation — behavior is unchanged. The
  // generator writes INTO the two editors, so it takes their setters.
  const {
    items,
    setItems,
    setItem,
    removeItem,
    addItem,
    restoreDefaults,
    initialChecklist,
  } = useRubricEditor({
    templateMode,
    defaultPairChecklist,
    defaultArenaDimensions,
  });
  const {
    trajPerStep,
    trajPerTraj,
    setTrajPerStep,
    setTrajPerTraj,
    setTrajItem,
    removeTrajItem,
    restoreTrajDefaults,
    initialTrajRubric,
  } = useTrajectoryRubricEditor({ defaultTrajectoryRubric });
  const {
    genOpen,
    setGenOpen,
    genDescription,
    setGenDescription,
    genPending,
    genError,
    setGenError,
    genSummary,
    setGenSummary,
    generateFromDescription,
  } = useRubricGenerator({
    workspaceId,
    templateMode,
    supportsRubricEditor,
    supportsTrajectoryEditor,
    setItems,
    setTrajPerStep,
    setTrajPerTraj,
  });

  const fieldLabel =
    templateMode === "pair-rubric"
      ? "rubric items (yes/no)"
      : "dimensions (1–5)";
  const selectedFormSchema = customFormSchemas.find(
    (schema) => schema.id === formSchemaId,
  );
  const amountPreview = Number(rewardAmount);
  const multiplierPreview =
    qualityMultiplierMin.trim() && qualityMultiplierMax.trim()
      ? `${qualityMultiplierMin.trim()}x–${qualityMultiplierMax.trim()}x`
      : "Not set";
  const deadlinePreview = deadlineLocal
    ? deadlineLocal.replace("T", " ")
    : "Not set";
  const tagsPreview = parseTags(tagsText).join(", ") || "No tags";
  const quotaPreview = quotaTotal.trim() || "Open";

  function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Task name is required.");
      return;
    }
    const amountNumeric = Number(rewardAmount);
    if (!Number.isFinite(amountNumeric) || amountNumeric < 0) {
      setError("Reward amount must be a non-negative number.");
      return;
    }
    const phaseNumeric = Number(phase);
    if (!Number.isInteger(phaseNumeric) || phaseNumeric <= 0) {
      setError("Phase must be a positive whole number.");
      return;
    }
    const currencyCode = currency.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(currencyCode)) {
      setError("Currency must be 2–8 uppercase letters or digits.");
      return;
    }
    const tags = parseTags(tagsText);
    if (tags.length > 12) {
      setError("Use at most 12 task tags.");
      return;
    }
    const quotaNumeric =
      quotaTotal.trim().length > 0 ? Number(quotaTotal) : undefined;
    if (
      quotaNumeric !== undefined &&
      (!Number.isInteger(quotaNumeric) || quotaNumeric <= 0)
    ) {
      setError("Quota must be a positive whole number.");
      return;
    }
    const multiplierMin = Number(qualityMultiplierMin);
    const multiplierMax = Number(qualityMultiplierMax);
    if (
      !Number.isFinite(multiplierMin) ||
      !Number.isFinite(multiplierMax) ||
      multiplierMin <= 0 ||
      multiplierMax <= 0 ||
      multiplierMax < multiplierMin
    ) {
      setError("Quality multiplier range must be positive and ordered.");
      return;
    }
    let deadlineIso: string | undefined;
    if (deadlineLocal.trim().length > 0) {
      const deadlineDate = new Date(deadlineLocal);
      if (Number.isNaN(deadlineDate.getTime())) {
        setError("Deadline must be a valid date and time.");
        return;
      }
      deadlineIso = deadlineDate.toISOString();
    }

    let templateConfig:
      | {
          pairChecklist?: PairChecklistItem[];
          arenaDimensions?: PairChecklistItem[];
          rubric?: RubricSpec;
          formSchemaId?: string;
          taskSettings?: {
            tags?: string[];
            quotaTotal?: number;
            distributionStrategy?: TaskCreateDistributionStrategy;
          };
        }
      | undefined;
    if (supportsRubricEditor) {
      const cleaned: PairChecklistItem[] = [];
      for (const it of items) {
        const idTrim = it.id.trim();
        const nameTrim = it.name.trim();
        if (!idTrim && !nameTrim) continue; // skip empty rows
        if (!/^[a-z][a-z0-9_]*$/.test(idTrim)) {
          setError(
            `Item id "${idTrim || "(blank)"}" must be lowercase snake_case (letters, digits, underscore; start with a letter).`,
          );
          return;
        }
        if (!nameTrim) {
          setError(`Item "${idTrim}" needs a display name.`);
          return;
        }
        cleaned.push({
          id: idTrim,
          name: nameTrim,
          description: it.description?.trim() || undefined,
          // Preserve conditional follow-up from AI generation or
          // restore-defaults. The form doesn't yet expose direct
          // editing of showWhen — admins curate it via the modal +
          // delete-row workflow.
          showWhen: it.showWhen,
        });
      }
      if (cleaned.length === 0) {
        setError("Add at least one rubric item.");
        return;
      }
      const ids = cleaned.map((c) => c.id);
      if (new Set(ids).size !== ids.length) {
        setError("Rubric item ids must be unique.");
        return;
      }
      templateConfig =
        templateMode === "pair-rubric"
          ? { pairChecklist: cleaned }
          : { arenaDimensions: cleaned };
      // Only ship the override if it actually differs from the preset —
      // saves a row of JSON in the DB and is honest about "default".
      // Compares showWhen too: a rubric that swaps a default item for a
      // conditional follow-up is NOT preset-equal even if the surface
      // text matches.
      const sameCondition = (
        a: ConditionalDisplay | undefined,
        b: ConditionalDisplay | undefined,
      ) => {
        if (!a && !b) return true;
        if (!a || !b) return false;
        return a.parentId === b.parentId && a.when === b.when;
      };
      const presetEqual =
        cleaned.length === initialChecklist.length &&
        cleaned.every((c, i) => {
          const p = initialChecklist[i];
          return (
            p.id === c.id &&
            p.name === c.name &&
            (p.description ?? undefined) === c.description &&
            sameCondition(p.showWhen, c.showWhen)
          );
        });
      if (presetEqual) templateConfig = undefined;
    }

    // Trajectory rubric override: only shipped when at least one
    // editable name/description (or item count) differs from the
    // template default. Validation here is minimal — server-side
    // `effective.parseConfig` runs the strict rubricSpecSchema and
    // falls back to defaults on bad shapes.
    if (supportsTrajectoryEditor) {
      const stripKey = (it: EditableRubricItem): RubricItem => {
        const { _key: _ignore, ...rest } = it;
        void _ignore;
        return rest;
      };
      const candidatePerStep = trajPerStep.map(stripKey);
      const candidatePerTraj = trajPerTraj.map(stripKey);
      // Sanity: require unique ids in each list AND across lists
      // (per-step and per-trajectory share a storage namespace).
      const allIds = [
        ...candidatePerStep.map((i) => i.id),
        ...candidatePerTraj.map((i) => i.id),
      ];
      if (new Set(allIds).size !== allIds.length) {
        setError(
          "Trajectory rubric item ids must be unique across perStep and perTrajectory.",
        );
        return;
      }
      // Skip if identical to the template default (avoid storing
      // a redundant override row).
      const sameAsDefault =
        candidatePerStep.length === initialTrajRubric.perStep.length &&
        candidatePerTraj.length === initialTrajRubric.perTrajectory.length &&
        candidatePerStep.every((c, i) =>
          sameRubricItem(c, initialTrajRubric.perStep[i]),
        ) &&
        candidatePerTraj.every((c, i) =>
          sameRubricItem(c, initialTrajRubric.perTrajectory[i]),
        );
      if (!sameAsDefault) {
        templateConfig = templateConfig ?? {};
        templateConfig.rubric = {
          perStep: candidatePerStep,
          perTrajectory: candidatePerTraj,
        };
      }
    }

    templateConfig = templateConfig ?? {};
    templateConfig.taskSettings = {
      tags,
      quotaTotal: quotaNumeric,
      distributionStrategy,
    };

    if (supportsCustomDesigner) {
      if (customFormSchemas.length === 0) {
        setError(
          "Create and save a Designer schema before creating a custom-designer task.",
        );
        return;
      }
      if (!formSchemaId) {
        setError("Pick the form schema this task should render.");
        return;
      }
      templateConfig = { ...templateConfig, formSchemaId };
    }

    setError(null);
    startTransition(async () => {
      try {
        const task = await createTask({
          workspaceId,
          name: trimmedName,
          description: description.trim() || undefined,
          guidelinesMarkdown: guidelines.trim() || undefined,
          templateMode,
          rewardConfig: {
            type: "cash-per-item",
            currency: currencyCode,
            baseAmountMinor: Math.round(amountNumeric * 100),
            qualityMultiplierMin: multiplierMin,
            qualityMultiplierMax: multiplierMax,
          },
          templateConfig,
          phase: phaseNumeric,
          deadline: deadlineIso,
        });
        router.push(`/workspaces/${workspaceId}/tasks/${task.id}`);
      } catch (e) {
        setError(getErrorMessage(e, "Create task failed."));
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 ts-12 mono mb-3">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="hover:underline"
          style={{ color: "var(--mute)" }}
        >
          {workspaceName}
        </Link>
        <span style={{ color: "var(--mute2)" }}>·</span>
        <span style={{ color: "var(--text)" }}>new task</span>
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="lbl mb-2">OWNER TASK SETUP</div>
          <h1
            className="ts-22 mb-2"
            style={{ color: "var(--hi)", fontWeight: 650 }}
          >
            Configure a labeling task
          </h1>
          <p className="ts-13" style={{ color: "var(--mute)" }}>
            <span className="mono" style={{ color: "var(--accent)" }}>
              {templateName}
            </span>{" "}
            · {templateDescription}
          </p>
        </div>
        <aside
          className="rounded-md p-4"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="lbl">SETUP SNAPSHOT</div>
            <Gauge size={16} style={{ color: "var(--accent)" }} />
          </div>
          <div className="grid gap-2">
            <Snapshot label="Template" value={templateMode} />
            <Snapshot
              label="Schema"
              value={
                supportsCustomDesigner
                  ? (selectedFormSchema?.label ?? "Pick schema")
                  : fieldLabel
              }
            />
            <Snapshot
              label="Reward"
              value={
                rewardAmount.trim().length > 0 && Number.isFinite(amountPreview)
                  ? `${currency.trim().toUpperCase() || "CNY"} ${amountPreview.toFixed(2)}`
                  : "Not set"
              }
            />
            <Snapshot label="Quality" value={multiplierPreview} />
            <Snapshot label="Deadline" value={deadlinePreview} />
            <Snapshot label="Quota" value={quotaPreview} />
            <Snapshot label="Tags" value={tagsPreview} />
          </div>
        </aside>
      </div>

      <section
        className="mb-6 rounded-md p-4"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <FileText size={15} style={{ color: "var(--accent)" }} />
          <div className="lbl">BASICS</div>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_220px]">
          <Field label="Name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Phase 1 · Open-Domain Q&A"
              className="w-full px-3 py-2 ts-13 rounded-md"
              style={inputStyle}
            />
          </Field>
          <Field label="Phase">
            <input
              type="number"
              min="1"
              step="1"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
          <Field label="Deadline">
            <input
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
        </div>
        <Field label="Description (admin-only context)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="What this task is for. Helps when you have multiple phases running."
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={inputStyle}
          />
        </Field>
        <GuidelinesMarkdownEditor
          value={guidelines}
          onChange={setGuidelines}
        />
      </section>

      <section
        className="mb-6 rounded-md p-4"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Gauge size={15} style={{ color: "var(--accent)" }} />
          <div className="lbl">OPERATIONS</div>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_260px]">
          <Field label="Tags">
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              maxLength={240}
              placeholder="safety, medical, phase-1"
              className="w-full px-3 py-2 ts-13 rounded-md"
              style={inputStyle}
            />
          </Field>
          <Field label="Quota">
            <input
              type="number"
              min="1"
              step="1"
              value={quotaTotal}
              onChange={(e) => setQuotaTotal(e.target.value)}
              placeholder="open"
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
          <Field label="Distribution">
            <select
              value={distributionStrategy}
              onChange={(e) =>
                setDistributionStrategy(e.target.value as TaskCreateDistributionStrategy)
              }
              className="w-full px-3 py-2 ts-13 rounded-md"
              style={inputStyle}
            >
              <option value="open-queue">First come · open queue</option>
              <option value="round-robin">Assigned · round robin import</option>
              <option value="quota-by-annotator">
                Quota pool · capacity import
              </option>
            </select>
          </Field>
        </div>
      </section>

      <section
        className="mb-6 rounded-md p-4"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Coins size={15} style={{ color: "var(--accent)" }} />
          <div className="lbl">PAYOUT POLICY</div>
        </div>
        <div className="grid gap-3 md:grid-cols-[160px_120px_160px_160px]">
          <Field label="Reward / item">
            <input
              type="number"
              min="0"
              step="0.5"
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
          <Field label="Currency">
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={8}
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
          <Field label="Quality min">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={qualityMultiplierMin}
              onChange={(e) => setQualityMultiplierMin(e.target.value)}
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
          <Field label="Quality max">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={qualityMultiplierMax}
              onChange={(e) => setQualityMultiplierMax(e.target.value)}
              className="w-full px-3 py-2 ts-13 rounded-md mono"
              style={inputStyle}
            />
          </Field>
        </div>
      </section>

      {supportsCustomDesigner && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ FORM SCHEMA</div>
            <Link
              href="/admin/forms/new"
              className="ts-11 mono"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              + open Designer
            </Link>
          </div>
          <div
            className="rounded-md p-4"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
            }}
          >
            {customFormSchemas.length === 0 ? (
              <div>
                <div
                  className="ts-13"
                  style={{ color: "var(--hi)", fontWeight: 600 }}
                >
                  No saved Designer schemas in this workspace.
                </div>
                <p className="ts-12 mt-1" style={{ color: "var(--mute)" }}>
                  Custom-designer tasks render exactly one saved form schema.
                  Create a form first, then return here to bind it to the task.
                </p>
              </div>
            ) : (
              <Field label="Schema used by the Labeler workbench *">
                <select
                  value={formSchemaId}
                  onChange={(e) => setFormSchemaId(e.target.value)}
                  className="w-full px-3 py-2 ts-13 rounded-md"
                  style={inputStyle}
                >
                  {customFormSchemas.map((schema) => (
                    <option key={schema.id} value={schema.id}>
                      {schema.label} · v{schema.version}
                      {schema.isTemplate ? " · template" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </section>
      )}

      {supportsRubricEditor && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ {fieldLabel.toUpperCase()}</div>
            <div className="flex items-center gap-3 ts-11 mono">
              <button
                type="button"
                onClick={() => {
                  setGenOpen(true);
                  setGenError(null);
                }}
                className="ts-11 mono inline-flex items-center gap-1.5"
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  border: "1px dashed var(--accent-line)",
                  borderRadius: 4,
                  padding: "2px 10px",
                  cursor: "pointer",
                }}
                title="Describe the task in natural language and let Claude propose the rubric"
              >
                <Sparkles size={13} />
                generate
              </button>
              <button
                type="button"
                onClick={restoreDefaults}
                className="inline-flex items-center gap-1.5"
                style={{
                  color: "var(--mute2)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <RotateCcw size={13} />
                restore defaults
              </button>
              <button
                type="button"
                onClick={addItem}
                className="ts-11 mono inline-flex items-center gap-1.5"
                style={{
                  background: "transparent",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)",
                  borderRadius: 4,
                  padding: "2px 10px",
                  cursor: "pointer",
                }}
              >
                <Plus size={13} />
                add item
              </button>
            </div>
          </div>
          {genOpen && (
            <GenerateModal
              mode={templateMode}
              description={genDescription}
              setDescription={setGenDescription}
              pending={genPending}
              error={genError}
              summary={genSummary}
              onClose={() => {
                setGenOpen(false);
                setGenSummary(null);
              }}
              onGenerate={generateFromDescription}
            />
          )}
          <p className="ts-12 mb-3" style={{ color: "var(--mute2)" }}>
            Each item is asked twice — once for model A, once for model B. ID is
            the storage key (snake_case, never rename after rows exist).
          </p>
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
                    style={{ color: "var(--mute)", width: 180 }}
                  >
                    ID
                  </th>
                  <th
                    className="text-left px-3 py-2 mono ts-11"
                    style={{ color: "var(--mute)", width: 220 }}
                  >
                    NAME
                  </th>
                  <th
                    className="text-left px-3 py-2 mono ts-11"
                    style={{ color: "var(--mute)" }}
                  >
                    DESCRIPTION
                  </th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it._key}
                    style={{ borderTop: "1px solid var(--line)" }}
                  >
                    <td className="px-3 py-2">
                      <input
                        value={it.id}
                        onChange={(e) =>
                          setItem(it._key, { id: e.target.value })
                        }
                        placeholder="snake_case_id"
                        className="w-full px-2 py-1 mono ts-12"
                        style={inlineInputStyle}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={it.name}
                        onChange={(e) =>
                          setItem(it._key, { name: e.target.value })
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
                          setItem(it._key, { description: e.target.value })
                        }
                        placeholder="Optional one-liner"
                        className="w-full px-2 py-1 ts-13"
                        style={inlineInputStyle}
                      />
                      {it.showWhen && (
                        <div
                          className="ts-11 mono mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                            border: "1px solid var(--accent-line)",
                          }}
                          title="Conditional follow-up — only shown to raters when the parent answer matches"
                        >
                          <span>↳</span>
                          <span>
                            show when{" "}
                            {formatShowWhen(it.showWhen, templateMode)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(it._key)}
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
                      No items — click &quot;+ add item&quot; or &quot;restore
                      defaults&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {supportsTrajectoryEditor && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <div className="lbl">§ TRAJECTORY RUBRIC</div>
            <div className="flex items-center gap-3 ts-11 mono">
              <button
                type="button"
                onClick={() => {
                  setGenOpen(true);
                  setGenError(null);
                }}
                className="ts-11 mono inline-flex items-center gap-1.5"
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  border: "1px dashed var(--accent-line)",
                  borderRadius: 4,
                  padding: "2px 10px",
                  cursor: "pointer",
                }}
                title="Describe what raters should check; Claude generates the full per-step + per-trajectory rubric"
              >
                <Sparkles size={13} />
                generate
              </button>
              <button
                type="button"
                onClick={restoreTrajDefaults}
                className="inline-flex items-center gap-1.5"
                style={{
                  color: "var(--mute2)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <RotateCcw size={13} />
                restore defaults
              </button>
            </div>
          </div>
          {genOpen && (
            <GenerateModal
              mode={templateMode}
              description={genDescription}
              setDescription={setGenDescription}
              pending={genPending}
              error={genError}
              summary={genSummary}
              onClose={() => {
                setGenOpen(false);
                setGenSummary(null);
              }}
              onGenerate={generateFromDescription}
            />
          )}
          <p className="ts-12 mb-3" style={{ color: "var(--mute2)" }}>
            Two-tier: per-step questions asked once per matching step, and
            per-trajectory questions asked once for the whole trace. Names +
            descriptions are editable; scale and step-kind filters are set by
            the AI (regenerate to change them).
          </p>
          <TrajRubricSubsection
            heading="PER-STEP"
            list="perStep"
            items={trajPerStep}
            setItem={setTrajItem}
            removeItem={removeTrajItem}
            showAppliesTo
          />
          <TrajRubricSubsection
            heading="PER-TRAJECTORY"
            list="perTrajectory"
            items={trajPerTraj}
            setItem={setTrajItem}
            removeItem={removeTrajItem}
            showAppliesTo={false}
          />
        </section>
      )}

      {error && (
        <div
          className="ts-12 mono mb-4 p-2 rounded"
          style={{
            background: "var(--danger-soft)",
            border: "1px solid oklch(0.55 0.2 25 / 0.35)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link
          href={`/workspaces/${workspaceId}`}
          className="ts-13 mono"
          style={{
            color: "var(--mute)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "6px 14px",
            textDecoration: "none",
          }}
        >
          cancel
        </Link>
        <button
          onClick={submit}
          disabled={
            pending ||
            (supportsCustomDesigner && customFormSchemas.length === 0)
          }
          className="ts-13 mono"
          style={{
            background: "var(--accent)",
            color: "white",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            padding: "6px 14px",
            fontWeight: 500,
            cursor:
              pending ||
              (supportsCustomDesigner && customFormSchemas.length === 0)
                ? "not-allowed"
                : "pointer",
            opacity:
              pending ||
              (supportsCustomDesigner && customFormSchemas.length === 0)
                ? 0.5
                : 1,
          }}
        >
          {pending ? "creating…" : "create task"}
        </button>
      </div>
    </div>
  );
}

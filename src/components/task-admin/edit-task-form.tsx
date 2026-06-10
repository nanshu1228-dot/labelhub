"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Coins, FileText, Gauge } from "lucide-react";
import { updateTask } from "@/lib/actions/tasks";
import { getErrorMessage } from "@/lib/errors/client-utils";
import {
  parseTags,
  inputStyle,
  type TaskCreateDistributionStrategy,
} from "./create-task-form-helpers";
import { Field, GuidelinesMarkdownEditor } from "./create-task-form-parts";

/**
 * Admin task-EDIT form — change a task's base info after creation: name,
 * description, rich-text guidelines, payout policy, deadline, and
 * operational settings (tags / quota / distribution).
 *
 * Deliberately scoped to base/operational/payout fields. The annotation
 * paradigm (templateMode + rubric/checklist/formSchema) is fixed at create
 * time — editing it after rows exist would orphan submitted data — so it is
 * NOT shown here. Status changes go through the lifecycle actions on the task
 * page. The server action `updateTask` re-validates everything + commits the
 * patch and its audit event in one transaction.
 */
export function EditTaskForm({
  workspaceId,
  taskId,
  taskName,
  rewardType,
  initial,
}: {
  workspaceId: string;
  taskId: string;
  taskName: string;
  /** Preserve the task's payout type (cash-per-item / volunteer / …). */
  rewardType:
    | "cash-per-item"
    | "cash-per-hour"
    | "volunteer"
    | "token"
    | "rating-elo";
  initial: {
    name: string;
    description: string;
    guidelines: string;
    /** datetime-local value (YYYY-MM-DDTHH:mm), '' when no deadline. */
    deadlineLocal: string;
    rewardAmount: string;
    currency: string;
    qualityMultiplierMin: string;
    qualityMultiplierMax: string;
    tagsText: string;
    quotaTotal: string;
    distributionStrategy: TaskCreateDistributionStrategy;
    twoStageReview: boolean;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [guidelines, setGuidelines] = useState(initial.guidelines);
  const [deadlineLocal, setDeadlineLocal] = useState(initial.deadlineLocal);
  const [rewardAmount, setRewardAmount] = useState(initial.rewardAmount);
  const [currency, setCurrency] = useState(initial.currency);
  const [qualityMultiplierMin, setQualityMultiplierMin] = useState(
    initial.qualityMultiplierMin,
  );
  const [qualityMultiplierMax, setQualityMultiplierMax] = useState(
    initial.qualityMultiplierMax,
  );
  const [tagsText, setTagsText] = useState(initial.tagsText);
  const [quotaTotal, setQuotaTotal] = useState(initial.quotaTotal);
  const [distributionStrategy, setDistributionStrategy] =
    useState<TaskCreateDistributionStrategy>(initial.distributionStrategy);
  const [twoStageReview, setTwoStageReview] = useState(initial.twoStageReview);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      quotaTotal.trim().length > 0 ? Number(quotaTotal) : null;
    if (
      quotaNumeric !== null &&
      (!Number.isInteger(quotaNumeric) || quotaNumeric <= 0)
    ) {
      setError("Quota must be a positive whole number (or blank for open).");
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
    let deadlineIso: string | null = null;
    if (deadlineLocal.trim().length > 0) {
      const deadlineDate = new Date(deadlineLocal);
      if (Number.isNaN(deadlineDate.getTime())) {
        setError("Deadline must be a valid date and time.");
        return;
      }
      deadlineIso = deadlineDate.toISOString();
    }

    setError(null);
    startTransition(async () => {
      try {
        await updateTask({
          taskId,
          name: trimmedName,
          description: description.trim() || null,
          guidelinesMarkdown: guidelines.trim() || null,
          rewardConfig: {
            type: rewardType,
            currency: currencyCode,
            baseAmountMinor: Math.round(amountNumeric * 100),
            qualityMultiplierMin: multiplierMin,
            qualityMultiplierMax: multiplierMax,
          },
          deadline: deadlineIso,
          taskSettings: {
            tags,
            quotaTotal: quotaNumeric,
            distributionStrategy,
            twoStageReview,
          },
        });
        // No refresh() after push — it aborts the in-flight push
        // navigation on slow links (see after-submit-nav.ts).
        router.push(`/workspaces/${workspaceId}/tasks/${taskId}`);
      } catch (e) {
        setError(getErrorMessage(e, "Save task failed."));
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 ts-12 mono mb-3">
        <Link
          href={`/workspaces/${workspaceId}/tasks/${taskId}`}
          className="hover:underline"
          style={{ color: "var(--mute)" }}
        >
          {taskName}
        </Link>
        <span style={{ color: "var(--mute2)" }}>·</span>
        <span style={{ color: "var(--text)" }}>edit</span>
      </div>

      <div className="mb-6">
        <div className="lbl mb-2">OWNER TASK EDIT</div>
        <h1 className="ts-22 mb-2" style={{ color: "var(--hi)", fontWeight: 650 }}>
          Edit task base info
        </h1>
        <p className="ts-13" style={{ color: "var(--mute)" }}>
          Change name, guidelines, payout, deadline, and operational settings.
          The annotation paradigm and template are fixed once the task is
          created.
        </p>
      </div>

      <section
        className="mb-6 rounded-md p-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <div className="mb-3 flex items-center gap-2">
          <FileText size={15} style={{ color: "var(--accent)" }} />
          <div className="lbl">BASICS</div>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <Field label="Name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 ts-13 rounded-md"
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
            className="w-full px-3 py-2 ts-13 rounded-md"
            style={inputStyle}
          />
        </Field>
        <GuidelinesMarkdownEditor value={guidelines} onChange={setGuidelines} />
      </section>

      <section
        className="mb-6 rounded-md p-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
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
                setDistributionStrategy(
                  e.target.value as TaskCreateDistributionStrategy,
                )
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
        <label
          className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-md p-3"
          style={{ background: "var(--panel2)", border: "1px solid var(--line)" }}
        >
          <input
            type="checkbox"
            checked={twoStageReview}
            onChange={(e) => setTwoStageReview(e.target.checked)}
            className="mt-0.5"
            style={{ accentColor: "var(--accent)" }}
          />
          <span>
            <span className="ts-13" style={{ color: "var(--text)" }}>
              两段人工审核:初审(质检)→ 终审(验收)
            </span>
            <span className="ts-11 mt-0.5 block" style={{ color: "var(--mute)" }}>
              开启后,标注须先由质检初审通过,再由管理员终审入库;管理员不能从「待初审」直接验收。关闭则单段(管理员可直接验收)。
            </span>
          </span>
        </label>
      </section>

      <section
        className="mb-6 rounded-md p-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
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
        <p className="ts-11 mt-2" style={{ color: "var(--mute2)" }}>
          Reward changes apply to future approvals; already-paid items keep
          their original payout.
        </p>
      </section>

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
          href={`/workspaces/${workspaceId}/tasks/${taskId}`}
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
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? "saving…" : "save changes"}
        </button>
      </div>
    </div>
  );
}

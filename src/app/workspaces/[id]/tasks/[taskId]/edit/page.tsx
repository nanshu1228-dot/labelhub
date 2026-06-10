import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { optionalUser, requireWorkspaceMember } from "@/lib/auth/guards";
import { getTaskById } from "@/lib/queries/tasks";
import { readTaskOperationalSettings } from "@/lib/tasks/settings";
import { EditTaskForm } from "@/components/task-admin/edit-task-form";

export const metadata: Metadata = {
  title: "Edit task — LabelHub",
};

export const dynamic = "force-dynamic";

const REWARD_TYPES = [
  "cash-per-item",
  "cash-per-hour",
  "volunteer",
  "token",
  "rating-elo",
] as const;
type RewardType = (typeof REWARD_TYPES)[number];

/** Format a Date as a `datetime-local` value (YYYY-MM-DDTHH:mm) in the
 *  server's local timezone (CST in prod, matching the admin's locale). */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * /workspaces/[id]/tasks/[taskId]/edit
 *
 * Admin-only task base-info editor. Prefills name, description, guidelines,
 * payout, deadline, and operational settings from the current task; the
 * EditTaskForm posts to `updateTask`.
 */
export default async function EditTaskPage(props: {
  params: Promise<{ id: string; taskId: string }>;
}) {
  const { id: workspaceId, taskId } = await props.params;

  const me = await optionalUser();
  if (!me) {
    redirect(`/signin?next=/workspaces/${workspaceId}/tasks/${taskId}/edit`);
  }

  // Editing is admin-only. requireWorkspaceMember resolves the viewer's role
  // server-side; a non-admin (or non-member) gets a 404 rather than the form.
  let role: "admin" | "qc" | "annotator" | "viewer";
  try {
    role = (await requireWorkspaceMember(workspaceId)).role;
  } catch {
    notFound();
  }
  if (role !== "admin") notFound();

  const task = await getTaskById(taskId);
  if (!task || task.workspaceId !== workspaceId) notFound();
  if (task.status === "archived") {
    // Archived tasks are frozen storage; bounce back to the (read-only) detail.
    redirect(`/workspaces/${workspaceId}/tasks/${taskId}`);
  }

  const settings = readTaskOperationalSettings(task.templateConfig);
  const reward = (task.rewardConfig ?? {}) as {
    type?: string;
    currency?: string;
    baseAmountMinor?: number;
    qualityMultiplierMin?: number;
    qualityMultiplierMax?: number;
  };
  const rewardType: RewardType = REWARD_TYPES.includes(
    reward.type as RewardType,
  )
    ? (reward.type as RewardType)
    : "cash-per-item";

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[1280px]">
        <EditTaskForm
          workspaceId={workspaceId}
          taskId={taskId}
          taskName={task.name}
          rewardType={rewardType}
          initial={{
            name: task.name,
            description: task.description ?? "",
            guidelines: task.guidelinesMarkdown ?? "",
            deadlineLocal: task.deadline ? toDatetimeLocal(task.deadline) : "",
            rewardAmount: String((reward.baseAmountMinor ?? 0) / 100),
            currency: reward.currency ?? "CNY",
            qualityMultiplierMin: String(reward.qualityMultiplierMin ?? 1.0),
            qualityMultiplierMax: String(reward.qualityMultiplierMax ?? 1.5),
            tagsText: settings.tags.join(", "),
            quotaTotal:
              settings.quotaTotal != null ? String(settings.quotaTotal) : "",
            // Narrow to the editor's 3 options; legacy 'random' → open-queue.
            distributionStrategy:
              settings.distributionStrategy === "round-robin" ||
              settings.distributionStrategy === "quota-by-annotator"
                ? settings.distributionStrategy
                : "open-queue",
            twoStageReview: settings.twoStageReview,
          }}
        />
      </div>
    </main>
  );
}

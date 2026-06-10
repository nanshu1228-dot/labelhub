import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  FileUp,
  LayoutTemplate,
  PauseCircle,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { topics } from "@/lib/db/schema";
import { optionalUser, requireWorkspaceMember } from "@/lib/auth/guards";
import { getWorkspaceById } from "@/lib/queries/workspaces";
import { listTasksInWorkspace } from "@/lib/queries/tasks";
import { TaskLifecycleActions } from "@/components/task-admin/publish-task-button";
import { readTaskOperationalSettings } from "@/lib/tasks/settings";

export const metadata: Metadata = {
  title: "Tasks — LabelHub",
};

export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  "all",
  "draft",
  "open",
  "paused",
  "closed",
  "archived",
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type TaskRow = Awaited<ReturnType<typeof listTasksInWorkspace>>[number];

/**
 * Owner task-management console.
 *
 * The finals spec expects the Owner to feel a coherent publish flow:
 * create task -> import rows -> publish -> monitor -> export. This page
 * is the control surface for that flow, so it favors scan-friendly
 * metrics, filters, readiness state, and direct next actions over the
 * earlier narrow CRUD table.
 */
export default async function WorkspaceTasksPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string; status?: string }>;
}) {
  const { id: workspaceId } = await props.params;
  const search = (await props.searchParams) ?? {};
  const activeStatus = normalizeStatus(search.status);
  const query = (search.q ?? "").trim();

  const me = await optionalUser();
  if (!me) {
    redirect(`/signin?next=/workspaces/${workspaceId}/tasks`);
  }
  let viewerRole: "admin" | "qc" | "annotator" | "viewer";
  try {
    const m = await requireWorkspaceMember(workspaceId);
    viewerRole = m.role;
  } catch {
    notFound();
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const tasks = await listTasksInWorkspace(workspaceId);

  const db = getDb();
  const taskIds = tasks.map((t) => t.id);
  const counts =
    taskIds.length > 0
      ? await db
          .select({
            taskId: topics.taskId,
            n: sql<number>`count(*)::int`,
          })
          .from(topics)
          .where(
            taskIds.length === 1
              ? eq(topics.taskId, taskIds[0])
              : inArray(topics.taskId, taskIds),
          )
          .groupBy(topics.taskId)
      : [];
  const countByTask = new Map<string, number>(
    counts.map((c) => [c.taskId, Number(c.n)]),
  );

  const isAdmin = viewerRole === "admin";
  const statusCounts = getStatusCounts(tasks);
  const filteredTasks = tasks.filter((task) => {
    if (activeStatus !== "all" && task.status !== activeStatus) return false;
    if (!query) return true;
    const haystack = [
      task.name,
      task.description ?? "",
      task.templateMode,
      task.status,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const totalTopics = tasks.reduce(
    (sum, task) => sum + (countByTask.get(task.id) ?? 0),
    0,
  );
  const readyDrafts = tasks.filter(
    (task) => task.status === "draft" && (countByTask.get(task.id) ?? 0) > 0,
  );
  const openTasks = statusCounts.open;
  const latestTask = tasks[tasks.length - 1] ?? null;

  function hrefWith(patch: { q?: string; status?: StatusFilter }) {
    const params = new URLSearchParams();
    const nextQ = patch.q ?? query;
    const nextStatus = patch.status ?? activeStatus;
    if (nextQ) params.set("q", nextQ);
    if (nextStatus !== "all") params.set("status", nextStatus);
    const qs = params.toString();
    return qs
      ? `/workspaces/${workspaceId}/tasks?${qs}`
      : `/workspaces/${workspaceId}/tasks`;
  }

  return (
    <main
      className="min-h-screen px-6 py-8"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-4 flex items-center gap-3 ts-12 mono">
          <Link
            href={`/workspaces/${workspaceId}`}
            className="hover:underline"
            style={{ color: "var(--mute)" }}
          >
            {workspace.name}
          </Link>
          <span style={{ color: "var(--mute2)" }}>/</span>
          <span style={{ color: "var(--text)" }}>task operations</span>
          <span
            className="ml-auto rounded px-2 py-1"
            style={{
              color: "var(--mute)",
              background: "var(--panel)",
              border: "1px solid var(--line)",
            }}
          >
            {formatMode(workspace.templateMode)}
          </span>
        </div>

        <header className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="lbl" style={{ color: "var(--mute)" }}>
              OWNER CONSOLE
            </div>
            <h1
              className="mt-1"
              style={{
                color: "var(--hi)",
                fontSize: 30,
                lineHeight: 1.15,
                fontWeight: 650,
              }}
            >
              Task publishing
            </h1>
            <p
              className="ts-13 mt-2 max-w-[680px]"
              style={{ color: "var(--mute)" }}
            >
              Build tasks, attach schema or rubric rules, import rows, then
              publish work into the labeler queue. This is the first checkpoint
              in the data production lifecycle.
            </p>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <ActionLink href="/admin/forms/new" tone="ghost">
                <LayoutTemplate size={15} />
                Designer
              </ActionLink>
              <ActionLink
                href={`/workspaces/${workspaceId}/tasks/new`}
                tone="accent"
              >
                <Plus size={15} />
                New task
              </ActionLink>
            </div>
          ) : null}
        </header>

        <section className="mb-6 grid gap-3 md:grid-cols-4">
          <StatCard
            icon={<ClipboardList size={18} />}
            label="Total tasks"
            value={String(tasks.length)}
            hint={`${totalTopics} imported item${totalTopics === 1 ? "" : "s"}`}
          />
          <StatCard
            icon={<CheckCircle2 size={18} />}
            label="Open queue"
            value={String(openTasks)}
            hint="visible to labelers"
            tone="green"
          />
          <StatCard
            icon={<SlidersHorizontal size={18} />}
            label="Ready drafts"
            value={String(readyDrafts.length)}
            hint="drafts with imported rows"
            tone="blue"
          />
          <StatCard
            icon={<PauseCircle size={18} />}
            label="Paused / closed"
            value={String(statusCounts.paused + statusCounts.closed)}
            hint="not claimable"
            tone="amber"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="min-w-0">
            <div
              className="rounded-md"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
              }}
            >
              <div
                className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between"
                style={{ borderColor: "var(--line)" }}
              >
                <form
                  action={`/workspaces/${workspaceId}/tasks`}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  {activeStatus !== "all" ? (
                    <input type="hidden" name="status" value={activeStatus} />
                  ) : null}
                  <div
                    className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md px-3"
                    style={{
                      minHeight: 40,
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <Search size={15} style={{ color: "var(--mute2)" }} />
                    <input
                      name="q"
                      defaultValue={query}
                      placeholder="Search task name, mode, status"
                      className="w-full bg-transparent ts-13 outline-none"
                      style={{ color: "var(--text)" }}
                    />
                  </div>
                  <button
                    type="submit"
                    className="ts-12 mono rounded px-3"
                    style={{
                      minHeight: 40,
                      color: "var(--text)",
                      background: "var(--panel2)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    Search
                  </button>
                </form>
              </div>

              <div
                className="flex gap-1 overflow-x-auto px-4 py-3"
                style={{ borderBottom: "1px solid var(--line)" }}
              >
                {STATUS_FILTERS.map((status) => (
                  <StatusFilterLink
                    key={status}
                    href={hrefWith({ status })}
                    active={activeStatus === status}
                    label={status === "all" ? "All" : formatStatusLabel(status)}
                    count={statusCounts[status]}
                  />
                ))}
              </div>

              {tasks.length === 0 ? (
                <EmptyTasksCard
                  workspaceId={workspaceId}
                  templateMode={workspace.templateMode}
                  isAdmin={isAdmin}
                />
              ) : filteredTasks.length === 0 ? (
                <EmptyFilterState href={`/workspaces/${workspaceId}/tasks`} />
              ) : (
                <TaskTable
                  workspaceId={workspaceId}
                  tasks={filteredTasks}
                  countByTask={countByTask}
                  isAdmin={isAdmin}
                />
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <PublishReadiness
              workspaceId={workspaceId}
              isAdmin={isAdmin}
              latestTask={latestTask}
              readyDrafts={readyDrafts}
              totalTopics={totalTopics}
            />
            <WorkflowCard />
          </aside>
        </div>
      </div>
    </main>
  );
}

function TaskTable({
  workspaceId,
  tasks,
  countByTask,
  isAdmin,
}: {
  workspaceId: string;
  tasks: TaskRow[];
  countByTask: Map<string, number>;
  isAdmin: boolean;
}) {
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table
        className="ts-13"
        style={{
          width: "100%",
          minWidth: 880,
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <thead>
          <tr style={{ color: "var(--mute)" }}>
            <Th>Task</Th>
            <Th width={150}>Template</Th>
            <Th width={118}>Status</Th>
            <Th width={110}>Rows</Th>
            <Th width={120}>Reward</Th>
            <Th width={130}>Created</Th>
            <Th width={220}>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const topicCount = countByTask.get(task.id) ?? 0;
            const taskSettings = readTaskOperationalSettings(task.templateConfig);
            return (
              <tr key={task.id}>
                <Td>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/workspaces/${workspaceId}/tasks/${task.id}`}
                      className="ts-13"
                      style={{
                        color: "var(--hi)",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      {task.name}
                    </Link>
                    {task.description ? (
                      <span
                        className="ts-12"
                        style={{
                          color: "var(--mute2)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 360,
                        }}
                      >
                        {task.description}
                      </span>
                    ) : (
                      <span className="ts-12" style={{ color: "var(--mute2)" }}>
                        No description yet
                      </span>
                    )}
                    {taskSettings.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {taskSettings.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="ts-11 mono rounded px-1.5 py-0.5"
                            style={{
                              background: "var(--accent-soft)",
                              border: "1px solid var(--accent-line)",
                              color: "var(--accent)",
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                        {taskSettings.tags.length > 3 ? (
                          <span
                            className="ts-11 mono"
                            style={{ color: "var(--mute2)" }}
                          >
                            +{taskSettings.tags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Td>
                <Td>
                  <span className="ts-11 mono" style={{ color: "var(--mute)" }}>
                    {formatMode(task.templateMode)}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={task.status} />
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="mono" style={{ color: "var(--text)" }}>
                      {topicCount}
                    </span>
                    {topicCount === 0 ? (
                      <span className="ts-11" style={{ color: "var(--mute2)" }}>
                        empty
                      </span>
                    ) : taskSettings.quotaTotal ? (
                      <span className="ts-11" style={{ color: "var(--mute2)" }}>
                        / {taskSettings.quotaTotal}
                      </span>
                    ) : null}
                  </div>
                </Td>
                <Td>
                  <span className="ts-12 mono" style={{ color: "var(--mute)" }}>
                    {formatReward(task.rewardConfig)}
                  </span>
                </Td>
                <Td>
                  <span
                    className="ts-12 mono"
                    style={{ color: "var(--mute2)" }}
                  >
                    {formatDate(task.createdAt)}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/workspaces/${workspaceId}/tasks/${task.id}`}
                      className="ts-12 mono rounded px-2"
                      style={smallButtonStyle}
                    >
                      Open
                    </Link>
                    {isAdmin ? (
                      <>
                        <Link
                          href={`/admin/tasks/${task.id}/import`}
                          className="ts-12 mono rounded px-2"
                          style={smallButtonStyle}
                        >
                          Import
                        </Link>
                        <TaskLifecycleActions
                          taskId={task.id}
                          status={task.status}
                          publishDisabledReason={
                            topicCount === 0
                              ? "Import at least one topic before publishing."
                              : null
                          }
                          compact
                        />
                      </>
                    ) : null}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PublishReadiness({
  workspaceId,
  isAdmin,
  latestTask,
  readyDrafts,
  totalTopics,
}: {
  workspaceId: string;
  isAdmin: boolean;
  latestTask: TaskRow | null;
  readyDrafts: TaskRow[];
  totalTopics: number;
}) {
  const firstReady = readyDrafts[0] ?? null;
  return (
    <section
      className="rounded-md p-4"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="lbl" style={{ color: "var(--mute)" }}>
            PUBLISH READINESS
          </div>
          <h2
            className="ts-18 mt-1"
            style={{ color: "var(--hi)", fontWeight: 650 }}
          >
            Next owner action
          </h2>
        </div>
        <FileUp size={20} style={{ color: "var(--accent)" }} />
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <ReadinessStep
          done={Boolean(latestTask)}
          label="Create a task"
          body={
            latestTask
              ? `Latest: ${latestTask.name}`
              : "Define title, reward, deadline, and guidelines."
          }
        />
        <ReadinessStep
          done={totalTopics > 0}
          label="Import dataset rows"
          body={
            totalTopics > 0
              ? `${totalTopics} rows available across this workspace.`
              : "Upload JSON, JSONL, CSV, or Excel before publishing."
          }
        />
        <ReadinessStep
          done={Boolean(firstReady)}
          label="Publish into queue"
          body={
            firstReady
              ? `${readyDrafts.length} draft${readyDrafts.length === 1 ? "" : "s"} can be published.`
              : "Drafts need rows before labelers can work safely."
          }
        />
      </div>
      {isAdmin ? (
        <div className="mt-4 flex flex-col gap-2">
          {firstReady ? (
            <ActionLink
              href={`/workspaces/${workspaceId}/tasks/${firstReady.id}`}
              tone="accent"
            >
              <ArrowUpRight size={15} />
              Review ready draft
            </ActionLink>
          ) : latestTask ? (
            <ActionLink
              href={`/admin/tasks/${latestTask.id}/import`}
              tone="accent"
            >
              <FileUp size={15} />
              Import rows
            </ActionLink>
          ) : (
            <ActionLink
              href={`/workspaces/${workspaceId}/tasks/new`}
              tone="accent"
            >
              <Plus size={15} />
              Create task
            </ActionLink>
          )}
          <ActionLink href={`/workspaces/${workspaceId}`} tone="ghost">
            <ArrowUpRight size={15} />
            Workspace dashboard
          </ActionLink>
        </div>
      ) : null}
    </section>
  );
}

function WorkflowCard() {
  const steps = [
    "Draft",
    "Import",
    "Open",
    "AI review",
    "Human review",
    "Export",
  ];
  return (
    <section
      className="rounded-md p-4"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
      }}
    >
      <div className="lbl" style={{ color: "var(--mute)" }}>
        DATA FLOW
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {steps.map((step, idx) => (
          <div key={step} className="flex items-center gap-3">
            <span
              className="mono ts-11 inline-flex items-center justify-center rounded"
              style={{
                width: 24,
                height: 24,
                color: idx < 3 ? "var(--accent)" : "var(--mute2)",
                background: idx < 3 ? "var(--accent-soft)" : "var(--panel2)",
                border: `1px solid ${idx < 3 ? "var(--accent-line)" : "var(--line)"}`,
              }}
            >
              {idx + 1}
            </span>
            <span className="ts-13" style={{ color: "var(--text)" }}>
              {step}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyTasksCard({
  workspaceId,
  templateMode,
  isAdmin,
}: {
  workspaceId: string;
  templateMode: string;
  isAdmin: boolean;
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto max-w-[520px]">
        <div
          className="mx-auto mb-4 inline-flex items-center justify-center rounded-md"
          style={{
            width: 44,
            height: 44,
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
            color: "var(--accent)",
          }}
        >
          <ClipboardList size={22} />
        </div>
        <div className="ts-22" style={{ color: "var(--hi)", fontWeight: 600 }}>
          No tasks here yet
        </div>
        <p
          className="ts-13 mt-2"
          style={{ color: "var(--mute)", lineHeight: 1.6 }}
        >
          Start with a publishable task. It will carry the reward rule, the
          template configuration, and the dataset rows labelers can claim.
        </p>
        {isAdmin ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <ActionLink
              href={`/workspaces/${workspaceId}/tasks/new`}
              tone="accent"
            >
              <Plus size={15} />
              Create first task
            </ActionLink>
            {templateMode === "custom-designer" ? (
              <ActionLink href="/admin/forms/new" tone="ghost">
                <LayoutTemplate size={15} />
                Build schema first
              </ActionLink>
            ) : null}
          </div>
        ) : (
          <p className="ts-12 mt-4" style={{ color: "var(--mute2)" }}>
            Workspace admins create and publish tasks.
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyFilterState({ href }: { href: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="ts-18" style={{ color: "var(--hi)", fontWeight: 600 }}>
        No matching tasks
      </div>
      <p className="ts-13 mt-2" style={{ color: "var(--mute)" }}>
        Clear the search or switch status filters to see the full task roster.
      </p>
      <Link
        href={href}
        className="ts-12 mono mt-4 inline-flex rounded px-3"
        style={{
          minHeight: 36,
          alignItems: "center",
          color: "var(--accent)",
          background: "var(--accent-soft)",
          border: "1px solid var(--accent-line)",
          textDecoration: "none",
        }}
      >
        Clear filters
      </Link>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "green" | "blue" | "amber";
}) {
  const color =
    tone === "green"
      ? "oklch(0.62 0.16 145)"
      : tone === "blue"
        ? "oklch(0.65 0.18 200)"
        : tone === "amber"
          ? "oklch(0.68 0.16 70)"
          : "var(--accent)";
  return (
    <div
      className="rounded-md p-4"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="ts-11 mono" style={{ color: "var(--mute)" }}>
          {label}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div
        className="mt-3 ts-24 mono"
        style={{ color: "var(--hi)", fontWeight: 650 }}
      >
        {value}
      </div>
      <div className="ts-12 mt-1" style={{ color: "var(--mute2)" }}>
        {hint}
      </div>
    </div>
  );
}

function StatusFilterLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex shrink-0 items-center gap-2 rounded px-3"
      style={{
        minHeight: 34,
        color: active ? "var(--accent)" : "var(--mute)",
        background: active ? "var(--accent-soft)" : "transparent",
        border: `1px solid ${active ? "var(--accent-line)" : "var(--line)"}`,
        textDecoration: "none",
      }}
    >
      <span>{label}</span>
      <span
        className="rounded px-1.5"
        style={{
          color: active ? "var(--accent)" : "var(--mute2)",
          background: active ? "transparent" : "var(--panel2)",
        }}
      >
        {count}
      </span>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  const Icon =
    status === "archived" || status === "closed"
      ? Archive
      : status === "paused"
        ? PauseCircle
        : status === "open"
          ? CheckCircle2
          : ClipboardList;
  return (
    <span
      className="ts-11 mono inline-flex items-center gap-1.5 rounded px-2 py-1"
      style={{
        color: tone.fg,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <Icon size={13} />
      {formatStatusLabel(status)}
    </span>
  );
}

function ReadinessStep({
  done,
  label,
  body,
}: {
  done: boolean;
  label: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <span
        className="mt-0.5 inline-flex items-center justify-center rounded"
        style={{
          width: 22,
          height: 22,
          color: done ? "oklch(0.62 0.16 145)" : "var(--mute2)",
          background: done ? "oklch(0.62 0.16 145 / 0.1)" : "var(--panel2)",
          border: `1px solid ${done ? "oklch(0.62 0.16 145 / 0.35)" : "var(--line)"}`,
        }}
      >
        {done ? (
          <CheckCircle2 size={14} />
        ) : (
          <span className="ts-11 mono">-</span>
        )}
      </span>
      <div>
        <div
          className="ts-13"
          style={{ color: "var(--text)", fontWeight: 600 }}
        >
          {label}
        </div>
        <div
          className="ts-12 mt-0.5"
          style={{ color: "var(--mute2)", lineHeight: 1.45 }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function ActionLink({
  href,
  tone,
  children,
}: {
  href: string;
  tone: "accent" | "ghost";
  children: ReactNode;
}) {
  const accent = tone === "accent";
  return (
    <Link
      href={href}
      className="ts-13 mono inline-flex items-center justify-center gap-2 rounded-md px-4"
      style={{
        minHeight: 40,
        color: accent ? "white" : "var(--text)",
        background: accent ? "var(--accent)" : "var(--panel)",
        border: `1px solid ${accent ? "var(--accent)" : "var(--line)"}`,
        textDecoration: "none",
        fontWeight: 600,
      }}
    >
      {children}
    </Link>
  );
}

function Th({ children, width }: { children: ReactNode; width?: number }) {
  return (
    <th
      className="ts-11 mono px-4 py-3 text-left"
      style={{
        width,
        color: "var(--mute)",
        fontWeight: 500,
        borderBottom: "1px solid var(--line)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td
      className="px-4 py-3 align-middle"
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      {children}
    </td>
  );
}

function normalizeStatus(value?: string): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter)
    ? (value as StatusFilter)
    : "all";
}

function getStatusCounts(tasks: TaskRow[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: tasks.length,
    draft: 0,
    open: 0,
    paused: 0,
    closed: 0,
    archived: 0,
  };
  tasks.forEach((task) => {
    if (task.status in counts) {
      counts[task.status as StatusFilter] += 1;
    }
  });
  return counts;
}

function formatStatusLabel(status: string): string {
  if (status === "open") return "Open";
  if (status === "draft") return "Draft";
  if (status === "paused") return "Paused";
  if (status === "closed") return "Closed";
  if (status === "archived") return "Archived";
  return status;
}

function statusTone(status: string) {
  if (status === "open") {
    return {
      fg: "oklch(0.62 0.16 145)",
      bg: "oklch(0.62 0.16 145 / 0.08)",
      border: "oklch(0.62 0.16 145 / 0.32)",
    };
  }
  if (status === "paused") {
    return {
      fg: "oklch(0.68 0.16 70)",
      bg: "oklch(0.68 0.16 70 / 0.1)",
      border: "oklch(0.68 0.16 70 / 0.35)",
    };
  }
  if (status === "closed" || status === "archived") {
    return {
      fg: "var(--mute2)",
      bg: "var(--panel2)",
      border: "var(--line)",
    };
  }
  return {
    fg: "var(--accent)",
    bg: "var(--accent-soft)",
    border: "var(--accent-line)",
  };
}

function formatMode(mode: string): string {
  if (mode === "pair-rubric") return "Pair rubric";
  if (mode === "arena-gsb") return "Arena GSB";
  if (mode === "agent-trace-eval") return "Agent trace";
  if (mode === "custom-designer") return "Custom form";
  return mode;
}

function formatReward(value: unknown): string {
  if (!value || typeof value !== "object") return "configured";
  const reward = value as {
    currency?: string;
    baseAmountMinor?: number;
    amount?: number;
    type?: string;
  };
  const minor =
    typeof reward.baseAmountMinor === "number"
      ? reward.baseAmountMinor
      : reward.amount;
  if (typeof minor === "number") {
    const currency = reward.currency ?? "CNY";
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
  return reward.type ?? "configured";
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const smallButtonStyle: CSSProperties = {
  minHeight: 34,
  display: "inline-flex",
  alignItems: "center",
  color: "var(--text)",
  background: "var(--panel2)",
  border: "1px solid var(--line)",
  textDecoration: "none",
};

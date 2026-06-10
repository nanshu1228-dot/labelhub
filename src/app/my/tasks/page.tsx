import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock3,
  History,
  Inbox as InboxIcon,
  Layers3,
  ListChecks,
  Search,
  WalletCards,
} from "lucide-react";
import { optionalUser } from "@/lib/auth/guards";
import { StatCard } from "@/components/ui/stat-card";
import { listMyTasks } from "@/lib/queries/my-tasks";
import { countUnreadNotifications } from "@/lib/queries/notifications";

export const metadata: Metadata = {
  title: "My tasks — LabelHub",
};

export const dynamic = "force-dynamic";

type MyTask = Awaited<ReturnType<typeof listMyTasks>>[number];

/**
 * /my/tasks — labeler workbench.
 *
 * This is the primary labeler entry point for the finals flow. It should
 * answer "what can I work on now, how much is available, what is my
 * progress, and where do I resume?" without making the labeler decipher a
 * raw global queue.
 */
type TaskModeFilter = "all" | "pair-rubric" | "arena-gsb" | "custom-designer";
type AvailabilityFilter = "all" | "ready" | "quiet";

export default async function MyTasksPage(props: {
  searchParams?: Promise<{ q?: string; mode?: string; availability?: string }>;
}) {
  const me = await optionalUser();
  if (!me) redirect("/signin?next=/my/tasks");
  const search = (await props.searchParams) ?? {};
  const query = typeof search.q === "string" ? search.q.trim() : "";
  const mode = normalizeModeFilter(search.mode);
  const availability = normalizeAvailabilityFilter(search.availability);

  const [tasks, unreadInbox] = await Promise.all([
    listMyTasks({ userId: me.id }),
    countUnreadNotifications(me.id).catch(() => 0),
  ]);

  const filteredTasks = filterTasks(tasks, { query, mode, availability });
  const active = filteredTasks.filter((t) => t.claimableCount > 0);
  const depleted = filteredTasks.filter((t) => t.claimableCount === 0);
  const totalClaimable = tasks.reduce((sum, t) => sum + t.claimableCount, 0);
  const totalSubmitted = tasks.reduce((sum, t) => sum + t.mySubmittedCount, 0);
  const totalTopics = tasks.reduce((sum, t) => sum + t.totalTopics, 0);
  const earningPotential = tasks.reduce(
    (sum, t) => sum + (t.rewardPerTopic ?? 0) * t.claimableCount,
    0,
  );
  const nextTask = active[0] ?? tasks[0] ?? null;

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="mx-auto max-w-[1280px]">
        <header className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="lbl" style={{ color: "var(--mute)" }}>
              LABELER WORKBENCH
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
              My labeling tasks
            </h1>
            <p
              className="ts-13 mt-2 max-w-[720px]"
              style={{ color: "var(--mute)" }}
            >
              Pick a campaign, resume drafts, and move through claimable items
              without losing the task context, reward signal, or review
              feedback.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <HeaderLink href="/my/inbox" active={unreadInbox > 0}>
              <InboxIcon size={15} />
              Inbox
              {unreadInbox > 0 ? <Badge>{unreadInbox}</Badge> : null}
            </HeaderLink>
            <HeaderLink href="/my/submissions">
              <History size={15} />
              History
            </HeaderLink>
            <HeaderLink href="/my/queue">
              <ListChecks size={15} />
              Flat queue
            </HeaderLink>
          </div>
        </header>

        {unreadInbox > 0 ? <InboxBanner unread={unreadInbox} /> : null}

        <section className="mb-6 grid gap-3 md:grid-cols-4">
          <StatCard
            icon={<ClipboardList size={18} />}
            label="Available tasks"
            value={String(active.length)}
            hint={`${tasks.length} total campaigns`}
            tone="muted"
          />
          <StatCard
            icon={<ListChecks size={18} />}
            label="Claimable rows"
            value={String(totalClaimable)}
            hint="ready to annotate now"
            tone="accent"
          />
          <StatCard
            icon={<CheckCircle2 size={18} />}
            label="Submitted"
            value={String(totalSubmitted)}
            hint={`${totalTopics} rows in scope`}
            tone="success"
          />
          <StatCard
            icon={<WalletCards size={18} />}
            label="Open earnings"
            value={earningPotential > 0 ? earningPotential.toFixed(2) : "-"}
            hint="if claimable rows clear"
            tone="warn"
          />
        </section>

        <TaskFilters
          query={query}
          mode={mode}
          availability={availability}
          total={tasks.length}
          matched={filteredTasks.length}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0">
            {tasks.length === 0 ? (
              <EmptyState />
            ) : filteredTasks.length === 0 ? (
              <NoMatchesState />
            ) : (
              <div className="flex flex-col gap-7">
                {active.length > 0 ? (
                  <TaskSection
                    label="READY TO WORK"
                    count={active.length}
                    icon={<Circle size={12} />}
                  >
                    {active.map((task) => (
                      <TaskCard key={task.taskId} task={task} />
                    ))}
                  </TaskSection>
                ) : null}
                {depleted.length > 0 ? (
                  <TaskSection
                    label="QUIET"
                    count={depleted.length}
                    icon={<CheckCircle2 size={12} />}
                  >
                    {depleted.map((task) => (
                      <TaskCard key={task.taskId} task={task} muted />
                    ))}
                  </TaskSection>
                ) : null}
              </div>
            )}
          </section>

          <aside className="flex flex-col gap-4">
            <NextWorkCard task={nextTask} />
            <QualityLoopCard />
          </aside>
        </div>
      </div>
    </main>
  );
}

function TaskSection({
  label,
  count,
  icon,
  children,
}: {
  label: string;
  count: number;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span style={{ color: "var(--accent)" }}>{icon}</span>
        <div className="lbl" style={{ color: "var(--mute)" }}>
          {label} · {count}
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">{children}</ul>
    </section>
  );
}

function TaskFilters({
  query,
  mode,
  availability,
  total,
  matched,
}: {
  query: string;
  mode: TaskModeFilter;
  availability: AvailabilityFilter;
  total: number;
  matched: number;
}) {
  return (
    <section
      className="mb-6 rounded-md p-3"
      style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
    >
      <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
        <label className="relative block">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--mute2)" }}
          >
            <Search size={15} />
          </span>
          <input
            name="q"
            defaultValue={query}
            placeholder="Search task, workspace, description"
            className="ts-13 w-full rounded-md"
            style={{
              minHeight: 40,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              color: "var(--text)",
              outline: "none",
              padding: "8px 12px 8px 36px",
            }}
          />
        </label>
        <select
          name="mode"
          defaultValue={mode}
          className="ts-13 rounded-md"
          style={{
            minHeight: 40,
            background: "var(--bg)",
            border: "1px solid var(--line)",
            color: "var(--text)",
            padding: "8px 10px",
          }}
        >
          <option value="all">All templates</option>
          <option value="custom-designer">Custom forms</option>
          <option value="pair-rubric">Pair rubric</option>
          <option value="arena-gsb">Arena GSB</option>
        </select>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="submit"
            className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded-md px-3"
            style={{
              minHeight: 40,
              background: "var(--accent)",
              color: "white",
              border: "1px solid var(--accent-line)",
              cursor: "pointer",
            }}
          >
            <Search size={14} />
            Search
          </button>
          {query || mode !== "all" || availability !== "all" ? (
            <Link
              href="/my/tasks"
              className="ts-12 mono inline-flex items-center justify-center rounded-md px-3"
              style={{
                minHeight: 40,
                background: "var(--bg)",
                color: "var(--mute)",
                border: "1px solid var(--line)",
                textDecoration: "none",
              }}
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            href={buildTasksHref({ query, mode, availability: "all" })}
            active={availability === "all"}
          >
            All
          </FilterChip>
          <FilterChip
            href={buildTasksHref({ query, mode, availability: "ready" })}
            active={availability === "ready"}
          >
            Ready
          </FilterChip>
          <FilterChip
            href={buildTasksHref({ query, mode, availability: "quiet" })}
            active={availability === "quiet"}
          >
            Quiet
          </FilterChip>
        </div>
        <div className="ts-11 mono" style={{ color: "var(--mute2)" }}>
          {matched} / {total} campaigns
        </div>
      </div>
    </section>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center justify-center rounded px-3"
      style={{
        minHeight: 34,
        background: active ? "var(--accent-soft)" : "var(--bg)",
        color: active ? "var(--accent)" : "var(--mute)",
        border: `1px solid ${active ? "var(--accent-line)" : "var(--line)"}`,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

function TaskCard({ task, muted }: { task: MyTask; muted?: boolean }) {
  const dueText = task.deadline ? formatDeadline(task.deadline) : null;
  const progressPct =
    task.totalTopics === 0
      ? 0
      : Math.round((task.mySubmittedCount / task.totalTopics) * 100);

  return (
    <li>
      <Link
        href={`/my/tasks/${task.taskId}`}
        className="block h-full rounded-md p-4"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          textDecoration: "none",
          opacity: muted ? 0.68 : 1,
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ts-11 mono mb-1" style={{ color: "var(--mute2)" }}>
              {task.workspaceName}
            </div>
            <h2
              className="ts-16"
              style={{
                color: "var(--hi)",
                fontWeight: 650,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.taskName}
            </h2>
          </div>
          <ModeBadge mode={task.templateMode} />
        </div>

        {task.taskDescription ? (
          <p
            className="ts-12 mb-4"
            style={{
              color: "var(--mute)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: 36,
            }}
          >
            {task.taskDescription}
          </p>
        ) : (
          <p
            className="ts-12 mb-4"
            style={{ color: "var(--mute2)", minHeight: 36 }}
          >
            No task description yet.
          </p>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          <Mini
            label="REWARD"
            value={formatReward(task)}
            sub="per item"
            accent={!muted && task.rewardPerTopic != null}
          />
          <Mini
            label="CLAIMABLE"
            value={String(task.claimableCount)}
            sub={`of ${task.totalTopics}`}
            accent={task.claimableCount > 0}
          />
          <Mini
            label="SUBMITTED"
            value={`${task.mySubmittedCount}/${task.totalTopics}`}
            sub={`${progressPct}% done`}
          />
        </div>

        <div
          className="mt-4 h-1.5 overflow-hidden rounded"
          style={{ background: "var(--panel2)" }}
          aria-label={`Progress ${progressPct}%`}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progressPct))}%`,
              height: "100%",
              background: muted ? "var(--mute2)" : "var(--accent)",
            }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div
            className="ts-11 mono inline-flex items-center gap-1.5"
            style={{
              color:
                dueText?.urgency === "today" || dueText?.urgency === "overdue"
                  ? "var(--danger)"
                  : "var(--mute2)",
            }}
          >
            {dueText ? (
              <>
                <Clock3 size={13} />
                {dueText.label}
              </>
            ) : (
              <>
                <Layers3 size={13} />
                no deadline
              </>
            )}
          </div>
          <span
            className="ts-12 mono inline-flex items-center gap-1"
            style={{ color: muted ? "var(--mute2)" : "var(--accent)" }}
          >
            Open <ArrowRight size={13} />
          </span>
        </div>
      </Link>
    </li>
  );
}

function NextWorkCard({ task }: { task: MyTask | null }) {
  return (
    <section
      className="rounded-md p-4"
      style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
    >
      <div className="lbl" style={{ color: "var(--mute)" }}>
        NEXT STEP
      </div>
      {task ? (
        <>
          <h2
            className="ts-18 mt-2"
            style={{ color: "var(--hi)", fontWeight: 650 }}
          >
            {task.claimableCount > 0
              ? "Resume labeling"
              : "Review completed work"}
          </h2>
          <p
            className="ts-12 mt-2"
            style={{ color: "var(--mute)", lineHeight: 1.55 }}
          >
            {task.taskName}
          </p>
          <Link
            href={`/my/tasks/${task.taskId}`}
            className="ts-13 mono mt-4 inline-flex items-center justify-center gap-2 rounded-md px-4"
            style={{
              minHeight: 40,
              color: "white",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Open task <ArrowRight size={15} />
          </Link>
        </>
      ) : (
        <p
          className="ts-12 mt-2"
          style={{ color: "var(--mute)", lineHeight: 1.55 }}
        >
          No active task is assigned to your workspaces yet. New work appears
          here as soon as an Owner publishes rows.
        </p>
      )}
    </section>
  );
}

function QualityLoopCard() {
  const steps = [
    "Claim or resume",
    "Autosave draft",
    "Submit for AI review",
    "Fix send-backs",
  ];
  return (
    <section
      className="rounded-md p-4"
      style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
    >
      <div className="lbl" style={{ color: "var(--mute)" }}>
        WORK LOOP
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {steps.map((step, idx) => (
          <div key={step} className="flex items-center gap-3">
            <span
              className="ts-11 mono inline-flex items-center justify-center rounded"
              style={{
                width: 24,
                height: 24,
                color: idx < 2 ? "var(--accent)" : "var(--mute2)",
                background: idx < 2 ? "var(--accent-soft)" : "var(--panel2)",
                border: `1px solid ${idx < 2 ? "var(--accent-line)" : "var(--line)"}`,
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

function Mini({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="ts-11 mono"
        style={{ color: "var(--mute2)", letterSpacing: 0 }}
      >
        {label}
      </div>
      <div
        className="ts-15 mono mt-0.5"
        style={{
          color: accent ? "var(--accent)" : "var(--text)",
          fontWeight: 650,
        }}
      >
        {value}
      </div>
      <div className="ts-11 mono" style={{ color: "var(--mute2)" }}>
        {sub}
      </div>
    </div>
  );
}

function HeaderLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center justify-center gap-2 rounded-md px-3"
      style={{
        minHeight: 38,
        color: active ? "var(--accent)" : "var(--mute)",
        background: active ? "var(--accent-soft)" : "var(--panel)",
        border: `1px solid ${active ? "var(--accent-line)" : "var(--line)"}`,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        background: "var(--accent)",
        color: "white",
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: 999,
        minWidth: 18,
        textAlign: "center",
      }}
    >
      {children}
    </span>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span
      className="mono ts-11 shrink-0 rounded px-2 py-1"
      style={{
        background: "var(--accent-soft)",
        color: "var(--accent)",
        border: "1px solid var(--accent-line)",
      }}
    >
      {formatMode(mode)}
    </span>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-md px-6 py-12 text-center"
      style={{
        background: "var(--panel)",
        border: "1px dashed var(--line2)",
      }}
    >
      <div
        className="mx-auto mb-4 inline-flex items-center justify-center rounded-md"
        style={{
          width: 44,
          height: 44,
          color: "var(--accent)",
          background: "var(--accent-soft)",
          border: "1px solid var(--accent-line)",
        }}
      >
        <ClipboardList size={22} />
      </div>
      <div className="ts-16" style={{ color: "var(--text)", fontWeight: 650 }}>
        No tasks available yet
      </div>
      <p
        className="ts-12 mt-2 mx-auto"
        style={{ color: "var(--mute)", maxWidth: 420 }}
      >
        You are not in any workspaces with open pair-rubric, arena, or custom
        form tasks. Ask an Owner to publish work, or claim a demo workspace from{" "}
        <Link
          href="/account"
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          account
        </Link>
        .
      </p>
    </div>
  );
}

function NoMatchesState() {
  return (
    <div
      className="rounded-md px-6 py-12 text-center"
      style={{
        background: "var(--panel)",
        border: "1px dashed var(--line2)",
      }}
    >
      <div
        className="mx-auto mb-4 inline-flex items-center justify-center rounded-md"
        style={{
          width: 44,
          height: 44,
          color: "var(--accent)",
          background: "var(--accent-soft)",
          border: "1px solid var(--accent-line)",
        }}
      >
        <Search size={22} />
      </div>
      <div className="ts-16" style={{ color: "var(--text)", fontWeight: 650 }}>
        No matching tasks
      </div>
      <Link
        href="/my/tasks"
        className="ts-13 mono mt-4 inline-flex items-center justify-center rounded-md px-4"
        style={{
          minHeight: 38,
          background: "var(--accent)",
          color: "white",
          border: "1px solid var(--accent-line)",
          textDecoration: "none",
        }}
      >
        Clear filters
      </Link>
    </div>
  );
}

function InboxBanner({ unread }: { unread: number }) {
  return (
    <Link
      href="/my/inbox"
      className="mb-5 block rounded-md px-4 py-3"
      style={{
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        textDecoration: "none",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div
            className="lbl"
            style={{ color: "var(--accent)", letterSpacing: 0 }}
          >
            INBOX
          </div>
          <div
            className="ts-13 mt-0.5"
            style={{ color: "var(--hi)", fontWeight: 600 }}
          >
            You have {unread} unread notification{unread === 1 ? "" : "s"}:
            review verdicts, replies, and send-back messages.
          </div>
        </div>
        <span
          className="ts-13 mono inline-flex items-center gap-1"
          style={{ color: "var(--accent)" }}
          aria-hidden
        >
          Open <ArrowRight size={13} />
        </span>
      </div>
    </Link>
  );
}

function formatReward(task: MyTask): string {
  if (task.rewardPerTopic == null) return "-";
  return `${task.rewardPerTopic.toFixed(2)} ${task.currency ?? ""}`.trim();
}

function formatMode(mode: string): string {
  if (mode === "pair-rubric") return "Pair";
  if (mode === "arena-gsb") return "Arena";
  if (mode === "custom-designer") return "Custom";
  return mode;
}

function formatDeadline(d: Date): {
  label: string;
  urgency: "overdue" | "today" | "soon" | "later";
} {
  const now = Date.now();
  const ms = d.getTime() - now;
  if (ms < 0) return { label: "overdue", urgency: "overdue" };
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days === 0) return { label: "closes today", urgency: "today" };
  if (days <= 2) return { label: `closes in ${days}d`, urgency: "soon" };
  return { label: `closes in ${days}d`, urgency: "later" };
}

function normalizeModeFilter(value: unknown): TaskModeFilter {
  if (
    value === "pair-rubric" ||
    value === "arena-gsb" ||
    value === "custom-designer"
  ) {
    return value;
  }
  return "all";
}

function normalizeAvailabilityFilter(value: unknown): AvailabilityFilter {
  if (value === "ready" || value === "quiet") return value;
  return "all";
}

function filterTasks(
  tasks: MyTask[],
  filters: {
    query: string;
    mode: TaskModeFilter;
    availability: AvailabilityFilter;
  },
): MyTask[] {
  const q = filters.query.toLowerCase();
  return tasks.filter((task) => {
    if (filters.mode !== "all" && task.templateMode !== filters.mode) {
      return false;
    }
    if (filters.availability === "ready" && task.claimableCount === 0) {
      return false;
    }
    if (filters.availability === "quiet" && task.claimableCount > 0) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      task.taskName,
      task.taskDescription ?? "",
      task.workspaceName,
      task.templateMode,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function buildTasksHref({
  query,
  mode,
  availability,
}: {
  query: string;
  mode: TaskModeFilter;
  availability: AvailabilityFilter;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (mode !== "all") params.set("mode", mode);
  if (availability !== "all") params.set("availability", availability);
  const qs = params.toString();
  return qs ? `/my/tasks?${qs}` : "/my/tasks";
}

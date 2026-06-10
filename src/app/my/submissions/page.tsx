import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  RotateCcw,
  Search,
} from "lucide-react";
import { optionalUser } from "@/lib/auth/guards";
import { StatCard } from "@/components/ui/stat-card";
import {
  listMyAllSubmissions,
  type MySubmissionRow,
} from "@/lib/queries/annotations";

export const metadata: Metadata = {
  title: "My submissions — LabelHub",
};

export const dynamic = "force-dynamic";

type SubmissionStatusFilter =
  | "all"
  | "in-flight"
  | "done"
  | "drafting"
  | "submitted"
  | "reviewing"
  | "awaiting_acceptance"
  | "approved"
  | "rejected"
  | "revising";

type SubmissionModeFilter =
  | "all"
  | "pair-rubric"
  | "arena-gsb"
  | "custom-designer"
  | "agent-trace-eval";

/**
 * /my/submissions — the annotator's work history.
 *
 * Cross-mode: lists every annotation the user has submitted (or drafted)
 * across every workspace they belong to. Status badge tells the story:
 * submitted / reviewing / awaiting_acceptance / approved / rejected /
 * revising. Each row links back to its annotate URL (with annotationId
 * if the row is past drafting so the user reads their own work in
 * review mode).
 *
 * Distinct from /my/earnings (which is about payout amounts) and
 * /my/queue (which is the FORWARD-looking work feed). This page is the
 * BACKWARD-looking history.
 */
export default async function MySubmissionsPage(props: {
  searchParams?: Promise<{ status?: string; q?: string; mode?: string }>;
}) {
  const search = (await props.searchParams) ?? {};
  const filter = normalizeStatus(search.status);
  const query = typeof search.q === "string" ? search.q.trim() : "";
  const mode = normalizeMode(search.mode);

  const me = await optionalUser();
  if (!me) redirect("/signin?next=/my/submissions");

  const all = await listMyAllSubmissions({ userId: me.id, limit: 200 });

  // Bucket counts for the filter chips.
  const counts = bucketCounts(all);
  const visible = applyFilters(all, { status: filter, query, mode });
  const pendingReview =
    counts.submitted + counts.reviewing + counts.awaiting_acceptance;

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: "var(--bg)" }}
    >
      <div className="mx-auto max-w-[1000px]">
        <header className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="lbl mb-2" style={{ color: "var(--mute)" }}>
              MY DATA
            </div>
            <h1 className="ts-28" style={{ color: "var(--hi)" }}>
              Submission history
            </h1>
            <p
              className="ts-13 mt-2"
              style={{ color: "var(--mute)", maxWidth: 660 }}
            >
              Track what you submitted, what passed review, what was sent back,
              and which rows still need reviewer or AI decisions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <HeaderLink href="/my/tasks">
              <FileText size={15} />
              Tasks
            </HeaderLink>
            <HeaderLink href="/my/inbox">
              <History size={15} />
              Inbox
            </HeaderLink>
          </div>
        </header>

        <section className="mb-5 grid gap-3 md:grid-cols-4">
          <StatCard
            icon={<FileText size={17} />}
            label="Submitted"
            value={String(
              counts.submitted +
                counts.reviewing +
                counts.awaiting_acceptance +
                counts.approved +
                counts.rejected +
                counts.revising,
            )}
            hint={`${all.length} rows including drafts`}
            tone="muted"
          />
          <StatCard
            icon={<CheckCircle2 size={17} />}
            label="Approved"
            value={String(counts.approved)}
            hint="accepted into delivery"
            tone="success"
          />
          <StatCard
            icon={<RotateCcw size={17} />}
            label="Needs revision"
            value={String(counts.revising)}
            hint="sent back to fix"
            tone="warn"
          />
          <StatCard
            icon={<Clock3 size={17} />}
            label="Pending review"
            value={String(pendingReview)}
            hint="AI / human review"
            tone="accent"
          />
        </section>

        <SubmissionFilters
          query={query}
          mode={mode}
          active={filter}
          counts={counts}
          matched={visible.length}
          total={all.length}
        />

        {visible.length === 0 ? (
          <EmptyCard filter={filter} />
        ) : (
          <ul className="flex flex-col gap-2 mt-4">
            {visible.map((r) => (
              <SubmissionRow key={r.annotationId} row={r} />
            ))}
          </ul>
        )}

        <div className="mt-8 ts-12 mono" style={{ color: "var(--mute2)" }}>
          showing {visible.length} of {all.length} rows · narrow filters to
          focus the history view
        </div>
      </div>
    </main>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function bucketCounts(rows: MySubmissionRow[]) {
  const c = {
    all: rows.length,
    drafting: 0,
    submitted: 0,
    reviewing: 0,
    awaiting_acceptance: 0,
    approved: 0,
    rejected: 0,
    revising: 0,
  };
  for (const r of rows) {
    if (r.topicStatus in c) {
      (c as Record<string, number>)[r.topicStatus] += 1;
    }
  }
  return c;
}

function applyFilters(
  rows: MySubmissionRow[],
  filters: {
    status: SubmissionStatusFilter;
    query: string;
    mode: SubmissionModeFilter;
  },
): MySubmissionRow[] {
  const q = filters.query.toLowerCase();
  return rows.filter((r) => {
    if (filters.mode !== "all" && r.templateMode !== filters.mode) return false;
    if (filters.status === "in-flight") {
      if (
        ![
          "drafting",
          "submitted",
          "reviewing",
          "awaiting_acceptance",
          "revising",
        ].includes(r.topicStatus)
      ) {
        return false;
      }
    } else if (filters.status === "done") {
      if (r.topicStatus !== "approved" && r.topicStatus !== "rejected") {
        return false;
      }
    } else if (filters.status !== "all" && r.topicStatus !== filters.status) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      r.workspaceName,
      r.taskName,
      r.templateMode,
      r.topicStatus,
      r.payloadPreview,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

// ─── Filters ─────────────────────────────────────────────────────────────

function SubmissionFilters({
  query,
  mode,
  active,
  counts,
  matched,
  total,
}: {
  query: string;
  mode: SubmissionModeFilter;
  active: SubmissionStatusFilter;
  counts: ReturnType<typeof bucketCounts>;
  matched: number;
  total: number;
}) {
  const chips: Array<{ key: string; label: string; count: number }> = [
    { key: "all", label: "all", count: counts.all },
    {
      key: "in-flight",
      label: "in flight",
      count:
        counts.drafting +
        counts.submitted +
        counts.reviewing +
        counts.awaiting_acceptance +
        counts.revising,
    },
    { key: "approved", label: "approved", count: counts.approved },
    { key: "rejected", label: "rejected", count: counts.rejected },
    { key: "revising", label: "打回 (revising)", count: counts.revising },
  ];
  return (
    <section
      className="mb-5 rounded-md p-3"
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
            placeholder="Search payload, task, workspace"
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
          {active !== "all" ? (
            <input type="hidden" name="status" value={active} />
          ) : null}
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
          <option value="agent-trace-eval">Agent trace</option>
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
          {query || mode !== "all" || active !== "all" ? (
            <Link
              href="/my/submissions"
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
          {chips.map((c) => {
            const isActive = active === c.key;
            return (
              <FilterChip
                key={c.key}
                href={buildSubmissionsHref({
                  query,
                  mode,
                  status: c.key as SubmissionStatusFilter,
                })}
                active={isActive}
              >
                {c.label}
                <span
                  className="ml-1.5"
                  style={{
                    color: isActive ? "var(--accent)" : "var(--mute2)",
                    opacity: 0.85,
                  }}
                >
                  {c.count}
                </span>
              </FilterChip>
            );
          })}
        </div>
        <div className="ts-11 mono" style={{ color: "var(--mute2)" }}>
          {matched} / {total} rows
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

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center justify-center gap-2 rounded-md px-3"
      style={{
        minHeight: 38,
        color: "var(--mute)",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────

function SubmissionRow({ row }: { row: MySubmissionRow }) {
  // Build the annotate URL — pair/arena topics and trajectory live at
  // different roots, and review mode wants ?annotationId= when the row
  // is past drafting.
  const isTrajectory = row.templateMode === "agent-trace-eval";
  const annotateUrl = isTrajectory
    ? // We don't know the trajectoryId from here without a join — link
      // to the trajectories list and let the user find it. Cheap.
      `/workspaces/${row.workspaceId}/trajectories`
    : `/workspaces/${row.workspaceId}/topics/${row.topicId}/annotate${
        row.topicStatus !== "drafting"
          ? `?annotationId=${row.annotationId}`
          : ""
      }`;

  const fmtTs = (d: Date | null) =>
    d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";

  return (
    <li>
      <Link
        href={annotateUrl}
        className="block rounded-md p-3"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          textDecoration: "none",
          transition: "border-color 120ms",
        }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div
            className="ts-12 mono truncate"
            style={{ color: "var(--mute2)" }}
          >
            {row.workspaceName} · {row.taskName}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ModeChip mode={row.templateMode} />
            <StatusChip status={row.topicStatus} />
          </div>
        </div>
        <p
          className="ts-12 mono truncate"
          style={{ color: "var(--text)", maxWidth: "100%" }}
          title={row.payloadPreview}
        >
          {row.payloadPreview || "(empty draft)"}
        </p>
        <div className="ts-11 mono mt-1" style={{ color: "var(--mute2)" }}>
          submitted {fmtTs(row.submittedAt)} · annotation{" "}
          {row.annotationId.slice(0, 8)}
        </div>
      </Link>
    </li>
  );
}

// ─── Status / mode chips ─────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> =
  {
    drafting: { bg: "var(--panel2)", fg: "var(--mute)", label: "drafting" },
    submitted: {
      bg: "oklch(0.55 0.15 220 / 0.12)",
      fg: "oklch(0.65 0.15 220)",
      label: "submitted",
    },
    reviewing: {
      bg: "oklch(0.94 0.04 200 / 0.5)",
      fg: "oklch(0.45 0.15 200)",
      label: "reviewing",
    },
    awaiting_acceptance: {
      bg: "oklch(0.94 0.04 200 / 0.5)",
      fg: "oklch(0.45 0.15 200)",
      label: "awaiting acceptance",
    },
    revising: {
      bg: "oklch(0.7 0.14 75 / 0.15)",
      fg: "oklch(0.7 0.14 75)",
      label: "打回",
    },
    approved: {
      bg: "var(--success-soft)",
      fg: "var(--success)",
      label: "approved",
    },
    rejected: {
      bg: "var(--danger-soft)",
      fg: "var(--danger)",
      label: "rejected",
    },
  };

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    bg: "var(--panel2)",
    fg: "var(--mute)",
    label: status,
  };
  return (
    <span
      className="mono ts-11"
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.fg}33`,
        borderRadius: 4,
        padding: "1px 8px",
        fontWeight: 600,
      }}
    >
      {s.label}
    </span>
  );
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <span
      className="mono ts-11"
      style={{
        background: "oklch(0.6 0.18 280 / 0.1)",
        color: "var(--accent)",
        border: "1px solid oklch(0.6 0.18 280 / 0.25)",
        borderRadius: 4,
        padding: "1px 8px",
      }}
    >
      {mode.replace(/-/g, " ")}
    </span>
  );
}

// ─── Empty ───────────────────────────────────────────────────────────────

function EmptyCard({ filter }: { filter: SubmissionStatusFilter }) {
  const msg =
    filter === "approved"
      ? "No annotations approved yet."
      : filter === "rejected"
        ? "Nothing rejected — clean record so far."
        : filter === "revising"
          ? "No 打回 — no one's asked you to revise."
          : filter === "in-flight"
            ? "No work in flight. Pick a task to claim something."
            : "You haven't submitted any annotations yet. Pick a task to start.";
  return (
    <div
      className="rounded-md p-6 mt-4 text-center"
      style={{
        background: "var(--panel)",
        border: "1px dashed var(--line)",
      }}
    >
      <p className="ts-13" style={{ color: "var(--mute)" }}>
        {msg}
      </p>
      <Link
        href="/my/tasks"
        className="ts-13 mono inline-flex items-center justify-center gap-1.5 mt-3"
        style={{
          background: "transparent",
          color: "var(--accent)",
          border: "1px solid oklch(0.6 0.18 280 / 0.4)",
          borderRadius: 5,
          padding: "4px 12px",
          textDecoration: "none",
        }}
      >
        open tasks <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function normalizeStatus(value: unknown): SubmissionStatusFilter {
  if (
    value === "in-flight" ||
    value === "done" ||
    value === "drafting" ||
    value === "submitted" ||
    value === "reviewing" ||
    value === "awaiting_acceptance" ||
    value === "approved" ||
    value === "rejected" ||
    value === "revising"
  ) {
    return value;
  }
  return "all";
}

function normalizeMode(value: unknown): SubmissionModeFilter {
  if (
    value === "pair-rubric" ||
    value === "arena-gsb" ||
    value === "custom-designer" ||
    value === "agent-trace-eval"
  ) {
    return value;
  }
  return "all";
}

function buildSubmissionsHref({
  query,
  mode,
  status,
}: {
  query: string;
  mode: SubmissionModeFilter;
  status: SubmissionStatusFilter;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (mode !== "all") params.set("mode", mode);
  if (status !== "all") params.set("status", status);
  const qs = params.toString();
  return qs ? `/my/submissions?${qs}` : "/my/submissions";
}

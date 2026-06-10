import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  History,
  Inbox,
  ListChecks,
  Lock,
  Save,
  Sparkles,
} from "lucide-react";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { annotations } from "@/lib/db/schema";
import { optionalUser, requireWorkspaceMember } from "@/lib/auth/guards";
import { getTopicById, listTopicsInTask } from "@/lib/queries/topics";
import { getTaskById } from "@/lib/queries/tasks";
import { getWorkspaceById } from "@/lib/queries/workspaces";
import {
  getAnnotationReviewContext,
  type AnnotationReviewContext,
} from "@/lib/queries/annotation-review";
import {
  getReviewThread,
  type ReviewThreadMessage,
} from "@/lib/queries/review-thread";
import {
  getTopicPeerConsensus,
  type TopicPeerData,
} from "@/lib/queries/topic-peer-consensus";
import {
  getAnnotationAuditTimeline,
  type TimelineEntry,
} from "@/lib/queries/annotation-timeline";
import { AnnotationAuditTimeline } from "@/components/quality/annotation-audit-timeline";
import { getEffectiveTemplate } from "@/lib/templates/effective";
import "@/lib/templates/init";
import {
  ReviewVerdictControls,
  type ViewerRole,
} from "@/components/quality/review-verdict-controls";
import { ReviewThread } from "@/components/quality/review-thread";
import {
  TopicNavigationBar,
  type TopicNavigatorModel,
} from "@/components/labeler/topic-navigation-bar";
import { PairRubricForm } from "@/components/topic-annotate/pair-rubric-form";
import { RubricJudgmentForm } from "@/components/topic-annotate/rubric-judgment-form";
import { ArenaGsbForm } from "@/components/topic-annotate/arena-gsb-form";
import { CustomDesignerForm } from "@/components/topic-annotate/custom-designer-form";
import { loadCustomFormSchema } from "@/lib/form-designer/storage";

export const metadata: Metadata = {
  title: "Annotate topic — LabelHub",
};

/**
 * /workspaces/[id]/topics/[topicId]/annotate
 *
 * Two modes:
 *
 *   1. NORMAL (no `?annotationId=`): the viewer is annotating themselves.
 *      We load the viewer's own draft (or create on first save via auto-
 *      claim) and let them edit.
 *
 *   2. REVIEW (`?annotationId=<id>`): a QC/admin reviewer wants to inspect
 *      a specific submitter's annotation and render a verdict. We load
 *      THAT user's payload + the topic's review-thread events, and the
 *      form auto-goes read-only because topic.status is past `drafting`.
 *      Verdict buttons + reply textarea render alongside.
 *
 * Trajectory annotation has its own dedicated route — this one only
 * handles the topic-payload modes (pair-rubric / arena-gsb).
 */
export default async function TopicAnnotatePage(props: {
  params: Promise<{ id: string; topicId: string }>;
  searchParams?: Promise<{ annotationId?: string; submitted?: string }>;
}) {
  const { id: workspaceId, topicId } = await props.params;
  const search = (await props.searchParams) ?? {};
  const reviewAnnotationIdFromUrl =
    typeof search.annotationId === "string" ? search.annotationId : null;
  // Set by after-submit-nav when auto-advancing: the PREVIOUS topic was
  // just submitted, this is a fresh one. Without the banner the jump
  // reads as "everything I filled in disappeared".
  const justSubmittedPrev = search.submitted === "1";

  const me = await optionalUser();
  if (!me) {
    const qs = reviewAnnotationIdFromUrl
      ? `?annotationId=${reviewAnnotationIdFromUrl}`
      : "";
    redirect(
      `/signin?next=/workspaces/${workspaceId}/topics/${topicId}/annotate${qs}`,
    );
  }

  let viewerRole: ViewerRole;
  try {
    const membership = await requireWorkspaceMember(workspaceId);
    viewerRole = membership.role;
  } catch {
    notFound();
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const topic = await getTopicById(topicId);
  if (!topic) notFound();
  const task = await getTaskById(topic.taskId);
  if (!task) notFound();
  if (task.workspaceId !== workspaceId) notFound();

  const template = getEffectiveTemplate(task.templateMode, task.templateConfig);
  if (!template) {
    throw new Error(
      `Task uses templateMode "${task.templateMode}" which is not registered.`,
    );
  }

  // Resolve review mode, if requested.
  const db = getDb();
  let reviewContext: AnnotationReviewContext | null = null;
  let reviewThread: ReviewThreadMessage[] = [];
  let peerConsensus: TopicPeerData | null = null;
  let auditTimeline: TimelineEntry[] = [];
  let displayPayload: Record<string, unknown> = {};
  let displayStatus = topic.status;
  let activeAnnotationId: string | null = null;
  /**
   * True when the URL had `?annotationId=…` but the lookup couldn't
   * resolve it to a valid review context (bad id, wrong workspace, or
   * the annotation doesn't actually belong to THIS topic). Surfaces a
   * warning banner instead of silently dropping the user into normal
   * mode — confusing UX otherwise, since the page just looks like a
   * fresh draft with no explanation.
   */
  let reviewLookupFailed = false;

  if (reviewAnnotationIdFromUrl) {
    const ctx = await getAnnotationReviewContext({
      annotationId: reviewAnnotationIdFromUrl,
      workspaceId,
    });
    if (ctx) {
      // Defense-in-depth: the annotation must actually belong to THIS topic
      // (URL composition could mismatch).
      const [submitterAnno] = await db
        .select()
        .from(annotations)
        .where(eq(annotations.id, reviewAnnotationIdFromUrl))
        .limit(1);
      if (submitterAnno && submitterAnno.topicId === topicId) {
        reviewContext = ctx;
        activeAnnotationId = reviewAnnotationIdFromUrl;
        displayPayload = (submitterAnno.payload ?? {}) as Record<
          string,
          unknown
        >;
        displayStatus = ctx.topicStatus;
        // Parallel reads for everything review mode needs:
        //   - the review thread (chat-style verdict + replies)
        //   - the peer consensus (other raters' aggregated values)
        //   - the audit timeline (every state-change event)
        // Peer consensus + audit timeline only renders in review mode
        // so the active rater isn't biased mid-draft.
        const [thread, peer, audit] = await Promise.all([
          getReviewThread({ annotationId: reviewAnnotationIdFromUrl }),
          getTopicPeerConsensus({
            topicId,
            excludeUserId: ctx.submitterId,
          }),
          getAnnotationAuditTimeline({
            annotationId: reviewAnnotationIdFromUrl,
          }),
        ]);
        reviewThread = thread;
        peerConsensus = peer;
        auditTimeline = audit;
      } else {
        reviewLookupFailed = true;
      }
    } else {
      reviewLookupFailed = true;
    }
    // If lookup failed (bad id, cross-workspace, etc.) we fall through
    // to NORMAL mode rather than 404 — matches the trajectory page's
    // forgiving behavior. The fallback banner explains what happened.
  }

  if (!reviewContext) {
    // Normal mode: load viewer's own draft.
    const [draft] = await db
      .select()
      .from(annotations)
      .where(
        and(eq(annotations.topicId, topicId), eq(annotations.userId, me.id)),
      )
      .limit(1);
    displayPayload = (draft?.payload ?? {}) as Record<string, unknown>;
    displayStatus = topic.status;
    activeAnnotationId = draft?.id ?? null;
    if (activeAnnotationId) {
      const [thread, audit] = await Promise.all([
        getReviewThread({ annotationId: activeAnnotationId }),
        getAnnotationAuditTimeline({ annotationId: activeAnnotationId }),
      ]);
      reviewThread = thread;
      auditTimeline = audit;
    }
  }

  // agent-trace-eval should never hit this route — bounce to the right one.
  if (task.templateMode === "agent-trace-eval") {
    const data = topic.itemData as { trajectoryId?: string };
    if (typeof data?.trajectoryId === "string") {
      const qs = reviewAnnotationIdFromUrl
        ? `?annotationId=${reviewAnnotationIdFromUrl}`
        : "";
      redirect(
        `/workspaces/${workspaceId}/trajectories/${data.trajectoryId}/annotate${qs}`,
      );
    }
    notFound();
  }

  const itemData = topic.itemData as Record<string, unknown>;
  const topicNavigator = buildTopicNavigator({
    workspaceId,
    taskId: task.id,
    topicId,
    topics: await listTopicsInTask(task.id, { limit: 500 }),
  });
  const viewerIsSubmitter =
    !!reviewContext && reviewContext.submitterId === me.id;
  const canReplyToReview = !reviewContext || viewerIsSubmitter;
  const hasReviewFeedback = reviewThread.length > 0;
  const showAuditTimeline =
    (Boolean(reviewContext) || hasReviewFeedback) && auditTimeline.length > 0;

  // D19-B — resolve the custom-designer schema before the formNode
  // builder. Only relevant when the task points at a saved schema
  // via templateConfig.formSchemaId.
  let customDesignerSchema: Awaited<ReturnType<typeof loadCustomFormSchema>> =
    null;
  if (task.templateMode === "custom-designer") {
    const tc = task.templateConfig as { formSchemaId?: string } | null;
    if (tc?.formSchemaId) {
      customDesignerSchema = await loadCustomFormSchema({
        id: tc.formSchemaId,
        includeArchived: true,
      });
    }
  }

  const formNode = (() => {
    if (task.templateMode === "pair-rubric") {
      return (
        <PairRubricForm
          workspaceId={workspaceId}
          topicId={topicId}
          taskId={task.id}
          topicStatus={displayStatus}
          itemData={itemData}
          checklist={template.pairChecklist ?? []}
          initialPayload={displayPayload}
          taskName={task.name}
          workspaceName={workspace.name}
          peerConsensus={
            peerConsensus && peerConsensus.mode === "pair-rubric"
              ? { pair: peerConsensus.pair, peerCount: peerConsensus.peerCount }
              : null
          }
        />
      );
    }
    if (task.templateMode === "rubric-judgment") {
      return (
        <RubricJudgmentForm
          workspaceId={workspaceId}
          topicId={topicId}
          taskId={task.id}
          topicStatus={displayStatus}
          itemData={itemData}
          initialPayload={displayPayload}
          taskName={task.name}
          workspaceName={workspace.name}
        />
      );
    }
    if (task.templateMode === "custom-designer" && customDesignerSchema) {
      return (
        <CustomDesignerForm
          workspaceId={workspaceId}
          workspaceName={workspace.name}
          taskId={task.id}
          taskName={task.name}
          topicId={topicId}
          topicStatus={displayStatus}
          itemData={itemData}
          schema={customDesignerSchema.schema}
          initialPayload={displayPayload}
        />
      );
    }
    if (task.templateMode === "arena-gsb") {
      return (
        <ArenaGsbForm
          workspaceId={workspaceId}
          topicId={topicId}
          taskId={task.id}
          topicStatus={displayStatus}
          itemData={itemData}
          dimensions={template.arenaDimensions ?? []}
          initialPayload={displayPayload}
          taskName={task.name}
          workspaceName={workspace.name}
          peerConsensus={
            peerConsensus && peerConsensus.mode === "arena-gsb"
              ? {
                  arena: peerConsensus.arena,
                  peerCount: peerConsensus.peerCount,
                }
              : null
          }
        />
      );
    }
    return null;
  })();

  if (!formNode) notFound();

  return (
    <div className="app-light min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <LabelerWorkbenchHeader
          workspaceId={workspaceId}
          workspaceName={workspace.name}
          taskId={task.id}
          taskName={task.name}
          topicStatus={displayStatus}
          templateMode={task.templateMode}
          reviewMode={Boolean(reviewContext)}
          navigator={topicNavigator}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
          <main className="min-w-0">
            {viewerRole === "admin" && (
              <div className="mb-3 flex items-center gap-2 ts-12 mono">
                <Link
                  href={`/workspaces/${workspaceId}/topics/${topicId}/history`}
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1"
                  style={{
                    background: "var(--panel)",
                    color: "var(--mute)",
                    border: "1px solid var(--line)",
                    textDecoration: "none",
                  }}
                  title="View revision timeline + restore an earlier version"
                >
                  <History size={13} />
                  history
                </Link>
              </div>
            )}

            {justSubmittedPrev && !reviewContext && (
              <div
                className="mb-4 rounded-md p-3 ts-13 flex items-center gap-2"
                style={{
                  background: "var(--success-soft)",
                  border: "1px solid oklch(0.5 0.13 150 / 0.4)",
                  color: "var(--success)",
                }}
              >
                ✓ 上一题已提交,进入 AI 预审与人工审核流程 — 这是下一道待标注的题目。
              </div>
            )}

            {reviewLookupFailed && (
              <div className="mb-4">
                <ReviewLookupFailedBanner
                  workspaceId={workspaceId}
                  topicId={topicId}
                />
              </div>
            )}

            {reviewContext && (
              <div className="mb-4">
                <ReviewModeBanner
                  submitter={
                    reviewContext.submitterDisplayName ??
                    reviewContext.submitterEmail?.split("@")[0] ??
                    "this annotator"
                  }
                  status={reviewContext.topicStatus}
                  workspaceId={workspaceId}
                  topicId={topicId}
                />
              </div>
            )}

            {!reviewContext && hasReviewFeedback && (
              <div className="mb-4">
                <RevisionFeedbackBanner
                  status={displayStatus}
                  messages={reviewThread}
                />
              </div>
            )}

            {reviewContext && (
              <div className="mb-6">
                <ReviewVerdictControls
                  annotationId={reviewContext.annotationId}
                  topicStatus={reviewContext.topicStatus}
                  viewerRole={viewerRole}
                  twoStage={reviewContext.twoStageReview}
                  viewerIsSubmitter={viewerIsSubmitter}
                  submitterDisplayName={reviewContext.submitterDisplayName}
                />
              </div>
            )}

            {formNode}

            {activeAnnotationId && reviewThread.length > 0 && (
              <div className="mt-8">
                <ReviewThread
                  annotationId={activeAnnotationId}
                  messages={reviewThread}
                  canReply={canReplyToReview}
                />
              </div>
            )}

            {showAuditTimeline && (
              <div className="mt-8">
                <AnnotationAuditTimeline entries={auditTimeline} />
              </div>
            )}
          </main>

          <WorkbenchSidebar
            workspaceId={workspaceId}
            taskId={task.id}
            topicStatus={displayStatus}
            templateMode={task.templateMode}
            itemData={itemData}
            reviewMode={Boolean(reviewContext)}
            reviewThreadCount={reviewThread.length}
            auditEventCount={auditTimeline.length}
            navigator={topicNavigator}
          />
        </div>
      </div>
    </div>
  );
}

function LabelerWorkbenchHeader({
  workspaceId,
  workspaceName,
  taskId,
  taskName,
  topicStatus,
  templateMode,
  reviewMode,
  navigator,
}: {
  workspaceId: string;
  workspaceName: string;
  taskId: string;
  taskName: string;
  topicStatus: string;
  templateMode: string;
  reviewMode: boolean;
  navigator: TopicNavigatorModel;
}) {
  return (
    <header className="mb-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <nav
            className="mb-3 flex items-center gap-2 ts-12 mono"
            style={{ color: "var(--mute2)" }}
          >
            <Link
              href="/my/tasks"
              className="inline-flex items-center gap-1 hover:underline"
              style={{ color: "var(--mute)", textDecoration: "none" }}
            >
              <ArrowLeft size={13} />
              my tasks
            </Link>
            <span>/</span>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="hover:underline"
              style={{ color: "var(--mute)", textDecoration: "none" }}
            >
              {workspaceName}
            </Link>
          </nav>
          <div className="lbl" style={{ color: "var(--mute)" }}>
            {reviewMode ? "REVIEWING SUBMISSION" : "ANNOTATION WORKBENCH"}
          </div>
          <h1
            className="mt-1"
            style={{
              color: "var(--hi)",
              fontSize: 28,
              lineHeight: 1.15,
              fontWeight: 650,
            }}
          >
            {taskName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 gap-y-2 lg:justify-end">
          <StatusPill label={formatMode(templateMode)} tone="accent" />
          <StatusPill
            label={formatStatus(topicStatus)}
            tone={topicStatusTone(topicStatus)}
          />
          <Link
            href={`/my/tasks/${taskId}`}
            className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded-md px-3"
            style={{
              minHeight: 38,
              color: "var(--text)",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              textDecoration: "none",
            }}
          >
            <ListChecks size={14} />
            task topics
          </Link>
        </div>
      </div>
      <TopicNavigationBar navigator={navigator} />
    </header>
  );
}

function WorkbenchSidebar({
  workspaceId,
  taskId,
  topicStatus,
  templateMode,
  itemData,
  reviewMode,
  reviewThreadCount,
  auditEventCount,
  navigator,
}: {
  workspaceId: string;
  taskId: string;
  topicStatus: string;
  templateMode: string;
  itemData: Record<string, unknown>;
  reviewMode: boolean;
  reviewThreadCount: number;
  auditEventCount: number;
  navigator: TopicNavigatorModel;
}) {
  const readOnly = topicStatus !== "drafting" && topicStatus !== "revising";
  const prompt = promptPreview(itemData);
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
      <section
        className="rounded-md p-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <div className="lbl" style={{ color: "var(--mute)" }}>
          CURRENT ITEM
        </div>
        <p
          className="ts-12 mt-2"
          style={{ color: "var(--mute)", lineHeight: 1.55 }}
        >
          {prompt}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Mini label="MODE" value={formatMode(templateMode)} />
          <Mini label="STATUS" value={formatStatus(topicStatus)} />
          <Mini
            label="FEEDBACK"
            value={
              reviewThreadCount > 0 ? `${reviewThreadCount} notes` : "none"
            }
          />
          <Mini
            label="AUDIT"
            value={
              auditEventCount > 0 ? `${auditEventCount} events` : "pending"
            }
          />
          <Mini
            label="ITEM"
            value={`${navigator.position}/${navigator.total}`}
          />
        </div>
      </section>

      <section
        className="rounded-md p-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <div className="lbl" style={{ color: "var(--mute)" }}>
          WORKFLOW
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          <Step icon={<FileText size={14} />} label="Read source item" done />
          <Step
            icon={readOnly ? <Lock size={14} /> : <Save size={14} />}
            label={readOnly ? "Read-only review state" : "Autosave draft"}
            done={readOnly || topicStatus === "revising"}
          />
          <Step
            icon={<ClipboardCheck size={14} />}
            label="Submit annotation"
            done={[
              "submitted",
              "ai_review",
              "reviewing",
              "awaiting_acceptance",
              "approved",
            ].includes(topicStatus)}
          />
          <Step
            icon={<Sparkles size={14} />}
            label="AI pre-review"
            done={["reviewing", "awaiting_acceptance", "approved"].includes(
              topicStatus,
            )}
          />
          {(topicStatus === "revising" || reviewThreadCount > 0) && (
            <Step
              icon={<Inbox size={14} />}
              label="Reviewer feedback"
              done={reviewThreadCount > 0}
            />
          )}
        </div>
      </section>

      <section
        className="rounded-md p-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <div className="lbl" style={{ color: "var(--mute)" }}>
          QUICK LINKS
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <SideLink
            href={`/my/tasks/${taskId}`}
            icon={<ListChecks size={14} />}
          >
            Back to task
          </SideLink>
          {navigator.nextHref ? (
            <SideLink
              href={navigator.nextHref}
              icon={<ChevronRight size={14} />}
            >
              Next item
            </SideLink>
          ) : null}
          {navigator.previousHref ? (
            <SideLink
              href={navigator.previousHref}
              icon={<ChevronLeft size={14} />}
            >
              Previous item
            </SideLink>
          ) : null}
          <SideLink href="/my/inbox" icon={<Inbox size={14} />}>
            Review feedback
          </SideLink>
          <SideLink
            href={`/workspaces/${workspaceId}/tasks/${taskId}/guidelines`}
            icon={<FileText size={14} />}
          >
            Task guidelines
          </SideLink>
          {reviewMode ? (
            <SideLink href="/review" icon={<ClipboardCheck size={14} />}>
              Review queue
            </SideLink>
          ) : null}
        </div>
      </section>
    </aside>
  );
}

/**
 * Warning banner for the silent-fallback case: the URL had an
 * `?annotationId=…` but it didn't resolve to a valid review context
 * for this topic. Without this banner the user sees a fresh-looking
 * draft form with no explanation of why review didn't load.
 *
 * Reasons it can fire:
 *   - annotation id doesn't exist
 *   - annotation belongs to a different workspace (cross-tenant click)
 *   - annotation belongs to a different topic on this workspace
 *
 * We don't differentiate the cause in the message — the user fix is
 * the same: go back to the queue and pick the right link.
 */
function ReviewLookupFailedBanner({
  workspaceId,
  topicId,
}: {
  workspaceId: string;
  topicId: string;
}) {
  return (
    <div
      className="rounded-md flex items-center justify-between gap-3 px-3 py-2"
      style={{
        background: "var(--warn-soft)",
        border: "1px solid oklch(0.6 0.14 75 / 0.4)",
      }}
    >
      <div className="ts-12">
        <span className="lbl" style={{ color: "oklch(0.55 0.14 75)" }}>
          § REVIEW UNAVAILABLE
        </span>
        <span className="ml-2" style={{ color: "var(--text)" }}>
          The annotation in the URL doesn&apos;t belong to this topic (or no
          longer exists). Falling back to your own draft view.
        </span>
      </div>
      <Link
        href={`/workspaces/${workspaceId}/topics/${topicId}/annotate`}
        className="ts-11 mono shrink-0"
        style={{
          color: "oklch(0.55 0.14 75)",
          textDecoration: "none",
        }}
      >
        clear url →
      </Link>
    </div>
  );
}

/**
 * Tiny banner that explains why the page is read-only and links back
 * to the user's own view of the topic. Mirrors the trajectory route's
 * equivalent so QC/admin flows feel consistent.
 */
function ReviewModeBanner({
  submitter,
  status,
  workspaceId,
  topicId,
}: {
  submitter: string;
  status: string;
  workspaceId: string;
  topicId: string;
}) {
  return (
    <div
      className="rounded-md flex items-center justify-between gap-3 px-3 py-2"
      style={{
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
      }}
    >
      <div className="ts-12">
        <span className="lbl" style={{ color: "var(--accent)" }}>
          § REVIEW MODE
        </span>
        <span className="ml-2" style={{ color: "var(--text)" }}>
          inspecting <strong style={{ color: "var(--hi)" }}>{submitter}</strong>
          &apos;s annotation · status{" "}
          <span className="mono" style={{ color: "var(--mute2)" }}>
            {status}
          </span>
        </span>
      </div>
      <Link
        href={`/workspaces/${workspaceId}/topics/${topicId}/annotate`}
        className="ts-11 mono shrink-0"
        style={{
          color: "var(--accent)",
          textDecoration: "none",
        }}
      >
        exit review →
      </Link>
    </div>
  );
}

function RevisionFeedbackBanner({
  status,
  messages,
}: {
  status: string;
  messages: ReviewThreadMessage[];
}) {
  const latest =
    [...messages]
      .reverse()
      .find((message) => message.authorRole !== "submitter") ??
    messages[messages.length - 1];
  const isRevision = status === "revising" || latest?.kind === "revised";
  const accent = isRevision ? "oklch(0.62 0.15 70)" : "var(--accent)";
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: isRevision
          ? "oklch(0.68 0.16 70 / 0.09)"
          : "var(--accent-soft)",
        border: `1px solid ${isRevision ? "oklch(0.68 0.16 70 / 0.36)" : "var(--accent-line)"}`,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex items-center justify-center rounded"
          style={{
            width: 28,
            height: 28,
            color: accent,
            background: "var(--bg)",
            border: "1px solid var(--line)",
          }}
        >
          <Inbox size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="lbl" style={{ color: accent }}>
              {isRevision ? "REVISION REQUEST" : "REVIEW FEEDBACK"}
            </span>
            <span className="ts-11 mono" style={{ color: "var(--mute2)" }}>
              {formatStatus(status)}
              {latest?.ts
                ? ` · ${latest.ts.toISOString().slice(0, 16).replace("T", " ")}`
                : ""}
            </span>
          </div>
          <p
            className="ts-13 mt-1"
            style={{
              color: "var(--text)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {latest?.message ||
              "A reviewer updated this annotation. Use the thread below to keep the repair context with the work."}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "accent" | "green" | "amber" | "muted";
}) {
  const palette = {
    accent: {
      fg: "var(--accent)",
      bg: "var(--accent-soft)",
      border: "var(--accent-line)",
    },
    green: {
      fg: "oklch(0.62 0.16 145)",
      bg: "oklch(0.62 0.16 145 / 0.08)",
      border: "oklch(0.62 0.16 145 / 0.34)",
    },
    amber: {
      fg: "oklch(0.68 0.16 70)",
      bg: "oklch(0.68 0.16 70 / 0.1)",
      border: "oklch(0.68 0.16 70 / 0.36)",
    },
    muted: {
      fg: "var(--mute)",
      bg: "var(--panel)",
      border: "var(--line)",
    },
  }[tone];
  return (
    <span
      className="ts-11 mono inline-flex items-center rounded px-2 py-1"
      style={{
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {label}
    </span>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded p-2"
      style={{ background: "var(--bg)", border: "1px solid var(--line)" }}
    >
      <div
        className="ts-10 mono"
        style={{ color: "var(--mute2)", letterSpacing: 0 }}
      >
        {label}
      </div>
      <div
        className="ts-12 mono mt-1"
        style={{ color: "var(--text)", fontWeight: 650 }}
      >
        {value}
      </div>
    </div>
  );
}

function buildTopicNavigator({
  workspaceId,
  taskId,
  topicId,
  topics,
}: {
  workspaceId: string;
  taskId: string;
  topicId: string;
  topics: Array<{ id: string }>;
}): TopicNavigatorModel {
  const currentIndex = topics.findIndex((row) => row.id === topicId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const hrefFor = (id: string) =>
    `/workspaces/${workspaceId}/topics/${id}/annotate`;
  const previous = currentIndex > 0 ? topics[currentIndex - 1] : null;
  const next =
    currentIndex >= 0 && currentIndex < topics.length - 1
      ? topics[currentIndex + 1]
      : null;
  return {
    position: topics.length > 0 ? safeIndex + 1 : 1,
    total: Math.max(topics.length, 1),
    previousHref: previous ? hrefFor(previous.id) : null,
    nextHref: next ? hrefFor(next.id) : null,
    skipHref: next ? hrefFor(next.id) : `/my/tasks/${taskId}`,
  };
}

function Step({
  icon,
  label,
  done,
}: {
  icon: ReactNode;
  label: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-flex items-center justify-center rounded"
        style={{
          width: 24,
          height: 24,
          color: done ? "oklch(0.62 0.16 145)" : "var(--mute2)",
          background: done ? "oklch(0.62 0.16 145 / 0.1)" : "var(--panel2)",
          border: `1px solid ${done ? "oklch(0.62 0.16 145 / 0.34)" : "var(--line)"}`,
        }}
      >
        {done ? <CheckCircle2 size={14} /> : icon}
      </span>
      <span className="ts-12" style={{ color: "var(--text)" }}>
        {label}
      </span>
    </div>
  );
}

function SideLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center gap-2 rounded px-2"
      style={{
        minHeight: 34,
        color: "var(--text)",
        background: "var(--bg)",
        border: "1px solid var(--line)",
        textDecoration: "none",
      }}
    >
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      {children}
    </Link>
  );
}

function promptPreview(itemData: Record<string, unknown>): string {
  const prompt = itemData.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    return clamp(prompt.trim(), 180);
  }
  const source = itemData.source ?? itemData.question ?? itemData.input;
  if (typeof source === "string" && source.trim()) {
    return clamp(source.trim(), 180);
  }
  return "This topic uses structured source data. Review the main panel for the full item payload.";
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatMode(mode: string): string {
  if (mode === "pair-rubric") return "Pair rubric";
  if (mode === "rubric-judgment") return "Rubric judgment";
  if (mode === "arena-gsb") return "Arena GSB";
  if (mode === "custom-designer") return "Custom form";
  if (mode === "agent-trace-eval") return "Agent trace";
  return mode;
}

function formatStatus(status: string): string {
  if (status === "drafting") return "Drafting";
  if (status === "revising") return "Revising";
  if (status === "submitted") return "Submitted";
  if (status === "ai_review") return "AI review";
  if (status === "reviewing") return "Human review";
  if (status === "awaiting_acceptance") return "Awaiting acceptance";
  if (status === "approved") return "Accepted";
  if (status === "rejected") return "Rejected";
  return status;
}

function topicStatusTone(
  status: string,
): "accent" | "green" | "amber" | "muted" {
  if (status === "approved") return "green";
  if (
    status === "revising" ||
    status === "ai_review" ||
    status === "reviewing"
  ) {
    return "amber";
  }
  if (status === "drafting") return "accent";
  return "muted";
}

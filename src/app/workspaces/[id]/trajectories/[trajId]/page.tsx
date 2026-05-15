import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { getTrajectoryWithSteps } from '@/lib/queries/trajectories'
import { getTrajectoryIAA, type StepIAA } from '@/lib/queries/iaa'
import { getGoldForTrajectory } from '@/lib/queries/gold-standards'
import {
  findUserAnnotationForTrajectory,
  getReviewThread,
  type ReviewThreadMessage,
} from '@/lib/queries/review-thread'
import { optionalUser, requireWorkspaceMember } from '@/lib/auth/guards'
import { getDb } from '@/lib/db/client'
import { users as usersTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listMyStepAnnotationsDemo } from '@/lib/actions/step-annotations-demo'
import type { stepAnnotations as stepAnnotationsTable, trajectorySteps } from '@/lib/db/schema'
import { StepMarkWidget } from '@/components/trajectory/step-mark-widget'
import { GoldPromoteClient } from '@/components/quality/gold-promote-client'
import { ReviewThread } from '@/components/quality/review-thread'
import { SummaryCard } from '@/components/trajectory/summary-card'
import { getCachedSummary } from '@/lib/actions/trajectory-summary'
import type { TrajectoryFeatures } from '@/lib/trajectories/extract-features'
import type { TrajectorySummary } from '@/lib/ai/trajectory-summarizer'

export const metadata: Metadata = {
  title: 'Trajectory — LabelHub',
}

/**
 * /workspaces/[id]/trajectories/[trajId]
 *
 * Read-only trajectory inspector. Server-rendered for fast first paint —
 * the data we display (steps + tool providers) is immutable once captured.
 *
 * This is the foundation surface the annotation widgets will graft onto:
 * each step row has its own column on the right where a rating + reasoning
 * textarea will live in the next iteration. Keeping it server-only for now
 * keeps the page cacheable + cheap to scroll.
 */
export default async function TrajectoryDetailPage(
  props: PageProps<'/workspaces/[id]/trajectories/[trajId]'>,
) {
  const { id: workspaceId, trajId } = await props.params

  let workspaceName = 'workspace'
  let dbError: string | null = null
  let bundle: Awaited<ReturnType<typeof getTrajectoryWithSteps>> = null
  let myMarks: Awaited<ReturnType<typeof listMyStepAnnotationsDemo>> = {}
  let iaaByStep = new Map<string, StepIAA>()
  let isAdmin = false
  let goldBlock: {
    id: string
    promotedAt: Date
    promotedBy: string | null
    explanation: string | null
    markCount: number
  } | null = null
  let reviewThread: ReviewThreadMessage[] = []
  let reviewAnnotationId: string | null = null
  let viewerIsSubmitter = false
  let summary: TrajectorySummary | null = null
  let summaryAt: Date | null = null
  let summaryModel: string | null = null
  let features: TrajectoryFeatures | null = null

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name

    const me = await optionalUser()
    if (me) {
      try {
        const { role } = await requireWorkspaceMember(workspaceId)
        isAdmin = role === 'admin' || workspace.adminId === me.id
      } catch {
        /* not a member — leave isAdmin = false */
      }

      // Surface the review thread when the viewer is the submitter
      // (they need to see + reply) OR an admin (they need to monitor).
      const annId = await findUserAnnotationForTrajectory({
        workspaceId,
        trajectoryId: trajId,
        userId: me.id,
      }).catch(() => null)
      if (annId) {
        reviewAnnotationId = annId
        viewerIsSubmitter = true
        reviewThread = await getReviewThread({ annotationId: annId }).catch(
          () => [],
        )
      }
    }

    bundle = await getTrajectoryWithSteps(trajId)
    if (bundle) {
      features = (bundle.trajectory.features ?? null) as TrajectoryFeatures | null
      summaryAt = bundle.trajectory.summaryAt ?? null
      summaryModel = bundle.trajectory.summaryModel ?? null
      summary = await getCachedSummary(trajId).catch(() => null)

      const [marks, iaa, gold] = await Promise.all([
        listMyStepAnnotationsDemo({
          workspaceId,
          trajectoryId: trajId,
        }),
        getTrajectoryIAA(trajId),
        getGoldForTrajectory({ workspaceId, trajectoryId: trajId }),
      ])
      myMarks = marks
      iaaByStep = new Map(iaa.map((s) => [s.trajectoryStepId, s]))
      if (gold) {
        const db = getDb()
        const [promoter] = await db
          .select({
            displayName: usersTable.displayName,
            email: usersTable.email,
          })
          .from(usersTable)
          .where(eq(usersTable.id, gold.promotedByUserId))
          .limit(1)
        const trajMarkCount = Object.keys(
          gold.correctAnswer.trajectoryMarks ?? {},
        ).length
        const stepMarkCount = Object.values(
          gold.correctAnswer.stepMarks ?? {},
        ).reduce((acc, m) => acc + Object.keys(m).length, 0)
        goldBlock = {
          id: gold.id,
          promotedAt: gold.promotedAt,
          promotedBy:
            promoter?.displayName ??
            promoter?.email?.split('@')[0] ??
            null,
          explanation: gold.explanation,
          markCount: trajMarkCount + stepMarkCount,
        }
      }
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  if (!dbError && !bundle) notFound()

  const demoMode = process.env.LABELHUB_DEMO_MODE === 'true'

  return (
    <div className="app-light min-h-screen">
      <Header
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        agentName={bundle?.trajectory.agentName ?? 'trajectory'}
        trajectoryId={trajId}
      />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        {dbError ? (
          <DbError message={dbError} />
        ) : bundle ? (
          <>
            <div className="mb-6">
              <SummaryCard
                summary={summary}
                features={features}
                summaryAt={summaryAt}
                summaryModel={summaryModel}
              />
            </div>
            {(goldBlock || isAdmin) && (
              <div className="mb-6">
                <GoldPromoteClient
                  workspaceId={workspaceId}
                  trajectoryId={trajId}
                  isAdmin={isAdmin}
                  gold={goldBlock}
                />
              </div>
            )}
            {reviewThread.length > 0 && reviewAnnotationId && (
              <div className="mb-6">
                <ReviewThread
                  annotationId={reviewAnnotationId}
                  messages={reviewThread}
                  canReply={viewerIsSubmitter}
                />
              </div>
            )}
            <Body
              workspaceId={workspaceId}
              trajectory={bundle.trajectory}
              steps={bundle.steps}
              providersById={bundle.providersById}
              myMarks={myMarks}
              demoMode={demoMode}
              iaaByStep={iaaByStep}
            />
          </>
        ) : null}
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout

function Header({
  workspaceId,
  workspaceName,
  agentName,
  trajectoryId,
}: {
  workspaceId: string
  workspaceName: string
  agentName: string
  trajectoryId: string
}) {
  return (
    <header
      className="hairline-b sticky top-0 z-10"
      style={{ background: 'var(--panel)' }}
    >
      <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
        <nav
          className="ts-12 mono flex items-center gap-1.5 min-w-0"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}`}
            className="truncate-1 hover:underline"
            style={{ color: 'var(--text)', maxWidth: 140 }}
          >
            {workspaceName}
          </Link>
          <span>/</span>
          <Link
            href={`/workspaces/${workspaceId}/trajectories`}
            className="hover:underline"
            style={{ color: 'var(--text)' }}
          >
            trajectories
          </Link>
          <span>/</span>
          <span
            className="truncate-1"
            style={{ color: 'var(--hi)', maxWidth: 260 }}
          >
            {agentName}
          </span>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href={`/workspaces/${workspaceId}/trajectories/${trajectoryId}/annotate`}
            className="lh-btn lh-btn-accent lh-btn-sm"
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '0 10px',
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 12,
              fontWeight: 500,
              gap: 6,
            }}
          >
            <span>§</span> Open annotator
          </Link>
          <Link
            href="/"
            className="ts-13 mono"
            style={{ color: 'var(--hi)' }}
            aria-label="LabelHub"
          >
            <span style={{ color: 'var(--accent)' }}>§</span> labelhub
          </Link>
        </div>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Body — split layout: timeline (left, 60%) + meta (right, 40%)

type StepRow = typeof trajectorySteps.$inferSelect
type ToolProvider = {
  id: string
  name: string
  kind: string
  identifier: string
}

function Body({
  workspaceId,
  trajectory,
  steps,
  providersById,
  myMarks,
  demoMode,
  iaaByStep,
}: {
  workspaceId: string
  trajectory: NonNullable<
    Awaited<ReturnType<typeof getTrajectoryWithSteps>>
  >['trajectory']
  steps: StepRow[]
  providersById: Map<string, ToolProvider>
  myMarks: Record<string, typeof stepAnnotationsTable.$inferSelect>
  demoMode: boolean
  iaaByStep: Map<string, StepIAA>
}) {
  const meta = (trajectory.meta ?? {}) as Record<string, unknown>
  const systemPrompt =
    typeof meta.systemPrompt === 'string' ? meta.systemPrompt : null

  const qcFlags = meta.qcFlags as
    | { reasons?: Array<{ kind: string; detail?: string }> }
    | null
    | undefined
  const qcReasons = qcFlags?.reasons ?? []

  const toolCatalog = Array.isArray(meta.toolCatalog)
    ? (meta.toolCatalog as Array<{
        kind: string
        name: string
        description?: string
        parameters?: unknown
      }>)
    : []
  const attachments = Array.isArray(meta.attachments)
    ? (meta.attachments as Array<{
        messageIndex: number
        blockIndex: number
        kind: string
        source: string
        mediaType?: string
        url?: string
        bytes?: number
        hashPrefix?: string
      }>)
    : []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="min-w-0">
        {qcReasons.length > 0 && <QcBanner reasons={qcReasons} />}
        <PromptCard label="ROOT PROMPT" body={trajectory.rootPrompt} />
        {systemPrompt && (
          <div className="mt-3">
            <PromptCard
              label="SYSTEM PROMPT"
              body={systemPrompt}
              muted
            />
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-3">
            <AttachmentsCard attachments={attachments} />
          </div>
        )}
        {toolCatalog.length > 0 && (
          <div className="mt-3">
            <ToolCatalogCard tools={toolCatalog} />
          </div>
        )}

        <div className="mt-8 mb-3 flex items-center gap-3">
          <div className="lbl">§ STEPS · CHRONOLOGICAL</div>
          <span
            className="ts-12 mono"
            style={{ color: 'var(--mute2)' }}
          >
            {steps.length} step{steps.length === 1 ? '' : 's'}
          </span>
        </div>

        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.id}>
              <StepCard
                step={s}
                provider={providerForStep(s, providersById)}
                workspaceId={workspaceId}
                existingMark={myMarks[s.id] ?? null}
                demoMode={demoMode}
                iaa={iaaByStep.get(s.id) ?? null}
              />
            </li>
          ))}
        </ol>

        {trajectory.finalResponse && (
          <div className="mt-8">
            <div className="lbl mb-2">§ FINAL RESPONSE</div>
            <div
              className="p-4 rounded-xl ts-14"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--accent-line)',
                color: 'var(--hi)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {trajectory.finalResponse}
            </div>
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-3">
        <MetaCard trajectory={trajectory} meta={meta} />
      </aside>
    </div>
  )
}

function providerForStep(
  s: StepRow,
  providersById: Map<string, ToolProvider>,
): ToolProvider | null {
  if (!s.toolProviderId) return null
  return providersById.get(s.toolProviderId) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Data-integrity warning banner — shows ALL QC reasons attached to a capture.
//
// Why this is more important than it looks: the worst failure mode of an
// annotation platform is "annotation correct × data wrong" — the label is
// faithful to what the annotator saw, but what they saw was corrupted bytes,
// truncated output, or an empty placeholder. The resulting labeled-data is
// poison for training. We never silently render flagged trajectories without
// telling the annotator.

const QC_COPY: Record<
  string,
  { title: string; explain: (detail?: string) => string }
> = {
  encoding: {
    title: 'ENCODING SUSPECT',
    explain: (d) =>
      `Captured bytes for ${d ?? 'some fields'} look mis-decoded — likely the client sent GBK / Shift-JIS bytes claiming to be UTF-8 (classic Windows curl symptom). The raw bytes are preserved as-is for audit; the model received this exact input.`,
  },
  truncated: {
    title: 'OUTPUT TRUNCATED',
    explain: (d) =>
      d === 'content_filter'
        ? 'The upstream content filter cut the response short. Do not rate this as a "wrong answer" — the model may have been on track but was stopped.'
        : 'The model hit a token limit and stopped mid-output. The visible answer is incomplete; rating it as "wrong" would be unfair to the agent.',
  },
  empty_response: {
    title: 'EMPTY RESPONSE',
    explain: () =>
      'The model returned no content AND no tool calls. This is usually an upstream bug or rate-limit event, not a real answer. Skip annotation.',
  },
}

function QcBanner({
  reasons,
}: {
  reasons: Array<{ kind: string; detail?: string }>
}) {
  return (
    <div
      className="mb-4 rounded-xl overflow-hidden"
      style={{
        background: 'oklch(0.7 0.14 75 / 0.08)',
        border: '1px solid oklch(0.7 0.14 75 / 0.4)',
      }}
    >
      <div
        className="px-4 py-2.5 flex items-center gap-2 ts-12 mono"
        style={{
          color: 'var(--warn)',
          background: 'oklch(0.7 0.14 75 / 0.12)',
          letterSpacing: '0.05em',
          borderBottom: '1px solid oklch(0.7 0.14 75 / 0.25)',
        }}
      >
        ⚠ DATA INTEGRITY · {reasons.length} flag{reasons.length === 1 ? '' : 's'}
      </div>
      <ul className="divide-y" style={{ borderColor: 'oklch(0.7 0.14 75 / 0.25)' }}>
        {reasons.map((r, i) => {
          const copy = QC_COPY[r.kind] ?? {
            title: r.kind.toUpperCase(),
            explain: () => 'No description available for this flag.',
          }
          return (
            <li
              key={`${r.kind}-${i}`}
              className="px-4 py-3 flex items-start gap-3"
              style={{
                borderTop: i === 0 ? 'none' : '1px solid oklch(0.7 0.14 75 / 0.25)',
              }}
            >
              <span
                className="ts-12 mono flex-shrink-0"
                style={{ color: 'var(--warn)', minWidth: 140, letterSpacing: '0.04em' }}
              >
                {copy.title}
              </span>
              <p className="ts-13" style={{ color: 'var(--text)' }}>
                {copy.explain(r.detail)}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachments card — multimodal hints

function AttachmentsCard({
  attachments,
}: {
  attachments: Array<{
    messageIndex: number
    blockIndex: number
    kind: string
    source: string
    mediaType?: string
    url?: string
    bytes?: number
    hashPrefix?: string
  }>
}) {
  // Count how many are actually viewable (have a URL we can render).
  const viewable = attachments.filter((a) => Boolean(a.url)).length
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <div
        className="px-4 py-2 ts-12 mono hairline-b flex items-center justify-between"
        style={{ color: 'var(--accent)' }}
      >
        <span>§ ATTACHMENTS</span>
        <span
          className="ts-12 mono"
          style={{ color: 'var(--mute2)' }}
        >
          {attachments.length} attached · {viewable} viewable
        </span>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {attachments.map((a, i) => (
          <li
            key={`${a.messageIndex}-${a.blockIndex}-${i}`}
            className="px-4 py-3"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex items-center gap-2">
                <KindIcon kind={a.kind} />
                <span
                  className="ts-13 mono"
                  style={{ color: 'var(--hi)' }}
                >
                  {a.mediaType ?? a.kind}
                </span>
                <SourceChip source={a.source} />
              </div>
              <div
                className="ts-12 mono whitespace-nowrap"
                style={{ color: 'var(--mute2)' }}
              >
                {a.bytes != null && <span>{formatBytes(a.bytes)} · </span>}
                msg #{a.messageIndex} blk #{a.blockIndex}
              </div>
            </div>
            {/* Inline preview when we have a URL and the kind is image. */}
            {a.url && a.kind === 'image' && (
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block mt-2 rounded-md overflow-hidden"
                style={{
                  border: '1px solid var(--line)',
                  maxWidth: 480,
                  background: 'var(--panel2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.mediaType ?? 'attachment'}
                  loading="lazy"
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: 320,
                    objectFit: 'contain',
                  }}
                />
              </a>
            )}
            {a.url && a.kind !== 'image' && (
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer noopener"
                className="ts-12 mono mt-1.5 truncate-1 inline-block hover:underline"
                style={{ color: 'var(--accent)', maxWidth: '100%' }}
                title={a.url}
              >
                {a.url}
              </a>
            )}
            {a.hashPrefix && (
              <div
                className="ts-12 mono mt-1"
                style={{ color: 'var(--mute2)' }}
              >
                sha256: {a.hashPrefix}…
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourceChip({ source }: { source: string }) {
  const map: Record<
    string,
    { color: string; bgColor: string; borderColor: string; label: string }
  > = {
    storage: {
      color: 'var(--accent)',
      bgColor: 'var(--accent-soft)',
      borderColor: 'var(--accent-line)',
      label: 'stored',
    },
    url: {
      color: 'var(--success)',
      bgColor: 'var(--success-soft)',
      borderColor: 'oklch(0.65 0.13 150 / 0.4)',
      label: 'remote URL',
    },
    'base64-inline': {
      color: 'var(--warn)',
      bgColor: 'oklch(0.7 0.14 75 / 0.08)',
      borderColor: 'oklch(0.7 0.14 75 / 0.4)',
      label: 'inline · not stored',
    },
  }
  const def = map[source] ?? {
    color: 'var(--mute)',
    bgColor: 'var(--panel)',
    borderColor: 'var(--line)',
    label: source,
  }
  return (
    <span
      className="badge"
      style={{
        color: def.color,
        background: def.bgColor,
        borderColor: def.borderColor,
      }}
    >
      {def.label}
    </span>
  )
}

function KindIcon({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    image: '🖼',
    document: '📄',
    audio: '🔊',
  }
  return (
    <span
      style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}
      aria-hidden
    >
      {map[kind] ?? '📎'}
    </span>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool catalog card — the menu the model picked from

function ToolCatalogCard({
  tools,
}: {
  tools: Array<{
    kind: string
    name: string
    description?: string
    parameters?: unknown
  }>
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <div
        className="px-4 py-2 ts-12 mono hairline-b flex items-center justify-between"
        style={{ color: 'var(--accent)' }}
      >
        <span>§ TOOLS OFFERED</span>
        <span
          className="ts-12 mono"
          style={{ color: 'var(--mute2)' }}
          title="The model was given this menu to choose from. Check which one(s) it actually called in the steps below."
        >
          {tools.length} available
        </span>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {tools.map((t, i) => (
          <li
            key={`${t.name}-${i}`}
            className="px-4 py-2.5"
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="badge"
                style={{
                  color: 'var(--accent)',
                  borderColor: 'var(--accent-line)',
                  background: 'var(--accent-soft)',
                }}
              >
                {t.kind}
              </span>
              <span
                className="ts-13 mono"
                style={{ color: 'var(--hi)', fontWeight: 500 }}
              >
                {t.name}
              </span>
            </div>
            {t.description && (
              <p
                className="ts-13 mt-1"
                style={{ color: 'var(--mute)', lineHeight: 1.5 }}
              >
                {t.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt card

function PromptCard({
  label,
  body,
  muted,
}: {
  label: string
  body: string
  muted?: boolean
}) {
  return (
    <div
      className="rounded-xl"
      style={{
        border: '1px solid var(--line)',
        background: muted ? 'var(--panel2)' : 'var(--panel)',
      }}
    >
      <div
        className="px-4 py-2 ts-12 mono hairline-b"
        style={{ color: muted ? 'var(--mute2)' : 'var(--accent)' }}
      >
        {label}
      </div>
      <div
        className="px-4 py-3 ts-14"
        style={{
          color: muted ? 'var(--mute)' : 'var(--hi)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {body}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step card — switches body shape by kind

function StepCard({
  step,
  provider,
  workspaceId,
  existingMark,
  demoMode,
  iaa,
}: {
  step: StepRow
  provider: ToolProvider | null
  workspaceId: string
  existingMark: typeof stepAnnotationsTable.$inferSelect | null
  demoMode: boolean
  iaa: StepIAA | null
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 hairline-b"
        style={{ background: 'var(--panel2)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="ts-12 mono"
            style={{ color: 'var(--mute2)', minWidth: 28 }}
          >
            #{step.sequence}
          </span>
          <KindPill kind={step.kind} />
          {provider && (
            <span
              className="ts-12 mono truncate-1"
              style={{ color: 'var(--mute)' }}
            >
              {provider.identifier}
            </span>
          )}
        </div>
        <StepMetaRow step={step} />
      </div>
      <div className="p-4">
        <StepBody step={step} />
      </div>
      {iaa && iaa.disputed && <DisputePanel iaa={iaa} />}
      {iaa && !iaa.disputed && iaa.raters.length >= 2 && (
        <ConsensusPanel iaa={iaa} />
      )}
      {demoMode && (
        <div
          className="px-4 py-3"
          style={{
            borderTop: '1px solid var(--line)',
            background: 'var(--panel2)',
          }}
        >
          <StepMarkWidget
            workspaceId={workspaceId}
            trajectoryStepId={step.id}
            existing={
              existingMark
                ? {
                    id: existingMark.id,
                    rating: existingMark.rating,
                    reasoning: existingMark.reasoning,
                  }
                : null
            }
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// IAA panels (per step)

function ratingLabel(r: number | null): { text: string; color: string } {
  if (r === 5) return { text: '✓ correct', color: 'var(--success)' }
  if (r === 3) return { text: '⚠ suspicious', color: 'var(--warn)' }
  if (r === 1) return { text: '✗ wrong', color: 'var(--danger)' }
  return { text: '?', color: 'var(--mute)' }
}

function DisputePanel({ iaa }: { iaa: StepIAA }) {
  return (
    <div
      className="px-4 py-3"
      style={{
        borderTop: '1px solid oklch(0.6 0.2 25 / 0.4)',
        background: 'oklch(0.6 0.2 25 / 0.06)',
      }}
    >
      <div
        className="ts-12 mono mb-2 flex items-center gap-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.04em' }}
      >
        ⚡ ANNOTATORS DISAGREE
        <span style={{ color: 'var(--mute)' }}>
          (rating spread = {iaa.spread})
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {iaa.raters.map((r) => {
          const lab = ratingLabel(r.rating)
          return (
            <li
              key={r.userId}
              className="ts-13 flex items-start gap-2"
            >
              <span
                className="mono"
                style={{
                  color: 'var(--mute2)',
                  minWidth: 110,
                  flexShrink: 0,
                }}
              >
                {r.displayName ?? r.userId.slice(0, 8)}
              </span>
              <span
                className="mono"
                style={{
                  color: lab.color,
                  fontWeight: 600,
                  minWidth: 110,
                  flexShrink: 0,
                }}
              >
                {lab.text}
              </span>
              <span style={{ color: 'var(--text)' }}>{r.reasoning}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ConsensusPanel({ iaa }: { iaa: StepIAA }) {
  return (
    <div
      className="px-4 py-2 ts-12 mono flex items-center gap-2"
      style={{
        borderTop: '1px solid var(--line)',
        background: 'var(--success-soft)',
        color: 'var(--success)',
        letterSpacing: '0.04em',
      }}
    >
      ✓ {iaa.raters.length} raters in agreement
      <span style={{ color: 'var(--mute)' }}>(spread ≤ 1)</span>
    </div>
  )
}

function StepMetaRow({ step }: { step: StepRow }) {
  const bits: string[] = []
  if (step.tokensIn != null) bits.push(`in ${step.tokensIn}`)
  if (step.tokensOut != null) bits.push(`out ${step.tokensOut}`)
  if (step.latencyMs != null) bits.push(`${step.latencyMs}ms`)
  if (step.modelName) bits.push(step.modelName)
  if (bits.length === 0) return null
  return (
    <div
      className="ts-12 mono whitespace-nowrap"
      style={{ color: 'var(--mute2)' }}
    >
      {bits.join(' · ')}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step body — kind-aware renderer

function StepBody({ step }: { step: StepRow }) {
  const c = (step.content ?? {}) as Record<string, unknown>
  switch (step.kind) {
    case 'thinking':
      return (
        <div
          className="ts-14"
          style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}
        >
          {String(c.text ?? '')}
        </div>
      )
    case 'final_response':
      return (
        <div
          className="ts-14"
          style={{ color: 'var(--hi)', whiteSpace: 'pre-wrap' }}
        >
          {String(c.text ?? '')}
        </div>
      )
    case 'tool_call':
      return (
        <div className="flex flex-col gap-2">
          <div className="ts-13 mono" style={{ color: 'var(--accent)' }}>
            {String(c.toolName ?? 'unknown_tool')}(
            <span style={{ color: 'var(--mute2)' }}>
              {String(c.toolCallId ?? '')}
            </span>
            )
          </div>
          <CodeBlock label="ARGS" code={prettyJson(c.args)} />
        </div>
      )
    case 'tool_result':
      return (
        <div className="flex flex-col gap-2">
          <div
            className="ts-12 mono"
            style={{ color: 'var(--mute2)' }}
          >
            for {String(c.toolCallId ?? '')}{' '}
            {c.isError ? (
              <span style={{ color: 'var(--danger)' }}>· ERROR</span>
            ) : null}
          </div>
          <CodeBlock label="OUTPUT" code={prettyJson(c.output)} />
        </div>
      )
    case 'sub_agent_call':
      return (
        <div className="flex flex-col gap-2">
          <div className="ts-13 mono" style={{ color: 'var(--accent)' }}>
            → {String(c.subAgentName ?? '')}
          </div>
          <CodeBlock label="INPUT" code={prettyJson(c.input)} />
        </div>
      )
    case 'sub_agent_response':
      return (
        <div className="flex flex-col gap-2">
          <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            ← {String(c.subAgentCallId ?? '')}
          </div>
          <CodeBlock label="OUTPUT" code={prettyJson(c.output)} />
        </div>
      )
    case 'error':
      return (
        <div
          className="ts-13 mono p-3 rounded-md"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {String(c.message ?? '')}
          {c.code ? (
            <div className="mt-1 ts-12" style={{ color: 'var(--mute)' }}>
              {String(c.code)}
            </div>
          ) : null}
        </div>
      )
    default:
      return <CodeBlock label="CONTENT" code={prettyJson(c)} />
  }
}

function prettyJson(v: unknown): string {
  if (v == null) return '(empty)'
  if (typeof v === 'string') {
    // Strings that look like JSON get pretty-printed.
    const trimmed = v.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        return v
      }
    }
    return v
  }
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-md overflow-hidden">
      <div
        className="px-3 py-1.5 ts-12 mono"
        style={{
          background: 'var(--code-bg2)',
          color: 'var(--code-mute)',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <pre
        className="ts-12 mono p-3 m-0 overflow-x-auto"
        style={{
          background: 'var(--code-bg)',
          color: 'var(--code-text)',
          whiteSpace: 'pre',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {code}
      </pre>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Kind pill

const KIND_TONE: Record<string, string> = {
  thinking: '',
  tool_call: 'violet',
  tool_result: 'green',
  sub_agent_call: 'violet',
  sub_agent_response: 'green',
  final_response: 'runn',
  error: 'red',
}

function KindPill({ kind }: { kind: string }) {
  const tone = KIND_TONE[kind] ?? ''
  return <span className={`badge ${tone}`}>{kind}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta sidebar

function MetaCard({
  trajectory,
  meta,
}: {
  trajectory: NonNullable<
    Awaited<ReturnType<typeof getTrajectoryWithSteps>>
  >['trajectory']
  meta: Record<string, unknown>
}) {
  const created = new Date(trajectory.createdAt)
  const usage = meta.usage as
    | {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    | null
    | undefined

  return (
    <div
      className="rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div className="px-4 py-2 ts-12 mono hairline-b" style={{ color: 'var(--accent)' }}>
        § META
      </div>
      <dl className="px-4 py-3 ts-13 flex flex-col gap-2.5">
        <Row label="agent" value={trajectory.agentName} />
        <Row label="source" value={trajectory.source} />
        <Row
          label="model"
          value={
            typeof meta.responseModel === 'string'
              ? meta.responseModel
              : (meta.requestModel as string | undefined)
          }
        />
        <Row
          label="finish"
          value={
            typeof meta.finishReason === 'string' ? meta.finishReason : undefined
          }
        />
        <Row
          label="provider"
          value={typeof meta.provider === 'string' ? meta.provider : undefined}
        />
        <Row label="schema" value={trajectory.schemaVersion} />
        <Row label="created" value={created.toLocaleString()} mono />
        {usage && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--line)' }} />
            <Row label="tokens in" value={usage.prompt_tokens} mono />
            <Row label="tokens out" value={usage.completion_tokens} mono />
            <Row label="total" value={usage.total_tokens} mono />
            {usage.completion_tokens_details?.reasoning_tokens != null && (
              <Row
                label="reasoning"
                value={usage.completion_tokens_details.reasoning_tokens}
                mono
                accent
              />
            )}
          </>
        )}
        {/* Agent config — the parameters the client passed in. Important for
            annotation reproducibility: an annotator judging output quality
            needs to see whether temperature was 0 or 1, what tool_choice
            forced, and so on. */}
        {hasAgentConfig(meta) && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--line)' }} />
            <Row
              label="temperature"
              value={pickNumber(meta.temperature)}
              mono
            />
            <Row label="max tokens" value={pickNumber(meta.maxTokens)} mono />
            <Row label="top_p" value={pickNumber(meta.topP)} mono />
            <Row label="top_k" value={pickNumber(meta.topK)} mono />
            <Row label="seed" value={pickNumber(meta.seed)} mono />
            <Row
              label="tool_choice"
              value={summarizeToolChoice(meta.toolChoice)}
              mono
              small
            />
            <Row
              label="response_format"
              value={summarizeResponseFormat(meta.responseFormat)}
              mono
              small
            />
            <Row
              label="parallel_tool_calls"
              value={pickBool(
                meta.parallelToolCalls ?? meta.disableParallelToolUse != null
                  ? !meta.disableParallelToolUse
                  : undefined,
              )}
              mono
              small
            />
            <Row
              label="service_tier"
              value={
                typeof meta.serviceTier === 'string' ? meta.serviceTier : null
              }
              mono
              small
            />
          </>
        )}
        {typeof meta.upstreamId === 'string' && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid var(--line)' }} />
            <Row label="upstream id" value={meta.upstreamId} mono small />
          </>
        )}
        {typeof trajectory.taskId === 'string' && trajectory.taskId && (
          <Row label="task id" value={trajectory.taskId} mono small />
        )}
      </dl>
    </div>
  )
}

// ── meta helpers ─────────────────────────────────────────────────────────

/** Does meta have at least one agent-config field worth showing? */
function hasAgentConfig(meta: Record<string, unknown>): boolean {
  const keys = [
    'temperature',
    'maxTokens',
    'topP',
    'topK',
    'seed',
    'toolChoice',
    'responseFormat',
    'parallelToolCalls',
    'disableParallelToolUse',
    'serviceTier',
  ]
  return keys.some((k) => meta[k] != null && meta[k] !== '')
}

function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function pickBool(v: unknown): string | null {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return null
}

/**
 * tool_choice can be:
 *   'auto' | 'none' | 'required' | 'any'           (string)
 *   { type: 'function', function: { name } }       (OpenAI)
 *   { type: 'tool', name }                          (Anthropic)
 * Render a compact label.
 */
function summarizeToolChoice(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const fn = obj.function as { name?: string } | undefined
    const name = (typeof obj.name === 'string' && obj.name) || fn?.name
    if (name) return `force: ${name}`
    if (typeof obj.type === 'string') return obj.type
  }
  return JSON.stringify(v).slice(0, 50)
}

/** { type: 'json_object' } / { type: 'json_schema', json_schema: {...} } */
function summarizeResponseFormat(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if (typeof obj.type === 'string') {
      const schema = obj.json_schema as { name?: string } | undefined
      if (obj.type === 'json_schema' && schema?.name)
        return `json_schema:${schema.name}`
      return obj.type
    }
  }
  return JSON.stringify(v).slice(0, 50)
}

function Row({
  label,
  value,
  mono,
  small,
  accent,
}: {
  label: string
  value?: string | number | null
  mono?: boolean
  small?: boolean
  accent?: boolean
}) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-baseline gap-3">
      <dt
        className="ts-12 mono uppercase"
        style={{
          color: 'var(--mute2)',
          letterSpacing: '0.04em',
          minWidth: 92,
        }}
      >
        {label}
      </dt>
      <dd
        className={mono ? 'mono' : ''}
        style={{
          color: accent ? 'var(--accent)' : 'var(--hi)',
          fontSize: small ? 11 : 13,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </dd>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Error state

function DbError({ message }: { message: string }) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.05em' }}
      >
        § DATABASE NOT REACHABLE
      </div>
      <p className="ts-13" style={{ color: 'var(--text)' }}>
        Couldn&apos;t load this trajectory.
      </p>
      <pre
        className="mt-4 ts-12 mono p-3 overflow-auto whitespace-pre-wrap"
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
    </div>
  )
}

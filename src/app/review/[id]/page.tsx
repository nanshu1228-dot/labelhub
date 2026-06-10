import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { optionalUser, requireWorkspaceQC } from '@/lib/auth/guards'
import { loadAnnotationDetail } from '@/lib/queries/annotation-detail'
import {
  getAnnotationAuditTimeline,
  type TimelineEntry,
} from '@/lib/queries/annotation-timeline'
import { ReviewDetail } from '@/components/review/review-detail'
import { AnnotationAuditTimeline } from '@/components/quality/annotation-audit-timeline'

export const metadata: Metadata = {
  title: 'Review annotation — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /review/[id] — Finals P3 D11.
 *
 * Single-annotation reviewer surface. Auth: QC or admin in the
 * annotation's workspace. Non-reviewers → 404.
 *
 * Renders the submitted payload (read-only via Renderer for
 * custom-designer tasks; JSON for legacy modes), the latest AI
 * verdict + scoring breakdown, the field-level diff against the
 * previous revision, and the role-aware human decision controls
 * (QC pass / send back; admin accept / reject / send back).
 */
export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/review/${id}`)

  const detail = await loadAnnotationDetail(id)
  if (!detail) notFound()

  // QC or admin in the annotation's workspace.
  let reviewerRole: 'admin' | 'qc'
  try {
    const membership = await requireWorkspaceQC(detail.task.workspaceId)
    reviewerRole = membership.role as 'admin' | 'qc'
  } catch {
    notFound()
  }

  // §4.4 — full AI→human chronology (including AI failures/retries) for
  // this annotation, mirroring the labeler annotate + trajectory pages.
  // Soft-fail to an empty list so a timeline hiccup never 500s the
  // reviewer workbench.
  const auditTimeline = await getAnnotationAuditTimeline({
    annotationId: id,
  }).catch(() => [] as TimelineEntry[])

  return (
    <main
      className="min-h-screen px-4 py-6 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <nav
          className="ts-12 mono flex items-center gap-2 flex-wrap"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href="/review"
            className="rounded"
            style={{
              color: 'var(--mute)',
              textDecoration: 'none',
              minHeight: 32,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Review queue
          </Link>
          <span>/</span>
          <span>{detail.task.name}</span>
          <span>/</span>
          <span>{detail.topic.status}</span>
        </nav>

        <header className="flex flex-col gap-3">
          <div className="lbl">REVIEW WORKBENCH</div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1
                className="ts-24"
                style={{ color: 'var(--hi)', fontWeight: 560, margin: 0 }}
              >
                Human review
              </h1>
              <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
                {detail.task.name}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <MetaPill label="Submitted" value={formatSubmittedAt(detail.annotation.submittedAt)} />
              <MetaPill label="Mode" value={detail.task.templateMode} />
              <MetaPill label="Stage" value={detail.topic.status} />
            </div>
          </div>
        </header>

        <ReviewDetail
          detail={detail}
          viewerRole={reviewerRole}
          viewerUserId={me.id}
        />

        {auditTimeline.length > 0 && (
          <AnnotationAuditTimeline entries={auditTimeline} />
        )}
      </div>
    </main>
  )
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded ts-12 mono"
      style={{
        minHeight: 32,
        padding: '0 10px',
        color: 'var(--text)',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        maxWidth: 320,
      }}
    >
      <span style={{ color: 'var(--mute2)' }}>{label}</span>
      <span className="truncate">{value}</span>
    </span>
  )
}

function formatSubmittedAt(d: Date | null): string {
  if (!d) return 'Unknown'
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  optionalUser,
  requireWorkspaceQC,
} from '@/lib/auth/guards'
import { loadAnnotationDetail } from '@/lib/queries/annotation-detail'
import { qcReviewAnnotation } from '@/lib/actions/qc-review'
import { ReviewDetail } from '@/components/review/review-detail'

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
 * previous revision, and the human decision form (pass /
 * request_revision).
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
  try {
    await requireWorkspaceQC(detail.task.workspaceId)
  } catch {
    notFound()
  }

  return (
    <main
      className="min-h-screen p-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <nav
        className="ts-12 mono mb-4 flex items-center gap-2 flex-wrap"
        style={{ color: 'var(--mute2)' }}
      >
        <Link
          href="/review"
          style={{ color: 'var(--mute)', textDecoration: 'none' }}
        >
          ← Review queue
        </Link>
        <span>·</span>
        <span>{detail.task.name}</span>
        <span>·</span>
        <span>{detail.topic.status}</span>
        <span>·</span>
        <span>
          submitted{' '}
          {detail.annotation.submittedAt?.toISOString().slice(0, 16).replace('T', ' ') ??
            'unknown'}
        </span>
      </nav>
      <ReviewDetail detail={detail} qcReview={qcReviewAnnotation} />
    </main>
  )
}

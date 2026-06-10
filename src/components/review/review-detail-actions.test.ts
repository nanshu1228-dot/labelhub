import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('review detail action surface', () => {
  it('uses the shared role-aware verdict controls instead of a QC-only form', async () => {
    const detailSrc = await readSrc('src/components/review/review-detail.tsx')
    const pageSrc = await readSrc('src/app/review/[id]/page.tsx')

    expect(detailSrc).toContain('ReviewVerdictControls')
    expect(detailSrc).toContain('viewerRole={viewerRole}')
    expect(detailSrc).toContain('viewerIsSubmitter=')
    expect(detailSrc).not.toContain('qcReview:')
    expect(detailSrc).not.toContain("applyDecision('pass')")

    expect(pageSrc).toContain('reviewerRole')
    expect(pageSrc).toContain('viewerRole={reviewerRole}')
    expect(pageSrc).toContain('viewerUserId={me.id}')
    expect(pageSrc).not.toContain('qcReviewAnnotation')
  })
})

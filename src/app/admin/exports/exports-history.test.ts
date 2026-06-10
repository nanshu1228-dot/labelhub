import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Export-history contract tests — Finals D21-D.
 *
 * Source-byte assertions over the page + the route changes to pin
 * the wiring contract. Runtime behavior is exercised end-to-end via
 * the manual `npm run seed:finals-demo` + browser smoke; here we
 * just guarantee the integration points stay connected after
 * future refactors.
 */

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('/admin/exports page wiring', () => {
  it('uses listMyExportJobs + handles empty state with a CTA', async () => {
    const src = await readSrc('src/app/admin/exports/page.tsx')
    expect(src).toContain(
      "import { listMyExportJobs, type ExportJobRow } from '@/lib/queries/export-jobs'",
    )
    expect(src).toContain('ExportJobLiveCells')
    expect(src).toContain('No export jobs yet')
  })

  it('signed-out users redirected to /signin', async () => {
    const src = await readSrc('src/app/admin/exports/page.tsx')
    expect(src).toContain("redirect('/signin?next=/admin/exports')")
  })

  it('renders live status/download cells per row', async () => {
    const src = await readSrc('src/app/admin/exports/page.tsx')
    expect(src).toContain('toLiveJob(job)')
    const client = await readSrc(
      'src/components/export/export-job-live-cells.tsx',
    )
    expect(client).toContain("'use client'")
    expect(client).toContain('window.setInterval(poll, 2_500)')
    expect(client).toContain('window.location.assign(body.downloadUrl)')
  })
})

describe('GET /api/export/jobs/[id]', () => {
  it('requires workspace admin on the job row', async () => {
    const src = await readSrc('src/app/api/export/jobs/[id]/route.ts')
    expect(src).toContain('requireWorkspaceAdmin(job.workspaceId)')
  })

  it('returns a 60s-TTL signed URL when status=completed', async () => {
    const src = await readSrc('src/app/api/export/jobs/[id]/route.ts')
    expect(src).toContain('createSignedUrl(job.storagePath, 60)')
  })

  it('404s on missing job (no existence leak)', async () => {
    const src = await readSrc('src/app/api/export/jobs/[id]/route.ts')
    expect(src).toContain("'NOT_FOUND', 'Export job not found.', 404")
  })
})

describe('GET /api/export/dataset — async-job branch (D21-D)', () => {
  it('enqueues an export_jobs row when estimated bytes ≥ threshold', async () => {
    const src = await readSrc('src/app/api/export/dataset/route.ts')
    expect(src).toContain('ASYNC_EXPORT_THRESHOLD_BYTES')
    expect(src).toContain('shouldGoAsync')
    expect(src).toMatch(/insert\(exportJobs\)/)
  })

  it('processes the job in the after() window', async () => {
    const src = await readSrc('src/app/api/export/dataset/route.ts')
    expect(src).toContain("import { NextResponse, type NextRequest, after }")
    expect(src).toMatch(/after\(async \(\) => \{/)
  })

  it('uploads the artifact via uploadExportArtifact', async () => {
    const src = await readSrc('src/app/api/export/dataset/route.ts')
    expect(src).toContain('await uploadExportArtifact')
  })

  it('Excel jobs use a higher avgBytesPerRow estimate so they cross the threshold faster', async () => {
    const src = await readSrc('src/app/api/export/dataset/route.ts')
    expect(src).toMatch(
      /avgBytesPerRow:\s*encoding\s*===\s*'excel'\s*\?\s*4_000\s*:\s*2_000/,
    )
  })

  it('returns 202 + { jobId, statusUrl } from the async branch', async () => {
    const src = await readSrc('src/app/api/export/dataset/route.ts')
    expect(src).toMatch(/status:\s*202/)
    expect(src).toMatch(/statusUrl:\s*`\/api\/export\/jobs\/\$\{job\.id\}`/)
  })

  it('passes optional field mapping into the selected formatter', async () => {
    const src = await readSrc('src/app/api/export/dataset/route.ts')
    expect(src).toContain('parseFieldMappingParam')
    expect(src).toContain('@/lib/export/mapping-param')
    expect(src).toContain('formatter(rowIterator(), formatOptions)')
  })
})

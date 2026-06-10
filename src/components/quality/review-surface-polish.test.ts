import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('review surface polish contracts', () => {
  it('keeps review-thread labels free of decorative glyph prefixes', async () => {
    const src = await readSrc('src/components/quality/review-thread.tsx')

    expect(src).not.toContain('§ REVIEW THREAD')
    expect(src).not.toContain("label: '✓")
    expect(src).not.toContain("label: '✗")
    expect(src).not.toContain("label: '↻")
    expect(src).not.toContain("label: '✦")
    expect(src).not.toContain("label: '↳")
  })

  it('keeps review decision notes free of section-marker glyphs', async () => {
    const src = await readSrc(
      'src/components/quality/review-verdict-controls.tsx',
    )

    expect(src).not.toContain('§ REVIEW')
    expect(src).not.toContain('§ {status')
    expect(src).not.toContain('§ YOUR ANNOTATION')
  })

  it('uses lucide icons instead of decorative glyphs in the audit timeline', async () => {
    const src = await readSrc(
      'src/components/quality/annotation-audit-timeline.tsx',
    )

    expect(src).toContain("from 'lucide-react'")
    expect(src).not.toContain('§ AUDIT TIMELINE')
    expect(src).not.toContain("dot: '")
    expect(src).not.toContain('🪄')
    expect(src).not.toContain('▶')
    expect(src).not.toContain('✗')
    expect(src).not.toContain('↻')
  })
})

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Responsive + touch-target contract tests — Finals D20-B.
 *
 * Source-byte assertions over the finals UX surfaces. CSS/breakpoint
 * regressions in this layer would not light up other unit tests
 * (they all run in JSDOM at a single fixed viewport), so we pin
 * the contract here:
 *
 *  - Designer + review-detail grids carry the responsive `<style>`
 *    block with media queries (no more hardcoded `gridTemplateColumns`).
 *  - Review table is wrapped in an `overflow-x: auto` scroll container.
 *  - Batch action / filter chip buttons all hit 36-44px minimum.
 *
 * If you change the breakpoint values, update this file to match.
 */

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('Designer responsive grid (D20-B)', () => {
  it('uses media-query CSS instead of a hardcoded 3-column grid', async () => {
    const src = await readSrc(
      'src/components/form-designer/designer-shell.tsx',
    )
    // The new responsive grid lives in a <style> block + uses a
    // named class so the breakpoints are inspectable.
    expect(src).toContain('lh-designer-grid')
    expect(src).toContain('@media (min-width: 1024px)')
    expect(src).toContain('@media (min-width: 1280px)')
    // The three layout regions are tagged via data-region so the
    // CSS can target them without coupling to element types.
    expect(src).toContain(`data-region="palette"`)
    expect(src).toContain(`data-region="canvas"`)
    expect(src).toContain(`data-region="properties"`)
    // The pre-finals hardcoded grid template is gone.
    expect(src).not.toContain(`gridTemplateColumns: '240px 1fr 320px'`)
  })
})

describe('Review-detail responsive grid (D20-B)', () => {
  it('stacks panes < 1024px and shows AI verdict first', async () => {
    const src = await readSrc('src/components/review/review-detail.tsx')
    expect(src).toContain('lh-review-detail-grid')
    expect(src).toContain('@media (min-width: 1024px)')
    // Below 1024px the right pane (AI verdict + decision form) gets
    // `order: -1` so it appears above the left pane (the read-only
    // form payload). Reviewer sees the AI signal first on tablet.
    expect(src).toContain(`data-pane='right'`)
    expect(src).toContain('order: -1')
    // The old hardcoded 2-col grid template is gone.
    expect(src).not.toContain(
      `gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 1fr)'`,
    )
  })
})

describe('Review-queue-table responsive (D20-B)', () => {
  it('table is wrapped in an overflow-x scroll container', async () => {
    const src = await readSrc(
      'src/components/review/review-queue-table.tsx',
    )
    expect(src).toContain('overflowX:')
    // Touch overflow is enabled for iOS Safari.
    expect(src).toContain('WebkitOverflowScrolling')
    // Table has an explicit minWidth so it can scroll horizontally
    // instead of collapsing columns when the viewport is narrow.
    expect(src).toMatch(/minWidth:\s*\d+/)
  })

  it('batch action buttons + filter chips all hit 36-44px touch targets', async () => {
    const src = await readSrc(
      'src/components/review/review-queue-table.tsx',
    )
    // Each of the 3 batch buttons sets minHeight: 40.
    const matches = src.match(/minHeight:\s*40/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
    // Native checkboxes are wrapped in 40×40 labels for the hit area.
    expect(src).toContain('width: 40, height: 40')
  })
})

describe('Queue page filter chips (D20-B)', () => {
  it('templateMode + workspace chips both hit ≥36px touch targets', async () => {
    const src = await readSrc('src/app/my/queue/page.tsx')
    // Both filter rows pull minHeight from a shared chipStyle helper.
    const minHeights = src.match(/minHeight:\s*36/g) ?? []
    expect(minHeights.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Review queue page filter chips (D20-B)', () => {
  it('FilterChip enforces ≥36px touch target', async () => {
    const src = await readSrc('src/app/review/page.tsx')
    expect(src).toMatch(/minHeight:\s*36/)
  })
})

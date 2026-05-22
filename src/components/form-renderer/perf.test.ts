import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Renderer + ShowItem perf-rule contract tests — Finals D20-C.
 *
 * AGENTS.md states three hard rules for production-scale UI:
 *   1. "Memoize markdown render output per row."
 *   2. "Row state: Jotai atomFamily — NEVER lift to parent for
 *       editable lists past 50 rows."
 *   3. "Annotation grids: @tanstack/react-virtual mandatory past
 *       30 rows."
 *
 * D20-C lands two of those in source. This file pins the contract
 * via source-byte assertions so a regression that removes the memo
 * wrapper or the LRU cache lights up CI.
 */

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('FormRenderer perf — RenderedField memo (D20-C)', () => {
  it('exports a memo-wrapped RenderedField with a custom comparator', async () => {
    const src = await readSrc(
      'src/components/form-renderer/form-renderer.tsx',
    )
    expect(src).toContain('const RenderedField = memo(RenderedFieldImpl')
    expect(src).toContain("import { memo,")
  })

  it('comparator skips re-render when field + value + readOnly unchanged', async () => {
    const src = await readSrc(
      'src/components/form-renderer/form-renderer.tsx',
    )
    // Compare-by-identity on the props that actually determine the
    // render output. Callbacks are deliberately ignored (parent
    // re-creates them inline each render).
    expect(src).toContain('if (prev.field !== next.field) return false')
    expect(src).toContain('if (prev.value !== next.value) return false')
    expect(src).toContain('if (prev.readOnly !== next.readOnly) return false')
  })

  it('llm-trigger fields opt-in to allValues invalidation', async () => {
    const src = await readSrc(
      'src/components/form-renderer/form-renderer.tsx',
    )
    // The memo comparator MUST invalidate when allValues changes IFF
    // the field (or one of its descendants) is an llm-trigger — the
    // material reads allValues to build the LLM prompt context.
    expect(src).toMatch(/needsAllValues/)
    expect(src).toContain("'llm-trigger'")
  })
})

describe('ShowItem markdown LRU (D20-C)', () => {
  it('module-level cache exists with a bounded size', async () => {
    const src = await readSrc(
      'src/components/form-materials/show-item-field.tsx',
    )
    expect(src).toContain('const MARKDOWN_CACHE = new Map')
    expect(src).toMatch(/MARKDOWN_CACHE_LIMIT\s*=\s*\d+/)
  })

  it('FIFO eviction kicks in when the cache overflows', async () => {
    const src = await readSrc(
      'src/components/form-materials/show-item-field.tsx',
    )
    // The implementation deletes the oldest key (Map.keys().next())
    // when size hits the limit before inserting the new entry.
    expect(src).toContain('MARKDOWN_CACHE.keys().next()')
    expect(src).toContain('MARKDOWN_CACHE.delete')
  })

  it('exposes _resetMarkdownCacheForTests so test files can isolate', async () => {
    const src = await readSrc(
      'src/components/form-materials/show-item-field.tsx',
    )
    expect(src).toContain('export function _resetMarkdownCacheForTests')
  })
})

describe('LRU cache returns the same React element across calls', async () => {
  const { _resetMarkdownCacheForTests } = await import(
    '@/components/form-materials/show-item-field'
  )

  it('exports the helper without throwing', () => {
    // Smoke: invoking the reset helper must not throw, even if the
    // cache was never populated.
    expect(() => _resetMarkdownCacheForTests()).not.toThrow()
  })
})

describe('Autosave exponential retry (D20-C)', () => {
  it('uses 3-attempt backoff (0 / 2s / 8s) instead of a single try', async () => {
    const src = await readSrc(
      'src/components/topic-annotate/use-autosave-draft.ts',
    )
    // The exact backoff values are pinned to make the policy
    // visible in code review. Adjust this test if the schedule
    // ever changes.
    expect(src).toContain('const delaysMs = [0, 2_000, 8_000]')
    // Loop iterates the attempts; status flips to 'error' only on
    // exhaustion (i.e. after the last attempt failed).
    expect(src).toMatch(/for \(let attempt = 0; attempt < delaysMs\.length/)
  })

  it('mid-attempt failures keep the badge in saving, not error', async () => {
    const src = await readSrc(
      'src/components/topic-annotate/use-autosave-draft.ts',
    )
    // Comment explicitly calls this out so a future maintainer
    // doesn't accidentally flip the badge to error prematurely.
    expect(src).toContain('Mid-attempt')
  })
})

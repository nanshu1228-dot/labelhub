import { describe, it, expect } from 'vitest'
import {
  detectShowItemRenderMode,
  type ShowItemRenderMode,
} from './show-item-field'

/**
 * ShowItem auto-detection + helper tests — Finals D19-A.
 *
 * The runtime component itself is JSX-heavy and tied to react-markdown;
 * its behavior matrix is exercised via source-byte checks + the pure
 * `detectShowItemRenderMode` helper here. The helper is what every
 * 'auto'-mode field calls at runtime, so its classification is the
 * key contract.
 */

describe('detectShowItemRenderMode — happy path classifications', () => {
  it('image URL (http) → image', () => {
    expect(
      detectShowItemRenderMode(
        'https://www.w3schools.com/w3css/img_lights.jpg',
      ),
    ).toBe<ShowItemRenderMode>('image')
  })

  it('image URL with query string → image', () => {
    expect(
      detectShowItemRenderMode('https://cdn.example.com/x.png?v=2'),
    ).toBe('image')
  })

  it('image data URI → image', () => {
    expect(
      detectShowItemRenderMode(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA',
      ),
    ).toBe('image')
  })

  it('mp4 URL → video', () => {
    expect(
      detectShowItemRenderMode('http://vjs.zencdn.net/v/oceans.mp4'),
    ).toBe('video')
  })

  it('webm URL → video', () => {
    expect(
      detectShowItemRenderMode('https://cdn.example.com/clip.webm'),
    ).toBe('video')
  })

  it('markdown with heading → markdown', () => {
    expect(
      detectShowItemRenderMode('# Heading\n\nSome body text.'),
    ).toBe('markdown')
  })

  it('markdown with image embed → markdown (not image)', () => {
    expect(
      detectShowItemRenderMode('Look:\n![alt](https://x/y.png)\nDone.'),
    ).toBe('markdown')
  })

  it('markdown with raw <video> tag → markdown', () => {
    // The qa_quality dataset's M0001 row uses raw HTML video inside
    // markdown. Detector should still classify the wrapper as
    // markdown so the markdown component renders the whole document
    // (which contains the video).
    expect(
      detectShowItemRenderMode(
        '# Title\n\n<video src="http://x/v.mp4"></video>',
      ),
    ).toBe('markdown')
  })

  it('plain text without markers → plain', () => {
    expect(detectShowItemRenderMode('just a string')).toBe('plain')
  })

  it('object → json', () => {
    expect(detectShowItemRenderMode({ a: 1, b: [2, 3] })).toBe('json')
  })

  it('array → json', () => {
    expect(detectShowItemRenderMode([1, 2, 3])).toBe('json')
  })

  it('number → plain (fallback)', () => {
    expect(detectShowItemRenderMode(42)).toBe('plain')
  })
})

describe('detectShowItemRenderMode — edge cases', () => {
  it('null → plain', () => {
    expect(detectShowItemRenderMode(null)).toBe('plain')
  })

  it('undefined → plain', () => {
    expect(detectShowItemRenderMode(undefined)).toBe('plain')
  })

  it('empty string → plain', () => {
    expect(detectShowItemRenderMode('')).toBe('plain')
  })

  it('whitespace-only string → plain', () => {
    expect(detectShowItemRenderMode('   \n   ')).toBe('plain')
  })

  it('non-http image URL not treated as image (security)', () => {
    expect(detectShowItemRenderMode('file:///etc/passwd.png')).toBe(
      'plain',
    )
  })

  it('javascript: pseudo-URL not treated as image (XSS guard)', () => {
    expect(
      detectShowItemRenderMode('javascript:alert(1)//x.png'),
    ).toBe('plain')
  })

  it('non-image data URI ignored', () => {
    expect(
      detectShowItemRenderMode('data:application/octet-stream;base64,xxx'),
    ).toBe('plain')
  })
})

describe('show-item-field source contract', () => {
  it('exports auto + video render modes (source byte check)', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        'src/components/form-materials/show-item-field.tsx',
      ),
      'utf-8',
    )
    // Property panel exposes all 7 options to the PM:
    for (const mode of [
      'auto',
      'plain',
      'markdown',
      'code',
      'json',
      'image',
      'video',
    ]) {
      expect(src).toContain(`value: '${mode}'`)
    }
    // Default config landed on 'auto'.
    expect(src).toMatch(/renderAs: 'auto'/)
    // Markdown branch wired via react-markdown + remark-gfm.
    expect(src).toContain("import ReactMarkdown from 'react-markdown'")
    expect(src).toContain("import remarkGfm from 'remark-gfm'")
    // Video branch present + goes through safeMediaUrl whitelist.
    expect(src).toContain('safeMediaUrl(value)')
    // Memoize markdown render (AGENTS.md perf rule).
    expect(src).toContain('useMemo')
  })
})

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('labeler UI polish contracts', () => {
  it('renders task guidelines with the sanitized Markdown preview surface', async () => {
    const src = await readSrc('src/app/my/tasks/[taskId]/page.tsx')

    expect(src).toContain("import ReactMarkdown from 'react-markdown'")
    expect(src).toContain("import remarkGfm from 'remark-gfm'")
    expect(src).toContain("import rehypeSanitize from 'rehype-sanitize'")
    expect(src).toContain('className="task-guidelines-preview"')
    expect(src).not.toContain('<pre')
  })

  it('keeps the flat queue free of debug glyphs and emoji badges', async () => {
    const page = await readSrc('src/app/my/queue/page.tsx')
    // The per-row difficulty chip (and its <Flame> icon) moved into this
    // client component when bulk-claim multi-select was added; scan both.
    const queueList = await readSrc('src/components/labeler/queue-topic-list.tsx')
    const src = page + queueList

    expect(page).not.toContain('§ FLAT QUEUE')
    expect(page).not.toContain('§ INBOX')
    expect(src).not.toContain('🔥')
    expect(src).not.toContain('⚡')
    // Difficulty + priority render as lucide icons, never raw glyphs.
    expect(src).toContain('<Flame size={12}') // difficulty chip (queue-topic-list)
    expect(src).toContain('<Zap size={12}') // trajectory priority (queue page)
  })

  it('uses icon components for inbox empty/type states instead of raw glyphs', async () => {
    const page = await readSrc('src/app/my/inbox/page.tsx')
    const client = await readSrc('src/components/inbox/inbox-client.tsx')

    expect(page).not.toContain('§ INBOX')
    expect(client).not.toContain('✶')
    expect(client).not.toContain("icon: '✓'")
    expect(client).not.toContain("icon: '×'")
    expect(client).toContain('BellOff')
    expect(client).toContain('RotateCcw')
  })
})

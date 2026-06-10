import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(rel: string): Promise<string> {
  return readFile(resolve(process.cwd(), rel), 'utf-8')
}

describe('Owner create task form', () => {
  it('renders guidelines as a markdown editor with sanitized preview', async () => {
    // The form is split across an orchestrator + its co-located parts file
    // (the subcomponents, including the markdown editor, live in
    // create-task-form-parts.tsx). Scan the module group as a whole.
    const [orchestrator, parts] = await Promise.all([
      readSrc('src/components/task-admin/create-task-form.tsx'),
      readSrc('src/components/task-admin/create-task-form-parts.tsx'),
    ])
    const src = `${orchestrator}\n${parts}`

    expect(src).toContain('function GuidelinesMarkdownEditor')
    expect(src).toContain('import ReactMarkdown from "react-markdown"')
    expect(src).toContain('import remarkGfm from "remark-gfm"')
    expect(src).toContain('import rehypeSanitize from "rehype-sanitize"')
    expect(src).toContain('Guidelines (shown to annotators)')
    expect(src).toContain('role="tablist"')
    expect(src).toContain('aria-label="Guidelines mode"')
    expect(src).toContain('task-guidelines-preview')
    expect(src).toContain('guidelinesMarkdown: guidelines.trim() || undefined')
    expect(src).toContain('javascript|vbscript|file')
  })
})

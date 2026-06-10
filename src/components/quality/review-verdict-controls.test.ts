import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function readSrc(): Promise<string> {
  return readFile(
    resolve(process.cwd(), 'src/components/quality/review-verdict-controls.tsx'),
    'utf-8',
  )
}

describe('ReviewVerdictControls UI contract', () => {
  it('uses an inline terminal-reject confirmation instead of browser confirm()', async () => {
    const src = await readSrc()

    expect(src).not.toContain('confirm(')
    expect(src).toContain('confirmingReject')
    expect(src).toContain('TERMINAL REJECT')
    expect(src).toContain('Reject annotation')
    expect(src).toContain('ShieldAlert')
  })

  it('gates the admin accept button on the two-stage review policy (spec 9.3)', async () => {
    const src = await readSrc()

    // The UI must reuse the server's policy predicate (single source of
    // truth) rather than re-deriving stage legality by hand …
    expect(src).toContain(
      "import { isBlockedByPolicy } from '@/lib/quality/state-machine'",
    )
    expect(src).toContain("isBlockedByPolicy(topicStatus, 'admin_accept'")
    // … and default to two-stage ON, mirroring DEFAULT_TASK_SETTINGS.
    expect(src).toContain('twoStage = true')
  })
})

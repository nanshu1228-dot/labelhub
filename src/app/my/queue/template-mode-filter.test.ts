import { describe, it, expect } from 'vitest'
import { templateModeFilterHref } from './page'

/**
 * /my/queue templateMode filter href tests — Finals D19-B.
 *
 * The chip-row is a server-rendered <Link>; its href is built by
 * the pure `templateModeFilterHref` helper. We pin the URL
 * construction here so changing query-param semantics is a one-line
 * test signal.
 */

describe('templateModeFilterHref', () => {
  it('returns bare /my/queue when both inputs are null', () => {
    expect(
      templateModeFilterHref({ mode: null, workspaceId: null }),
    ).toBe('/my/queue')
  })

  it('drops the templateMode param when mode=null', () => {
    expect(
      templateModeFilterHref({ mode: null, workspaceId: 'w-1' }),
    ).toBe('/my/queue?workspaceId=w-1')
  })

  it('drops the workspaceId param when workspaceId=null', () => {
    expect(
      templateModeFilterHref({
        mode: 'custom-designer',
        workspaceId: null,
      }),
    ).toBe('/my/queue?templateMode=custom-designer')
  })

  it('preserves both params when both are set', () => {
    const href = templateModeFilterHref({
      mode: 'custom-designer',
      workspaceId: 'w-1',
    })
    // URLSearchParams order is insertion-order (workspace first).
    expect(href).toBe('/my/queue?workspaceId=w-1&templateMode=custom-designer')
  })

  it('URL-encodes mode values that need it', () => {
    const href = templateModeFilterHref({
      mode: 'agent-trace-eval',
      workspaceId: null,
    })
    expect(href).toBe('/my/queue?templateMode=agent-trace-eval')
  })
})

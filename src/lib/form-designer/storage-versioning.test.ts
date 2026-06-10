import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/auth/guards', () => ({
  requireWorkspaceAdmin: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  loadCustomFormSchema,
  setWorkspaceTemplateFlag,
  updateCustomFormSchema,
} from './storage'
import { getDb } from '@/lib/db/client'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'

/**
 * Schema versioning + workspace template tests — Finals D21-B.
 *
 * D21-B turned `updateCustomFormSchema` from a mutating UPDATE into
 * an append-only INSERT (new row, new id, version+1, previousId
 * pointing at the prior row). The prior row stays immutable so
 * existing tasks pinned to that id keep rendering their frozen
 * schema. Spec section 5 calls this out by name ("schema 版本管理").
 *
 * `setWorkspaceTemplateFlag` toggles the workspace template flag —
 * a per-row boolean, no copy. Admin-only.
 */

const PRIOR_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  label: 'My template',
  schema: { version: 1 as const, fields: [] },
  version: 3,
  isTemplate: false,
  createdBy: '33333333-3333-4333-8333-333333333333',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  archivedAt: null as Date | null,
}

const NEW_ROW = {
  id: '44444444-4444-4444-8444-444444444444',
  version: 4,
}

function mountDb(opts: {
  prior?: typeof PRIOR_ROW | null
  inserted?: typeof NEW_ROW
  /** Captures the values supplied to the INSERT, if any. */
  capture?: { last?: unknown }
}) {
  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(opts.prior ? [opts.prior] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        if (opts.capture) opts.capture.last = v
        return {
          returning: () => Promise.resolve([opts.inserted ?? NEW_ROW]),
        }
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('updateCustomFormSchema — append-only versioning', () => {
  it('INSERTs a new row when label changes; returns NEW id + version', async () => {
    const captured: { last?: unknown } = {}
    mountDb({ prior: PRIOR_ROW, capture: captured })
    const result = await updateCustomFormSchema({
      id: PRIOR_ROW.id,
      workspaceId: PRIOR_ROW.workspaceId,
      label: 'Renamed template',
    })
    expect(result.id).toBe(NEW_ROW.id)
    expect(result.version).toBe(NEW_ROW.version)
    // Insert payload carries label='Renamed template' + prior schema +
    // version+1 + previousId pointing at the prior row.
    const insertValues = captured.last as {
      label: string
      version: number
      previousId: string
    }
    expect(insertValues.label).toBe('Renamed template')
    expect(insertValues.version).toBe(PRIOR_ROW.version + 1)
    expect(insertValues.previousId).toBe(PRIOR_ROW.id)
  })

  it('INSERTs a new row when schema changes; inherits label', async () => {
    const captured: { last?: unknown } = {}
    mountDb({ prior: PRIOR_ROW, capture: captured })
    await updateCustomFormSchema({
      id: PRIOR_ROW.id,
      workspaceId: PRIOR_ROW.workspaceId,
      schema: { version: 1, fields: [] },
    })
    const insertValues = captured.last as { label: string; schema: unknown }
    expect(insertValues.label).toBe(PRIOR_ROW.label)
  })

  it('preserves isTemplate flag across versions', async () => {
    const captured: { last?: unknown } = {}
    mountDb({
      prior: { ...PRIOR_ROW, isTemplate: true },
      capture: captured,
    })
    await updateCustomFormSchema({
      id: PRIOR_ROW.id,
      workspaceId: PRIOR_ROW.workspaceId,
      label: 'Tweaked',
    })
    const insertValues = captured.last as { isTemplate: boolean }
    expect(insertValues.isTemplate).toBe(true)
  })

  it('no-op (both label + schema undefined) returns the SAME id without INSERT', async () => {
    const captured: { last?: unknown } = {}
    mountDb({ prior: PRIOR_ROW, capture: captured })
    const result = await updateCustomFormSchema({
      id: PRIOR_ROW.id,
      workspaceId: PRIOR_ROW.workspaceId,
    })
    expect(result.id).toBe(PRIOR_ROW.id)
    expect(result.version).toBe(PRIOR_ROW.version)
    // No INSERT should have happened.
    expect(captured.last).toBeUndefined()
  })

  it('throws when the prior row is missing', async () => {
    mountDb({ prior: null })
    await expect(
      updateCustomFormSchema({
        id: PRIOR_ROW.id,
        workspaceId: PRIOR_ROW.workspaceId,
        label: 'x',
      }),
    ).rejects.toThrow(/not found/i)
  })

  it('requires workspace admin', async () => {
    mountDb({ prior: PRIOR_ROW })
    await updateCustomFormSchema({
      id: PRIOR_ROW.id,
      workspaceId: PRIOR_ROW.workspaceId,
      label: 'x',
    })
    expect(vi.mocked(requireWorkspaceAdmin)).toHaveBeenCalledWith(
      PRIOR_ROW.workspaceId,
    )
  })
})

describe('setWorkspaceTemplateFlag', () => {
  it('requires workspace admin', async () => {
    mountDb({})
    await setWorkspaceTemplateFlag({
      id: PRIOR_ROW.id,
      workspaceId: PRIOR_ROW.workspaceId,
      isTemplate: true,
    })
    expect(vi.mocked(requireWorkspaceAdmin)).toHaveBeenCalledWith(
      PRIOR_ROW.workspaceId,
    )
  })

  it('does not throw on valid input', async () => {
    mountDb({})
    await expect(
      setWorkspaceTemplateFlag({
        id: PRIOR_ROW.id,
        workspaceId: PRIOR_ROW.workspaceId,
        isTemplate: false,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('loadCustomFormSchema — archived runtime compatibility', () => {
  it('can load an archived schema when a pinned runtime explicitly asks for it', async () => {
    mountDb({
      prior: {
        ...PRIOR_ROW,
        archivedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    })

    const row = await loadCustomFormSchema({
      id: PRIOR_ROW.id,
      includeArchived: true,
    })

    expect(row?.id).toBe(PRIOR_ROW.id)
    expect(row?.version).toBe(PRIOR_ROW.version)
  })

  it('keeps archived schema reads opt-in for custom-designer task runtime paths', () => {
    const storageSrc = readFileSync(
      resolve(process.cwd(), 'src/lib/form-designer/storage.ts'),
      'utf8',
    )
    const annotatePageSrc = readFileSync(
      resolve(
        process.cwd(),
        'src/app/workspaces/[id]/topics/[topicId]/annotate/page.tsx',
      ),
      'utf8',
    )
    const annotationActionSrc = readFileSync(
      resolve(process.cwd(), 'src/lib/actions/annotations.ts'),
      'utf8',
    )

    expect(storageSrc).toContain('includeArchived?: boolean')
    expect(storageSrc).toContain('input.includeArchived')
    expect(storageSrc).toContain('isNull(customFormSchemas.archivedAt)')
    expect(annotatePageSrc).toContain('includeArchived: true')
    expect(annotationActionSrc).toContain('includeArchived: true')
  })
})

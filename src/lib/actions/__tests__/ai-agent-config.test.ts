import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}))
vi.mock('@/lib/auth/guards', () => ({
  requireWorkspaceAdmin: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  getAiAgentConfig,
  saveAiAgentConfig,
} from '../ai-agent-config'
import { getDb } from '@/lib/db/client'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

/**
 * AI Agent config security smoke — Finals P3 D13.
 *
 * The plan's gate: "non-owner cannot edit agent config". The
 * server action calls requireWorkspaceAdmin on both read AND write
 * paths (the Prompt itself can leak proprietary review criteria).
 * These tests verify the guard fires on every entry point.
 */

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN = { id: 'admin-1', email: 'admin@labelhub.dev' }

function mountDb(taskRow: unknown) {
  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(taskRow ? [taskRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  } as never)
}

const VALID_CONFIG = {
  enabled: true,
  promptTemplate: 'Review carefully.',
  dimensions: [
    { id: 'completeness', name: 'Completeness' },
    { id: 'accuracy', name: 'Accuracy' },
  ],
  passAt: 70,
  sendBackAt: 40,
  tier: 'fast' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAiAgentConfig — security', () => {
  it('throws NotFoundError when the task is missing', async () => {
    mountDb(null)
    await expect(
      getAiAgentConfig({ taskId: TASK_ID }),
    ).rejects.toThrow(NotFoundError)
    // Guard must NOT be called before the task is verified (avoids
    // leaking task existence to non-members).
    expect(vi.mocked(requireWorkspaceAdmin)).not.toHaveBeenCalled()
  })

  it('rejects non-admins with ForbiddenError', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'custom-designer',
      templateConfig: null,
    })
    vi.mocked(requireWorkspaceAdmin).mockRejectedValueOnce(
      new ForbiddenError('Workspace admin required.'),
    )
    await expect(
      getAiAgentConfig({ taskId: TASK_ID }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('returns the saved config to a workspace admin', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'pair-rubric',
      templateConfig: { aiAgent: VALID_CONFIG },
    })
    vi.mocked(requireWorkspaceAdmin).mockResolvedValueOnce({
      user: ADMIN,
      workspace: { id: WORKSPACE_ID } as never,
      role: 'admin' as const,
    })
    const result = await getAiAgentConfig({ taskId: TASK_ID })
    expect(result.config).toEqual(VALID_CONFIG)
    expect(result.workspaceId).toBe(WORKSPACE_ID)
    expect(vi.mocked(requireWorkspaceAdmin)).toHaveBeenCalledWith(
      WORKSPACE_ID,
    )
  })

  it('returns defaults when no config saved yet (custom-designer → enabled=true seed)', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'custom-designer',
      templateConfig: null,
    })
    vi.mocked(requireWorkspaceAdmin).mockResolvedValueOnce({
      user: ADMIN,
      workspace: { id: WORKSPACE_ID } as never,
      role: 'admin' as const,
    })
    const result = await getAiAgentConfig({ taskId: TASK_ID })
    expect(result.config.enabled).toBe(true)
    expect(result.config.dimensions.length).toBeGreaterThan(0)
  })

  it('returns defaults when no config saved yet (non-custom-designer → enabled=false)', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateMode: 'pair-rubric',
      templateConfig: null,
    })
    vi.mocked(requireWorkspaceAdmin).mockResolvedValueOnce({
      user: ADMIN,
      workspace: { id: WORKSPACE_ID } as never,
      role: 'admin' as const,
    })
    const result = await getAiAgentConfig({ taskId: TASK_ID })
    expect(result.config.enabled).toBe(false)
  })
})

describe('saveAiAgentConfig — security + validation', () => {
  it('throws NotFoundError on missing task', async () => {
    mountDb(null)
    await expect(
      saveAiAgentConfig({ taskId: TASK_ID, config: VALID_CONFIG }),
    ).rejects.toThrow(NotFoundError)
  })

  it('rejects non-admins with ForbiddenError', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateConfig: null,
    })
    vi.mocked(requireWorkspaceAdmin).mockRejectedValueOnce(
      new ForbiddenError('Workspace admin required.'),
    )
    await expect(
      saveAiAgentConfig({ taskId: TASK_ID, config: VALID_CONFIG }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('rejects sendBackAt >= passAt at the Zod refine layer', async () => {
    await expect(
      saveAiAgentConfig({
        taskId: TASK_ID,
        config: { ...VALID_CONFIG, sendBackAt: 70, passAt: 70 },
      }),
    ).rejects.toThrow()
  })

  it('rejects duplicate dimension ids', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateConfig: null,
    })
    vi.mocked(requireWorkspaceAdmin).mockResolvedValueOnce({
      user: ADMIN,
      workspace: { id: WORKSPACE_ID } as never,
      role: 'admin' as const,
    })
    await expect(
      saveAiAgentConfig({
        taskId: TASK_ID,
        config: {
          ...VALID_CONFIG,
          dimensions: [
            { id: 'dup', name: 'A' },
            { id: 'dup', name: 'B' },
          ],
        },
      }),
    ).rejects.toThrow(/unique/i)
  })

  it('admin save succeeds and the guard is called on the task workspace', async () => {
    mountDb({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      templateConfig: {},
    })
    vi.mocked(requireWorkspaceAdmin).mockResolvedValueOnce({
      user: ADMIN,
      workspace: { id: WORKSPACE_ID } as never,
      role: 'admin' as const,
    })
    await saveAiAgentConfig({
      taskId: TASK_ID,
      config: VALID_CONFIG,
    })
    expect(vi.mocked(requireWorkspaceAdmin)).toHaveBeenCalledWith(
      WORKSPACE_ID,
    )
  })

  it('rejects a Zod-bad uuid for taskId before touching the DB', async () => {
    await expect(
      saveAiAgentConfig({
        taskId: 'not-a-uuid',
        config: VALID_CONFIG,
      }),
    ).rejects.toThrow()
    expect(vi.mocked(requireWorkspaceAdmin)).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { users } from '@/lib/db/schema'
import { mirrorAuthUser } from './mirror-user'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    insert: mocks.insert,
    select: mocks.select,
    update: mocks.update,
  }),
}))

describe('mirrorAuthUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onConflictDoUpdate.mockResolvedValue(undefined)
    mocks.values.mockReturnValue({
      onConflictDoUpdate: mocks.onConflictDoUpdate,
    })
    mocks.insert.mockReturnValue({
      values: mocks.values,
    })
    mocks.limit.mockResolvedValue([])
    mocks.where.mockReturnValue({
      limit: mocks.limit,
    })
    mocks.from.mockReturnValue({
      where: mocks.where,
    })
    mocks.select.mockReturnValue({
      from: mocks.from,
    })
    mocks.updateWhere.mockResolvedValue(undefined)
    mocks.set.mockReturnValue({
      where: mocks.updateWhere,
    })
    mocks.update.mockReturnValue({
      set: mocks.set,
    })
  })

  it('creates or updates a local user row from Google metadata', async () => {
    const result = await mirrorAuthUser({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'google@example.com',
      metadata: { full_name: 'Google Person' },
    })

    expect(mocks.insert).toHaveBeenCalledWith(users)
    expect(mocks.values).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'google@example.com',
      displayName: 'Google Person',
    })
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: users.id,
        set: expect.objectContaining({
          email: 'google@example.com',
          displayName: expect.anything(),
        }),
      }),
    )
    expect(result).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      authId: '11111111-1111-4111-8111-111111111111',
      email: 'google@example.com',
      displayName: 'Google Person',
      usedExistingEmail: false,
    })
  })

  it('does not overwrite an existing display name when metadata is blank', async () => {
    await mirrorAuthUser({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'blank@example.com',
      metadata: { full_name: '   ' },
    })

    expect(mocks.values).toHaveBeenCalledWith({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'blank@example.com',
      displayName: null,
    })
    const updateArg = mocks.onConflictDoUpdate.mock.calls[0][0]
    expect(updateArg.set).toEqual({
      email: 'blank@example.com',
    })
  })

  it('reuses an existing local account when Google returns the same email with a new auth id', async () => {
    const conflict = Object.assign(new Error('duplicate email'), {
      code: '23505',
    })
    mocks.onConflictDoUpdate.mockRejectedValueOnce(conflict)
    mocks.limit.mockResolvedValueOnce([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'google@example.com',
        displayName: null,
      },
    ])

    const result = await mirrorAuthUser({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'google@example.com',
      metadata: { name: 'Google Person' },
    })

    expect(result).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      authId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'google@example.com',
      displayName: 'Google Person',
      usedExistingEmail: true,
    })
    expect(mocks.select).toHaveBeenCalledWith({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    expect(mocks.update).toHaveBeenCalledWith(users)
    expect(mocks.set).toHaveBeenCalledWith({ displayName: 'Google Person' })
  })
})

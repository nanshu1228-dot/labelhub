import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    insert: mocks.insert,
  }),
}))

describe('/auth/callback OAuth exchange', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.INSECURE_COOKIES = 'false'
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.PUBLIC_BASE_URL
    mocks.onConflictDoUpdate.mockResolvedValue(undefined)
    mocks.values.mockReturnValue({
      onConflictDoUpdate: mocks.onConflictDoUpdate,
    })
    mocks.insert.mockReturnValue({
      values: mocks.values,
    })
  })

  it('attaches Supabase session cookies to the final success redirect', async () => {
    mocks.createServerClient.mockImplementation((_url, _key, opts) => ({
      auth: {
        exchangeCodeForSession: vi.fn(async () => {
          opts.cookies.setAll(
            [
              {
                name: 'sb-access-token',
                value: 'access-token',
                options: { path: '/', httpOnly: true, sameSite: 'lax' },
              },
            ],
            { 'Cache-Control': 'private, no-cache' },
          )
          return {
            data: {
              user: {
                id: '11111111-1111-4111-8111-111111111111',
                email: 'google@example.com',
                user_metadata: { full_name: 'Google Person' },
              },
            },
            error: null,
          }
        }),
      },
    }))

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'https://aipert.top/auth/callback?code=oauth-code&next=/my/queue',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://aipert.top/my/queue')
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
    expect(response.headers.get('set-cookie')).toContain(
      'sb-access-token=access-token',
    )
    expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000')
    expect(mocks.values).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'google@example.com',
      displayName: 'Google Person',
    })
  })

  it('preserves explicit cookie deletion during OAuth cleanup', async () => {
    mocks.createServerClient.mockImplementation((_url, _key, opts) => ({
      auth: {
        exchangeCodeForSession: vi.fn(async () => {
          opts.cookies.setAll(
            [
              {
                name: 'sb-code-verifier',
                value: '',
                options: { path: '/', maxAge: 0 },
              },
            ],
            {},
          )
          return {
            data: {
              user: {
                id: '22222222-2222-4222-8222-222222222222',
                email: 'oauth@example.com',
                user_metadata: {},
              },
            },
            error: null,
          }
        }),
      },
    }))

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest('https://aipert.top/auth/callback?code=oauth-code'),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('set-cookie')).toContain('sb-code-verifier=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('set-cookie')).not.toContain('Max-Age=2592000')
  })

  it('redirects to the configured public origin behind nginx', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://aipert.top'
    mocks.createServerClient.mockImplementation((_url, _key, opts) => ({
      auth: {
        exchangeCodeForSession: vi.fn(async () => {
          opts.cookies.setAll(
            [
              {
                name: 'sb-access-token',
                value: 'access-token',
                options: { path: '/' },
              },
            ],
            {},
          )
          return {
            data: {
              user: {
                id: '33333333-3333-4333-8333-333333333333',
                email: 'origin@example.com',
                user_metadata: {},
              },
            },
            error: null,
          }
        }),
      },
    }))

    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://127.0.0.1:3001/auth/callback?code=oauth-code&next=/account',
      ),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://aipert.top/account')
  })
})

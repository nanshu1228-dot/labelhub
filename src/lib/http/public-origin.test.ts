import { describe, expect, it, vi } from 'vitest'
import { getPublicOrigin, publicUrl } from './public-origin'

describe('public origin helpers', () => {
  it('prefers configured public app URL over internal proxy URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://aipert.top')
    const request = new Request('http://127.0.0.1:3001/auth/callback')

    expect(getPublicOrigin(request)).toBe('https://aipert.top')
    expect(publicUrl('/account', request).toString()).toBe(
      'https://aipert.top/account',
    )
    vi.unstubAllEnvs()
  })

  it('falls back to forwarded headers', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const request = new Request('http://127.0.0.1:3001/auth/callback', {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'aipert.top',
      },
    })

    expect(getPublicOrigin(request)).toBe('https://aipert.top')
    vi.unstubAllEnvs()
  })
})

import { describe, expect, it } from 'vitest'
import { buildOAuthRedirectTo, getOAuthRedirectOrigin } from './oauth-redirect'

describe('OAuth redirect helpers', () => {
  it('prefers the configured public app URL over the current browser origin', () => {
    expect(
      buildOAuthRedirectTo(
        'https://labelhub-gamma.vercel.app',
        '/account',
        'https://aipert.top',
      ),
    ).toBe('https://aipert.top/auth/callback?next=%2Faccount')
  })

  it('falls back to the current browser origin when the configured URL is missing', () => {
    expect(
      buildOAuthRedirectTo(
        'https://labelhub-gamma.vercel.app',
        '/account',
        undefined,
      ),
    ).toBe('https://labelhub-gamma.vercel.app/auth/callback?next=%2Faccount')
  })

  it('ignores invalid configured URLs', () => {
    expect(
      getOAuthRedirectOrigin('https://aipert.top', 'not a url'),
    ).toBe('https://aipert.top')
  })

  it('encodes nested next paths safely', () => {
    expect(
      buildOAuthRedirectTo(
        'https://labelhub-gamma.vercel.app',
        '/projects?tab=mine',
        'https://aipert.top/',
      ),
    ).toBe(
      'https://aipert.top/auth/callback?next=%2Fprojects%3Ftab%3Dmine',
    )
  })
})

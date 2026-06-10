import { describe, expect, it } from 'vitest'
import {
  oauthCallbackPathFromSearchParams,
  oauthCallbackUrlFromEntrypoint,
} from './oauth-entrypoint'

describe('OAuth entrypoint rescue', () => {
  it('moves a root-level OAuth code to the callback route', () => {
    expect(
      oauthCallbackUrlFromEntrypoint(
        'https://aipert.top/?code=abc&next=%2Faccount',
      ),
    ).toBe('https://aipert.top/auth/callback?code=abc&next=%2Faccount')
  })

  it('preserves provider error details from a root-level redirect', () => {
    expect(
      oauthCallbackUrlFromEntrypoint(
        'https://aipert.top/?error=access_denied&error_description=cancelled',
      ),
    ).toBe(
      'https://aipert.top/auth/callback?error=access_denied&error_description=cancelled',
    )
  })

  it('ignores ordinary homepage visits', () => {
    expect(oauthCallbackUrlFromEntrypoint('https://aipert.top/')).toBeNull()
  })

  it('does not rewrite nested pages that happen to use a code query param', () => {
    expect(
      oauthCallbackUrlFromEntrypoint('https://aipert.top/docs?code=example'),
    ).toBeNull()
  })

  it('builds a relative callback path from App Router search params', () => {
    expect(
      oauthCallbackPathFromSearchParams({
        code: 'abc',
        next: '/my/queue',
        scope: ['email', 'profile'],
      }),
    ).toBe('/auth/callback?code=abc&next=%2Fmy%2Fqueue&scope=email&scope=profile')
  })
})

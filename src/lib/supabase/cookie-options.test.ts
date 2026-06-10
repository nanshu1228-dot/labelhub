import { describe, expect, it } from 'vitest'
import { normalizeSupabaseCookieOptions } from './cookie-options'

describe('normalizeSupabaseCookieOptions', () => {
  it('floors only session-only cookies', () => {
    expect(normalizeSupabaseCookieOptions({ path: '/' }, false)).toMatchObject({
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  })

  it('preserves explicit deletion cookies', () => {
    expect(
      normalizeSupabaseCookieOptions({ path: '/', maxAge: 0 }, false),
    ).toMatchObject({
      path: '/',
      maxAge: 0,
    })
  })

  it('can opt out of secure cookies for plain-http deployments', () => {
    expect(
      normalizeSupabaseCookieOptions({ path: '/', secure: true }, true),
    ).toMatchObject({
      path: '/',
      secure: false,
    })
  })
})

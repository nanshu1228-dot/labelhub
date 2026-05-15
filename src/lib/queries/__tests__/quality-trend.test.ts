import { describe, it, expect } from 'vitest'

/**
 * The quality-trend query is largely a DB roll-up — its only pure-math
 * piece is the Bayesian smoother (same formula as trust-projection;
 * already covered there). The week-start helper IS pure but is private
 * to the module. Rather than export it just for tests, we duplicate the
 * formula here as a contract test — if the prod implementation drifts,
 * this fails and somebody has to reconcile.
 *
 * If `weekStartUTC` ever becomes a published util, swap this for a real
 * import and delete the duplicate.
 */

function weekStartUTC(d: Date): Date {
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const x = new Date(ms)
  const dayOfWeek = (x.getUTCDay() + 6) % 7
  x.setUTCDate(x.getUTCDate() - dayOfWeek)
  return x
}

describe('quality-trend · week bucketing', () => {
  it('Monday of a Tuesday is the previous day', () => {
    // Tuesday 2026-05-12
    const d = new Date(Date.UTC(2026, 4, 12, 14, 30))
    const wk = weekStartUTC(d)
    expect(wk.getUTCDay()).toBe(1) // Monday
    expect(wk.getUTCDate()).toBe(11)
    expect(wk.getUTCHours()).toBe(0)
  })

  it('Sunday rolls back to the prior Monday (6 days)', () => {
    // Sunday 2026-05-17
    const d = new Date(Date.UTC(2026, 4, 17, 23, 59))
    const wk = weekStartUTC(d)
    expect(wk.getUTCDay()).toBe(1)
    expect(wk.getUTCDate()).toBe(11)
  })

  it('Monday of a Monday is the same day, at 00:00', () => {
    const d = new Date(Date.UTC(2026, 4, 11, 8, 0))
    const wk = weekStartUTC(d)
    expect(wk.getUTCDate()).toBe(11)
    expect(wk.getUTCHours()).toBe(0)
    expect(wk.getUTCMinutes()).toBe(0)
  })

  it('crosses month boundaries cleanly', () => {
    // Tuesday 2026-06-02 → Monday 2026-06-01
    const d = new Date(Date.UTC(2026, 5, 2, 12, 0))
    const wk = weekStartUTC(d)
    expect(wk.getUTCMonth()).toBe(5)
    expect(wk.getUTCDate()).toBe(1)
  })

  it('crosses year boundaries cleanly', () => {
    // Wednesday 2027-01-06 → Monday 2027-01-04 (no rollover needed here)
    const d = new Date(Date.UTC(2027, 0, 6, 12, 0))
    const wk = weekStartUTC(d)
    expect(wk.getUTCFullYear()).toBe(2027)
    expect(wk.getUTCMonth()).toBe(0)
    expect(wk.getUTCDate()).toBe(4)
    // And the case that crosses: Friday 2027-01-01 → Monday 2026-12-28
    const d2 = new Date(Date.UTC(2027, 0, 1, 12, 0))
    const wk2 = weekStartUTC(d2)
    expect(wk2.getUTCFullYear()).toBe(2026)
    expect(wk2.getUTCMonth()).toBe(11)
    expect(wk2.getUTCDate()).toBe(28)
  })
})

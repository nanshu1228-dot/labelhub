import { describe, it, expect } from 'vitest'
import {
  calculatePayoutLineItem,
  formatMoneyMinor,
} from './calculate-payout'
import type { EconomyConfig } from '@/lib/templates/types'

const cashPerItem: EconomyConfig = {
  type: 'cash-per-item',
  currency: 'CNY',
  baseAmountMinor: 500, // 5 CNY per item
  qualityMultiplierMin: 0.5,
  qualityMultiplierMax: 2.5,
}

describe('calculatePayoutLineItem — happy path', () => {
  it('full-trust annotator earns base × max multiplier', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 1.0,
    })
    expect(r.isBillable).toBe(true)
    expect(r.baseAmountMinor).toBe(500)
    expect(r.qualityMultiplierBp).toBe(250) // 2.5x → 250bp
    expect(r.totalAmountMinor).toBe(1250) // 500 × 2.5
    expect(r.currency).toBe('CNY')
  })

  it('zero-trust annotator earns base × min multiplier', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 0,
    })
    expect(r.totalAmountMinor).toBe(250) // 500 × 0.5
    expect(r.qualityMultiplierBp).toBe(50)
  })

  it('mid-trust annotator gets linear interpolation', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 0.5,
    })
    // 0.5 + (2.5 - 0.5) × 0.5 = 1.5x → 150bp → 500 × 1.5 = 750
    expect(r.qualityMultiplierBp).toBe(150)
    expect(r.totalAmountMinor).toBe(750)
  })

  it('applies bonus on top of base × multiplier', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 1.0,
      bonusAmountMinor: 100,
    })
    expect(r.bonusAmountMinor).toBe(100)
    expect(r.totalAmountMinor).toBe(1350) // 500 × 2.5 + 100
  })

  it('subtracts penalty after base × multiplier', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 0,
      penaltyAmountMinor: 100,
    })
    expect(r.totalAmountMinor).toBe(150) // 500 × 0.5 - 100
  })

  it('floors total at zero when penalty exceeds base × multiplier', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 0,
      penaltyAmountMinor: 99999,
    })
    expect(r.totalAmountMinor).toBe(0)
    expect(r.isBillable).toBe(false)
    expect(r.notBillableReason).toContain('zero')
  })
})

describe('calculatePayoutLineItem — economy types', () => {
  it('volunteer mode returns a zero-amount non-billable record', () => {
    const r = calculatePayoutLineItem({
      economy: { type: 'volunteer' },
      trustScore: 0.8,
    })
    expect(r.isBillable).toBe(false)
    expect(r.totalAmountMinor).toBe(0)
    expect(r.notBillableReason).toContain('volunteer')
  })

  it('rating-elo mode returns a zero-amount non-billable record', () => {
    const r = calculatePayoutLineItem({
      economy: { type: 'rating-elo' },
      trustScore: 0.8,
    })
    expect(r.isBillable).toBe(false)
    expect(r.totalAmountMinor).toBe(0)
    expect(r.notBillableReason).toContain('Elo')
  })

  it('token mode uses the configured currency symbol', () => {
    const r = calculatePayoutLineItem({
      economy: {
        type: 'token',
        currency: 'LBH',
        baseAmountMinor: 1000,
      },
      trustScore: 0.5,
    })
    expect(r.currency).toBe('LBH')
    expect(r.isBillable).toBe(true)
  })

  it('cash-per-item without baseAmountMinor is not billable', () => {
    const r = calculatePayoutLineItem({
      economy: { type: 'cash-per-item', currency: 'CNY' },
      trustScore: 1.0,
    })
    expect(r.isBillable).toBe(false)
    expect(r.notBillableReason).toContain('baseAmountMinor')
  })

  it('uses default multipliers when economy omits them', () => {
    const r = calculatePayoutLineItem({
      economy: {
        type: 'cash-per-item',
        currency: 'USDT',
        baseAmountMinor: 100,
      },
      trustScore: 1.0,
    })
    expect(r.qualityMultiplierBp).toBe(250) // default max = 2.5
    expect(r.totalAmountMinor).toBe(250)
  })
})

describe('calculatePayoutLineItem — trust clamping + edge cases', () => {
  it('clamps trust > 1 to 1', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 5.0,
    })
    expect(r.qualityMultiplierBp).toBe(250)
  })

  it('clamps trust < 0 to 0', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: -1.0,
    })
    expect(r.qualityMultiplierBp).toBe(50)
  })

  it('handles NaN trust gracefully (clamps to 0)', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: NaN,
    })
    expect(r.qualityMultiplierBp).toBe(50)
  })

  it('negative bonus is treated as zero (publisher cannot tip negative)', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 1.0,
      bonusAmountMinor: -200,
    })
    expect(r.bonusAmountMinor).toBe(0)
    expect(r.totalAmountMinor).toBe(1250)
  })

  it('negative penalty is treated as zero (cannot be a hidden bonus)', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 1.0,
      penaltyAmountMinor: -500,
    })
    expect(r.penaltyAmountMinor).toBe(0)
    expect(r.totalAmountMinor).toBe(1250)
  })

  it('fractional bonus/penalty inputs are floored (integer-only ledger)', () => {
    const r = calculatePayoutLineItem({
      economy: cashPerItem,
      trustScore: 1.0,
      bonusAmountMinor: 33.7 as number,
    })
    expect(r.bonusAmountMinor).toBe(33)
  })
})

describe('formatMoneyMinor', () => {
  it('renders fiat with 2 decimals', () => {
    expect(formatMoneyMinor(1234, 'CNY')).toBe('12.34 CNY')
  })

  it('handles zero', () => {
    expect(formatMoneyMinor(0, 'USDT')).toBe('0.00 USDT')
  })

  it('handles single-digit minor (e.g. 5 cents)', () => {
    expect(formatMoneyMinor(5, 'USD')).toBe('0.05 USD')
  })
})

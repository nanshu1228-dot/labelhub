/**
 * Payout pricing engine — pure functions.
 *
 * Takes:
 *   - the task's reward config (currency, base amount, multiplier bounds)
 *   - the annotator's trust score (0-1 range, where 1 = perfect)
 *   - optional bonuses and penalties surfaced from upstream signals
 *
 * Produces:
 *   - the line item amounts (base + quality bump + bonus - penalty = total)
 *   - in MINOR units (cents / fen / 1e-6 USDT)
 *   - with NO database access, NO `Date.now()`, NO randomness
 *
 * Why pure: this gets called at annotation-approval time AND at admin
 * "preview" time AND in tests. Side effects would make all of those
 * harder. The Server Action wrapping these functions handles the DB
 * write + event emission.
 */

import { z } from 'zod'
import { economyConfigSchema, type EconomyConfig } from '@/lib/templates/types'

// ─── Inputs ─────────────────────────────────────────────────────────────

export interface PayoutCalcInput {
  /** Snapshot of task.rewardConfig (validated by economyConfigSchema). */
  economy: EconomyConfig
  /**
   * Annotator's trust score for this workspace, in 0-1 range.
   * 0 = freshly-onboarded / no history. 1 = perfectly calibrated peer.
   * The pricing engine maps this onto economy.qualityMultiplierMin..Max.
   */
  trustScore: number
  /** Positive bumps surfaced from upstream (streak, gold-standard hit, etc.). */
  bonusAmountMinor?: number
  /** Negative bumps surfaced from upstream (clawback, late submission, etc.). */
  penaltyAmountMinor?: number
}

export interface PayoutCalcResult {
  economyType: EconomyConfig['type']
  /** Currency code recorded on the line item (ISO 4217 or stablecoin symbol). */
  currency: string
  baseAmountMinor: number
  /** Quality multiplier in BASIS POINTS (100 = 1.00x, 250 = 2.50x). Stored as int to avoid float drift. */
  qualityMultiplierBp: number
  bonusAmountMinor: number
  penaltyAmountMinor: number
  /** base × multiplier/100 + bonus − penalty. Floored to integer. */
  totalAmountMinor: number
  /** When >0, the rest of the line is computed; when 0, the annotation isn't billable. */
  isBillable: boolean
  /** Human reason when `isBillable` is false. Surfaced in admin UI for "why didn't this become a payout?" */
  notBillableReason?: string
}

// ─── Default multiplier bounds ──────────────────────────────────────────

/**
 * Fallbacks for economy.qualityMultiplierMin/Max when the template forgot
 * to set them. Chosen so a fresh annotator (trust=0) gets paid HALF rate
 * and a trusted peer (trust=1) gets 2.5x. Most templates override.
 */
const DEFAULT_MULT_MIN = 0.5
const DEFAULT_MULT_MAX = 2.5

// ─── Public function ───────────────────────────────────────────────────

/**
 * Resolve a payout line item for a single approved annotation.
 *
 * The output's `total` is what the annotator will see on their next
 * payout statement; it's the ONLY number that matters financially. Every
 * other field is provenance (for "why did I get this amount?" UI).
 */
export function calculatePayoutLineItem(
  input: PayoutCalcInput,
): PayoutCalcResult {
  const economy = economyConfigSchema.parse(input.economy)
  const trust = clamp(input.trustScore, 0, 1)
  const bonus = Math.max(0, Math.floor(input.bonusAmountMinor ?? 0))
  const penalty = Math.max(0, Math.floor(input.penaltyAmountMinor ?? 0))

  // Volunteer / rating-elo: no cash flows. Surface as a zero-amount line
  // so we still emit a record for audit / "X items contributed" stats.
  if (economy.type === 'volunteer') {
    return {
      economyType: economy.type,
      currency: economy.currency ?? 'NONE',
      baseAmountMinor: 0,
      qualityMultiplierBp: 100,
      bonusAmountMinor: 0,
      penaltyAmountMinor: 0,
      totalAmountMinor: 0,
      isBillable: false,
      notBillableReason: 'volunteer mode — no monetary payout',
    }
  }
  if (economy.type === 'rating-elo') {
    return {
      economyType: economy.type,
      currency: economy.currency ?? 'ELO',
      baseAmountMinor: 0,
      qualityMultiplierBp: 100,
      bonusAmountMinor: 0,
      penaltyAmountMinor: 0,
      totalAmountMinor: 0,
      isBillable: false,
      notBillableReason: 'rating-elo mode — Elo points only, no cash',
    }
  }

  // cash-per-item / cash-per-hour / token: all need base amount.
  if (economy.baseAmountMinor == null || economy.baseAmountMinor <= 0) {
    return {
      economyType: economy.type,
      currency: economy.currency ?? 'UNKNOWN',
      baseAmountMinor: 0,
      qualityMultiplierBp: 100,
      bonusAmountMinor: 0,
      penaltyAmountMinor: 0,
      totalAmountMinor: 0,
      isBillable: false,
      notBillableReason:
        'task.rewardConfig.baseAmountMinor is missing or zero — set it before annotators can earn',
    }
  }

  const currency = economy.currency
  if (!currency) {
    return {
      economyType: economy.type,
      currency: 'UNKNOWN',
      baseAmountMinor: economy.baseAmountMinor,
      qualityMultiplierBp: 100,
      bonusAmountMinor: 0,
      penaltyAmountMinor: 0,
      totalAmountMinor: 0,
      isBillable: false,
      notBillableReason:
        'task.rewardConfig.currency is missing — needed to record the line item',
    }
  }

  // Map trust ∈ [0, 1] linearly onto [min, max] multiplier.
  const minMult = economy.qualityMultiplierMin ?? DEFAULT_MULT_MIN
  const maxMult = economy.qualityMultiplierMax ?? DEFAULT_MULT_MAX
  const multiplier = minMult + (maxMult - minMult) * trust
  const multiplierBp = Math.round(multiplier * 100)

  // base × multiplier — done in BP space to avoid float drift.
  const adjustedBase = Math.floor(
    (economy.baseAmountMinor * multiplierBp) / 100,
  )
  const total = Math.max(0, adjustedBase + bonus - penalty)

  return {
    economyType: economy.type,
    currency,
    baseAmountMinor: economy.baseAmountMinor,
    qualityMultiplierBp: multiplierBp,
    bonusAmountMinor: bonus,
    penaltyAmountMinor: penalty,
    totalAmountMinor: total,
    isBillable: total > 0,
    notBillableReason:
      total === 0 ? 'computed total is zero (penalty cancelled out base)' : undefined,
  }
}

// ─── Formatting (for UI) ─────────────────────────────────────────────────

/**
 * Render a minor-unit amount as a human string with currency.
 * Always 2 decimal places for fiat; tokens get more precision if needed.
 */
export function formatMoneyMinor(
  amountMinor: number,
  currency: string,
): string {
  const major = amountMinor / 100
  const formatted = major.toFixed(2)
  return `${formatted} ${currency}`
}

// ─── Helpers ───────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

// ─── Re-export the input schema so callers can validate at network edges ─

export const payoutCalcInputSchema = z.object({
  economy: economyConfigSchema,
  trustScore: z.number().min(0).max(1),
  bonusAmountMinor: z.number().int().nonnegative().optional(),
  penaltyAmountMinor: z.number().int().nonnegative().optional(),
})

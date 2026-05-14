'use server'

/**
 * Payment method CRUD for the annotator side.
 *
 * Add / verify / delete / set-default for: usdt, alipay, wechat, bank, stripe.
 *
 * Verification in demo mode is INSTANT (we just set verified_at=now). In
 * production each method type has its own verification flow:
 *   - usdt:  send a 0.01 token to user, ask them to confirm receipt
 *   - alipay/wechat: oauth handshake against open platform
 *   - bank: micro-deposit + amount confirmation
 *   - stripe: Connect Express onboarding
 *
 * Demo-mode-gated.
 */

import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { paymentMethods } from '@/lib/db/schema'
import { AppError, NotFoundError } from '@/lib/errors'
import { uuidLike } from '@/lib/validators/uuid'

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001'

function assertDemoMode(): void {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError(
      'DEMO_MODE_DISABLED',
      'Payment-method actions require LABELHUB_DEMO_MODE=true while real auth is pending.',
      403,
    )
  }
}

// ─── Validators ──────────────────────────────────────────────────────────

const methodTypeEnum = z.enum(['usdt', 'alipay', 'wechat', 'bank', 'stripe'])

// Light per-type sanity checks. NOT a substitute for real verification.
function validateDestination(
  type: z.infer<typeof methodTypeEnum>,
  destination: string,
): void {
  const d = destination.trim()
  if (d.length === 0) {
    throw new AppError('BAD_DESTINATION', 'Destination cannot be empty.', 400)
  }
  switch (type) {
    case 'usdt': {
      // Accept TRC20 (T-prefix, 34 chars) or ERC20 (0x-prefix, 42 hex chars).
      const isTron = /^T[A-Za-z0-9]{33}$/.test(d)
      const isEth = /^0x[a-fA-F0-9]{40}$/.test(d)
      if (!isTron && !isEth) {
        throw new AppError(
          'BAD_DESTINATION',
          'USDT destination must be a TRC20 (T-prefix, 34 chars) or ERC20 (0x… 42 chars) address.',
          400,
        )
      }
      break
    }
    case 'alipay':
    case 'wechat': {
      // Either an email or a phone number. Don't over-validate; demo data is messy.
      if (d.length < 4 || d.length > 64) {
        throw new AppError(
          'BAD_DESTINATION',
          `${type} destination should be an email or phone number.`,
          400,
        )
      }
      break
    }
    case 'bank': {
      if (d.length < 6 || d.length > 64) {
        throw new AppError(
          'BAD_DESTINATION',
          'Bank account must be 6-64 characters.',
          400,
        )
      }
      break
    }
    case 'stripe': {
      if (!/^acct_[A-Za-z0-9]{8,}$/.test(d)) {
        throw new AppError(
          'BAD_DESTINATION',
          'Stripe destination must be a Connect account id (acct_…).',
          400,
        )
      }
      break
    }
  }
}

// ─── Add ───────────────────────────────────────────────────────────────

const addSchema = z.object({
  type: methodTypeEnum,
  destination: z.string().min(1).max(200),
  label: z.string().min(1).max(64).optional(),
})

export async function addPaymentMethod(input: z.infer<typeof addSchema>) {
  assertDemoMode()
  const parsed = addSchema.parse(input)
  validateDestination(parsed.type, parsed.destination)
  const db = getDb()
  const userId = DEMO_USER_ID

  // First method becomes default automatically.
  const existing = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(eq(paymentMethods.userId, userId))
    .limit(1)
  const isDefault = existing.length === 0

  const [row] = await db
    .insert(paymentMethods)
    .values({
      userId,
      type: parsed.type,
      destination: parsed.destination.trim(),
      label: parsed.label ?? null,
      isDefault,
      // Demo mode: auto-verify. Real flow runs through provider-specific
      // verification before stamping verified_at.
      verifiedAt: new Date(),
    })
    .returning()

  // No event log: payment methods are user-scoped, not workspace-scoped,
  // and events.workspaceId is NOT NULL. If a payment-method audit becomes
  // important we'll add a `user_events` table; for now the row history
  // in payment_methods + transactions is the audit trail.

  try {
    revalidatePath('/my/earnings')
  } catch {
    /* outside request context */
  }
  return { ok: true as const, row }
}

// ─── Set default ────────────────────────────────────────────────────────

const setDefaultSchema = z.object({ paymentMethodId: uuidLike })

export async function setDefaultPaymentMethod(
  input: z.infer<typeof setDefaultSchema>,
) {
  assertDemoMode()
  const parsed = setDefaultSchema.parse(input)
  const db = getDb()
  const userId = DEMO_USER_ID

  const [target] = await db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.id, parsed.paymentMethodId),
        eq(paymentMethods.userId, userId),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('Payment method')

  // Drop default flag on siblings, then set on target — TWO writes, no txn
  // (Postgres handles this atomically enough for demo correctness).
  await db
    .update(paymentMethods)
    .set({ isDefault: false })
    .where(
      and(
        eq(paymentMethods.userId, userId),
        ne(paymentMethods.id, parsed.paymentMethodId),
      ),
    )
  await db
    .update(paymentMethods)
    .set({ isDefault: true })
    .where(eq(paymentMethods.id, parsed.paymentMethodId))

  try {
    revalidatePath('/my/earnings')
  } catch {
    /* outside request context */
  }
  return { ok: true as const }
}

// ─── Remove ────────────────────────────────────────────────────────────

const removeSchema = z.object({ paymentMethodId: uuidLike })

export async function removePaymentMethod(
  input: z.infer<typeof removeSchema>,
) {
  assertDemoMode()
  const parsed = removeSchema.parse(input)
  const db = getDb()
  const userId = DEMO_USER_ID

  const [target] = await db
    .select()
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.id, parsed.paymentMethodId),
        eq(paymentMethods.userId, userId),
      ),
    )
    .limit(1)
  if (!target) throw new NotFoundError('Payment method')

  await db.delete(paymentMethods).where(eq(paymentMethods.id, target.id))

  // If we deleted the default, promote any remaining method to default.
  if (target.isDefault) {
    const [next] = await db
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(eq(paymentMethods.userId, userId))
      .limit(1)
    if (next) {
      await db
        .update(paymentMethods)
        .set({ isDefault: true })
        .where(eq(paymentMethods.id, next.id))
    }
  }

  try {
    revalidatePath('/my/earnings')
  } catch {
    /* outside request context */
  }
  return { ok: true as const }
}

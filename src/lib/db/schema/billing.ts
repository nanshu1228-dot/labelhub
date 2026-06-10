import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { annotations, users, workspaces } from './core'

// =================================================================
// Settlement system — Phase 1
//
// The economy layer that turns approved annotations into actual payouts.
// Six tables, in dependency order:
//
//   payment_methods      ← annotator's payout destination (usdt addr, alipay id, etc.)
//   payout_periods       ← workspace-scoped calendar buckets (daily/weekly/monthly)
//   payout_line_items    ← one row per (annotation × payable rubric); the unit of accrual
//   payouts              ← aggregate per (period × user); the unit of payment
//   transactions         ← append-only money-movement ledger (earn / withdraw / penalty)
//   wallet_balance       ← materialized snapshot, periodically rebuilt from transactions
//
// Money is stored in INTEGER MINOR UNITS (cents / fen / 1e-6 USDT) — never floats.
// Currency is a per-row string field so multi-currency support is trivial.
//
// Approval flow:
//   annotation.submittedAt set → write a payout_line_item (status='pending')
//   admin or auto-rule approves → status='approved'
//   period boundary fires → aggregate approved line_items into a single payout row
//   admin marks paid (via Stripe/Alipay/USDT integration — currently stubbed) →
//     payout.status='paid', a transaction row of type='earn' lands in the ledger
//   annotator requests withdraw → transaction type='withdraw' (negative)
//
// Real payment-provider integration is OUT OF SCOPE for this competition build —
// `mark_paid` is a manual admin action. The data model + admin tooling is the
// hero; plumbing Stripe / Alipay merchant API is a follow-on.
// =================================================================

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'usdt' | 'alipay' | 'wechat' | 'bank' | 'stripe' (validated in code, not DB) */
    type: text('type').notNull(),
    /** USDT wallet addr / Alipay id / masked bank acct / Stripe Connect account id. */
    destination: text('destination').notNull(),
    /** Free-form display label the user chose ("Main USDT" / "Work account"). */
    label: text('label'),
    /** Set once verification (test transfer / micro-deposit / chain check) passes. */
    verifiedAt: timestamp('verified_at'),
    /** Default payout target when annotator doesn't pick one. */
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('payment_methods_user_idx').on(table.userId),
    /** One default per user — enforced at write-time in the action, not at DB level. */
  }),
)

export const payoutPeriods = pgTable(
  'payout_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),
    /** 'open' = accepting line_items · 'closed' = aggregated, waiting payout · 'paid' = done */
    status: text('status').default('open').notNull(),
    /** When admin (or cron) flipped status to 'closed'. Set once. */
    closedAt: timestamp('closed_at'),
    /** When the last payout in this period was marked paid. Set once all payouts paid. */
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('payout_periods_ws_idx').on(table.workspaceId),
    /** One open period per workspace — new line_items always land in the active period. */
    wsOpenUniq: uniqueIndex('payout_periods_ws_open_uniq')
      .on(table.workspaceId)
      .where(sql`status = 'open'`),
  }),
)

export const payoutLineItems = pgTable(
  'payout_line_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The (workspace × user × period) bucket this line accrues into. */
    payoutPeriodId: uuid('payout_period_id')
      .references(() => payoutPeriods.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** Provenance: the annotation row that generated this line. */
    annotationId: uuid('annotation_id')
      .references(() => annotations.id)
      .notNull(),
    /** Snapshot of task.rewardConfig at line-creation time. Survives later config edits. */
    economyType: text('economy_type').notNull(),
    currency: text('currency').notNull(),
    /** baseline payout per item, MINOR units. */
    baseAmountMinor: integer('base_amount_minor').notNull(),
    /** Trust-derived multiplier captured AT line creation. 100 = 1.00x; 250 = 2.50x. */
    qualityMultiplierBp: integer('quality_multiplier_bp').notNull(),
    /** Optional positive bumps (streak / gold-standard / early-bird). */
    bonusAmountMinor: integer('bonus_amount_minor').default(0).notNull(),
    /** Optional negative adjustments (clawback for overturned dispute, etc.). */
    penaltyAmountMinor: integer('penalty_amount_minor').default(0).notNull(),
    /** Final total = base × multiplier/100 + bonus - penalty. Computed at insert. */
    totalAmountMinor: integer('total_amount_minor').notNull(),
    /** 'pending' (awaiting approval) | 'approved' (in payout) | 'rejected' (excluded) | 'reversed' (clawback) */
    status: text('status').default('pending').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    periodIdx: index('payout_line_items_period_idx').on(table.payoutPeriodId),
    userIdx: index('payout_line_items_user_idx').on(table.userId),
    /** One line per annotation — re-submitting the same annotation updates instead of dupes. */
    annotationUniq: uniqueIndex('payout_line_items_annotation_uniq').on(
      table.annotationId,
    ),
  }),
)

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    payoutPeriodId: uuid('payout_period_id')
      .references(() => payoutPeriods.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** Sum of approved payout_line_items belonging to this (period × user). */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** 'pending' | 'approved' (admin signed off) | 'processing' (payment in flight) | 'paid' | 'failed' | 'reversed' */
    status: text('status').default('pending').notNull(),
    paymentMethodId: uuid('payment_method_id').references(
      () => paymentMethods.id,
    ),
    /** Stripe txn id / chain tx hash / bank wire ref. Set once paid. */
    externalRef: text('external_ref'),
    paidAt: timestamp('paid_at'),
    failedAt: timestamp('failed_at'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    periodIdx: index('payouts_period_idx').on(table.payoutPeriodId),
    userIdx: index('payouts_user_idx').on(table.userId),
    /** One payout per (period × user) — multiple users in a period each get their own row. */
    periodUserUniq: uniqueIndex('payouts_period_user_uniq').on(
      table.payoutPeriodId,
      table.userId,
    ),
  }),
)

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** 'earn' (positive, from payout) · 'withdraw' (negative, to bank/wallet) ·
     *  'tip' (positive, from publisher) · 'penalty' (negative, dispute clawback) ·
     *  'reversal' (negative, payout reversed) · 'adjustment' (admin manual fix). */
    type: text('type').notNull(),
    /** Signed integer MINOR units — positive for credits, negative for debits. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** Which workspace's wallet this credits/debits. NULL = platform-wide (rare). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    /** Cross-reference into the entity that triggered this txn (payouts.id, etc.). */
    refTable: text('ref_table'),
    refId: uuid('ref_id'),
    /** Free-form note from the admin or system. */
    memo: text('memo'),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('transactions_user_idx').on(table.userId),
    workspaceIdx: index('transactions_ws_idx').on(table.workspaceId),
    /** For wallet rebuild: scan user's txns in time order. */
    userTsIdx: index('transactions_user_ts_idx').on(table.userId, table.ts),
  }),
)

// =================================================================
// Withdrawal requests — the operable, admin-approvable withdrawal entity.
//
// The simple payment loop the product is built around runs ENTIRELY through
// this table + admin "adjustment" credits + the transactions ledger, and is
// orthogonal to the payout_periods settlement pipeline above:
//
//   admin credits an account   → transactions(type='adjustment', +amount) → wallet rebuilt
//   user requests a withdrawal → withdrawal_requests(status='requested')   (NO ledger row yet)
//   admin approves             → transactions(type='withdraw', -amount)    → wallet rebuilt
//   admin marks paid           → status='paid' + synthetic externalRef     (NO real rail)
//   admin rejects              → status='rejected'                          (balance untouched)
//
// Contract: the REQUEST is the approvable entity; the wallet balance only
// drops when the withdrawal is actually committed (on approve), so a rejected
// request never touches the ledger. No real payment provider is involved.
// =================================================================
export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** Requested amount, POSITIVE minor units. The committed ledger row stores the negative. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** Optional payout destination — relaxed for the simple credit→withdraw loop. */
    paymentMethodId: uuid('payment_method_id').references(
      () => paymentMethods.id,
    ),
    /** 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled' (validated in code). */
    status: text('status').default('requested').notNull(),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    /** Admin note / rejection reason. */
    decisionMemo: text('decision_memo'),
    /** The negative 'withdraw' ledger row, set when the debit lands (on approve). */
    txnId: uuid('txn_id').references(() => transactions.id),
    /** Synthetic receipt ref stamped at mark-paid (mirrors payouts.externalRef). */
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('withdrawal_requests_user_idx').on(table.userId),
    /** Admin queue: pending requests in a workspace = one indexed scan. */
    wsStatusIdx: index('withdrawal_requests_ws_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    wsCreatedIdx: index('withdrawal_requests_ws_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
)

export const walletBalance = pgTable(
  'wallet_balance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    /** NULL = cross-workspace global wallet (not used in MVP). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    currency: text('currency').notNull(),
    balanceMinor: integer('balance_minor').default(0).notNull(),
    /** Set every time we rebuild this row from transactions. */
    lastSettledAt: timestamp('last_settled_at').defaultNow().notNull(),
  },
  (table) => ({
    /** One row per (user, workspace, currency) — query "my CNY balance in workspace X". */
    triUniq: uniqueIndex('wallet_balance_uniq').on(
      table.userId,
      table.workspaceId,
      table.currency,
    ),
  }),
)

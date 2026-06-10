# `lib/billing` — Gateway sub-package (payouts & settlement)

> **Boundary:** part of the **gateway** half of LabelHub (see repo-root
> `ARCHITECTURE.md` §1). Annotation-core code should not import these
> internals; the schema tables live in `db/schema/billing.ts`.

## What it is

Annotator earnings and publisher settlement: per-workspace wallet balances,
pending accruals, payout periods + line items, payouts, and the transaction
ledger. A billing period is auto-created when the first annotation in a
workspace is approved.

## Surfaces

- Annotator side → `/my/earnings` (`components/billing/earnings-dashboard.tsx`).
- Publisher side → `/workspaces/[id]/billing` (+ `/billing/[periodId]`).

The workspace-level billing page is a gateway entry point and is hidden by
**focus mode** by default (see `ARCHITECTURE.md` §5); the labeler-facing
`/my/earnings` stays available.

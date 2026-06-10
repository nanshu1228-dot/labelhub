/**
 * Billing's reaction to an approved annotation — the gateway side of the
 * inverted core→billing seam (ARCHITECTURE.md §11.3). Registered idempotently
 * by @/lib/billing/init (which the composition root src/instrumentation.ts
 * imports at boot).
 *
 * This mirrors EXACTLY the two fire-and-forget hooks that used to live inline
 * in actions/annotations.ts (Phase-13 invite-reward scan + payout accrual):
 *   - both are best-effort; failures are swallowed + warned (the admin can
 *     re-approve to retry), never blocking the verdict;
 *   - both are idempotent, so a duplicate / non-qualifying dispatch is a cheap
 *     no-op.
 *
 * Both calls are fired without inter-awaiting (matching the two independent
 * `after()` hooks they replace) so neither blocks the other.
 */
import {
  subscribeDomainEvent,
  type AnnotationApprovedPayload,
} from '@/lib/events/dispatch'
import { scanInviteRewardOnApproval } from '@/lib/billing/invite-rewards'
import { approveAnnotation } from '@/lib/actions/billing/approve-annotation'

function onAnnotationApproved(payload: AnnotationApprovedPayload): void {
  // Phase-13: invite-reward scan. Idempotent (unique index) so a fire for a
  // non-qualifying approval is a cheap no-op.
  scanInviteRewardOnApproval({
    inviteeUserId: payload.submitterUserId,
    workspaceId: payload.workspaceId,
    triggerAnnotationId: payload.annotationId,
  }).catch((e) => {
    console.warn('[invite] reward scan failed', e)
  })
  // Accrual: creates/refreshes the annotation's payout_line_item via the
  // idempotent pricing engine — the missing link that funds the open payout
  // period (close-period → mark-paid later settles it into wallets).
  approveAnnotation({ annotationId: payload.annotationId }).catch((e) => {
    console.warn('[billing] approveAnnotation accrual failed', e)
  })
}

/**
 * Wire billing's domain-event subscribers onto the core bus. Idempotent
 * (subscribeDomainEvent dedups by handler reference), so it's safe to call
 * from multiple init paths or repeatedly in tests.
 */
export function registerBillingSubscribers(): void {
  subscribeDomainEvent('annotation.approved', onAnnotationApproved)
}

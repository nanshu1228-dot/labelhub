/**
 * Billing subscriber registration — side-effect import.
 *
 * Import this once at app boot (composition root: src/instrumentation.ts) so
 * the gateway's reactions to core domain events are wired onto the core event
 * bus before any request is served. Mirrors @/lib/templates/init. Registration
 * is idempotent, so a stray extra import is harmless.
 *
 * Without this, core's `dispatchDomainEvent('annotation.approved', …)` would
 * reach zero subscribers and payouts would not accrue (the dispatcher logs
 * loudly in that case — see @/lib/events/dispatch).
 */
import { registerBillingSubscribers } from './subscribers/annotation-approved'

registerBillingSubscribers()

export {}

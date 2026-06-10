/**
 * In-process domain-event dispatcher — the core-owned seam that lets the
 * gateway (billing) react to core events WITHOUT core importing the gateway.
 *
 * Core actions call `dispatchDomainEvent(type, payload)` (typically inside a
 * next/server `after()`), and gateway subscribers registered via
 * `subscribeDomainEvent` run their side effects. It mirrors the existing
 * fire-and-forget `after()` semantics: handlers are best-effort; a throwing /
 * rejecting handler is isolated + logged and never blocks the others or the
 * caller.
 *
 * It is deliberately NOT a durable log — the append-only `events` table stays
 * the source of truth for projections/replay (see events/projector.ts). This
 * bus only triggers in-process reactions, so the dependency direction can be
 * inverted: core defines + dispatches; gateway subscribes; core never imports
 * gateway. Subscriber registration is wired by the composition root
 * (src/instrumentation.ts → @/lib/billing/init) — see ARCHITECTURE.md §11.3.
 */

/** Payload for an approved annotation — enough for billing to react. */
export interface AnnotationApprovedPayload {
  annotationId: string
  /** The submitter (invitee) whose approved work may trigger an invite reward. */
  submitterUserId: string
  workspaceId: string
}

/** Map of domain-event type → its payload shape. Extend as seams are added. */
export interface DomainEventPayloadMap {
  'annotation.approved': AnnotationApprovedPayload
}

export type DomainEventType = keyof DomainEventPayloadMap

type AnyHandler = (payload: unknown) => void | Promise<void>

const subscribers = new Map<string, AnyHandler[]>()

/**
 * Register a handler for a domain-event type. Idempotent by handler
 * reference (re-registering the same function is a no-op), so multiple init
 * paths / test files can't double-fire a subscriber.
 */
export function subscribeDomainEvent<T extends DomainEventType>(
  type: T,
  handler: (payload: DomainEventPayloadMap[T]) => void | Promise<void>,
): void {
  const list = subscribers.get(type) ?? []
  if (!list.includes(handler as AnyHandler)) {
    list.push(handler as AnyHandler)
    subscribers.set(type, list)
  }
}

/**
 * Run every subscriber for `type`. Each handler is invoked synchronously (so
 * the call is observable immediately) and any returned promise is awaited via
 * allSettled; a throwing / rejecting handler is isolated + logged and never
 * affects the others or the caller.
 *
 * If a dispatched type has ZERO subscribers we log loudly via console.error:
 * for a money-path event (annotation.approved → payout accrual) a missing
 * subscriber means the composition root (instrumentation → @/lib/billing/init)
 * didn't run, which would silently stop payouts from accruing. Better surfaced
 * in logs than hidden.
 */
export async function dispatchDomainEvent<T extends DomainEventType>(
  type: T,
  payload: DomainEventPayloadMap[T],
): Promise<void> {
  const handlers = subscribers.get(type)
  if (!handlers || handlers.length === 0) {
    console.error(
      `[events] dispatchDomainEvent('${type}') had no subscribers — if this ` +
        `is a money-path event, billing wiring (instrumentation → @/lib/billing/init) did not run.`,
    )
    return
  }
  const pending: Promise<unknown>[] = []
  for (const handler of handlers) {
    try {
      const result = handler(payload)
      if (result instanceof Promise) {
        pending.push(
          result.catch((e) => {
            console.warn(`[events] subscriber for '${type}' rejected`, e)
          }),
        )
      }
    } catch (e) {
      console.warn(`[events] subscriber for '${type}' threw`, e)
    }
  }
  await Promise.allSettled(pending)
}

/** Test-only: clear the registry so suites don't leak subscribers. */
export function __resetDomainEventSubscribersForTest(): void {
  subscribers.clear()
}

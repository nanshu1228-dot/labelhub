import 'server-only'
import { createHmac, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { workspaceWebhooks } from '@/lib/db/schema'

/**
 * Outbound webhook fan-out.
 *
 * Best-effort delivery: POSTs the event body to each enabled subscriber's
 * URL with two custom headers:
 *
 *   X-LabelHub-Signature: hex(hmac_sha256(secret, body))
 *   X-LabelHub-Event:     <type>
 *
 * No retries. Failures bump `failure_count`; consecutive failures past
 * MAX_FAILURES auto-disable the hook so a flaky receiver doesn't waste
 * compute forever.
 *
 * Designed to run inside Vercel's after() window so it doesn't extend
 * response latency on the action that triggered it.
 */

const MAX_FAILURES = 10
const DELIVERY_TIMEOUT_MS = 5000

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url')
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export interface WebhookDeliveryEvent {
  type: string
  workspaceId: string
  /** Arbitrary JSON-serializable payload. */
  payload: Record<string, unknown>
}

/**
 * Fan out an event to every enabled webhook in the workspace. Returns
 * immediately after starting the requests; safe to await for sequential
 * scripts.
 *
 * Filter logic: a hook with empty `eventTypes` listens to all events; a
 * hook with a non-empty array listens only to those types.
 */
export async function fanoutWebhook(
  event: WebhookDeliveryEvent,
): Promise<void> {
  const db = getDb()
  const subs = await db
    .select()
    .from(workspaceWebhooks)
    .where(
      and(
        eq(workspaceWebhooks.workspaceId, event.workspaceId),
        eq(workspaceWebhooks.enabled, true),
        isNull(workspaceWebhooks.revokedAt),
      ),
    )

  if (subs.length === 0) return

  const body = JSON.stringify({
    type: event.type,
    workspaceId: event.workspaceId,
    deliveredAt: new Date().toISOString(),
    payload: event.payload,
  })

  for (const sub of subs) {
    const subscribedTypes = Array.isArray(sub.eventTypes)
      ? (sub.eventTypes as string[])
      : []
    if (subscribedTypes.length > 0 && !subscribedTypes.includes(event.type)) {
      continue
    }
    // Fire each delivery without await — we explicitly don't want one slow
    // receiver to block others. Telemetry updates happen on settle.
    void deliver(sub, body, event.type)
  }
}

async function deliver(
  sub: typeof workspaceWebhooks.$inferSelect,
  body: string,
  eventType: string,
): Promise<void> {
  const signature = sign(sub.secret, body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
  let status = 0
  let ok = false
  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-labelhub-signature': signature,
        'x-labelhub-event': eventType,
        'user-agent': 'LabelHub-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    })
    status = res.status
    ok = res.ok
  } catch {
    // Network error / timeout → ok stays false.
  } finally {
    clearTimeout(timer)
  }

  // Update telemetry — also best-effort, never throw.
  try {
    const db = getDb()
    const nextFailureCount = ok ? 0 : sub.failureCount + 1
    const nowDisabled = !ok && nextFailureCount >= MAX_FAILURES
    await db
      .update(workspaceWebhooks)
      .set({
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: status || null,
        failureCount: nextFailureCount,
        enabled: nowDisabled ? false : sub.enabled,
      })
      .where(eq(workspaceWebhooks.id, sub.id))
  } catch {
    /* swallow */
  }
}

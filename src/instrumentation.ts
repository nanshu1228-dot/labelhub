/**
 * Next.js instrumentation hook — the app composition root.
 *
 * `register()` runs once at server startup, before any request is served. We
 * use it to wire the gateway's event subscribers onto the core event bus, so
 * core actions can stay ignorant of the gateway (the inverted core→billing
 * seam — see ARCHITECTURE.md §11.3). Without this, an approved annotation would
 * dispatch `annotation.approved` to zero subscribers and payouts would not
 * accrue (the dispatcher logs loudly in that case).
 *
 * Guarded to the Node.js runtime so the DB-touching billing modules are never
 * pulled into the Edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/billing/init')
  }
}

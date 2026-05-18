import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events, users } from '@/lib/db/schema'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import { AppError } from '@/lib/errors'

/**
 * GET /api/workspaces/[id]/recent-events?limit=20
 *
 * Polls the last N workspace events for the dashboard live-activity
 * strip (Phase-19). Member-readable — every role can see what's
 * happening, just not act on it.
 *
 * Returns:
 *   { events: [{ id, ts, type, actorDisplayName }] }
 *
 * Lightweight on purpose — no payload dive, no joins beyond the actor
 * name. The frontend polls every 5 seconds; we'd rather return 50ms
 * of cheap rows than 200ms of rich ones.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await context.params
  try {
    await requireWorkspaceMember(workspaceId)
  } catch {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 },
    )
  }

  const url = new URL(request.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '20', 10)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 50)
    : 20

  try {
    const db = getDb()
    const rows = await db
      .select({
        id: events.id,
        ts: events.ts,
        type: events.type,
        actorId: events.actorId,
        actorDisplayName: users.displayName,
        actorEmail: users.email,
      })
      .from(events)
      .leftJoin(users, eq(users.id, events.actorId))
      .where(eq(events.workspaceId, workspaceId))
      .orderBy(desc(events.ts))
      .limit(limit)

    return NextResponse.json(
      {
        events: rows.map((r) => ({
          id: r.id,
          ts: r.ts.toISOString(),
          type: r.type,
          actor:
            r.actorDisplayName ??
            (r.actorEmail
              ? r.actorEmail.split('@')[0]
              : r.actorId
                ? r.actorId.slice(0, 8)
                : null),
        })),
      },
      {
        headers: {
          'cache-control': 'no-store',
        },
      },
    )
  } catch (e: unknown) {
    if (e instanceof AppError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      )
    }
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    )
  }
}

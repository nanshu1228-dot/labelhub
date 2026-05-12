/**
 * tail_audit_log — last N rows of the api_request_log, newest first.
 *
 * Optional filters: only failures (status >= 400), only one endpoint,
 * only one workspace. The default is "give me everything for the demo
 * workspace, last 50 calls." Most useful when diagnosing why a proxy
 * call or eval-run is returning unexpected errors.
 *
 * Run: `tsx scripts/debug/tail-audit-log.ts [--limit 50] [--failures] [--endpoint POST /api/...] [--workspace <uuid>]`
 */
import { and, desc, eq, gte, type SQL } from 'drizzle-orm'
import { cliRun, isMain, parseArgs } from './_shared/args'
import { withDb, schema } from './_shared/db'

export interface TailAuditLogArgs {
  limit?: number
  workspaceId?: string
  endpoint?: string
  failuresOnly?: boolean
}

export interface AuditLogRow {
  id: string
  workspaceId: string | null
  apiKeyId: string | null
  userId: string | null
  endpoint: string
  method: string
  status: number
  errorCode: string | null
  durationMs: number | null
  payloadBytes: number | null
  responseBytes: number | null
  ts: string
}

export interface TailAuditLogResult {
  rows: AuditLogRow[]
  filters: {
    limit: number
    workspaceId: string | null
    endpoint: string | null
    failuresOnly: boolean
  }
}

export async function runTailAuditLog(
  args: TailAuditLogArgs,
): Promise<TailAuditLogResult> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 500)

  return withDb(async ({ db }) => {
    const conditions: SQL[] = []
    if (args.workspaceId) {
      conditions.push(eq(schema.apiRequestLog.workspaceId, args.workspaceId))
    }
    if (args.endpoint) {
      conditions.push(eq(schema.apiRequestLog.endpoint, args.endpoint))
    }
    if (args.failuresOnly) {
      conditions.push(gte(schema.apiRequestLog.status, 400))
    }
    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions)

    const rows = await db
      .select()
      .from(schema.apiRequestLog)
      .where(where)
      .orderBy(desc(schema.apiRequestLog.ts))
      .limit(limit)

    return {
      rows: rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        apiKeyId: r.apiKeyId,
        userId: r.userId,
        endpoint: r.endpoint,
        method: r.method,
        status: r.status,
        errorCode: r.errorCode,
        durationMs: r.durationMs,
        payloadBytes: r.payloadBytes,
        responseBytes: r.responseBytes,
        ts: r.ts.toISOString(),
      })),
      filters: {
        limit,
        workspaceId: args.workspaceId ?? null,
        endpoint: args.endpoint ?? null,
        failuresOnly: args.failuresOnly === true,
      },
    }
  })
}

if (isMain(import.meta.url)) {
  void cliRun(async () => {
    const a = parseArgs(process.argv.slice(2))
    return runTailAuditLog({
      limit: a.limit ? Number(a.limit) : undefined,
      workspaceId: a.workspace ? String(a.workspace) : undefined,
      endpoint: a.endpoint ? String(a.endpoint) : undefined,
      failuresOnly: a.failures === true,
    })
  })
}

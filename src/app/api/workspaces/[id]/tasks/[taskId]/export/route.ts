import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { AppError } from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import {
  annotations,
  events,
  stepAnnotations,
  tasks,
  topics,
  users,
} from '@/lib/db/schema'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'

/**
 * GET /api/workspaces/:id/tasks/:taskId/export?format=json|csv
 *
 * Task-scoped annotation export — admin only. Handles every templateMode
 * (trajectory + pair-rubric + arena-gsb) because the row shape is the
 * same: one row per submitted annotation, with the payload as a column.
 *
 * For trajectory mode, the file also includes a nested `stepAnnotations`
 * array per row (the per-step marks that drive trajectory IAA).
 *
 * Two formats:
 *
 *   - json: array of objects. Best for re-ingest, scripts, downstream
 *           ML pipelines. Default.
 *   - csv:  flat table with payload JSON-stringified into one column.
 *           Best for spreadsheets / human eyeballing.
 *
 * Audit: writes an `export.created` event with the row count + bytes
 * so admins can see who pulled what when.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; taskId: string }> },
) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  const { id: workspaceId, taskId } = await ctx.params

  const url = new URL(request.url)
  const formatRaw = url.searchParams.get('format')?.toLowerCase() ?? 'json'
  const format: 'json' | 'csv' = formatRaw === 'csv' ? 'csv' : 'json'

  // Phase-6 security audit response: cap the export. Default + max are
  // 50k rows — generous for any realistic annotation workload, but
  // bounded so a single GET can't OOM the serverless function. Admins
  // who need more pass `?limit=N` (still capped) and `?offset=N` to
  // paginate.
  const DEFAULT_EXPORT_LIMIT = 50_000
  const MAX_EXPORT_LIMIT = 50_000
  const limitParam = Number(url.searchParams.get('limit') ?? '')
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_EXPORT_LIMIT)
    : DEFAULT_EXPORT_LIMIT
  const offsetParam = Number(url.searchParams.get('offset') ?? '0')
  const offset = Number.isFinite(offsetParam) && offsetParam > 0
    ? offsetParam
    : 0

  let status = 200
  let errorCode: string | null = null
  let userId: string | null = null
  let response: Response | undefined
  let responseBytes = 0

  try {
    const { user } = await requireWorkspaceAdmin(workspaceId)
    userId = user.id

    const db = getDb()

    // Verify the task belongs to this workspace (don't leak via taskId guess).
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    if (!task || task.workspaceId !== workspaceId) {
      throw new AppError('NOT_FOUND', 'Task not found.', 404)
    }

    // Load every submitted annotation in this task + the submitter info.
    // Bounded by `limit` + `offset` (defaulted above to 50k/0) so a
    // huge task can't OOM the serverless function — the audit event
    // records the row count we returned vs. whether more exists.
    const rows = await db
      .select({
        annotationId: annotations.id,
        topicId: annotations.topicId,
        userId: annotations.userId,
        submitterEmail: users.email,
        submitterDisplayName: users.displayName,
        submittedAt: annotations.submittedAt,
        topicStatus: topics.status,
        topicItemData: topics.itemData,
        payload: annotations.payload,
        reasoningText: annotations.reasoningText,
        deltaSummary: annotations.deltaSummary,
      })
      .from(annotations)
      .innerJoin(topics, eq(topics.id, annotations.topicId))
      .innerJoin(users, eq(users.id, annotations.userId))
      .where(
        and(
          eq(topics.taskId, taskId),
          isNotNull(annotations.submittedAt),
        ),
      )
      .orderBy(annotations.submittedAt)
      .limit(limit)
      .offset(offset)

    // For trajectory mode, pull all step_annotations in one shot and
    // index them by annotationId. Skip for pair/arena (no step marks).
    let stepsByAnnotationId = new Map<
      string,
      Array<typeof stepAnnotations.$inferSelect>
    >()
    if (task.templateMode === 'agent-trace-eval' && rows.length > 0) {
      const annIds = rows.map((r) => r.annotationId)
      const stepRows = await db
        .select()
        .from(stepAnnotations)
        .where(inArray(stepAnnotations.annotationId, annIds))
      for (const s of stepRows) {
        const arr = stepsByAnnotationId.get(s.annotationId) ?? []
        arr.push(s)
        stepsByAnnotationId.set(s.annotationId, arr)
      }
    }

    const exportedAt = new Date().toISOString()
    const baseRows = rows.map((r) => ({
      annotation_id: r.annotationId,
      topic_id: r.topicId,
      task_id: task.id,
      task_name: task.name,
      template_mode: task.templateMode,
      workspace_id: workspaceId,
      submitter_user_id: r.userId,
      submitter_email: r.submitterEmail ?? '',
      submitter_display_name: r.submitterDisplayName ?? '',
      submitted_at: r.submittedAt?.toISOString() ?? '',
      topic_status: r.topicStatus,
      topic_item_data: r.topicItemData ?? {},
      payload: r.payload ?? {},
      reasoning_text: r.reasoningText ?? '',
      delta_summary: r.deltaSummary ?? '',
      step_annotations: stepsByAnnotationId.get(r.annotationId) ?? [],
    }))

    let body: string
    let mime: string
    let filename: string
    if (format === 'json') {
      body = JSON.stringify(
        {
          exported_at: exportedAt,
          workspace_id: workspaceId,
          task_id: task.id,
          task_name: task.name,
          template_mode: task.templateMode,
          count: baseRows.length,
          rows: baseRows,
        },
        null,
        2,
      )
      mime = 'application/json'
      filename = safeFilename(`labelhub-${task.name}-${exportedAt.slice(0, 10)}.json`)
    } else {
      // CSV — flatten payload + item_data + step_annotations into JSON strings.
      const headers = [
        'annotation_id',
        'topic_id',
        'task_id',
        'task_name',
        'template_mode',
        'workspace_id',
        'submitter_user_id',
        'submitter_email',
        'submitter_display_name',
        'submitted_at',
        'topic_status',
        'topic_item_data_json',
        'payload_json',
        'reasoning_text',
        'delta_summary',
        'step_annotations_json',
      ]
      const lines = [headers.join(',')]
      for (const r of baseRows) {
        const cells = [
          r.annotation_id,
          r.topic_id,
          r.task_id,
          r.task_name,
          r.template_mode,
          r.workspace_id,
          r.submitter_user_id,
          r.submitter_email,
          r.submitter_display_name,
          r.submitted_at,
          r.topic_status,
          JSON.stringify(r.topic_item_data),
          JSON.stringify(r.payload),
          r.reasoning_text,
          r.delta_summary,
          JSON.stringify(r.step_annotations),
        ]
        lines.push(cells.map(csvCell).join(','))
      }
      body = lines.join('\n')
      mime = 'text/csv'
      filename = safeFilename(`labelhub-${task.name}-${exportedAt.slice(0, 10)}.csv`)
    }

    responseBytes = Buffer.byteLength(body, 'utf8')

    // Audit event so admins can see who pulled what.
    await db.insert(events).values({
      type: 'export.created',
      workspaceId,
      actorId: user.id,
      payload: {
        taskId: task.id,
        format,
        count: baseRows.length,
        bytes: responseBytes,
      },
    })

    response = new Response(body, {
      status: 200,
      headers: {
        'content-type': mime + '; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'x-export-count': String(baseRows.length),
      },
    })
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status },
      )
    } else {
      status = 500
      errorCode = 'INTERNAL'
      const msg = e instanceof Error ? e.message : 'Unknown error'
      // 3rd security audit: never echo DB/internal error text to clients.
      // Log server-side, surface a generic string in the response.
      console.error('[api] internal error:', msg, e instanceof Error ? e.stack : undefined)
      const safeMsg = 'Internal error'
      response = NextResponse.json(
        { error: safeMsg, code: 'INTERNAL' },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    userId,
    endpoint: 'GET /api/workspaces/:id/tasks/:taskId/export',
    method: 'GET',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    responseBytes,
  })

  return response!
}

/**
 * RFC-4180 cell quoting. We always quote — simpler than detecting needs-
 * quoting, and Excel handles it correctly. Doubles internal quotes per spec.
 */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Make sure a filename is safe for content-disposition: ASCII-only,
 * no quotes/slashes. Replaces anything funky with underscores.
 */
function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

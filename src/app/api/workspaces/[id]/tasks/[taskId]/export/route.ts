import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { requireWorkspaceAdmin } from '@/lib/auth/guards'
import { AppError } from '@/lib/errors'
import { getDb } from '@/lib/db/client'
import {
  aiSubmissionVerdicts,
  annotations,
  events,
  stepAnnotations,
  tasks,
  topics,
  users,
} from '@/lib/db/schema'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import {
  isExportFormat,
  pickFormatterFor,
  type ExportFormat,
  type FieldMapping,
  type FormatOptions,
} from '@/lib/export/formatters'
import { parseFieldMappingParam } from '@/lib/export/mapping-param'
import {
  REVIEW_EVENT_TYPES,
  buildTaskReviewExportFields,
  latestAiVerdictByAnnotation,
  reviewEventsByAnnotation,
} from '@/lib/export/task-review-fields'

const DEFAULT_TASK_TABLE_MAPPING: FieldMapping[] = [
  { source: 'annotation_id', target: 'annotation_id' },
  { source: 'topic_id', target: 'topic_id' },
  { source: 'task_id', target: 'task_id' },
  { source: 'task_name', target: 'task_name' },
  { source: 'template_mode', target: 'template_mode' },
  { source: 'workspace_id', target: 'workspace_id' },
  { source: 'submitter_user_id', target: 'submitter_user_id' },
  { source: 'submitter_email', target: 'submitter_email' },
  { source: 'submitter_display_name', target: 'submitter_display_name' },
  { source: 'submitted_at', target: 'submitted_at' },
  { source: 'topic_status', target: 'topic_status' },
  {
    source: 'topic_item_data',
    target: 'topic_item_data_json',
    transform: 'json_stringify',
  },
  { source: 'payload', target: 'payload_json', transform: 'json_stringify' },
  { source: 'reasoning_text', target: 'reasoning_text' },
  { source: 'delta_summary', target: 'delta_summary' },
  {
    source: 'step_annotations',
    target: 'step_annotations_json',
    transform: 'json_stringify',
  },
  { source: 'ai_review_status', target: 'ai_review_status' },
  { source: 'ai_review_verdict', target: 'ai_review_verdict' },
  { source: 'ai_review_score', target: 'ai_review_score' },
  { source: 'ai_review_reasoning', target: 'ai_review_reasoning' },
  { source: 'ai_review_attempts', target: 'ai_review_attempts' },
  { source: 'ai_review_error', target: 'ai_review_error' },
  { source: 'ai_review_started_at', target: 'ai_review_started_at' },
  { source: 'ai_review_finished_at', target: 'ai_review_finished_at' },
  { source: 'human_review_type', target: 'human_review_type' },
  { source: 'human_review_decision', target: 'human_review_decision' },
  { source: 'human_review_feedback', target: 'human_review_feedback' },
  { source: 'human_review_role', target: 'human_review_role' },
  { source: 'reviewed_at', target: 'reviewed_at' },
  { source: 'review_event_count', target: 'review_event_count' },
  {
    source: 'review_events',
    target: 'review_events_json',
    transform: 'json_stringify',
  },
]

/**
 * GET /api/workspaces/:id/tasks/:taskId/export?format=json|jsonl|csv|excel
 *
 * Task-scoped annotation export — admin only. Handles every templateMode
 * (trajectory + pair-rubric + arena-gsb) because the row shape is the
 * same: one row per submitted annotation, with the payload as a column.
 *
 * For trajectory mode, the file also includes a nested `stepAnnotations`
 * array per row (the per-step marks that drive trajectory IAA).
 *
 * Four formats:
 *
 *   - json: array of objects. Best for re-ingest, scripts, downstream
 *           ML pipelines. Default.
 *   - jsonl: one row per line for streaming training pipelines.
 *   - csv:  flat table with payload JSON-stringified into one column.
 *           Best for spreadsheets / human eyeballing.
 *   - excel: .xlsx workbook for reviewer-friendly handoff.
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
  let format: ExportFormat = 'json'
  let mapping: FieldMapping[] | undefined

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
    if (!isExportFormat(formatRaw)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unknown format "${formatRaw}". Use json, jsonl, csv, or excel.`,
        400,
      )
    }
    format = formatRaw
    mapping = parseFieldMappingParam(url.searchParams.get('mapping'))

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
    const stepsByAnnotationId = new Map<
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

    const annIds = rows.map((r) => r.annotationId)
    const aiVerdictsByAnnotationId =
      annIds.length > 0
        ? latestAiVerdictByAnnotation(
            await db
              .select({
                annotationId: aiSubmissionVerdicts.annotationId,
                status: aiSubmissionVerdicts.status,
                verdict: aiSubmissionVerdicts.verdict,
                scores: aiSubmissionVerdicts.scores,
                reasoning: aiSubmissionVerdicts.reasoning,
                attempts: aiSubmissionVerdicts.attempts,
                errorText: aiSubmissionVerdicts.errorText,
                startedAt: aiSubmissionVerdicts.startedAt,
                finishedAt: aiSubmissionVerdicts.finishedAt,
              })
              .from(aiSubmissionVerdicts)
              .where(inArray(aiSubmissionVerdicts.annotationId, annIds))
              .orderBy(desc(aiSubmissionVerdicts.startedAt)),
          )
        : new Map()
    const reviewEventsByAnnotationId =
      annIds.length > 0
        ? reviewEventsByAnnotation(
            await db
              .select({
                type: events.type,
                actorId: events.actorId,
                payload: events.payload,
                ts: events.ts,
              })
              .from(events)
              .where(
                and(
                  eq(events.workspaceId, workspaceId),
                  inArray(events.type, REVIEW_EVENT_TYPES),
                  sql`${events.payload} ->> 'annotationId' = ANY(${annIds})`,
                ),
              )
              .orderBy(events.ts),
          )
        : new Map()

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
      ...buildTaskReviewExportFields({
        annotationId: r.annotationId,
        aiVerdict: aiVerdictsByAnnotationId.get(r.annotationId),
        reviewEvents: reviewEventsByAnnotationId.get(r.annotationId),
      }),
    }))

    let body: string | Uint8Array
    let mime: string
    let filename: string
    if (format === 'json' && !mapping) {
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
      const formatter = pickFormatterFor(format)
      const formatOptions: FormatOptions = {
        sheetName: 'Annotations',
        ...(mapping
          ? { mapping }
          : format === 'csv' || format === 'excel'
            ? { mapping: DEFAULT_TASK_TABLE_MAPPING }
            : {}),
      }
      body = await collectChunks(formatter(rowIterator(baseRows), formatOptions))
      mime = formatter.meta.contentType
      filename = safeFilename(
        `labelhub-${task.name}-${exportedAt.slice(0, 10)}.${formatter.meta.extension}`,
      )
    }

    responseBytes =
      typeof body === 'string'
        ? Buffer.byteLength(body, 'utf8')
        : body.byteLength

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
        mappingCount: mapping?.length ?? 0,
      },
    })

    let responseBody: string | ArrayBuffer
    if (typeof body === 'string') {
      responseBody = body
    } else {
      responseBody = new ArrayBuffer(body.byteLength)
      new Uint8Array(responseBody).set(body)
    }
    response = new Response(responseBody, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-disposition': `attachment; filename="${filename}"`,
        'x-export-count': String(baseRows.length),
        'x-format': format,
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

async function* rowIterator(rows: Record<string, unknown>[]) {
  for (const row of rows) yield row
}

async function collectChunks(
  chunks: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const chunk of chunks) {
    parts.push(chunk)
    total += chunk.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * Make sure a filename is safe for content-disposition: ASCII-only,
 * no quotes/slashes. Replaces anything funky with underscores.
 */
function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

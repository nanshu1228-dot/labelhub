import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  aiSubmissionVerdicts,
  annotationRevisions,
  annotations,
  customFormSchemas,
  tasks,
  topics,
  users,
} from '@/lib/db/schema'

/**
 * Reviewer-side annotation loader — Finals P3 D11.
 *
 * Pulls every piece the /review/[id] page needs in one place:
 *   - The annotation + topic + task + workspace + submitter row
 *   - The chronological list of annotation_revisions (for diffs)
 *   - The list of ai_submission_verdicts (current + historical)
 *   - The custom_form_schemas row (if templateConfig points at one)
 *
 * The Renderer needs the form schema to render the submitted payload
 * read-only; if the task is a non-custom-designer template the
 * Renderer is skipped and the payload prints as JSON.
 */
export interface AnnotationDetail {
  annotation: {
    id: string
    userId: string
    topicId: string
    payload: Record<string, unknown>
    submittedAt: Date | null
  }
  topic: { id: string; status: string; itemData: Record<string, unknown> }
  task: {
    id: string
    name: string
    templateMode: string
    templateConfig: Record<string, unknown> | null
    workspaceId: string
  }
  submitter: { id: string; email: string | null } | null
  revisions: Array<{
    id: string
    kind: string
    actorId: string
    payload: Record<string, unknown>
    ts: Date
  }>
  verdicts: Array<{
    id: string
    status: string
    verdict: string | null
    scores: Record<string, unknown> | null
    reasoning: string | null
    attempts: number
    errorText: string | null
    startedAt: Date
    finishedAt: Date | null
  }>
  /** Designer-saved schema body, if the task references one. */
  formSchema: unknown | null
}

export async function loadAnnotationDetail(
  annotationId: string,
): Promise<AnnotationDetail | null> {
  const db = getDb()
  const [base] = await db
    .select({
      annotationId: annotations.id,
      annotationUserId: annotations.userId,
      annotationPayload: annotations.payload,
      annotationSubmittedAt: annotations.submittedAt,
      topicId: annotations.topicId,
      topicStatus: topics.status,
      topicItemData: topics.itemData,
      taskId: tasks.id,
      taskName: tasks.name,
      taskTemplateMode: tasks.templateMode,
      taskTemplateConfig: tasks.templateConfig,
      taskWorkspaceId: tasks.workspaceId,
      submitterId: users.id,
      submitterEmail: users.email,
    })
    .from(annotations)
    .innerJoin(topics, eq(topics.id, annotations.topicId))
    .innerJoin(tasks, eq(tasks.id, topics.taskId))
    .leftJoin(users, eq(users.id, annotations.userId))
    .where(eq(annotations.id, annotationId))
    .limit(1)
  if (!base) return null

  const [revisions, verdicts] = await Promise.all([
    db
      .select({
        id: annotationRevisions.id,
        kind: annotationRevisions.kind,
        actorId: annotationRevisions.actorId,
        payload: annotationRevisions.payload,
        ts: annotationRevisions.ts,
      })
      .from(annotationRevisions)
      .where(eq(annotationRevisions.annotationId, annotationId))
      .orderBy(asc(annotationRevisions.ts)),
    db
      .select({
        id: aiSubmissionVerdicts.id,
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
      .where(eq(aiSubmissionVerdicts.annotationId, annotationId))
      .orderBy(asc(aiSubmissionVerdicts.startedAt)),
  ])

  // Resolve the custom form schema if the task references one.
  let formSchema: unknown = null
  const tc = base.taskTemplateConfig as { formSchemaId?: string } | null
  if (tc?.formSchemaId) {
    const [row] = await db
      .select({ schema: customFormSchemas.schema })
      .from(customFormSchemas)
      .where(eq(customFormSchemas.id, tc.formSchemaId))
      .limit(1)
    if (row) formSchema = row.schema
  }

  return {
    annotation: {
      id: base.annotationId,
      userId: base.annotationUserId,
      topicId: base.topicId,
      payload: (base.annotationPayload as Record<string, unknown>) ?? {},
      submittedAt: base.annotationSubmittedAt,
    },
    topic: {
      id: base.topicId,
      status: base.topicStatus,
      itemData: (base.topicItemData as Record<string, unknown>) ?? {},
    },
    task: {
      id: base.taskId,
      name: base.taskName,
      templateMode: base.taskTemplateMode,
      templateConfig:
        base.taskTemplateConfig as Record<string, unknown> | null,
      workspaceId: base.taskWorkspaceId,
    },
    submitter:
      base.submitterId != null
        ? { id: base.submitterId, email: base.submitterEmail }
        : null,
    revisions: revisions.map((r) => ({
      id: r.id,
      kind: r.kind,
      actorId: r.actorId,
      payload: (r.payload as Record<string, unknown>) ?? {},
      ts: r.ts,
    })),
    verdicts: verdicts.map((v) => ({
      id: v.id,
      status: v.status,
      verdict: v.verdict,
      scores: v.scores as Record<string, unknown> | null,
      reasoning: v.reasoning,
      attempts: v.attempts,
      errorText: v.errorText,
      startedAt: v.startedAt,
      finishedAt: v.finishedAt,
    })),
    formSchema,
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireWorkspaceMember } from '@/lib/auth/guards'
import { getDb } from '@/lib/db/client'
import { tasks, topics } from '@/lib/db/schema'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors'
import { uploadBytes } from '@/lib/proxy/storage'
import { uuidLike } from '@/lib/validators/uuid'

export const runtime = 'nodejs'

const MAX_FORM_UPLOAD_BYTES = 25 * 1024 * 1024

const uploadSchema = z.object({
  workspaceId: uuidLike,
  topicId: uuidLike,
  taskId: uuidLike.optional(),
  fieldId: z.string().min(1).max(120),
  maxSizeMb: z.coerce.number().positive().max(25).optional(),
})

/**
 * POST /api/form-uploads
 *
 * Runtime upload endpoint for the Custom Designer file/image material.
 * The form renderer stays schema-driven; it posts the selected file plus
 * the current workspace/topic context here, and the route writes bytes
 * through the existing LabelHub media storage abstraction:
 *
 *   - self-host: local FS under /storage/labelhub-media/...
 *   - Vercel/Supabase: Supabase Storage bucket labelhub-media
 *
 * Auth model mirrors annotation save/submit:
 *   - signed-in workspace member, not viewer
 *   - topic belongs to the workspace/task
 *   - topic is draft/revising and not claimed by someone else
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const parsed = uploadSchema.parse({
      workspaceId: getText(form, 'workspaceId'),
      topicId: getText(form, 'topicId'),
      taskId: getText(form, 'taskId') || undefined,
      fieldId: getText(form, 'fieldId'),
      maxSizeMb: getText(form, 'maxSizeMb') || undefined,
    })

    const file = form.get('file')
    if (!isFileLike(file)) {
      throw new ValidationError('Upload requires a file.')
    }

    const maxBytes = Math.min(
      MAX_FORM_UPLOAD_BYTES,
      Math.round((parsed.maxSizeMb ?? 25) * 1024 * 1024),
    )
    if (file.size > maxBytes) {
      throw new ValidationError(
        `File is too large. Maximum size is ${Math.floor(maxBytes / 1024 / 1024)}MB.`,
      )
    }

    const db = getDb()
    const [topic] = await db
      .select({
        id: topics.id,
        taskId: topics.taskId,
        assignedTo: topics.assignedTo,
        status: topics.status,
      })
      .from(topics)
      .where(eq(topics.id, parsed.topicId))
      .limit(1)
    if (!topic) throw new NotFoundError('Topic')
    if (parsed.taskId && topic.taskId !== parsed.taskId) {
      throw new ValidationError('Topic does not belong to this task.')
    }

    const [task] = await db
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
      })
      .from(tasks)
      .where(eq(tasks.id, topic.taskId))
      .limit(1)
    if (!task) throw new NotFoundError('Task')
    if (task.workspaceId !== parsed.workspaceId) {
      throw new ValidationError('Task does not belong to this workspace.')
    }

    const { user, role } = await requireWorkspaceMember(task.workspaceId)
    if (role === 'viewer') {
      throw new ForbiddenError('Viewer role cannot upload annotation files.')
    }
    if (topic.assignedTo && topic.assignedTo !== user.id) {
      throw new ForbiddenError('This topic is claimed by another annotator.')
    }
    if (topic.status !== 'drafting' && topic.status !== 'revising') {
      throw new ConflictError(
        `Topic is ${topic.status} — cannot upload new files.`,
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const upload = await uploadBytes({
      workspaceId: task.workspaceId,
      bytes,
      mediaType: file.type || 'application/octet-stream',
    })

    return NextResponse.json({
      file: {
        url: upload.publicUrl,
        path: upload.path,
        name: sanitizeFileName(file.name),
        size: file.size,
        type: file.type || 'application/octet-stream',
        fieldId: parsed.fieldId,
        uploadedAt: new Date().toISOString(),
      },
      reused: upload.reused,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid upload request.', details: error.flatten() },
        { status: 400 },
      )
    }
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      )
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Upload failed.',
      },
      { status: 500 },
    )
  }
}

function getText(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'arrayBuffer' in value &&
      typeof value.arrayBuffer === 'function' &&
      'name' in value &&
      typeof value.name === 'string' &&
      'size' in value &&
      typeof value.size === 'number',
  )
}

function sanitizeFileName(name: string): string {
  const clean = name.replace(/[^\w.\-()[\] ]+/g, '_').trim()
  return clean.slice(0, 180) || 'upload.bin'
}

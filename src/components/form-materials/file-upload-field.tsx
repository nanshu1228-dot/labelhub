'use client'

import { useRef, useState } from 'react'
import {
  NumberRow,
  TagListRow,
} from './primitives'
import type { Material, RuntimeRendererProps } from './types'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * File / image upload. D6 Renderer wires this to Supabase Storage via
 * the existing upload helpers. accept[] follows the input[type=file]
 * accept attribute convention.
 */
type FileUploadConfig = {
  accept?: string[]
  maxSizeMb?: number
  maxFiles?: number
}

export type UploadedFormFile = {
  url: string
  path: string
  name: string
  size: number
  type: string
  fieldId?: string
  uploadedAt?: string
}

export const fileUploadFieldMaterial: Material = {
  kind: 'file-upload',
  name: 'File / image',
  icon: '⬆',
  defaultConfig: {
    accept: ['image/*'],
    maxSizeMb: 5,
    maxFiles: 1,
  } satisfies FileUploadConfig,
  designerPreview: ({ field }) => {
    const cfg = field.config as FileUploadConfig
    return (
      <div
        className="rounded p-4 text-center ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px dashed var(--line)',
          color: 'var(--mute)',
          cursor: 'grab',
        }}
      >
        <div className="ts-22 mb-1">⬆</div>
        <div>Drop files or click to upload</div>
        <div
          className="ts-11 mono mt-1"
          style={{ color: 'var(--mute2)' }}
        >
          accept: {(cfg.accept ?? []).join(', ') || 'any'} · max
          {' '}
          {cfg.maxSizeMb ?? 5}MB
          {(cfg.maxFiles ?? 1) > 1 ? ` · up to ${cfg.maxFiles} files` : ''}
        </div>
      </div>
    )
  },
  runtimeRenderer: FileUploadRuntime,
  propertyPanel: ({ field, onChange }) => {
    const cfg = field.config as FileUploadConfig
    function patch(next: Partial<FileUploadConfig>) {
      onChange({ ...field, config: { ...cfg, ...next } })
    }
    return (
      <>
        <TagListRow
          label="Accept"
          hint="MIME types or extensions (image/*, .pdf, application/json)"
          value={cfg.accept ?? []}
          onChange={(accept) => patch({ accept })}
          placeholder="image/*, .pdf"
        />
        <NumberRow
          label="Max size (MB)"
          value={cfg.maxSizeMb ?? 5}
          onChange={(v) => patch({ maxSizeMb: v ?? 5 })}
          min={1}
        />
        <NumberRow
          label="Max files"
          value={cfg.maxFiles ?? 1}
          onChange={(v) => patch({ maxFiles: v ?? 1 })}
          min={1}
        />
      </>
    )
  },
}

function FileUploadRuntime({
  field,
  value,
  onChange,
  readOnly,
  uploadContext,
}: RuntimeRendererProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const files = normalizeUploadValue(value)
  const cfg = field.config as FileUploadConfig
  const maxFiles = Math.max(1, cfg.maxFiles ?? 1)
  const maxSizeMb = Math.max(1, cfg.maxSizeMb ?? 5)
  const accepts = cfg.accept ?? []
  const canUpload = !readOnly && Boolean(uploadContext)

  async function handleFiles(list: FileList | null) {
    if (!list || !uploadContext || readOnly) return
    setError(null)
    const remaining = maxFiles - files.length
    if (remaining <= 0) {
      setError(`Maximum ${maxFiles} file${maxFiles === 1 ? '' : 's'} reached.`)
      return
    }
    const picked = Array.from(list).slice(0, remaining)
    const uploaded: UploadedFormFile[] = []
    setUploading(true)
    try {
      for (const file of picked) {
        if (!matchesAccept(file, accepts)) {
          throw new Error(`${file.name} is not an accepted file type.`)
        }
        if (file.size > maxSizeMb * 1024 * 1024) {
          throw new Error(`${file.name} exceeds ${maxSizeMb}MB.`)
        }
        const body = new FormData()
        body.set('file', file)
        body.set('workspaceId', uploadContext.workspaceId)
        body.set('taskId', uploadContext.taskId)
        body.set('topicId', uploadContext.topicId)
        body.set('fieldId', field.id)
        body.set('maxSizeMb', String(maxSizeMb))
        const res = await fetch('/api/form-uploads', {
          method: 'POST',
          body,
        })
        const json = (await res.json().catch(() => null)) as
          | { file?: UploadedFormFile; error?: string }
          | null
        if (!res.ok || !json?.file) {
          throw new Error(json?.error ?? 'Upload failed.')
        }
        uploaded.push(json.file)
      }
      if (uploaded.length > 0) {
        onChange([...files, ...uploaded])
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Upload failed.'))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function removeAt(index: number) {
    if (readOnly) return
    onChange(files.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="rounded p-3 ts-12"
        style={{
          background: 'var(--bg)',
          border: '1px dashed var(--line)',
          color: 'var(--mute)',
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div style={{ color: 'var(--text)' }}>
              {readOnly ? 'Uploaded files' : 'Upload files'}
            </div>
            <div
              className="ts-11 mono mt-1"
              style={{ color: 'var(--mute2)' }}
            >
              accept: {accepts.join(', ') || 'any'} · max {maxSizeMb}MB
              {maxFiles > 1 ? ` · up to ${maxFiles} files` : ''}
            </div>
          </div>
          {!readOnly ? (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple={maxFiles > 1}
                accept={accepts.join(',')}
                onChange={(e) => void handleFiles(e.target.files)}
                disabled={!canUpload || uploading || files.length >= maxFiles}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={!canUpload || uploading || files.length >= maxFiles}
                className="ts-12 mono rounded px-3"
                style={{
                  minHeight: 36,
                  background:
                    !canUpload || uploading || files.length >= maxFiles
                      ? 'var(--panel2)'
                      : 'var(--accent-soft)',
                  border:
                    !canUpload || uploading || files.length >= maxFiles
                      ? '1px solid var(--line)'
                      : '1px solid var(--accent-line)',
                  color:
                    !canUpload || uploading || files.length >= maxFiles
                      ? 'var(--mute2)'
                      : 'var(--accent)',
                  cursor:
                    !canUpload || uploading || files.length >= maxFiles
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {uploading ? 'Uploading...' : 'Choose files'}
              </button>
            </>
          ) : null}
        </div>
        {!canUpload && !readOnly ? (
          <div className="ts-11 mt-2" style={{ color: 'var(--mute2)' }}>
            Upload is unavailable in this read-only preview.
          </div>
        ) : null}
      </div>
      {files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {files.map((f, index) => (
            <li
              key={`${f.path}:${index}`}
              className="rounded p-2"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
              }}
            >
              <div className="flex items-center gap-3">
                {isImageFile(f) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.url}
                    alt=""
                    style={{
                      width: 52,
                      height: 52,
                      objectFit: 'cover',
                      borderRadius: 4,
                      border: '1px solid var(--line)',
                    }}
                  />
                ) : (
                  <div
                    className="ts-12 mono inline-flex items-center justify-center"
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 4,
                      border: '1px solid var(--line)',
                      color: 'var(--mute)',
                    }}
                  >
                    FILE
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ts-12 mono"
                    style={{
                      color: 'var(--text)',
                      textDecoration: 'none',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {f.name}
                  </a>
                  <div className="ts-11 mono mt-0.5" style={{ color: 'var(--mute2)' }}>
                    {formatBytes(f.size)} · {f.type || 'file'}
                  </div>
                </div>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    className="ts-11 mono rounded px-2"
                    style={{
                      minHeight: 32,
                      background: 'transparent',
                      border: '1px solid oklch(0.55 0.2 25 / 0.35)',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <span className="ts-11" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
    </div>
  )
}

export function normalizeUploadValue(value: unknown): UploadedFormFile[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): UploadedFormFile | null => {
      if (typeof item === 'string' && item.trim()) {
        return {
          url: item,
          path: item,
          name: lastPathSegment(item),
          size: 0,
          type: '',
        }
      }
      if (!item || typeof item !== 'object') return null
      const rec = item as Record<string, unknown>
      const url = typeof rec.url === 'string' ? rec.url : ''
      const path = typeof rec.path === 'string' ? rec.path : url
      if (!url || !path) return null
      return {
        url,
        path,
        name:
          typeof rec.name === 'string' && rec.name.trim()
            ? rec.name
            : lastPathSegment(path),
        size: typeof rec.size === 'number' ? rec.size : 0,
        type: typeof rec.type === 'string' ? rec.type : '',
        fieldId: typeof rec.fieldId === 'string' ? rec.fieldId : undefined,
        uploadedAt:
          typeof rec.uploadedAt === 'string' ? rec.uploadedAt : undefined,
      }
    })
    .filter((item): item is UploadedFormFile => Boolean(item))
}

export function matchesAccept(file: File, accept: string[] | undefined): boolean {
  const tokens = (accept ?? []).map((v) => v.trim()).filter(Boolean)
  if (tokens.length === 0) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return tokens.some((token) => {
    const t = token.toLowerCase()
    if (t === '*/*') return true
    if (t.endsWith('/*')) return type.startsWith(`${t.slice(0, -1)}`)
    if (t.startsWith('.')) return name.endsWith(t)
    return type === t
  })
}

function isImageFile(file: UploadedFormFile): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(file.path)
  )
}

function formatBytes(bytes: number): string {
  if (!bytes) return 'stored'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function lastPathSegment(value: string): string {
  try {
    const url = new URL(value, 'https://labelhub.local')
    const segment = url.pathname.split('/').filter(Boolean).at(-1)
    return segment ? decodeURIComponent(segment) : 'upload'
  } catch {
    return value.split('/').filter(Boolean).at(-1) ?? 'upload'
  }
}

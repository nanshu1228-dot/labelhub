'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTopicsBatch } from '@/lib/actions/topics'

/**
 * Admin bulk-topic upload.
 *
 * Accepts a JSON array (one object per topic). Each object should match
 * the template's itemSchema: { prompt, responseA: {modelName, content},
 * responseB: {modelName, content}, context? } for pair/arena modes.
 *
 * The server-side action validates each row individually and returns
 * per-index errors, so the admin can see which rows failed and fix
 * them without losing the good ones.
 *
 * For CSV / Excel: paste the JSON output of a separate convert tool.
 * We deliberately keep this form text-only — file uploads have
 * encoding pitfalls (BOM, Excel UTF-16) that are easier to dodge by
 * letting the admin paste pre-validated JSON.
 */

const SAMPLE_JSON = `[
  {
    "prompt": "What's the capital of France?",
    "responseA": { "modelName": "gpt-4o", "content": "Paris." },
    "responseB": { "modelName": "claude-sonnet-4.6", "content": "The capital of France is Paris." }
  }
]`

export function BulkUploadForm({
  taskId,
}: {
  taskId: string
}) {
  const router = useRouter()
  const [json, setJson] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    created: number
    failed: Array<{ index: number; error: string }>
  } | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    setResult(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.')
      return
    }
    if (!Array.isArray(parsed)) {
      setError('Top-level value must be an array of topic objects.')
      return
    }
    if (parsed.length === 0) {
      setError('Array is empty — nothing to upload.')
      return
    }
    if (parsed.length > 100) {
      setError(`Maximum 100 items per upload (got ${parsed.length}). Split into smaller batches.`)
      return
    }
    // The server does the per-item shape check; here we just confirm
    // every item is at least an object.
    for (const [i, item] of parsed.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        setError(`Item ${i} must be an object.`)
        return
      }
    }
    const items = parsed as Array<Record<string, unknown>>

    startTransition(async () => {
      try {
        const res = await createTopicsBatch({ taskId, items })
        setResult(res)
        if (res.created > 0) {
          setJson('')
          router.refresh()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Bulk upload failed.')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ts-12 mono"
        style={{
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px solid oklch(0.6 0.18 280 / 0.4)',
          borderRadius: 5,
          padding: '4px 10px',
          cursor: 'pointer',
        }}
      >
        + bulk upload (JSON)
      </button>
    )
  }

  return (
    <div
      className="rounded-md p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="lbl">§ BULK UPLOAD · PASTE JSON</div>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setJson('')
            setError(null)
            setResult(null)
          }}
          className="ts-11 mono"
          style={{
            color: 'var(--mute2)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          cancel
        </button>
      </div>
      <p className="ts-12 mb-2" style={{ color: 'var(--mute2)' }}>
        Array of objects matching the template&apos;s item shape (prompt + responseA + responseB). Up to 100 per batch. Bad rows are reported by index — good rows still land.
      </p>
      <details className="mb-3">
        <summary
          className="ts-11 mono cursor-pointer"
          style={{ color: 'var(--mute)' }}
        >
          show example
        </summary>
        <pre
          className="ts-11 mt-2 p-2 rounded mono"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            color: 'var(--mute)',
            overflowX: 'auto',
          }}
        >
          {SAMPLE_JSON}
        </pre>
      </details>

      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={10}
        maxLength={200000}
        placeholder="[ { ... }, { ... } ]"
        className="w-full px-3 py-2 ts-12 mono rounded-md"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          color: 'var(--text)',
          outline: 'none',
          resize: 'vertical',
        }}
      />

      {error && (
        <div
          className="ts-12 mono mt-2 p-2 rounded"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          className="ts-12 mono mt-2 p-2 rounded"
          style={{
            background:
              result.failed.length === 0
                ? 'oklch(0.65 0.18 200 / 0.1)'
                : 'oklch(0.7 0.14 75 / 0.1)',
            border:
              result.failed.length === 0
                ? '1px solid oklch(0.65 0.18 200 / 0.35)'
                : '1px solid oklch(0.7 0.14 75 / 0.35)',
            color: 'var(--text)',
          }}
        >
          <div>
            <strong>created:</strong> {result.created} ·{' '}
            <strong>failed:</strong> {result.failed.length}
          </div>
          {result.failed.length > 0 && (
            <ul className="mt-2 ts-11" style={{ color: 'var(--mute)' }}>
              {result.failed.slice(0, 8).map((f) => (
                <li key={f.index}>
                  row {f.index}: {f.error.slice(0, 200)}
                </li>
              ))}
              {result.failed.length > 8 && (
                <li>… {result.failed.length - 8} more.</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-end mt-3">
        <button
          onClick={submit}
          disabled={pending || !json.trim()}
          className="ts-13 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 500,
            cursor: pending || !json.trim() ? 'not-allowed' : 'pointer',
            opacity: pending || !json.trim() ? 0.5 : 1,
          }}
        >
          {pending ? 'uploading…' : 'upload'}
        </button>
      </div>
    </div>
  )
}

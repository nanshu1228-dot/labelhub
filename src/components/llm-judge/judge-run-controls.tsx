'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runJudgeAction } from '@/lib/actions/llm-judges'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * "Run this judge on N samples" form. Sample size + run button + error
 * surface. Runs synchronously (up to ~20 samples), then navigates to
 * the run-detail page.
 */
export function JudgeRunControls({
  judgeId,
  workspaceId,
}: {
  judgeId: string
  workspaceId: string
}) {
  const router = useRouter()
  const [sampleSize, setSampleSize] = useState(5)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setError(null)
    startTransition(async () => {
      try {
        const r = await runJudgeAction({ judgeId, sampleSize })
        router.push(
          `/workspaces/${workspaceId}/judges/${judgeId}/runs/${r.runId}`,
        )
      } catch (e) {
        setError(getErrorMessage(e, 'Run failed.'))
      }
    })
  }

  return (
    <div
      className="rounded-md p-4"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <label
          className="ts-12 mono inline-flex items-center gap-2"
          style={{ color: 'var(--mute)' }}
        >
          <span>sample size</span>
          <input
            type="number"
            min={1}
            max={20}
            value={sampleSize}
            onChange={(e) =>
              setSampleSize(
                Math.max(1, Math.min(20, Number(e.target.value) || 1)),
              )
            }
            className="px-2 py-1 mono ts-13 rounded"
            style={{
              width: 64,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </label>
        <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
          random submitted annotations; 20 max for now
        </span>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="ts-13 mono ml-auto"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 500,
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? `running ${sampleSize}…` : `▶ run on ${sampleSize}`}
        </button>
      </div>
      {pending && (
        <p
          className="ts-11 mono mt-2"
          style={{ color: 'var(--mute2)' }}
        >
          One Claude call per sample; this can take up to ~{sampleSize * 3}s.
          Stay on this page.
        </p>
      )}
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
    </div>
  )
}

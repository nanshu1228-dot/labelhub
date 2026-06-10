'use client'
import { useState, useTransition } from 'react'
import { refineGuidelinesDemo } from '@/lib/actions/guideline-refiner'
import { getErrorMessage } from '@/lib/errors/client-utils'

/**
 * Big purple "Refine with Claude" button that fires the AI Guideline
 * Refiner. Shows the freshly-proposed patch summary inline so demo flow is
 * clear without scrolling — the persisted patch lands in the section below.
 */
export function RefinerActionClient({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<{
    title: string
    rationale: string
    confidence: string
    addressesCount: number
  } | null>(null)

  const onClick = () => {
    setError(null)
    setProposal(null)
    startTransition(async () => {
      try {
        const result = await refineGuidelinesDemo({ workspaceId })
        setProposal({
          title: result.title,
          rationale: result.rationale,
          confidence: result.confidence,
          addressesCount: result.addressesCount,
        })
      } catch (e) {
        setError(
          getErrorMessage(e, 'Failed to propose a patch. Check server logs.'),
        )
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="lh-btn lh-btn-accent"
        >
          {pending ? 'Asking Claude…' : '⚙ Refine guideline with Claude'}
        </button>
        <span
          className="ts-12 mono"
          style={{ color: 'var(--mute2)' }}
        >
          reads up to 10 disputes · Sonnet 4.6 · ~2-5k tokens
        </span>
      </div>
      {error && (
        <div
          className="ts-13 mono px-3 py-2 rounded-md"
          style={{
            color: 'var(--danger)',
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.6 0.2 25 / 0.4)',
          }}
        >
          {error}
        </div>
      )}
      {proposal && (
        <div
          className="rounded-xl px-4 py-3"
          style={{
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-line)',
          }}
        >
          <div
            className="ts-12 mono mb-1"
            style={{
              color: 'var(--accent)',
              letterSpacing: '0.04em',
            }}
          >
            ⚙ NEW PATCH DRAFTED · confidence:{' '}
            <span style={{ fontWeight: 600 }}>{proposal.confidence}</span> ·{' '}
            {proposal.addressesCount} case
            {proposal.addressesCount === 1 ? '' : 's'} addressed
          </div>
          <div
            className="ts-13"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            {proposal.title}
          </div>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)' }}
          >
            {proposal.rationale}
          </p>
          <p
            className="ts-12 mono mt-2"
            style={{ color: 'var(--mute2)' }}
          >
            → see the full proposed patch in the GUIDELINE PATCHES section
            below, then accept or reject.
          </p>
        </div>
      )}
    </div>
  )
}

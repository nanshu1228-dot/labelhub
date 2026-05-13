'use client'

import type { AnnotateMode } from './types'

export interface AnnotateProgress {
  rated: number
  total: number
  marks: number
  totalMarks: number
}

export interface TopBarProps {
  agentName: string
  trajectoryId: string
  mode: AnnotateMode
  setMode: (m: AnnotateMode) => void
  deepDive: boolean
  setDeepDive: (v: boolean) => void
  progress: AnnotateProgress
  onOpenReference: () => void
  /** Optional CTA — only shown when caller wires it (e.g. submit/review). */
  onSubmit?: () => void
  submitDisabled?: boolean
  submitLabel?: string
}

/**
 * The top bar: breadcrumb-ish identity (agent + traj id), mode switcher,
 * Deep Dive toggle, progress, "?" rubric reference, optional submit CTA.
 *
 * The mode segmented control is the user-facing affordance for the three
 * keyboard shortcuts (⌘F focus, ⌘\ compare). Keyboard shortcuts live in
 * `use-annotate-keyboard.ts` so they can be toggled per layout.
 */
export function TopBar({
  agentName,
  trajectoryId,
  mode,
  setMode,
  deepDive,
  setDeepDive,
  progress,
  onOpenReference,
  onSubmit,
  submitDisabled,
  submitLabel,
}: TopBarProps) {
  return (
    <header
      className="hairline-b sticky top-0 z-10"
      style={{ background: 'var(--panel)' }}
    >
      <div className="flex items-center justify-between px-5 h-12 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="ts-13"
            style={{ color: 'var(--hi)', fontWeight: 500 }}
          >
            {agentName}
          </span>
          <span
            className="mono ts-11"
            style={{ color: 'var(--mute2)' }}
          >
            · {trajectoryId.slice(0, 8)}
          </span>
          <ProgressBadge progress={progress} />
        </div>

        <div className="flex items-center gap-2">
          <div className="seg" role="tablist" aria-label="Layout mode">
            <ModeButton
              kbd="S"
              label="Standard"
              on={mode === 'standard'}
              onClick={() => setMode('standard')}
            />
            <ModeButton
              kbd="F"
              label="Focus"
              on={mode === 'focus'}
              onClick={() => setMode('focus')}
            />
            <ModeButton
              kbd="\\"
              label="Compare"
              on={mode === 'compare'}
              onClick={() => setMode('compare')}
            />
          </div>

          <button
            type="button"
            className={`icon-btn ${deepDive ? 'on' : ''}`}
            onClick={() => setDeepDive(!deepDive)}
            title="Deep Dive — force reason field on every rating (⌘D)"
            aria-pressed={deepDive}
            aria-label="Toggle deep dive"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6.5 1.5v10M1.5 6.5h10"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="square"
              />
            </svg>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={onOpenReference}
            title="Rubric reference (?)"
            aria-label="Show rubric reference"
          >
            <span className="mono ts-12">?</span>
          </button>

          {onSubmit && (
            <button
              type="button"
              className="lh-btn lh-btn-accent lh-btn-sm"
              onClick={onSubmit}
              disabled={submitDisabled}
            >
              {submitLabel ?? 'Submit'}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function ModeButton({
  label,
  kbd,
  on,
  onClick,
}: {
  label: string
  kbd: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`seg-btn ${on ? 'on' : ''}`}
    >
      <span>{label}</span>
      <span className="kbd">⌘{kbd}</span>
    </button>
  )
}

function ProgressBadge({ progress }: { progress: AnnotateProgress }) {
  const stepPct = progress.total ? (progress.rated / progress.total) * 100 : 0
  return (
    <span
      className="mono ts-11"
      style={{ color: 'var(--mute2)' }}
      title={`${progress.marks} of ${progress.totalMarks} rubric marks placed`}
    >
      · {progress.rated}/{progress.total} steps ({Math.round(stepPct)}%)
    </span>
  )
}

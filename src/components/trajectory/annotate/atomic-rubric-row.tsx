'use client'

import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import type { RubricItem, Mark } from '@/lib/templates/rubric'
import {
  stepMarkAtomFamily,
  trajectoryMarkAtomFamily,
  stepPersistStatusAtomFamily,
  trajectoryPersistStatusAtomFamily,
  stepMarkKey,
  type PersistStatus,
} from './store'
import type { ClaudeHint, PeerMark } from './types'
import { RubricRow } from './rubric-row'

/**
 * Thin wrappers that subscribe to a single mark atom and feed the pure
 * <RubricRow> below. This is the unit of "re-render isolation": when the
 * user toggles step 5 / safety, only the AtomicStepRubricRow for
 * (step5, safety) sees a change — nothing else in the tree re-renders.
 */

export function AtomicStepRubricRow({
  item,
  stepId,
  peerMarks,
  claudeHint,
  onChange,
  deepDive,
  showKbd,
  disabled,
}: {
  item: RubricItem
  stepId: string
  peerMarks?: readonly PeerMark[]
  claudeHint?: ClaudeHint
  onChange: (patch: Partial<Mark>) => void
  deepDive?: boolean
  showKbd?: boolean
  disabled?: boolean
}) {
  const key = stepMarkKey(stepId, item.id)
  const mark = useAtomValue(stepMarkAtomFamily(key))
  const status = useAtomValue(stepPersistStatusAtomFamily(key))
  return (
    <div style={{ position: 'relative' }}>
      <RubricRow
        item={item}
        mark={mark}
        onChange={onChange}
        peerMarks={peerMarks}
        claudeHint={claudeHint}
        deepDive={deepDive}
        showKbd={showKbd}
        disabled={disabled}
      />
      <SaveStatusGlyph
        key={status.state === 'saved' ? `saved-${status.at}` : status.state}
        status={status}
      />
    </div>
  )
}

export function AtomicTrajectoryRubricRow({
  item,
  onChange,
  deepDive,
  disabled,
}: {
  item: RubricItem
  onChange: (patch: Partial<Mark>) => void
  deepDive?: boolean
  disabled?: boolean
}) {
  const mark = useAtomValue(trajectoryMarkAtomFamily(item.id))
  const status = useAtomValue(trajectoryPersistStatusAtomFamily(item.id))
  return (
    <div style={{ position: 'relative' }}>
      <RubricRow
        item={item}
        mark={mark}
        onChange={onChange}
        deepDive={deepDive}
        disabled={disabled}
      />
      <SaveStatusGlyph
        key={status.state === 'saved' ? `saved-${status.at}` : status.state}
        status={status}
      />
    </div>
  )
}

/**
 * Tiny floating glyph in the row's top-right: spinner / check / × / nothing.
 * Auto-clears the "saved" state after 1500ms so the row goes back to clean.
 *
 * The caller keys this component by the save event, so each 'saved' state
 * mounts a fresh instance; a mount-time timer then flips it to hidden after
 * 1500ms. (Previously this read Date.now() during render — impure, and it
 * never re-rendered to actually clear.)
 */
function SaveStatusGlyph({ status }: { status: PersistStatus }) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (status.state !== 'saved') return
    const t = setTimeout(() => setHidden(true), 1500)
    return () => clearTimeout(t)
  }, [status])
  if (status.state === 'idle' || hidden) return null
  const { color, glyph, title } = renderStatus(status)
  return (
    <span
      className="mono"
      title={title}
      style={{
        position: 'absolute',
        top: 8,
        right: 0,
        fontSize: 10.5,
        color,
        opacity: 0.8,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
      aria-live="polite"
    >
      {glyph}
    </span>
  )
}

function renderStatus(status: PersistStatus): {
  color: string
  glyph: string
  title: string
} {
  switch (status.state) {
    case 'saving':
      return { color: 'var(--mute2)', glyph: '⋯', title: 'Saving…' }
    case 'saved':
      return { color: 'var(--success)', glyph: '✓', title: 'Saved' }
    case 'error':
      return {
        color: 'var(--danger)',
        glyph: '!',
        title: status.message,
      }
    default:
      return { color: 'transparent', glyph: '', title: '' }
  }
}

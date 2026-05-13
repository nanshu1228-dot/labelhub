'use client'

import { memo, useRef } from 'react'
import type { RubricItem } from '@/lib/templates/rubric'
import { isMarkMissingReason } from '@/lib/templates/rubric'
import type { Mark } from './types'
import { PeerMarks } from './peer-marks'
import { ClaudeHintCard } from './claude-hint'
import type { ClaudeHint, PeerMark } from './types'

/**
 * One rubric question rendered as the appropriate input (likert / bool / enum / text).
 *
 * Hard rules this row enforces:
 *   1. Text inputs are UNCONTROLLED (`defaultValue` + `onBlur`) — never
 *      onChange-per-keystroke. AGENTS.md hard rule.
 *   2. The component is memoized so re-rendering the parent panel doesn't
 *      thrash the whole list of rows.
 *   3. Props are kept primitive (`mark`, `onChange`) so the row works the
 *      same whether state lives in parent useState (Step 2) or Jotai
 *      atomFamily (Step 3).
 *
 * The row owns no state — every change goes straight through `onChange`.
 * That keeps it testable as a pure function: given (item, mark, peerMarks,
 * hint), the rendered output is deterministic.
 */

export interface RubricRowProps {
  item: RubricItem
  mark: Mark | undefined
  onChange: (next: Partial<Mark>) => void
  /** Other raters' marks on THIS rubric (filtered by parent). Optional. */
  peerMarks?: readonly PeerMark[]
  /** Claude's suggestion for THIS rubric (filtered by parent). Optional. */
  claudeHint?: ClaudeHint
  /** Force Deep Dive treatment regardless of `item.requiresReason`. */
  deepDive?: boolean
  /** Show 1·3·5 keyboard hint chips on likert buttons. */
  showKbd?: boolean
  /** Disable input (read-only mode for reviewers viewing a submitted set). */
  disabled?: boolean
}

export const RubricRow = memo(function RubricRow({
  item,
  mark,
  onChange,
  peerMarks,
  claudeHint,
  deepDive,
  showKbd,
  disabled,
}: RubricRowProps) {
  const reasonRequired =
    (item.requiresReason || deepDive) && isMarkMissingReason(item, mark)

  return (
    <div className="rubric-row">
      <div className="rub-head">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rub-name trunc-1">{item.name}</span>
          {item.description && (
            <span
              className="rub-meta trunc-1"
              title={item.description}
              style={{ display: 'inline-block', maxWidth: 260 }}
            >
              {item.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {peerMarks && peerMarks.length > 0 && <PeerMarks marks={peerMarks} />}
          {reasonRequired && (
            <span
              className="req-dot"
              title="Reason required — you rated this but left the rationale blank."
              aria-label="Reason required"
            />
          )}
        </div>
      </div>

      <RubricInput
        item={item}
        mark={mark}
        onChange={onChange}
        showKbd={showKbd}
        disabled={disabled}
      />

      {item.scale !== 'text' && (
        <ReasonField
          mark={mark}
          required={!!reasonRequired}
          onCommit={(reason) => onChange({ reason } as Partial<Mark>)}
          disabled={disabled}
        />
      )}

      {claudeHint && (
        <ClaudeHintCard
          hint={claudeHint}
          onUse={() => {
            onChange({
              scale: item.scale,
              value: claudeHint.value as never,
              reason: claudeHint.reason,
            } as Partial<Mark>)
          }}
          onOverride={() => {
            // We don't delete the hint from data — that's an upstream concern.
            // Override just gives the row a visual "I saw it and chose
            // differently" affordance; the dismissal is local UI state in
            // the parent panel that owns hint visibility.
            onChange({} as Partial<Mark>)
          }}
        />
      )}
    </div>
  )
})

// ─── Scale-specific inputs ─────────────────────────────────────────────────

function RubricInput({
  item,
  mark,
  onChange,
  showKbd,
  disabled,
}: {
  item: RubricItem
  mark: Mark | undefined
  onChange: (next: Partial<Mark>) => void
  showKbd?: boolean
  disabled?: boolean
}) {
  if (item.scale === 'likert') {
    const value = mark?.scale === 'likert' ? mark.value : undefined
    return (
      <LikertInput
        value={value}
        onPick={(v) =>
          onChange({ scale: 'likert', value: v } as Partial<Mark>)
        }
        showKbd={showKbd}
        disabled={disabled}
      />
    )
  }
  if (item.scale === 'bool') {
    const value = mark?.scale === 'bool' ? mark.value : false
    return (
      <BoolInput
        value={value}
        onToggle={(v) =>
          onChange({ scale: 'bool', value: v } as Partial<Mark>)
        }
        disabled={disabled}
      />
    )
  }
  if (item.scale === 'enum') {
    const value = mark?.scale === 'enum' ? mark.value : undefined
    return (
      <EnumInput
        options={item.options ?? []}
        value={value}
        onPick={(v) =>
          onChange({ scale: 'enum', value: v } as Partial<Mark>)
        }
        disabled={disabled}
      />
    )
  }
  // text
  const value = mark?.scale === 'text' ? mark.value : ''
  return (
    <TextInput
      defaultValue={value}
      onCommit={(v) =>
        onChange({ scale: 'text', value: v } as Partial<Mark>)
      }
      disabled={disabled}
      placeholder={item.description ?? 'Notes…'}
    />
  )
}

const LIKERT_BUTTONS = [
  { v: 1, glyph: '✕', cls: 'l1', kbd: '1' },
  { v: 3, glyph: '~', cls: 'l3', kbd: '3' },
  { v: 5, glyph: '✓', cls: 'l5', kbd: '5' },
] as const

function LikertInput({
  value,
  onPick,
  showKbd,
  disabled,
}: {
  value: 1 | 3 | 5 | undefined
  onPick: (v: 1 | 3 | 5) => void
  showKbd?: boolean
  disabled?: boolean
}) {
  return (
    <div className="likert" role="radiogroup">
      {LIKERT_BUTTONS.map((b) => {
        const on = value === b.v
        return (
          <button
            key={b.v}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(b.v)}
            className={`lk ${on ? `on ${b.cls}` : ''}`}
          >
            <span className="glyph">{b.glyph}</span>
            {showKbd && <span className="kbd">{b.kbd}</span>}
          </button>
        )
      })}
    </div>
  )
}

function BoolInput({
  value,
  onToggle,
  disabled,
}: {
  value: boolean
  onToggle: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onToggle(!value)}
      className={`toggle ${value ? 'on' : ''}`}
    >
      <span className="track">
        <span className="knob" />
      </span>
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--mute)' }}
      >
        {value ? 'safe' : 'flag'}
      </span>
    </button>
  )
}

const ENUM_VARIANT: Record<string, string> = {
  optimal: 'good',
  correct: 'good',
  suboptimal: 'warn',
  partial: 'warn',
  incorrect: 'bad',
}

function EnumInput({
  options,
  value,
  onPick,
  disabled,
}: {
  options: readonly string[]
  value: string | undefined
  onPick: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="enum-set" role="radiogroup">
      {options.map((opt) => {
        const on = value === opt
        const variant = ENUM_VARIANT[opt] ?? ''
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(opt)}
            className={`enum-pill ${on ? `on ${variant}` : ''}`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Uncontrolled textarea with blur-based autosave.
 *
 * Why uncontrolled: a controlled textarea fires onChange (and re-renders
 * the parent) on every keystroke. Per AGENTS.md this is forbidden in
 * editable lists past 50 rows — the rubric panel hosts up to 4 text fields
 * per step, times potentially hundreds of selected steps over a session.
 *
 * Why `key={defaultValue}` is intentionally omitted: we WANT React to keep
 * the same DOM node across re-renders so the user's in-progress typing
 * survives. The cost is that swapping which step is selected doesn't
 * reset the textarea — the parent must remount this component (via key
 * on the wrapper) when the step actually changes.
 */
function TextInput({
  defaultValue,
  onCommit,
  disabled,
  placeholder,
}: {
  defaultValue: string
  onCommit: (v: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  return (
    <textarea
      ref={ref}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      className="reason"
      rows={3}
      onBlur={(e) => {
        const next = e.currentTarget.value
        if (next !== defaultValue) onCommit(next)
      }}
    />
  )
}

function ReasonField({
  mark,
  required,
  onCommit,
  disabled,
}: {
  mark: Mark | undefined
  required: boolean
  onCommit: (v: string) => void
  disabled?: boolean
}) {
  const initial =
    mark && mark.scale !== 'text' && 'reason' in mark
      ? (mark.reason ?? '')
      : ''
  return (
    <TextareaUncontrolled
      key={`reason-${mark?.scale}`}
      defaultValue={initial}
      onCommit={onCommit}
      disabled={disabled}
      required={required}
      placeholder="Why? (optional, but recommended for low/high scores)"
    />
  )
}

function TextareaUncontrolled({
  defaultValue,
  onCommit,
  disabled,
  required,
  placeholder,
}: {
  defaultValue: string
  onCommit: (v: string) => void
  disabled?: boolean
  required?: boolean
  placeholder?: string
}) {
  return (
    <textarea
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      className={`reason ${required ? 'required' : ''}`}
      rows={2}
      onBlur={(e) => {
        const next = e.currentTarget.value
        if (next !== defaultValue) onCommit(next)
      }}
    />
  )
}

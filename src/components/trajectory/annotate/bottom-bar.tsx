import type { AnnotateMode } from './types'

/**
 * Keyboard hint strip at the bottom of the page. Different keys are surfaced
 * per mode — Focus shows the "auto-advance" hint, Compare shows the "pick
 * winner" hint. Standard shows the full set.
 *
 * Hints are visual only — the actual key handling lives in
 * `use-annotate-keyboard.ts`. Keeping the visual contract here means a
 * designer can rearrange/relabel without touching event code.
 */
export function BottomBar({ mode }: { mode: AnnotateMode }) {
  return (
    <footer
      className="hairline-t"
      style={{ background: 'var(--panel)', height: 36 }}
    >
      <div className="flex items-center justify-between px-5 h-9 ts-11 mono">
        <div className="flex items-center gap-3" style={{ color: 'var(--mute2)' }}>
          <Hint k="← →  /  j k" label="prev / next step" />
          <Hint k="1 · 3 · 5" label="rate primary likert" />
          <Hint k="b" label="toggle safety" />
          {mode === 'compare' && <Hint k="a · t · b" label="A / tie / B wins" />}
          {mode === 'focus' && (
            <Hint k="↵" label="advance after rating" muted="auto" />
          )}
          <Hint k="⌘D" label="deep dive" />
          <Hint k="?" label="rubric ref" />
        </div>
        <div style={{ color: 'var(--mute2)' }}>{mode} mode</div>
      </div>
    </footer>
  )
}

function Hint({
  k,
  label,
  muted,
}: {
  k: string
  label: string
  muted?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="kbd">{k}</span>
      <span>{label}</span>
      {muted && (
        <span style={{ color: 'var(--mute2)', opacity: 0.7 }}>· {muted}</span>
      )}
    </span>
  )
}

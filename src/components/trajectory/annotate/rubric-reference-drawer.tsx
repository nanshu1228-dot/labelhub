'use client'

import { RubricRow } from './rubric-row'

/**
 * Right-side drawer with one example of each scale type rendered, plus a short
 * note explaining keyboard shortcuts. Triggered by `?` (handled by the
 * keyboard hook).
 *
 * Purpose: first-time annotators need to know what the four scales feel like
 * before they're staring at a 500-step trace. This is the onboarding surface
 * — not a settings page, just a "what are these inputs?" cheat sheet.
 */

export function RubricReferenceDrawer({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div
        className="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="drawer rise"
        role="dialog"
        aria-modal="true"
        aria-label="Rubric reference"
      >
        <div className="flex items-center justify-between px-5 h-12 hairline-b">
          <div>
            <span className="lbl">rubric reference</span>
            <div
              className="ts-14 mt-0.5"
              style={{ color: 'var(--hi)', fontWeight: 500 }}
            >
              How each scale renders
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close rubric reference"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M3 3l7 7M10 3l-7 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="square"
              />
            </svg>
          </button>
        </div>

        <div className="scroll flex-1 px-5 py-5 space-y-6">
          <Section
            label="1·3·5 LIKERT"
            note="Three segmented buttons. Keyboard 1 / 3 / 5. Auto-advances in Focus Mode."
          >
            <RubricRow
              item={{
                id: 'demo_likert',
                name: 'Tool choice',
                scale: 'likert',
                requiresReason: true,
              }}
              mark={{ scale: 'likert', value: 3, reason: 'args missing unit' }}
              onChange={() => {}}
              showKbd
              claudeHint={{
                rubricId: 'demo_likert',
                value: 3,
                reason: 'args missing unit',
              }}
            />
          </Section>

          <Section label="BOOL" note="Single toggle. Keyboard b.">
            <RubricRow
              item={{ id: 'demo_bool', name: 'Safety', scale: 'bool' }}
              mark={{ scale: 'bool', value: true }}
              onChange={() => {}}
            />
          </Section>

          <Section
            label="ENUM"
            note="Pill set, semantically colored (green / amber / red). Single-select."
          >
            <RubricRow
              item={{
                id: 'demo_enum',
                name: 'Path optimality',
                scale: 'enum',
                options: ['optimal', 'suboptimal', 'incorrect'],
              }}
              mark={{ scale: 'enum', value: 'suboptimal' }}
              onChange={() => {}}
            />
          </Section>

          <Section
            label="TEXT"
            note="Autosaving textarea. Blur to commit — never on keystroke."
          >
            <RubricRow
              item={{
                id: 'demo_text',
                name: 'Overall notes',
                scale: 'text',
              }}
              mark={{
                scale: 'text',
                value:
                  "Agent self-flagged a timing conflict in the final response but didn't fix it.",
              }}
              onChange={() => {}}
            />
          </Section>

          <Section
            label="DEEP DIVE"
            note='When a rating is set but the reason is empty, the textarea picks up an amber border to nudge for rationale. Toggle Deep Dive (⌘D) to force this everywhere.'
          >
            <RubricRow
              item={{
                id: 'demo_deep',
                name: 'Reasoning sound',
                scale: 'likert',
                requiresReason: true,
              }}
              mark={{ scale: 'likert', value: 5 }}
              onChange={() => {}}
              deepDive
            />
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({
  label,
  note,
  children,
}: {
  label: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="lbl mb-2">{label}</div>
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: 14,
        }}
      >
        {children}
      </div>
      <p className="ts-12 mt-2" style={{ color: 'var(--mute)' }}>
        {note}
      </p>
    </section>
  )
}

'use client'
import { useState } from 'react'

/**
 * Tabbed code-example viewer for the API endpoints page. Tabs run along the
 * top; the active tab's body renders in a dark code block. Single-tab specs
 * skip the tab strip entirely.
 *
 * Stateless from the parent's point of view — each card owns its own
 * selected-tab index. Lightweight on purpose; tabs are rare-click UI.
 */
export function ExampleTabs({ examples }: { examples: Record<string, string> }) {
  const labels = Object.keys(examples)
  const [active, setActive] = useState(labels[0] ?? '')
  if (labels.length === 0) return null
  const body = examples[active] ?? ''

  return (
    <div>
      {labels.length > 1 && (
        <div
          className="flex items-center gap-1 mb-2 flex-wrap"
          role="tablist"
        >
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={active === label}
              onClick={() => setActive(label)}
              className="ts-12 mono"
              style={{
                padding: '4px 10px',
                border:
                  active === label
                    ? '1px solid var(--accent-line)'
                    : '1px solid var(--line)',
                borderRadius: 6,
                background:
                  active === label ? 'var(--accent-soft)' : 'transparent',
                color: active === label ? 'var(--accent)' : 'var(--mute)',
                cursor: 'pointer',
                fontWeight: active === label ? 600 : 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {labels.length === 1 && (
        <div
          className="ts-12 mono mb-1.5"
          style={{ color: 'var(--mute2)', letterSpacing: '0.04em' }}
        >
          {labels[0].toUpperCase()}
        </div>
      )}
      <pre
        className="ts-12 mono p-3 rounded-md overflow-x-auto"
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          lineHeight: 1.55,
          fontSize: 12,
          margin: 0,
        }}
      >
        {body}
      </pre>
    </div>
  )
}

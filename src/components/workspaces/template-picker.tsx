'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createWorkspace } from '@/lib/actions/workspaces'
import type { TemplateMode } from '@/lib/templates/types'
import { getErrorMessage } from '@/lib/errors/client-utils'

export type PickerTemplate = {
  mode: TemplateMode
  name: string
  description: string
}

/**
 * Which template modes are FULLY-IMPLEMENTED (have working
 * annotator UI / submit flow / read-side queries). Other modes show
 * a "Coming in v2" badge and are not selectable.
 *
 * Update this set when a mode ships end-to-end — the registry stays
 * the source of truth for data shapes, this set is the source of
 * truth for "can the user actually use this mode right now".
 */
const SHIPPED_MODES = new Set<TemplateMode>([
  'agent-trace-eval',
  'pair-rubric',
  'arena-gsb',
  'rubric-judgment',
])

export function TemplatePicker({ templates }: { templates: PickerTemplate[] }) {
  const [selected, setSelected] = useState<TemplateMode | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const canSubmit = !!selected && name.trim().length > 0 && !pending

  function submit() {
    if (!canSubmit || !selected) return
    setError(null)
    startTransition(async () => {
      try {
        const ws = await createWorkspace({ name: name.trim(), templateMode: selected })
        router.push(`/workspaces/${ws.id}`)
      } catch (e: unknown) {
        setError(getErrorMessage(e, 'Unknown error'))
      }
    })
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* minimal header */}
      <header
        style={{
          background: 'var(--panel)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div className="max-w-[1280px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <rect x="0.5" y="0.5" width="17" height="17" rx="4" stroke="oklch(0.6 0.18 280)" />
              <path
                d="M5 4.5V13.5H13"
                stroke="oklch(0.6 0.18 280)"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
            </svg>
            <span
              className="lh-body font-medium"
              style={{ color: 'var(--hi)', letterSpacing: '-0.01em' }}
            >
              LabelHub
            </span>
          </Link>
          <Link href="/" className="nav-link">Cancel</Link>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] mx-auto px-6 pt-16 pb-40 w-full">
        <div
          className="lh-mono lh-caption mb-3"
          style={{ color: 'oklch(0.6 0.18 280)' }}
        >
          §  01    GET STARTED
        </div>
        <h1 className="lh-h1" style={{ color: 'var(--hi)' }}>
          Start a workspace.
        </h1>
        <p
          className="lh-body-lg mt-4 max-w-[560px]"
          style={{ color: 'var(--mute2)' }}
        >
          Pick the shape of the teaching. One engine, many modes — you can spin up more workspaces with different templates anytime.
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((tpl, i) => {
            const active = selected === tpl.mode
            const shipped = SHIPPED_MODES.has(tpl.mode)
            return (
              <button
                key={tpl.mode}
                type="button"
                disabled={!shipped}
                onClick={() => shipped && setSelected(tpl.mode)}
                className="text-left p-6 transition-colors relative"
                style={{
                  borderRadius: 12,
                  border: active
                    ? '1px solid oklch(0.6 0.18 280)'
                    : '1px solid var(--line)',
                  background: active
                    ? 'oklch(0.6 0.18 280 / 0.06)'
                    : 'var(--panel)',
                  cursor: shipped ? 'pointer' : 'not-allowed',
                  opacity: shipped ? 1 : 0.45,
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="mode-tag">
                    {String(i + 1).padStart(2, '0')} · {tpl.mode.replace(/-/g, ' ')}
                  </span>
                  {shipped ? (
                    <span
                      aria-hidden
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: active
                          ? '4px solid oklch(0.6 0.18 280)'
                          : '1px solid var(--line2)',
                        background: active ? 'var(--panel)' : 'transparent',
                        transition: 'all 150ms',
                      }}
                    />
                  ) : (
                    <span
                      className="lh-mono lh-caption"
                      style={{
                        color: 'var(--mute2)',
                        background: 'var(--line)',
                        border: '1px solid var(--line2)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        letterSpacing: '0.04em',
                      }}
                      title="Data shape ready; annotator UI ships in v2."
                    >
                      v2
                    </span>
                  )}
                </div>
                <h3 className="lh-h4 mb-2" style={{ color: 'var(--hi)' }}>
                  {tpl.name}
                </h3>
                <p className="lh-body-sm" style={{ color: 'var(--mute2)' }}>
                  {tpl.description}
                </p>
              </button>
            )
          })}
        </div>
      </main>

      {/* sticky form bar */}
      <div
        className="sticky bottom-0"
        style={{
          background: 'var(--panel)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--line)',
        }}
      >
        <div className="max-w-[1280px] mx-auto px-6 py-4">
          {error && (
            <div
              className="lh-body-sm mb-3 px-3 py-2 rounded"
              style={{
                color: 'var(--hi)',
                background: 'oklch(0.6 0.2 25 / 0.12)',
                border: '1px solid oklch(0.6 0.2 25 / 0.4)',
              }}
            >
              {error}
            </div>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            <label
              htmlFor="workspace-name"
              className="lh-mono lh-caption"
              style={{ color: 'var(--mute2)', letterSpacing: '0.06em' }}
            >
              WORKSPACE NAME
            </label>
            <input
              id="workspace-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-workspace"
              maxLength={100}
              className="flex-1 min-w-[200px] px-3 py-2 outline-none"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                color: 'var(--hi)',
                fontSize: 14,
              }}
            />
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="lh-btn lh-btn-solid"
              style={{
                opacity: canSubmit ? 1 : 0.4,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              <span>{pending ? 'Creating…' : 'Create'}</span>
              {!pending && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3 6h6m0 0L6 3m3 3L6 9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="square"
                  />
                </svg>
              )}
            </button>
          </div>
          <div className="mt-2 lh-caption" style={{ color: 'var(--mute2)' }}>
            {selected ? (
              <>
                Mode: <span className="lh-mono" style={{ color: 'var(--text)' }}>{selected}</span> · You can switch modes per task later.
              </>
            ) : (
              'Pick a template above to continue.'
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

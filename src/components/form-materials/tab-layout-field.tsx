'use client'

import type { Material } from './types'

/**
 * Tab layout container — Finals P1 D5. Spec 4.2 calls out "Tab 布局".
 *
 * Stores its tabs as a nested children[] where each child is a `group`
 * (one tab = one group). The Designer renders the active tab's group
 * inline on the canvas (D5 nested SortableContext) and the Renderer
 * (D6) maps each tab to its own page of the form.
 *
 * Property editor lets the owner add / rename / remove tabs. The
 * underlying `children` array is patched so add-tab spawns a fresh
 * group with no children.
 */
type TabLayoutConfig = {
  /** ID of the currently-focused tab (Designer-only). */
  activeTabId?: string
}

export const tabLayoutFieldMaterial: Material = {
  kind: 'tab-layout',
  name: 'Tab layout',
  icon: '◧',
  defaultConfig: {
    activeTabId: '',
  } satisfies TabLayoutConfig,
  designerPreview: ({ field }) => {
    const tabs = field.children ?? []
    return (
      <div className="ts-12 mono" style={{ color: 'var(--mute)', cursor: 'grab' }}>
        § TABS · {tabs.length} tab{tabs.length === 1 ? '' : 's'}
        {tabs.length > 0 ? (
          <span className="ml-2" style={{ color: 'var(--mute2)' }}>
            ({tabs.map((t) => t.label || t.id).join(' / ')})
          </span>
        ) : null}
      </div>
    )
  },
  propertyPanel: ({ field, onChange }) => {
    const tabs = field.children ?? []
    function setTabs(next: typeof tabs) {
      onChange({ ...field, children: next })
    }
    function addTab() {
      const idx = tabs.length + 1
      const id = `tab_${idx}_${Date.now().toString(36).slice(-4)}`
      setTabs([
        ...tabs,
        {
          id,
          kind: 'group',
          label: `Tab ${idx}`,
          config: { showTitle: false, columns: 1 },
          validation: [],
          children: [],
        },
      ])
    }
    function renameTab(idx: number, label: string) {
      setTabs(tabs.map((t, i) => (i === idx ? { ...t, label } : t)))
    }
    function removeTab(idx: number) {
      setTabs(tabs.filter((_, i) => i !== idx))
    }
    return (
      <>
        <div
          className="lh-mono lh-caption"
          style={{ color: 'var(--mute)' }}
        >
          TABS
        </div>
        <ul className="flex flex-col gap-1.5">
          {tabs.length === 0 ? (
            <li className="ts-12" style={{ color: 'var(--mute2)' }}>
              No tabs yet — add one below.
            </li>
          ) : (
            tabs.map((t, idx) => (
              <li
                key={t.id}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  defaultValue={t.label}
                  onBlur={(e) => renameTab(idx, e.target.value)}
                  className="ts-12 flex-1"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'var(--text)',
                  }}
                />
                <code
                  className="ts-11 mono"
                  style={{ color: 'var(--mute2)' }}
                >
                  {t.children?.length ?? 0}
                </code>
                <button
                  type="button"
                  onClick={() => removeTab(idx)}
                  className="ts-11 mono px-2 py-1 rounded"
                  style={{
                    background: 'transparent',
                    color: 'var(--danger)',
                    border: '1px solid oklch(0.55 0.2 25 / 0.4)',
                    cursor: 'pointer',
                  }}
                  aria-label={`Remove tab ${t.label}`}
                >
                  ✕
                </button>
              </li>
            ))
          )}
        </ul>
        <button
          type="button"
          onClick={addTab}
          className="ts-12 mono px-2 py-1 rounded self-start"
          style={{
            background: 'var(--panel2)',
            color: 'var(--text)',
            border: '1px solid var(--line)',
            cursor: 'pointer',
          }}
        >
          + Add tab
        </button>
      </>
    )
  },
}

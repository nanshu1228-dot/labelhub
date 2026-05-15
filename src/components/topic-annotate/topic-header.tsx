/**
 * Topic header — shared between pair-rubric and arena-gsb.
 *
 * Renders: workspace · task breadcrumb, the prompt, and the two model
 * responses side-by-side. No interactivity — annotation controls live
 * in the mode-specific form below.
 *
 * Why this is its own component: keeping it separate means the two forms
 * stay focused on their unique scoring widgets, and future modes that
 * also use the "prompt + A + B" envelope (e.g. pair-rubric-with-rationale)
 * can reuse it.
 */

export interface TopicHeaderItem {
  prompt?: unknown
  responseA?: { modelName?: unknown; content?: unknown }
  responseB?: { modelName?: unknown; content?: unknown }
  context?: unknown
}

function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function TopicHeader({
  workspaceId,
  workspaceName,
  taskName,
  itemData,
  badge,
}: {
  workspaceId: string
  workspaceName: string
  taskName: string
  itemData: Record<string, unknown>
  /** Mode badge, e.g. "PAIR RUBRIC" / "ARENA GSB". Rendered with accent. */
  badge: string
}) {
  const item = itemData as TopicHeaderItem
  const prompt = safeString(item.prompt, '(no prompt)')
  const aName = safeString(item.responseA?.modelName, 'Model A')
  const aBody = safeString(item.responseA?.content, '(no response)')
  const bName = safeString(item.responseB?.modelName, 'Model B')
  const bBody = safeString(item.responseB?.content, '(no response)')
  const ctx = safeString(item.context, '')

  return (
    <header className="border-b border-[var(--line)] pb-6 mb-6">
      <div className="flex items-center gap-3 ts-12 mono mb-3">
        <a
          href={`/workspaces/${workspaceId}`}
          className="hover:underline"
          style={{ color: 'var(--mute)' }}
        >
          {workspaceName}
        </a>
        <span style={{ color: 'var(--mute2)' }}>·</span>
        <span style={{ color: 'var(--text)' }}>{taskName}</span>
        <span
          className="ts-11 mono ml-auto px-2 py-0.5 rounded"
          style={{
            color: 'var(--accent)',
            background: 'oklch(0.6 0.18 280 / 0.1)',
            border: '1px solid oklch(0.6 0.18 280 / 0.25)',
            letterSpacing: '0.06em',
          }}
        >
          {badge}
        </span>
      </div>

      <div className="mb-4">
        <div className="lbl mb-1.5">§ PROMPT</div>
        <p
          className="ts-14"
          style={{
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
          }}
        >
          {prompt}
        </p>
        {ctx && (
          <details className="mt-2">
            <summary
              className="ts-12 mono cursor-pointer"
              style={{ color: 'var(--mute2)' }}
            >
              show context
            </summary>
            <pre
              className="ts-12 mt-2 p-3 rounded"
              style={{
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
                color: 'var(--mute)',
                whiteSpace: 'pre-wrap',
                overflowX: 'auto',
              }}
            >
              {ctx}
            </pre>
          </details>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ResponseBlock side="A" modelName={aName} content={aBody} />
        <ResponseBlock side="B" modelName={bName} content={bBody} />
      </div>
    </header>
  )
}

function ResponseBlock({
  side,
  modelName,
  content,
}: {
  side: 'A' | 'B'
  modelName: string
  content: string
}) {
  // Distinct color per side so the table below can echo the cue.
  const accent = side === 'A' ? 'oklch(0.65 0.18 200)' : 'oklch(0.7 0.18 30)'
  return (
    <div
      className="rounded-md"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        overflow: 'hidden',
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel2)',
        }}
      >
        <span
          className="mono ts-11"
          style={{
            color: accent,
            border: `1px solid ${accent}66`,
            background: `${accent}1a`,
            borderRadius: 3,
            padding: '1px 6px',
            fontWeight: 600,
          }}
        >
          {side}
        </span>
        <span className="ts-12 mono" style={{ color: 'var(--mute)' }}>
          {modelName}
        </span>
      </div>
      <div
        className="px-3 py-3 ts-13"
        style={{
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.55,
          maxHeight: 480,
          overflowY: 'auto',
        }}
      >
        {content}
      </div>
    </div>
  )
}

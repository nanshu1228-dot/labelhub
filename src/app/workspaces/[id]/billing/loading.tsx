/**
 * Route-level loading UI for /workspaces/[id]/billing.
 *
 * Server component (no hooks, no "use client"). Suspense fallback shown
 * while the billing page streams. Mirrors that page's shell: .app-light
 * wrapper, sticky header strip, and a max-w-[1200px] content column with
 * shimmer placeholder cards.
 *
 * Pure static markup — imports nothing from the page.
 */
export default function Loading() {
  return (
    <div className="app-light min-h-screen" style={{ background: 'var(--bg)' }}>
      <SkeletonStyles />
      <header
        className="hairline-b sticky top-0 z-10"
        style={{ background: 'var(--panel)' }}
      >
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
          <Bar w={180} h={12} />
          <Bar w={90} h={12} />
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-8 flex flex-col gap-6">
        <Card lines={2} />
        <Card lines={1} />
        <Card lines={3} />
        <Card lines={3} />
      </main>
    </div>
  )
}

function Card({ lines }: { lines: number }) {
  return (
    <div
      className="lh-shimmer rounded-xl p-5"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <Bar w={200} h={14} />
        <Bar w={80} h={12} />
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Bar key={i} w={i % 2 === 0 ? '90%' : '70%'} h={12} />
        ))}
      </div>
    </div>
  )
}

function Bar({ w, h }: { w: number | string; h: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'block',
        width: typeof w === 'number' ? `${w}px` : w,
        height: h,
        borderRadius: 4,
        background: 'var(--line2)',
      }}
    />
  )
}

function SkeletonStyles() {
  return (
    <style>{`
      .lh-shimmer { animation: lh-pulse 1.4s ease-in-out infinite; }
      @keyframes lh-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
    `}</style>
  )
}

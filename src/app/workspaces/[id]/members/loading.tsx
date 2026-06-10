/**
 * Route-level loading UI for /workspaces/[id]/members.
 *
 * Server component (no hooks, no "use client"). Next.js renders this as the
 * Suspense fallback while the members roster streams. It mirrors that page's
 * shell: an .app-light wrapper, a sticky header strip, and a max-w-[1000px]
 * content column with shimmer placeholder cards.
 *
 * Pure static markup — imports nothing from the page. The shimmer is a CSS
 * keyframe injected inline so no client JavaScript is required.
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

      <main className="mx-auto max-w-[1000px] px-6 py-8">
        <div className="mb-8 flex flex-col gap-3">
          <Bar w={110} h={10} />
          <Bar w={220} h={26} />
          <Bar w={480} h={12} />
        </div>

        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} />
          ))}
        </div>
      </main>
    </div>
  )
}

function Card() {
  return (
    <div
      className="lh-shimmer rounded-xl p-4"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <Bar w={200} h={12} />
        <Bar w={90} h={12} />
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

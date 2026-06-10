/**
 * Route-level loading UI for /workspaces/[id]/tasks.
 *
 * Server component (no hooks, no "use client"). Next.js renders this as the
 * Suspense fallback while the tasks console streams. It mirrors that page's
 * shell: an .app-light wrapper and a max-w-[1280px] content column with a
 * header strip + shimmer placeholder cards.
 *
 * Pure static markup — imports nothing from the page. The shimmer is a CSS
 * keyframe injected inline so no client JavaScript is required.
 */
export default function Loading() {
  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <SkeletonStyles />
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-6 flex flex-col gap-3">
          <Bar w={120} h={10} />
          <Bar w={260} h={26} />
          <Bar w={460} h={12} />
        </div>

        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} />
          ))}
        </div>
      </div>
    </main>
  )
}

function Card() {
  return (
    <div
      className="lh-shimmer rounded-xl p-4"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <Bar w={220} h={12} />
        <Bar w={72} h={12} />
      </div>
      <Bar w="80%" h={12} />
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

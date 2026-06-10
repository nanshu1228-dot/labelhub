/**
 * Route-level loading UI for /my/submissions.
 *
 * Server component (no hooks, no "use client"). Suspense fallback shown while
 * the submission-history page streams. The page renders its own .app-light
 * shell (the /my layout does not add it), so this matches that: an .app-light
 * min-h-screen main with a max-w-[1000px] column, a header strip, and shimmer
 * placeholder cards.
 *
 * Pure static markup — imports nothing from the page.
 */
export default function Loading() {
  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <SkeletonStyles />
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-6 flex flex-col gap-3">
          <Bar w={90} h={10} />
          <Bar w={280} h={24} />
          <Bar w={520} h={12} />
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
      className="lh-shimmer rounded-xl p-3"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <Bar w={220} h={12} />
        <Bar w={120} h={12} />
      </div>
      <Bar w="70%" h={11} />
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

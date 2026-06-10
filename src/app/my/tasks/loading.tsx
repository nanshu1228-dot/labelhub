/**
 * Route-level loading UI for /my/tasks.
 *
 * Server component (no hooks, no "use client"). Suspense fallback shown while
 * the labeler workbench streams. The page renders its own .app-light shell
 * (the /my layout does not add it), so this matches that: an .app-light
 * min-h-screen main with a max-w-[1280px] column, a header strip, and shimmer
 * placeholder cards.
 *
 * Pure static markup — imports nothing from the page.
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
          <Bar w={150} h={10} />
          <Bar w={300} h={28} />
          <Bar w={560} h={12} />
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
        <Bar w={220} h={13} />
        <Bar w={64} h={13} />
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

/**
 * Route-level loading UI for /workspaces/[id] (the workspace cockpit).
 *
 * Server component (no hooks, no "use client"). Next.js renders this as the
 * Suspense fallback while the cockpit's DB fan-out resolves. It mirrors that
 * page's shell: an .app-light wrapper and a max-w-[1280px] content column with
 * the §/title/meta header strip, then a responsive tile grid of shimmer
 * StatTile placeholders matching `grid-cols-2 md:grid-cols-3 lg:grid-cols-7`.
 *
 * Pure static markup — imports nothing from the page. The shimmer is a CSS
 * keyframe injected inline so no client JavaScript is required.
 */
export default function Loading() {
  return (
    <main
      className="app-light min-h-screen"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <SkeletonStyles />
      <div className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="mb-6 flex flex-col gap-3">
          <Bar w={120} h={10} />
          <Bar w={280} h={30} />
          <Bar w={320} h={12} />
        </div>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Tile key={i} />
          ))}
        </div>
      </div>
    </main>
  )
}

function Tile() {
  return (
    <div
      className="lh-shimmer p-6"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--panel)',
      }}
    >
      <Bar w={70} h={9} />
      <div className="mt-3">
        <Bar w={40} h={22} />
      </div>
      <div className="mt-3">
        <Bar w="80%" h={10} />
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

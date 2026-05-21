'use client'

/**
 * Loading skeleton for the FormRenderer — Finals P5 D16.
 *
 * The Labeler page loads a custom-designer schema asynchronously
 * via loadCustomFormSchema. Until the response lands, we render
 * three skeleton rows instead of a blank panel so the Labeler sees
 * the page is alive and roughly where the fields will be.
 *
 * Server-component friendly (no hooks). The component is pure JSX
 * + a CSS shimmer animation defined inline.
 */

import type { CSSProperties } from 'react'

export interface FormRendererSkeletonProps {
  /** Number of placeholder field rows to render (default 3). */
  rows?: number
}

export function FormRendererSkeleton({
  rows = 3,
}: FormRendererSkeletonProps) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading form">
      {Array.from({ length: rows }, (_, i) => (
        <FieldRowSkeleton key={i} index={i} />
      ))}
    </div>
  )
}

function FieldRowSkeleton({ index }: { index: number }) {
  // Mix textarea vs single-line shapes so the skeleton isn't a
  // monotonous bar stack. Even-indexed rows get a single-line input;
  // odd rows get a taller textarea-style block.
  const isTall = index % 2 === 1
  return (
    <div className="flex flex-col gap-1.5">
      <Bar width="35%" height={12} />
      <Bar width="100%" height={isTall ? 80 : 32} />
    </div>
  )
}

function Bar({
  width,
  height,
}: {
  width: string
  height: number
}) {
  const style: CSSProperties = {
    width,
    height,
    background:
      'linear-gradient(90deg, var(--panel2) 0%, var(--panel) 50%, var(--panel2) 100%)',
    backgroundSize: '200% 100%',
    borderRadius: 4,
    border: '1px solid var(--line)',
    animation: 'lh-skeleton-shimmer 1.2s ease-in-out infinite',
  }
  return <div style={style} />
}

/**
 * Inject the shimmer keyframes once per page. Mount this anywhere
 * on the Labeler route (typically inside the layout); subsequent
 * <FormRendererSkeleton /> mounts pick it up by class name.
 *
 * Splitting the keyframes out keeps the per-row component
 * SSR-clean (no styled-jsx dependency).
 */
export function FormRendererSkeletonStyles() {
  return (
    <style>{`
      @keyframes lh-skeleton-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
      }
    `}</style>
  )
}

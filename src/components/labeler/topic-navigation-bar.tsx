'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import { usePrevNextNav } from './use-prev-next-nav'

export interface TopicNavigatorModel {
  position: number
  total: number
  previousHref: string | null
  nextHref: string | null
  skipHref: string
}

export function TopicNavigationBar({
  navigator,
}: {
  navigator: TopicNavigatorModel
}) {
  const router = useRouter()
  usePrevNextNav({
    onPrev: navigator.previousHref
      ? () => router.push(navigator.previousHref as string)
      : undefined,
    onNext: navigator.nextHref
      ? () => router.push(navigator.nextHref as string)
      : undefined,
    onSkip: () => router.push(navigator.skipHref),
  })

  const progress =
    navigator.total > 0
      ? (navigator.position / navigator.total) * 100
      : 0

  return (
    <div
      className="mt-5 grid gap-3 rounded-md p-3 md:grid-cols-[1fr_auto]"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <span className="lbl" style={{ color: 'var(--mute)' }}>
            ITEM NAVIGATION
          </span>
          <span className="ts-11 mono" style={{ color: 'var(--mute2)' }}>
            {navigator.position} / {navigator.total}
          </span>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded"
          style={{ background: 'var(--panel2)' }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progress))}%`,
              height: '100%',
              background: 'var(--accent)',
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <NavButton
          href={navigator.previousHref}
          icon={<ChevronLeft size={14} />}
        >
          Previous
        </NavButton>
        <NavButton href={navigator.skipHref} icon={<ListChecks size={14} />}>
          Skip
        </NavButton>
        <NavButton
          primary
          href={navigator.nextHref}
          icon={<ChevronRight size={14} />}
        >
          Next
        </NavButton>
      </div>
    </div>
  )
}

function NavButton({
  href,
  icon,
  primary,
  children,
}: {
  href: string | null
  icon: ReactNode
  primary?: boolean
  children: ReactNode
}) {
  const disabled = !href
  const styles = {
    minHeight: 34,
    color: disabled ? 'var(--mute2)' : primary ? 'white' : 'var(--text)',
    background: disabled
      ? 'var(--panel2)'
      : primary
        ? 'var(--accent)'
        : 'var(--bg)',
    border: `1px solid ${primary && !disabled ? 'var(--accent-line)' : 'var(--line)'}`,
    textDecoration: 'none',
    pointerEvents: disabled ? 'none' : 'auto',
    opacity: disabled ? 0.55 : 1,
  } as const
  if (disabled) {
    return (
      <span
        className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded-md px-3"
        style={styles}
        aria-disabled="true"
      >
        {icon}
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded-md px-3"
      style={styles}
    >
      {icon}
      {children}
    </Link>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/actions/notifications'
import type { NotificationListItem } from '@/lib/queries/notifications'

/**
 * Client wrapper for the inbox list.
 *
 * Renders each notification as a row that:
 *   1. shows read/unread state via the left rail color
 *   2. links to the notification's linkUrl on click
 *   3. fires markNotificationRead optimistically as the user clicks
 *      so unread badges drop immediately
 *
 * "mark all read" sits at the top — common UX pattern for inbox
 * surfaces; lets a user bulk-clear after a busy review session.
 *
 * No virtualization (we cap at 100 server-side) — TanStack Virtual
 * is overkill for 30-40 expected rows.
 */
export function InboxClient({
  initialItems,
}: {
  initialItems: NotificationListItem[]
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [isBusy, startTransition] = useTransition()

  const unreadCount = items.filter((i) => i.readAt === null).length

  function markOne(id: string) {
    // Optimistic — flip locally, fire-and-forget server.
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, readAt: new Date() } : i)),
    )
    startTransition(async () => {
      try {
        await markNotificationRead({ id })
      } catch {
        // Silent — the next router.refresh() will reconcile.
      }
    })
  }

  function markAll() {
    if (unreadCount === 0) return
    setItems((prev) =>
      prev.map((i) => (i.readAt === null ? { ...i, readAt: new Date() } : i)),
    )
    startTransition(async () => {
      try {
        await markAllNotificationsRead()
        router.refresh()
      } catch {
        // Silent — refresh will reconcile.
      }
    })
  }

  if (items.length === 0) {
    return <EmptyState />
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {unreadCount > 0
            ? `${unreadCount} unread · ${items.length} total`
            : `${items.length} total · all read`}
        </div>
        <button
          type="button"
          onClick={markAll}
          disabled={unreadCount === 0 || isBusy}
          className="ts-12 mono"
          style={{
            background: 'transparent',
            color: unreadCount > 0 ? 'var(--accent)' : 'var(--mute2)',
            border: 'none',
            cursor: unreadCount > 0 && !isBusy ? 'pointer' : 'not-allowed',
            padding: '4px 8px',
          }}
        >
          mark all read
        </button>
      </div>

      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <NotificationRow key={it.id} item={it} onClick={() => markOne(it.id)} />
        ))}
      </ul>
    </div>
  )
}

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationListItem
  onClick: () => void
}) {
  const unread = item.readAt === null
  const { icon, accentColor } = typeIcon(item.type)
  const actorName =
    item.actorDisplayName ?? item.actorEmail?.split('@')[0] ?? 'system'
  return (
    <Link
      href={item.linkUrl}
      onClick={onClick}
      className="block rounded-md px-4 py-3"
      style={{
        background: unread ? 'var(--panel)' : 'transparent',
        border: `1px solid ${unread ? 'var(--accent-line)' : 'var(--line)'}`,
        borderLeftWidth: 3,
        borderLeftColor: unread ? accentColor : 'var(--line)',
        textDecoration: 'none',
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mono ts-11 shrink-0"
          style={{
            width: 22,
            height: 22,
            background: `${accentColor}1f`,
            color: accentColor,
            borderRadius: 5,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            marginTop: 1,
          }}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="ts-13"
              style={{
                color: 'var(--hi)',
                fontWeight: unread ? 500 : 400,
              }}
            >
              {item.title}
            </span>
            <span
              className="mono ts-11 shrink-0"
              style={{ color: 'var(--mute2)' }}
              title={item.createdAt.toISOString()}
            >
              {formatRelative(item.createdAt)}
            </span>
          </div>
          {item.body && (
            <div
              className="ts-12 mt-0.5"
              style={{
                color: 'var(--mute)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.body}
            </div>
          )}
          <div
            className="mono ts-11 mt-1"
            style={{ color: 'var(--mute2)' }}
          >
            <span style={{ color: accentColor }}>{item.type}</span>
            <span className="mx-1.5" style={{ color: 'var(--line2)' }}>
              ·
            </span>
            <span>{item.workspaceName}</span>
            <span className="mx-1.5" style={{ color: 'var(--line2)' }}>
              ·
            </span>
            <span>from {actorName}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-md px-6 py-12 text-center"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line2)',
      }}
    >
      <div
        className="ts-32 mb-2"
        style={{ color: 'var(--mute2)', fontWeight: 300 }}
        aria-hidden
      >
        ✶
      </div>
      <div className="ts-14" style={{ color: 'var(--text)', fontWeight: 500 }}>
        No notifications yet
      </div>
      <p
        className="ts-12 mt-1 mx-auto"
        style={{ color: 'var(--mute)', maxWidth: 360 }}
      >
        When a reviewer approves, rejects, or replies to your work, it
        lands here. Drafts and submissions stay in{' '}
        <Link
          href="/my/submissions"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          /my/submissions
        </Link>
        .
      </p>
    </div>
  )
}

/**
 * Map notification type → glyph + accent color. Centralized so the
 * inbox row and any future preview surface render the same.
 */
function typeIcon(type: string): { icon: string; accentColor: string } {
  if (type === 'annotation.approved') {
    return { icon: '✓', accentColor: 'oklch(0.5 0.13 150)' }
  }
  if (type === 'annotation.rejected') {
    return { icon: '×', accentColor: 'oklch(0.55 0.2 25)' }
  }
  if (type === 'annotation.revising') {
    return { icon: '↻', accentColor: 'oklch(0.6 0.14 75)' }
  }
  if (type === 'annotation.awaiting_acceptance') {
    return { icon: '◔', accentColor: 'oklch(0.65 0.13 200)' }
  }
  if (type === 'review.reply') {
    return { icon: '↩', accentColor: 'oklch(0.6 0.18 280)' }
  }
  return { icon: '·', accentColor: 'oklch(0.55 0 0)' }
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return d.toISOString().slice(5, 10).replace('-', '/')
}

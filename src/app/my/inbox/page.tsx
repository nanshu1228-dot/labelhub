import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { optionalUser } from '@/lib/auth/guards'
import {
  listMyNotifications,
  type NotificationListItem,
} from '@/lib/queries/notifications'
import { InboxClient } from '@/components/inbox/inbox-client'

export const metadata: Metadata = {
  title: 'Inbox — LabelHub',
}

export const dynamic = 'force-dynamic'

/**
 * /my/inbox — annotator-facing notification feed.
 *
 * Lists every notification (read + unread) for the signed-in user.
 * Each row shows: type icon · workspace · actor · title · body · time.
 * Clicking the row marks it read and navigates to the linkUrl.
 *
 * SSR fetches the full list (cap 100). Mark-read is a client mutation
 * via Server Action; we keep the page server-rendered so the SEO + Next
 * cache invalidation work the same way as /my/submissions.
 */
export default async function MyInboxPage(props: {
  searchParams?: Promise<{ filter?: string }>
}) {
  const search = (await props.searchParams) ?? {}
  const filter = search.filter === 'unread' ? 'unread' : 'all'

  const me = await optionalUser()
  if (!me) redirect('/signin?next=/my/inbox')

  const items = await listMyNotifications({
    userId: me.id,
    unreadOnly: filter === 'unread',
    limit: 100,
  })

  const unreadCount = items.filter((i) => i.readAt === null).length

  return (
    <main
      className="app-light min-h-screen px-6 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-[820px]">
        <div className="mb-6">
          <div className="lbl mb-2">INBOX</div>
          <h1 className="ts-28" style={{ color: 'var(--hi)' }}>
            Your notifications
          </h1>
          <p
            className="ts-13 mt-1"
            style={{ color: 'var(--mute)', maxWidth: 540 }}
          >
            Review verdicts, replies, and approvals on work you&apos;ve
            submitted. Click a row to jump straight to the annotation.
          </p>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <FilterChip
            href="/my/inbox"
            label="all"
            count={items.length}
            active={filter === 'all'}
          />
          <FilterChip
            href="/my/inbox?filter=unread"
            label="unread"
            count={unreadCount}
            active={filter === 'unread'}
          />
        </div>

        <InboxClient initialItems={items} />
      </div>
    </main>
  )
}

function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string
  label: string
  count: number
  active: boolean
}) {
  return (
    <Link
      href={href}
      className="ts-12 mono px-3 py-1.5 rounded-full"
      style={{
        background: active ? 'var(--accent-soft)' : 'var(--panel)',
        color: active ? 'var(--accent)' : 'var(--mute)',
        border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
        textDecoration: 'none',
      }}
    >
      {label} · {count}
    </Link>
  )
}

// Re-export the type so the client can reference it without circular import.
export type { NotificationListItem }

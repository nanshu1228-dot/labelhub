'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { respondToReview } from '@/lib/actions/annotations'
import type { ReviewThreadMessage } from '@/lib/queries/review-thread'

/**
 * Bidirectional review thread — reviewer's verdict + free-form notes
 * interleaved with submitter replies. Modeled after Xpert's
 * 质检专家备注 ↔ 出题专家返修备注 loop but rendered as a chat-style
 * timeline so the conversation context is preserved.
 *
 * Reply input is shown when:
 *   - viewer is the submitter (canReply=true), AND
 *   - the last message in the thread is from a reviewer
 *     (no point posting twice in a row).
 *
 * The component is read-only when canReply=false. Admins viewing another
 * person's thread see the full history with no input.
 */
export function ReviewThread({
  annotationId,
  messages,
  canReply,
}: {
  annotationId: string
  messages: ReviewThreadMessage[]
  /**
   * True when the current viewer is the original submitter — they get
   * a reply input. Admins viewing the thread get read-only.
   */
  canReply: boolean
}) {
  if (messages.length === 0) return null

  const lastFromReviewer =
    messages.length > 0 && messages[messages.length - 1].authorRole === 'reviewer'

  return (
    <section>
      <div className="lbl mb-3">§ REVIEW THREAD</div>
      <div
        className="rounded-xl"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <ul className="flex flex-col">
          {messages.map((m, idx) => (
            <li
              key={m.eventId}
              className="px-4 py-3"
              style={{
                borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
              }}
            >
              <MessageBlock message={m} />
            </li>
          ))}
        </ul>
        {canReply && lastFromReviewer && (
          <div
            className="px-4 py-3"
            style={{
              borderTop: '1px solid var(--line)',
              background: 'var(--bg)',
            }}
          >
            <ReplyForm annotationId={annotationId} />
          </div>
        )}
      </div>
    </section>
  )
}

function MessageBlock({ message }: { message: ReviewThreadMessage }) {
  const kindStyle: Record<
    ReviewThreadMessage['kind'],
    { label: string; bg: string; fg: string }
  > = {
    approved: {
      label: '✓ approved',
      bg: 'var(--success-soft)',
      fg: 'var(--success)',
    },
    rejected: {
      label: '✗ rejected',
      bg: 'var(--danger-soft)',
      fg: 'var(--danger)',
    },
    revised: {
      label: '↻ revision requested',
      bg: 'oklch(0.7 0.14 75 / 0.08)',
      fg: 'var(--warn)',
    },
    reply: {
      label: '↳ reply',
      bg: 'var(--panel2)',
      fg: 'var(--mute)',
    },
  }
  const s = kindStyle[message.kind]
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span
          className="mono ts-11 shrink-0"
          style={{
            background: s.bg,
            color: s.fg,
            border: `1px solid ${s.fg}33`,
            borderRadius: 4,
            padding: '1px 8px',
            fontWeight: 600,
          }}
        >
          {s.label}
        </span>
        <span
          className="ts-12"
          style={{ color: 'var(--hi)', fontWeight: 500 }}
        >
          {message.authorDisplayName ??
            message.authorEmail?.split('@')[0] ??
            (message.authorRole === 'reviewer' ? 'reviewer' : 'submitter')}
        </span>
        <span className="mono ts-11" style={{ color: 'var(--mute2)' }}>
          · {message.authorRole}
        </span>
        <span
          className="mono ts-11 ml-auto"
          style={{ color: 'var(--mute2)' }}
          title={message.ts.toISOString()}
        >
          {message.ts.toISOString().slice(0, 16).replace('T', ' ')}
        </span>
      </div>
      {message.message ? (
        <p
          className="ts-13"
          style={{
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {message.message}
        </p>
      ) : (
        <p
          className="ts-12 italic"
          style={{ color: 'var(--mute2)' }}
        >
          (no message)
        </p>
      )}
    </div>
  )
}

function ReplyForm({ annotationId }: { annotationId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const message = text.trim()
    if (!message) {
      setError('Reply cannot be blank.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await respondToReview({ annotationId, message })
        setText('')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Reply failed.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <label>
        <span className="lbl mb-1.5 block">your reply</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Address the reviewer's note. The thread is part of the workspace audit log."
          className="w-full px-3 py-2 ts-13 rounded-md"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'var(--font-geist-sans), system-ui',
          }}
        />
      </label>
      {error && (
        <div
          className="ts-11 mono rounded-md p-2"
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid oklch(0.55 0.2 25 / 0.35)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}
      <div className="flex items-center justify-end">
        <button
          onClick={submit}
          disabled={isPending || text.trim().length === 0}
          className="ts-12 mono"
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '6px 14px',
            fontWeight: 500,
            cursor:
              isPending || text.trim().length === 0
                ? 'not-allowed'
                : 'pointer',
            opacity: isPending || text.trim().length === 0 ? 0.5 : 1,
          }}
        >
          {isPending ? 'sending…' : 'post reply'}
        </button>
      </div>
    </div>
  )
}

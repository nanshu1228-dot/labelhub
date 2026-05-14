'use client'

import { useState } from 'react'
import type { AttachmentRef } from './types'

/**
 * Trajectory-level attachments strip.
 *
 * Renders the array of attachments captured alongside the trajectory's
 * user messages — images, PDFs, audio. Currently we show:
 *
 *   - image  → inline 80x80 thumb, click-to-zoom modal
 *   - document → labeled link (most often PDF; we don't preview-render
 *                because PDF.js / iframe-embed feels heavy for an
 *                attachment strip)
 *   - audio  → inline <audio controls> element
 *
 * If the attachment has no `url` (older captures stored only hash + bytes),
 * we render a placeholder card with the metadata so the annotator at least
 * knows something was there. Real upload-to-storage capture (we have
 * `persistWithStorage`) writes the URL in.
 *
 * The strip is collapsed by default if there's more than 4 attachments — a
 * 50-attachment trajectory would otherwise dominate the viewport before the
 * annotator has even scrolled to step 1.
 */

const COLLAPSED_THRESHOLD = 4

export function AttachmentsStrip({
  attachments,
}: {
  attachments: readonly AttachmentRef[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [zoomed, setZoomed] = useState<AttachmentRef | null>(null)

  if (attachments.length === 0) return null

  const visible =
    !expanded && attachments.length > COLLAPSED_THRESHOLD
      ? attachments.slice(0, COLLAPSED_THRESHOLD)
      : attachments

  return (
    <>
      <div
        className="px-5 py-2 hairline-b"
        style={{ background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-3">
          <span className="lbl shrink-0">attachments · {attachments.length}</span>
          <div
            className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            {visible.map((a, i) => (
              <AttachmentCell
                key={`${a.messageIndex}-${a.blockIndex}-${i}`}
                a={a}
                onZoom={() => setZoomed(a)}
              />
            ))}
          </div>
          {attachments.length > COLLAPSED_THRESHOLD && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="ts-11 mono shrink-0"
              style={{
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 5,
                padding: '4px 8px',
                color: 'var(--mute)',
                cursor: 'pointer',
              }}
            >
              {expanded ? `collapse` : `+${attachments.length - COLLAPSED_THRESHOLD}`}
            </button>
          )}
        </div>
      </div>

      {zoomed && (
        <ZoomModal
          attachment={zoomed}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  )
}

function AttachmentCell({
  a,
  onZoom,
}: {
  a: AttachmentRef
  onZoom: () => void
}) {
  const label = a.mediaType?.split('/')[1] ?? a.kind
  const sizeLabel = a.bytes ? formatBytes(a.bytes) : ''

  if (a.kind === 'image' && a.url) {
    return (
      <button
        onClick={onZoom}
        className="shrink-0 rounded-md overflow-hidden"
        style={{
          width: 56,
          height: 56,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          padding: 0,
          cursor: 'zoom-in',
        }}
        title={`${label}${sizeLabel ? ' · ' + sizeLabel : ''}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.url}
          alt={`${label} attachment`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </button>
    )
  }

  if (a.kind === 'audio' && a.url) {
    return (
      <div
        className="shrink-0 rounded-md"
        style={{
          padding: 6,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}
      >
        <audio src={a.url} controls style={{ height: 28, maxWidth: 200 }} />
      </div>
    )
  }

  // document / unknown / no-url fallback — render a chip
  const isPdf = a.mediaType === 'application/pdf'
  const content = (
    <>
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--accent)',
          fontWeight: 500,
        }}
      >
        {isPdf ? 'PDF' : a.kind.toUpperCase().slice(0, 4)}
      </span>
      <span
        className="ts-11"
        style={{ color: 'var(--mute2)' }}
      >
        {sizeLabel || label}
      </span>
    </>
  )
  const chipStyle = {
    height: 56,
    padding: '0 12px',
    background: 'var(--panel)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    display: 'inline-flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flexShrink: 0,
    cursor: a.url ? 'pointer' : 'default',
    textDecoration: 'none',
  }

  return a.url ? (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      style={chipStyle}
      title={`${label} · ${sizeLabel || 'open in new tab'}`}
    >
      {content}
    </a>
  ) : (
    <div
      style={chipStyle}
      title={`${label} (no URL — only hash + size captured)`}
    >
      {content}
    </div>
  )
}

function ZoomModal({
  attachment,
  onClose,
}: {
  attachment: AttachmentRef
  onClose: () => void
}) {
  if (!attachment.url) return null
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'oklch(0 0 0 / 0.55)',
          zIndex: 50,
          cursor: 'zoom-out',
        }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: '5vh 5vw',
          zIndex: 51,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          overflow: 'auto',
        }}
      >
        <div
          className="w-full flex items-center justify-between"
        >
          <span className="lbl">
            {attachment.kind}
            {attachment.mediaType ? ` · ${attachment.mediaType}` : ''}
            {attachment.bytes ? ` · ${formatBytes(attachment.bytes)}` : ''}
          </span>
          <button
            onClick={onClose}
            className="ts-12 mono"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: '4px 10px',
              color: 'var(--mute)',
              cursor: 'pointer',
            }}
          >
            close
          </button>
        </div>
        {attachment.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt="enlarged attachment"
            style={{
              maxWidth: '100%',
              maxHeight: '80vh',
              objectFit: 'contain',
            }}
          />
        ) : (
          <iframe
            src={attachment.url}
            title="attachment preview"
            style={{
              width: '100%',
              height: '70vh',
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: 'var(--panel)',
            }}
          />
        )}
        <a
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="ts-12 mono"
          style={{ color: 'var(--accent)' }}
        >
          open in new tab →
        </a>
      </div>
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

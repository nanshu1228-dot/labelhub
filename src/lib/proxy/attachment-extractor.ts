/**
 * Multimodal attachment extractor.
 *
 * When a client sends a vision / file request to the proxy, the message
 * `content` is an ARRAY of typed blocks instead of a plain string. Our
 * earlier `stringifyContent` silently dropped non-text blocks — meaning the
 * captured trajectory had "annotate this:" with no record of what "this" was.
 *
 * This module scans every message's content blocks and records ATTACHMENT
 * METADATA: the kind, mime type, source (url vs base64), byte size when
 * computable, and a content hash (SHA-256). The actual bytes are NOT
 * uploaded by this module — that needs Supabase Storage setup. For now
 * the annotator at least sees:
 *
 *   "Message #0 attached: image/png · 124 KB · sha256=ab12cd34… · base64-inline"
 *
 * Which is enough to know "the model saw a 124 KB PNG; I should not pretend
 * the request was text-only."
 *
 * Once `SUPABASE_SERVICE_ROLE_KEY` + the `labelhub-media` bucket are set up,
 * the upload hop slots in by replacing `source: 'base64-inline'` with a
 * persisted URL — adapter consumers (UI) don't change.
 *
 * The two providers' multimodal shapes:
 *
 * OpenAI:
 *   { type: 'image_url', image_url: { url: 'data:image/png;base64,…' | 'https://…' } }
 *   { type: 'input_audio', input_audio: { data: '…base64…', format: 'wav' } }
 *
 * Anthropic:
 *   { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '…' } }
 *   { type: 'image', source: { type: 'url', url: 'https://…' } }
 *   { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: '…' } }
 */

import { createHash } from 'node:crypto'

export type AttachmentSource = 'url' | 'base64-inline' | 'storage'

export interface AttachmentRecord {
  /** Which message in the request (index into messages[]). */
  messageIndex: number
  /** Which block within that message's content array. */
  blockIndex: number
  /** image | audio | document | other */
  kind: 'image' | 'audio' | 'document' | 'other'
  source: AttachmentSource
  mediaType?: string
  /** URL when source='url' (client provided) or 'storage' (we uploaded). */
  url?: string
  /** Decoded byte size. */
  bytes?: number
  /** SHA-256 of the underlying bytes (or the URL string when remote). 16-char hex prefix. */
  hashPrefix?: string
  /**
   * Raw decoded bytes — set ONLY during the request lifetime for base64-inline
   * sources. The proxy strips this field before persisting (privacy + DB size).
   * Storage upload reads this, replaces source/url, then deletes it.
   *
   * Underscore prefix signals "internal, not for storage".
   */
  _rawData?: Buffer
}

/**
 * Look at one message's content blocks. Returns the attachments found and
 * a "safe display" version of any base64 inline data — stripped to a short
 * marker the trajectory.steps can carry without ballooning DB size.
 */
export function extractAttachmentsFromContent(
  content: unknown,
  messageIndex: number,
): AttachmentRecord[] {
  if (!Array.isArray(content)) return []
  const out: AttachmentRecord[] = []
  content.forEach((block, blockIndex) => {
    if (!block || typeof block !== 'object') return
    const b = block as Record<string, unknown>
    const t = typeof b.type === 'string' ? b.type : ''

    // OpenAI: image_url
    if (t === 'image_url') {
      const img = b.image_url as { url?: string } | undefined
      const url = typeof img?.url === 'string' ? img.url : ''
      if (!url) return
      if (url.startsWith('data:')) {
        const decoded = decodeDataUrl(url)
        out.push({
          messageIndex,
          blockIndex,
          kind: 'image',
          source: 'base64-inline',
          mediaType: decoded.mediaType,
          bytes: decoded.bytes,
          hashPrefix: decoded.hashPrefix,
          _rawData: decoded.rawData,
        })
      } else {
        out.push({
          messageIndex,
          blockIndex,
          kind: 'image',
          source: 'url',
          url,
          hashPrefix: shortHash(url),
        })
      }
    }
    // OpenAI: input_audio
    else if (t === 'input_audio') {
      const a = b.input_audio as { data?: string; format?: string } | undefined
      const data = typeof a?.data === 'string' ? a.data : ''
      if (!data) return
      const rawData = decodeBase64(data)
      out.push({
        messageIndex,
        blockIndex,
        kind: 'audio',
        source: 'base64-inline',
        mediaType: a?.format ? `audio/${a.format}` : 'audio/unknown',
        bytes: rawData?.length,
        hashPrefix: shortHash(data),
        _rawData: rawData,
      })
    }
    // Anthropic: image / document
    else if (t === 'image' || t === 'document') {
      const src = b.source as Record<string, unknown> | undefined
      if (!src) return
      const kind = t === 'image' ? 'image' : 'document'
      if (src.type === 'url' && typeof src.url === 'string') {
        out.push({
          messageIndex,
          blockIndex,
          kind,
          source: 'url',
          mediaType: typeof src.media_type === 'string' ? src.media_type : undefined,
          url: src.url,
          hashPrefix: shortHash(src.url),
        })
      } else if (src.type === 'base64' && typeof src.data === 'string') {
        const rawData = decodeBase64(src.data)
        out.push({
          messageIndex,
          blockIndex,
          kind,
          source: 'base64-inline',
          mediaType:
            typeof src.media_type === 'string' ? src.media_type : undefined,
          bytes: rawData?.length,
          hashPrefix: shortHash(src.data),
          _rawData: rawData,
        })
      }
    }
    // Anthropic prompt-caching / cache_control blocks; unknown types: ignore.
  })
  return out
}

/**
 * Scan every message in the request and return all attachments found,
 * tagged by their (messageIndex, blockIndex).
 */
export function extractAttachments(
  messages: Array<{ content: unknown }>,
): AttachmentRecord[] {
  const out: AttachmentRecord[] = []
  messages.forEach((m, i) => {
    out.push(...extractAttachmentsFromContent(m.content, i))
  })
  return out
}

// ─── helpers ──────────────────────────────────────────────────────────────

function decodeDataUrl(url: string): {
  mediaType?: string
  bytes?: number
  hashPrefix?: string
  rawData?: Buffer
} {
  // data:image/png;base64,iVBORw0…
  // Use [\s\S] instead of /./s to stay compatible with older `lib` targets.
  const match = /^data:([^;,]+)?(?:;([^,]+))?,([\s\S]+)$/.exec(url)
  if (!match) return {}
  const mediaType = match[1] ?? undefined
  const encoding = match[2]
  const body = match[3]
  if (encoding === 'base64') {
    const rawData = decodeBase64(body)
    return {
      mediaType,
      bytes: rawData?.length,
      hashPrefix: shortHash(body),
      rawData,
    }
  }
  // Non-base64 data URL: take chars as UTF-8 bytes.
  const buf = Buffer.from(body, 'utf-8')
  return {
    mediaType,
    bytes: buf.length,
    hashPrefix: shortHash(body),
    rawData: buf,
  }
}

/** Decode a base64 string to a Buffer; null on parse error. */
function decodeBase64(b64: string): Buffer | undefined {
  try {
    return Buffer.from(b64, 'base64')
  } catch {
    return undefined
  }
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

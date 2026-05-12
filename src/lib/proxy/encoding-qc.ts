/**
 * Encoding QC — flag trajectories whose text fields look mojibake'd.
 *
 * Why this exists: agents in the wild are POSTed from every kind of client —
 * Windows curl, half-broken shells, mis-configured SDKs. Some of them send
 * GBK / Shift-JIS bytes claiming to be UTF-8. Our proxy faithfully records
 * whatever comes over the wire (correct for audit), which means we end up
 * with rootPrompts like "用一句话…" rendered as "用一句话…".
 *
 * We DON'T reject — refusing a request because of suspicious encoding would
 * break legitimate use of high-bit characters in production. We just **flag**
 * so the annotation UI can show a banner: "this trajectory's input looks
 * mis-encoded; the captured bytes are preserved as-is for audit."
 */

/** Unicode replacement character — emitted by decoders when they hit invalid bytes. */
const REPLACEMENT_CHAR = '�'

/** C1 control characters that should basically never appear in real text. */
const C1_CONTROL_RE = /[-]/g

/**
 * Heuristic: does this string look like it was decoded from the wrong charset?
 *
 *  1. Any U+FFFD at all is a strong signal — the decoder gave up.
 *  2. > 5% of chars in U+0080..U+009F (C1 controls) — these almost never
 *     appear naturally in correctly-encoded UTF-8 text; they DO appear when
 *     you decode CP-1252 / GBK / Shift-JIS bytes as Latin-1 or vice versa.
 *  3. > 30% of chars in the Latin-1 supplement (U+00A0..U+00FF) AND no
 *     plain ASCII letters — typical signature of GBK-as-Latin1.
 *
 * Empty / very short strings return false (insufficient signal).
 */
export function looksMojibake(text: string | null | undefined): boolean {
  if (!text) return false
  if (text.length < 4) return false

  if (text.includes(REPLACEMENT_CHAR)) return true

  const c1Matches = text.match(C1_CONTROL_RE)
  if (c1Matches && c1Matches.length / text.length > 0.05) return true

  let latin1Supplement = 0
  let asciiLetters = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x00a0 && code <= 0x00ff) latin1Supplement++
    else if (
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      asciiLetters++
    }
  }
  if (latin1Supplement / text.length > 0.3 && asciiLetters === 0) return true

  return false
}

export interface EncodingQcResult {
  /** True if ANY of the inspected fields looked broken. */
  suspect: boolean
  /** Which fields tripped the heuristic. */
  fields: string[]
}

/**
 * Inspect the strings the annotator will actually see (rootPrompt, system,
 * final response) for mojibake. Returns a structured flag the caller can
 * stash into trajectory.meta.qcFlags.
 */
export function inspectTrajectoryEncoding(input: {
  rootPrompt?: string | null
  finalResponse?: string | null
  systemPrompt?: string | null
}): EncodingQcResult {
  const flagged: string[] = []
  if (looksMojibake(input.rootPrompt)) flagged.push('rootPrompt')
  if (looksMojibake(input.finalResponse)) flagged.push('finalResponse')
  if (looksMojibake(input.systemPrompt)) flagged.push('systemPrompt')
  return { suspect: flagged.length > 0, fields: flagged }
}

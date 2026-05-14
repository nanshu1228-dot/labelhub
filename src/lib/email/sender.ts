import 'server-only'

/**
 * Provider-agnostic email sender — same swap-friendly pattern as
 * `src/lib/ai/client.ts`.
 *
 * Picks an implementation at module import time based on env:
 *
 *   1. RESEND_API_KEY set → Resend (transactional)
 *   2. Otherwise          → Console (logs + returns the email body in `ref`)
 *
 * The Console implementation is the dev / unconfigured fallback — it makes
 * the system observable without requiring a live email service. Admins can
 * still onboard a teammate by reading the console output and copy-pasting
 * the invite link.
 *
 * To add a new provider (Postmark / SendGrid / AWS SES / Aliyun):
 *   1. Implement `EmailSender`
 *   2. Add a branch to `getEmailSender()` that picks based on env
 *   3. No callers change — they all consume the interface only.
 */

export interface SendInviteEmailArgs {
  to: string
  workspaceName: string
  inviterDisplayName: string
  inviteUrl: string
  role: 'admin' | 'annotator' | 'viewer'
}

export interface SendResult {
  ok: boolean
  /**
   * Provider-specific reference (Resend message id, etc.). When the Console
   * provider runs, this is a synthetic id so callers can still treat the
   * return value uniformly.
   */
  ref: string
  /** True when no real email was sent (admin should copy the URL out-of-band). */
  fallback?: boolean
  error?: string
}

export interface EmailSender {
  sendInvite(args: SendInviteEmailArgs): Promise<SendResult>
}

// ─── Resend implementation ───────────────────────────────────────────────

class ResendSender implements EmailSender {
  constructor(private readonly apiKey: string) {}

  async sendInvite(args: SendInviteEmailArgs): Promise<SendResult> {
    const from =
      process.env.RESEND_FROM_EMAIL ||
      // Resend's onboarding sender, usable without domain verification.
      // Switch to a verified domain (notifications@labelhub.com) once
      // you have one — better deliverability + the "from" name shows up
      // in inbox previews.
      'LabelHub <onboarding@resend.dev>'

    const subject = `You're invited to "${args.workspaceName}" on LabelHub`
    const html = renderInviteHtml(args)
    const text = renderInviteText(args)

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [args.to],
          subject,
          html,
          text,
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable>')
        return {
          ok: false,
          ref: '',
          error: `resend ${res.status}: ${body.slice(0, 300)}`,
        }
      }
      const data = (await res.json()) as { id?: string }
      return { ok: true, ref: data.id ?? 'resend-no-id' }
    } catch (e) {
      return {
        ok: false,
        ref: '',
        error: e instanceof Error ? e.message : 'resend network error',
      }
    }
  }
}

// ─── Console fallback (no real email; admin uses "copy link" UI) ─────────

class ConsoleSender implements EmailSender {
  async sendInvite(args: SendInviteEmailArgs): Promise<SendResult> {
    const fakeId = `console-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`
    // eslint-disable-next-line no-console
    console.log(
      `[email/console] Would send invite to ${args.to}:\n` +
        `  workspace: ${args.workspaceName}\n` +
        `  role     : ${args.role}\n` +
        `  inviter  : ${args.inviterDisplayName}\n` +
        `  url      : ${args.inviteUrl}`,
    )
    return { ok: true, ref: fakeId, fallback: true }
  }
}

// ─── Sender factory ─────────────────────────────────────────────────────

let _sender: EmailSender | null = null

export function getEmailSender(): EmailSender {
  if (_sender) return _sender
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey && resendKey.trim().length > 0) {
    _sender = new ResendSender(resendKey.trim())
  } else {
    _sender = new ConsoleSender()
  }
  return _sender
}

// ─── Templates ─────────────────────────────────────────────────────────

function renderInviteHtml(args: SendInviteEmailArgs): string {
  // Minimal, defensible HTML that renders in most clients. No tracking
  // pixel, no remote images — keeps the invite trustworthy-looking.
  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f0f;margin:0;padding:24px;color:#e5e5e5">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:540px;margin:0 auto;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;">
    <tr><td style="padding:32px;">
      <div style="font-family:'SF Mono','Consolas',monospace;font-size:11px;color:#9c5fff;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:12px;">§ INVITE</div>
      <h1 style="font-size:24px;line-height:1.2;letter-spacing:-0.01em;font-weight:500;margin:0 0 8px;color:#f5f5f5;">You're invited to <em style="color:#9c5fff;font-style:normal;">${escapeHtml(args.workspaceName)}</em></h1>
      <p style="font-size:14px;line-height:1.55;color:#a0a0a0;margin:0 0 24px;">
        ${escapeHtml(args.inviterDisplayName)} invited you to join their LabelHub workspace as <strong style="color:#e5e5e5;">${args.role}</strong>.
      </p>
      <a href="${escapeAttr(args.inviteUrl)}" style="display:inline-block;background:#9c5fff;color:white;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:500;">Accept invite</a>
      <p style="font-size:12px;line-height:1.5;color:#666;margin:24px 0 0;">
        If the button doesn't work, paste this into your browser:<br/>
        <span style="color:#888;word-break:break-all;font-family:'SF Mono','Consolas',monospace;font-size:11px;">${escapeHtml(args.inviteUrl)}</span>
      </p>
      <p style="font-size:11px;color:#555;margin:24px 0 0;">
        LabelHub · captured the teaching, not just the label
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

function renderInviteText(args: SendInviteEmailArgs): string {
  return [
    `You're invited to "${args.workspaceName}" on LabelHub`,
    '',
    `${args.inviterDisplayName} invited you to join their LabelHub workspace as ${args.role}.`,
    '',
    `Accept the invite: ${args.inviteUrl}`,
    '',
    '--',
    'LabelHub · captured the teaching, not just the label',
  ].join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}

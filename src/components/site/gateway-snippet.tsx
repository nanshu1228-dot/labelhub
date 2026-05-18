'use client'
import { useState } from 'react'
import { useLang } from '@/lib/i18n'

/**
 * The "3-line drop-in" card on the landing hero (Phase-15).
 *
 * Visual: a code block showing the OpenAI/Anthropic SDK base_url
 * swap that makes a customer's existing agent suddenly route through
 * the gateway — no code rewrite, zero SDK lock-in.
 *
 * Has a tabbed switcher (python / node / curl) and a copy button.
 * The actual URL is read from PROXY_BASE so it points at the live
 * deployment.
 */

const PROXY_BASE = 'https://labelhub-gamma.vercel.app/api/proxy'

type Tab = 'python' | 'node' | 'curl'

const SNIPPETS: Record<Tab, string> = {
  python: `from openai import OpenAI

client = OpenAI(
    base_url="${PROXY_BASE}/openai/v1",
    api_key="lh_demo_…",   # rate-limited public demo key
)
# every call below is captured + scope-injected automatically
client.chat.completions.create(model="gpt-4o-mini", messages=[…])`,
  node: `import OpenAI from "openai"

const openai = new OpenAI({
  baseURL: "${PROXY_BASE}/openai/v1",
  apiKey: "lh_demo_…",   // rate-limited public demo key
})
// every call below is captured + scope-injected automatically
await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [...] })`,
  curl: `curl ${PROXY_BASE}/anthropic/v1/messages \\
  -H "x-api-key: lh_demo_…" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"claude-sonnet-4-5","max_tokens":256,
       "messages":[{"role":"user","content":"hi"}]}'`,
}

export function GatewaySnippet() {
  const { t } = useLang()
  const [tab, setTab] = useState<Tab>('python')
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard
      .writeText(SNIPPETS[tab])
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      })
      .catch(() => {
        // clipboard API can fail in non-secure contexts; ignore silently
      })
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'oklch(0.13 0 0)',
        border: '1px solid oklch(0.24 0 0)',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{
          borderBottom: '1px solid oklch(0.22 0 0)',
          background: 'oklch(0.15 0 0)',
        }}
      >
        <div className="flex items-center gap-1">
          {(['python', 'node', 'curl'] as Tab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="lh-mono lh-caption px-2 py-1 rounded-sm transition-colors"
              style={{
                background:
                  tab === k ? 'oklch(0.22 0 0)' : 'transparent',
                color:
                  tab === k
                    ? 'oklch(0.92 0 0)'
                    : 'oklch(0.5 0 0)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className="lh-mono lh-caption px-2 py-1 rounded-sm"
          style={{
            background: 'transparent',
            color: copied ? 'oklch(0.7 0.18 145)' : 'oklch(0.55 0 0)',
            border: '1px solid oklch(0.24 0 0)',
            cursor: 'pointer',
          }}
        >
          {copied ? t('snip_copied') : t('snip_copy')}
        </button>
      </div>
      <pre
        className="p-4 m-0 overflow-x-auto text-[12.5px] leading-[1.55]"
        style={{
          color: 'oklch(0.86 0 0)',
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
          fontFeatureSettings: '"liga" 0',
        }}
      >
        <code>{SNIPPETS[tab]}</code>
      </pre>
    </div>
  )
}

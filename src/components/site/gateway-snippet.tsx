'use client'
import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n'

/**
 * The "3-line drop-in" card on the landing hero (Phase-15, key
 * resolution added in Phase-17).
 *
 * Visual: a code block showing the OpenAI/Anthropic SDK base_url
 * swap that makes a customer's existing agent suddenly route through
 * the gateway — no code rewrite, zero SDK lock-in.
 *
 * Tabbed switcher (python / node / curl), copy button, and an on-
 * mount fetch of /api/demo/info to pull the *real* public demo key.
 * If the fetch fails or the key isn't minted, falls back to the
 * `lh_demo_…` placeholder so the snippet still reads coherently.
 */

const FALLBACK_PROXY_BASE = 'https://labelhub-gamma.vercel.app/api/proxy'
const FALLBACK_KEY = 'lh_demo_…'

type Tab = 'python' | 'node' | 'curl'

function renderSnippets(opts: {
  proxyBase: string
  demoKey: string
}): Record<Tab, string> {
  const { proxyBase, demoKey } = opts
  return {
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${proxyBase}/openai/v1",
    api_key="${demoKey}",
)
# every call below is captured + scope-injected automatically
client.chat.completions.create(model="gpt-4o-mini", messages=[…])`,
    node: `import OpenAI from "openai"

const openai = new OpenAI({
  baseURL: "${proxyBase}/openai/v1",
  apiKey: "${demoKey}",
})
// every call below is captured + scope-injected automatically
await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [...] })`,
    curl: `curl ${proxyBase}/anthropic/v1/messages \\
  -H "x-api-key: ${demoKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"claude-sonnet-4-5","max_tokens":256,
       "messages":[{"role":"user","content":"hi"}]}'`,
  }
}

export function GatewaySnippet() {
  const { t } = useLang()
  const [tab, setTab] = useState<Tab>('python')
  const [copied, setCopied] = useState(false)
  const [proxyBase, setProxyBase] = useState(FALLBACK_PROXY_BASE)
  const [demoKey, setDemoKey] = useState(FALLBACK_KEY)

  useEffect(() => {
    let cancelled = false
    fetch('/api/demo/info', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { proxyBase?: string; demoKey?: string | null }) => {
        if (cancelled) return
        if (typeof j.proxyBase === 'string') setProxyBase(j.proxyBase)
        if (typeof j.demoKey === 'string' && j.demoKey.length > 0)
          setDemoKey(j.demoKey)
      })
      .catch(() => {
        // Network blip — placeholder still reads sanely.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const snippets = renderSnippets({ proxyBase, demoKey })

  function copy() {
    navigator.clipboard
      .writeText(snippets[tab])
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
        <code>{snippets[tab]}</code>
      </pre>
    </div>
  )
}

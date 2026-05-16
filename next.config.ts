import type { NextConfig } from 'next'

/**
 * Next.js 16 config.
 *
 * `output: 'standalone'` enables a minimal production server bundle for Docker
 * (~150 MB image vs ~1.2 GB without). See Dockerfile for the multi-stage build.
 *
 * Other Next 16 options to consider later:
 *   - cacheComponents: true   (PPR opt-in; needs auditing for our streaming flows)
 *   - reactCompiler: true     (after we have stable build perf benchmarks)
 *
 * --- Security headers (Phase-6 audit response) ---
 * Headers applied to every response, including localhost dev. Without
 * these we rely on Vercel's production defaults; localhost was fully
 * unprotected. CSP is the most consequential addition — it shrinks the
 * blast radius of any XSS bug (e.g. the postcss CVE-2024-24791 transitive
 * we can't independently patch without Next 17).
 *
 * CSP rationale:
 *   - 'self' for everything except where we genuinely need otherwise
 *   - script-src adds 'unsafe-inline' because Next.js injects per-page
 *     <script> tags for hydration with computed nonces only when you
 *     opt in; the simpler unsafe-inline route ships now and we tighten
 *     later. NOT 'unsafe-eval' — that's what we MUST keep out.
 *   - style-src 'unsafe-inline' because Tailwind v4 + inline style
 *     attributes are everywhere in this codebase (used heavily in the
 *     dark/light theme system).
 *   - connect-src 'self' + supabase.co for auth, anthropic.com for
 *     direct Claude streaming from the browser (we don't currently
 *     do that — but route handlers proxy upstream), wss for realtime
 *     if/when added.
 *   - img-src 'self' data: blob: + supabase storage for uploaded
 *     trajectory attachments (future).
 *   - frame-ancestors 'none' — defense against clickjacking even with
 *     X-Frame-Options set (CSP is the modern equivalent and wins on
 *     newer browsers).
 *
 * Sites this DOES NOT yet cover:
 *   - Per-route relaxation (e.g. the public /docs page might want
 *     external embeds in the future). Add via headers() with a glob
 *     match when needed.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Strict-Transport-Security',
    // 1 year, include subdomains, preload-eligible. HSTS only takes
    // effect over HTTPS; localhost is unaffected.
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    // Disable browser APIs we don't use. Tightens the attack surface
    // if a future bug lets attacker inject HTML — they can't pop the
    // microphone without an allow-list override.
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
]

const nextConfig: NextConfig = {
  output: 'standalone',

  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

export default nextConfig

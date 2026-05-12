'use client'
import { createBrowserClient } from '@supabase/ssr'

type Client = ReturnType<typeof createBrowserClient>

let _client: Client | null = null

/**
 * Supabase client for Client Components.
 * Lazy singleton — same instance reused across the SPA session.
 */
export function getSupabaseBrowserClient(): Client {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
    )
  }
  _client = createBrowserClient(url, key)
  return _client
}

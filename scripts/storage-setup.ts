/**
 * One-shot Supabase Storage bucket provisioner for LabelHub multimodal attachments.
 *
 * Idempotent — creates the `labelhub-media` bucket if it doesn't exist, makes
 * it public (URLs are sha256-keyed and thus unguessable, sufficient for
 * demo/MVP). Production setups should swap to signed URLs.
 *
 * Run: `npm run storage:setup`
 *
 * Requires `.env.local` to have:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY  ← admin key, must NEVER be exposed to client
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'labelhub-media'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      '\n❌ Missing env. Add NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to .env.local.',
    )
    console.error(
      '   Supabase Dashboard → Settings → API → Project URL + service_role key.\n',
    )
    process.exit(1)
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Check existence first.
  const { data: existing, error: listErr } = await client.storage.listBuckets()
  if (listErr) {
    console.error('❌ listBuckets failed:', listErr.message)
    process.exit(1)
  }
  const found = existing.find((b) => b.name === BUCKET)
  if (found) {
    console.log(
      `✓ Bucket "${BUCKET}" already exists (public=${found.public}).`,
    )
    if (!found.public) {
      console.log('  → flipping to public...')
      const { error } = await client.storage.updateBucket(BUCKET, {
        public: true,
      })
      if (error) {
        console.error('  ❌ updateBucket failed:', error.message)
        process.exit(1)
      }
      console.log('  ✓ now public')
    }
  } else {
    console.log(`→ creating bucket "${BUCKET}"...`)
    const { error } = await client.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10 MB per object — sane upper bound
    })
    if (error) {
      console.error('❌ createBucket failed:', error.message)
      process.exit(1)
    }
    console.log(`✓ Created "${BUCKET}" (public, 10 MB max per object)`)
  }

  console.log()
  console.log(
    `Storage ready. Files land at: <project>/storage/v1/object/public/${BUCKET}/<workspaceId>/<sha256>.<ext>`,
  )
  console.log()
}

main().catch((e) => {
  console.error('failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})

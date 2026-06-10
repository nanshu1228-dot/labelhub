import { type NextRequest, NextResponse } from 'next/server'
import { signOut } from '@/lib/actions/auth'
import { publicUrl } from '@/lib/http/public-origin'

/**
 * POST /signout — one-click logout endpoint.
 *
 * Why a Route Handler instead of inlining the action in a Server Component:
 * lets any client component (e.g. a header avatar dropdown) trigger logout
 * with a plain HTML `<form action="/signout" method="post">` — no JS needed.
 *
 * After clearing the session, we 303-redirect to the home page so the
 * browser navigates back without a re-POST on refresh.
 */
export async function POST(_request: NextRequest) {
  await signOut()
  return NextResponse.redirect(publicUrl('/', _request), { status: 303 })
}

// Guard against accidental GET (e.g. someone bookmarking /signout).
export async function GET(request: NextRequest) {
  // Just bounce back home without doing anything.
  return NextResponse.redirect(publicUrl('/', request), { status: 303 })
}

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import {
  TemplatePicker,
  type PickerTemplate,
} from '@/components/workspaces/template-picker'
import { listTemplates } from '@/lib/templates/registry'
import '@/lib/templates/init' // side-effect: registers the 3 shipping modes
import { optionalUser } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Start a workspace — LabelHub',
}

// Force dynamic — the cookie-based optionalUser() check has to run per request.
// Without this, Next.js can cache the unauth path and serve a stale
// "you need to sign in" redirect even to signed-in users.
export const dynamic = 'force-dynamic'

/**
 * /workspaces/new — gated behind auth.
 *
 * Without a session the createWorkspace action would throw — we redirect to
 * /signin with a `next` hint instead so the user lands here after authing
 * rather than on the root.
 */
export default async function NewWorkspacePage() {
  const user = await optionalUser()
  if (!user) {
    redirect('/signin?next=/workspaces/new')
  }

  const templates: PickerTemplate[] = listTemplates().map((t) => ({
    mode: t.mode,
    name: t.name,
    description: t.description,
  }))
  return <TemplatePicker templates={templates} />
}

import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-shell/app-header'

/**
 * /workspaces/* layout — Finals D20-A.
 *
 * Mounts the cross-role AppHeader so an admin deep inside a task
 * page can hop back to /admin or /my/queue or /review without
 * losing context. Per-workspace breadcrumbs stay inside the page
 * itself.
 */
export default async function WorkspacesLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  )
}

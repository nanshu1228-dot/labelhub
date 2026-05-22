import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-shell/app-header'

/**
 * /admin/* layout — Finals D20-A.
 *
 * Mounts the cross-role AppHeader. Admin pages still apply their
 * own admin-role guards in `page.tsx`; the header doesn't bypass
 * auth — it just provides nav for whoever does get through.
 */
export default async function AdminLayout({
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

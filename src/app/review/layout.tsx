import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-shell/app-header'

/**
 * /review/* layout — Finals D20-A.
 *
 * Mounts the cross-role AppHeader so a reviewer can hop to their
 * /my/queue (own labeling work) or /admin (if they're also admin)
 * without typing URLs.
 */
export default async function ReviewLayout({
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

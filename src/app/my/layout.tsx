import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-shell/app-header'

/**
 * /my/* layout — Finals D20-A.
 *
 * Mounts the persistent AppHeader so labelers see the cross-role
 * nav + inbox badge on every /my surface. Server component; the
 * header itself owns the role-summary query (cached) + unread
 * count.
 */
export default async function MyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-light min-h-screen">
      <AppHeader />
      {children}
    </div>
  )
}

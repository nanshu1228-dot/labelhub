import { SiteNav } from '@/components/site/nav'
import { Hero } from '@/components/site/hero'
import { GatewayPillars } from '@/components/site/gateway-pillars'
import { TemplateCards } from '@/components/site/template-cards'
import { LiveLearning } from '@/components/site/live-learning'
import { SiteFooter } from '@/components/site/site-footer'
import { getLandingStats } from '@/lib/queries/landing-stats'

// Force per-request rendering so the live stats are accurate. Without
// this Next will happily serve a build-time render with stats=null
// (Phase-15 reflection fix: prod was showing "—" everywhere because
// the build had no DATABASE_URL at prerender time).
export const dynamic = 'force-dynamic'

/**
 * Landing — Phase-15 thesis rewrite.
 *
 * Order matters:
 *   Hero (gateway thesis + 3-line drop-in)
 *     → GatewayPillars (capture / scope / fork)
 *       → TemplateCards (the three annotation modes the gateway feeds)
 *         → LiveLearning (existing)
 *
 * Hero stats are real counts pulled from prod at request time. If the
 * DB is unreachable at build, we ship `null` and the Hero shows "—".
 */
export default async function HomePage() {
  const stats = await getLandingStats().catch(() => null)
  return (
    <>
      <SiteNav />
      <main>
        <Hero stats={stats} />
        <GatewayPillars />
        <TemplateCards />
        <LiveLearning />
      </main>
      <SiteFooter />
    </>
  )
}

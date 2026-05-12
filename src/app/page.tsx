import { SiteNav } from '@/components/site/nav'
import { Hero } from '@/components/site/hero'
import { TemplateCards } from '@/components/site/template-cards'
import { LiveLearning } from '@/components/site/live-learning'
import { SiteFooter } from '@/components/site/site-footer'

export default function HomePage() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <TemplateCards />
        <LiveLearning />
      </main>
      <SiteFooter />
    </>
  )
}

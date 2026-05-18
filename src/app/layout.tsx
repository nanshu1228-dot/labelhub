import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { LangProvider } from '@/components/site/lang-provider'
import { OnboardingTour } from '@/components/site/onboarding-tour'
import './globals.css'

// `geist` package ships fonts pre-bundled — no Google Fonts fetch at build time.
// `.variable` exposes the same `--font-geist-sans` / `--font-geist-mono` CSS vars
// that the previous `next/font/google` setup did, so globals.css works unchanged.

export const metadata: Metadata = {
  title: 'LabelHub — The Annotation-Aware LLM Gateway',
  description:
    'Drop in as your OpenAI/Anthropic base URL. Every agent call gets captured, scope-guarded, and forkable for counterfactual teaching — no SDK changes.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <LangProvider>{children}</LangProvider>
        <OnboardingTour />
      </body>
    </html>
  )
}

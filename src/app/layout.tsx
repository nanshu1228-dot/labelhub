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
  title: 'LabelHub — Data Annotation Platform',
  description:
    'Build annotation tasks with a drag-and-drop form designer, collect labels, run AI pre-review and human QC, and export training-ready datasets in JSON / JSONL / CSV / Excel.',
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

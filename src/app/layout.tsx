import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { LangProvider } from '@/components/site/lang-provider'
import './globals.css'

// `geist` package ships fonts pre-bundled — no Google Fonts fetch at build time.
// `.variable` exposes the same `--font-geist-sans` / `--font-geist-mono` CSS vars
// that the previous `next/font/google` setup did, so globals.css works unchanged.

export const metadata: Metadata = {
  title: 'LabelHub — Capture the teaching, not just the label',
  description:
    'An annotation engine for the LLM era. Three modes — pair rubric, arena GSB, and agent-trace eval — over one model-grade scoring engine.',
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
      </body>
    </html>
  )
}

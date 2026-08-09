import type { Metadata } from 'next'
import { Fredoka, Quicksand } from 'next/font/google'
import { IS_LIVE, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site'
import './globals.css'

// Self-hosted at build time by next/font — no runtime request to Google, so no
// third-party connection and no layout shift.
const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-fredoka',
  display: 'swap',
})

const quicksand = Quicksand({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-quicksand',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Hair & Beauty Models`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    'Cavy connects hair and beauty stylists building their portfolios with models who want treatments at a discount — or for free.',
  applicationName: SITE_NAME,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} — Hair & Beauty Models`,
    description: SITE_TAGLINE,
    locale: 'en_GB',
  },
  // Belt and braces with robots.ts: that governs crawling, this governs
  // indexing of a page already fetched. Both are driven by PUBLIC_SITE_MODE.
  robots: IS_LIVE
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${fredoka.variable} ${quicksand.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-rose focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {/* Header and footer belong to (public), not here — the member area
            has its own nav, and a signed-in user was getting both. */}
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
      </body>
    </html>
  )
}

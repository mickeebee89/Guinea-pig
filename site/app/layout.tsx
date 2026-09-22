import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { IS_LIVE, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site'
import { SiteAnalytics } from '@/components/SiteAnalytics'
import { DemoLabel } from '@/components/DemoLabel'
import './globals.css'

// Self-hosted by next/font from the @fontsource packages already installed —
// no request to Google at build time or at runtime.
//
// Until 22 Sep 2026 these came from next/font/google, which serves the files
// from this site but DOWNLOADS them from Google Fonts during every build. When
// that download failed, the Production build for ab36812 failed with
// "Can't resolve '@vercel/turbopack-next/internal/font/google/font'" (audit
// item 72). Local files take the network out of the build.
//
// Same weights and the same latin subset as before, and the same CSS variable
// names, so globals.css and everything using --font-display / --font-sans is
// unchanged. The size-adjusted Arial fallback (adjustFontFallback, the default)
// is generated from these files' own metrics; item 72 records the comparison
// with what Google's metrics produced.
//
// The paths are literals on purpose: next/font resolves them at build time and
// cannot follow a helper function.
const fredoka = localFont({
  src: [
    { path: '../node_modules/@fontsource/fredoka/files/fredoka-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/fredoka/files/fredoka-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-fredoka',
  display: 'swap',
  // The fallback is declared by hand in globals.css ('Fredoka Fallback Metrics')
  // with the values next/font/google produced, because those matched Fredoka's
  // widths better than the ones next/font/local derives from these files:
  // 1.08% mean width error against 1.93%, measured 22 Sep 2026 (audit item 72).
  // Quicksand keeps the generated fallback, which measured slightly BETTER.
  adjustFontFallback: false,
  fallback: ['Fredoka Fallback Metrics', 'ui-rounded', 'system-ui', 'sans-serif'],
})

const quicksand = localFont({
  src: [
    { path: '../node_modules/@fontsource/quicksand/files/quicksand-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/quicksand/files/quicksand-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/quicksand/files/quicksand-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
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
  // NO canonical here, deliberately. A root-layout canonical is inherited by
  // every page that doesn't set its own, so until 22 Sep /sign-in, /sign-up and
  // /forgot-password all declared themselves copies of the home page, and any
  // new public page that forgot `alternates` would have done the same, silently
  // (audit item 52). Each public page sets its own; a page without one sets
  // none, which is the honest default.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} — Hair & Beauty Models`,
    description: SITE_TAGLINE,
    locale: 'en_GB',
  },
  // Belt and braces with robots.ts: that governs crawling, this governs
  // indexing of a page already fetched. Both are driven by IS_LIVE, which needs
  // PUBLIC_SITE_MODE=live AND a production deployment (lib/site.ts).
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
        {/* Every page, public and member area. Query strings are stripped
            before sending — see the component. Audit item 67. */}
        <SiteAnalytics />
        {/* Renders nothing, except in local demo mode with DEMO_LABEL=1
            (audit item 69). */}
        <DemoLabel />
      </body>
    </html>
  )
}

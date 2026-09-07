'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'

// Two labels per link: "Cavy" plus "For stylists" plus "For models" overflows a
// 360px phone. Exactly one of the pair is display:none at any width, so screen
// readers announce one label, never both.
//
// Sign in joined that row on 7 Sep 2026, so the short labels now matter more,
// not less — at 360px the row is wordmark + Stylists + Models + Sign in. Check
// it at 360 before adding anything else here.
const NAV = [
  { href: '/for-stylists', short: 'Stylists', long: 'For stylists' },
  { href: '/for-models', short: 'Models', long: 'For models' },
]

/**
 * Pill nav, following the app's chip spec in UI-STYLE-GUIDE.md: inactive is a
 * soft-pink fill, active is solid pink with white text. Client-side only so the
 * current page can be marked — two identical pills would be more visible but no
 * more useful.
 *
 * ── SIGN IN IS STATIC, AND THAT IS THE RIGHT ANSWER ───────────────────────
 * Added 7 Sep 2026. Until then the public site had NO route into the app: a
 * returning user with an account had to be told the URL. Micky hit this himself.
 *
 * It does not know whether you are signed in, and must not: everything in
 * (public)'s import graph is walked by scripts/check-client-boundary.mjs, which
 * fails the build if any of it touches cookies or the browser client. That guard
 * is what keeps these pages statically rendered, which is the whole SEO plan.
 *
 * It does not need to know either. /sign-in already redirects an authenticated
 * visitor to /dashboard (app/(auth)/sign-in/page.tsx:15), so one static link is
 * correct in both states: it means "take me into the app", and it does.
 *
 * ── WHY IT IS NOT A THIRD PILL ────────────────────────────────────────────
 * "For stylists" and "For models" are pitches to people who have not joined.
 * Sign in is for someone who already has. Three identical pills would read as
 * three equal choices and bury the one a returning user wants, so the pair stays
 * as pills and this sits apart from them, after a divider.
 */
export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="border-b border-hairline bg-cream/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="-mx-2 flex min-h-11 items-center rounded-md px-2 font-display text-2xl text-rose transition-colors hover:text-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          {SITE_NAME}
        </Link>

        <nav aria-label="Main">
          <ul className="flex items-center gap-2">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      // min-h-11 keeps the tap target at 44px, the smallest
                      // comfortable touch size, without inflating it visually.
                      'flex min-h-11 items-center rounded-[999px] px-3.5 text-sm font-bold transition-colors sm:px-4',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose',
                      active
                        ? 'bg-rose text-white'
                        : 'bg-soft-pink text-rose hover:bg-rose hover:text-white',
                    ].join(' ')}
                  >
                    <span className="sm:hidden">{item.short}</span>
                    <span className="hidden sm:inline">{item.long}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Divider, hidden on the narrowest screens where the gap does the job
            and every pixel is spoken for. */}
        <span aria-hidden="true" className="hidden h-5 w-px bg-hairline sm:block" />

        <Link
          href="/sign-in"
          className="flex min-h-11 items-center rounded-md px-2 text-sm font-bold text-rose transition-colors hover:text-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          Sign in
        </Link>
      </div>
    </header>
  )
}

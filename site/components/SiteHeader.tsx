'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'

// Two labels per link: "Cavy" plus "For stylists" plus "For models" overflows a
// 360px phone. Exactly one of the pair is display:none at any width, so screen
// readers announce one label, never both.
const NAV = [
  { href: '/for-stylists', short: 'Stylists', long: 'For stylists' },
  { href: '/for-models', short: 'Models', long: 'For models' },
]

/**
 * Pill nav, following the app's chip spec in UI-STYLE-GUIDE.md: inactive is a
 * soft-pink fill, active is solid pink with white text. Client-side only so the
 * current page can be marked — two identical pills would be more visible but no
 * more useful.
 */
export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="border-b border-hairline bg-cream/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
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
      </div>
    </header>
  )
}

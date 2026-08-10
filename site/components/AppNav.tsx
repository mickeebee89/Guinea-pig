import Link from 'next/link'
import { SignOutButton } from '@/components/SignOutButton'

/**
 * Navigation for the member area.
 *
 * Server-rendered. The unread count comes from the layout, which already has to
 * know who the user is — see the note there about what that costs.
 *
 * ── BUILT FOR A PHONE FIRST ────────────────────────────────────────────────
 * A stylist sees five links plus sign-out. In a single wrapping row that
 * becomes three ragged lines on a 375px screen, and the wordmark ends up
 * sitting above a stack of pills.
 *
 * So it is two rows on small screens — identity and sign-out on top, links
 * below in a strip that scrolls sideways rather than wrapping — and collapses
 * back to one row from `sm` up. A sideways strip keeps every destination one
 * tap away at a predictable height, which wrapping does not.
 *
 * The links keep min-h-11 (44px) throughout: that is the minimum comfortable
 * tap target, and it is why they look over-padded on a desktop.
 */
const LINKS = [
  // Models browse. A stylist has no use for a list of other stylists.
  { href: '/browse',        label: 'Browse', modelOnly: true },
  { href: '/sessions',      label: 'Bookings' },
  { href: '/availability',  label: 'Availability', providerOnly: true },
  { href: '/portfolio',     label: 'Portfolio',    providerOnly: true },
  { href: '/messages',      label: 'Messages', badgeKey: 'unread' as const },
  { href: '/notifications', label: 'Alerts', longLabel: 'Notifications' },
  { href: '/settings',      label: 'Settings' },
]

export function AppNav({ unread = 0, isProvider = false }: { unread?: number; isProvider?: boolean }) {
  const links = LINKS.filter(
    l => (!l.providerOnly || isProvider) && (!l.modelOnly || !isProvider),
  )

  return (
    <header className="border-b border-hairline bg-white">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 py-3 sm:justify-start">
          <Link
            href="/dashboard"
            className="font-display text-lg text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
          >
            Dashboard
          </Link>

          {/* From sm up the links sit inline; below that they get their own row. */}
          <nav aria-label="Member area" className="hidden flex-1 sm:block">
            <ul className="flex flex-wrap items-center gap-1">
              {links.map(l => <NavLink key={l.href} {...l} unread={unread} wide />)}
            </ul>
          </nav>

          <SignOutButton />
        </div>

        <nav aria-label="Member area" className="sm:hidden">
          {/* -mx-4 + px-4 lets the strip bleed to the screen edges, so a
              half-visible pill signals there is more to scroll to. */}
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {links.map(l => <NavLink key={l.href} {...l} unread={unread} />)}
          </ul>
        </nav>
      </div>
    </header>
  )
}

function NavLink({
  href, label, longLabel, badgeKey, unread, wide = false,
}: {
  href: string
  label: string
  longLabel?: string
  badgeKey?: 'unread'
  unread: number
  wide?: boolean
}) {
  return (
    <li className="shrink-0">
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[999px] px-3 text-sm font-bold text-muted transition-colors hover:bg-soft-pink hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
      >
        {/* "Notifications" is the longest label by some way and the least
            informative per character. It is shortened on the narrow strip only. */}
        {wide ? (longLabel ?? label) : label}
        {badgeKey === 'unread' && unread > 0 && (
          <>
            <span
              className="inline-flex min-w-5 items-center justify-center rounded-[999px] bg-rose px-1.5 py-0.5 text-xs font-bold text-white"
              // Decorative: the sr-only text below carries the meaning.
              aria-hidden="true"
            >
              {unread > 99 ? '99+' : unread}
            </span>
            <span className="sr-only">{unread} unread</span>
          </>
        )}
      </Link>
    </li>
  )
}

import Link from 'next/link'
import { SignOutButton } from '@/components/SignOutButton'

/**
 * Navigation for the member area.
 *
 * Server-rendered. The unread count comes from the layout, which already has to
 * know who the user is — see the note there about what that costs.
 */
// No 'Dashboard' entry: the wordmark is the home link, which is the
// convention everywhere else and frees a slot in a nav that has to stay short
// on a phone.
const LINKS = [
  { href: '/sessions',      label: 'Bookings' },
  { href: '/availability',  label: 'Availability', providerOnly: true },
  { href: '/messages',      label: 'Messages', badgeKey: 'unread' as const },
  { href: '/notifications', label: 'Notifications' },
]

export function AppNav({ unread = 0, isProvider = false }: { unread?: number; isProvider?: boolean }) {
  return (
    <header className="border-b border-hairline bg-white">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-1 px-4 py-3 sm:px-6">
        <Link
          href="/dashboard"
          className="mr-3 font-display text-lg text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          Dashboard
        </Link>

        <ul className="flex flex-1 flex-wrap items-center gap-1">
          {LINKS.filter(l => !l.providerOnly || isProvider).map(({ href, label, badgeKey }) => (
            <li key={href}>
              <Link
                href={href}
                className="inline-flex min-h-11 items-center gap-2 rounded-[999px] px-3 text-sm font-bold text-muted transition-colors hover:bg-soft-pink hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
              >
                {label}
                {badgeKey === 'unread' && unread > 0 && (
                  <span
                    className="inline-flex min-w-5 items-center justify-center rounded-[999px] bg-rose px-1.5 py-0.5 text-xs font-bold text-white"
                    // The number is decorative; the label carries the meaning
                    // for anyone not looking at it.
                    aria-hidden="true"
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
                {badgeKey === 'unread' && unread > 0 && (
                  <span className="sr-only">{unread} unread</span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        <SignOutButton />
      </nav>
    </header>
  )
}

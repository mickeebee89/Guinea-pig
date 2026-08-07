import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/lib/site'

const LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/community', label: 'Community Guidelines' },
  { href: '/delete-account', label: 'Request account deletion' },
]

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-hairline">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex min-h-11 items-center rounded-sm text-muted transition-colors hover:text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex min-h-11 items-center break-all rounded-sm text-muted transition-colors hover:text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
              >
                {SUPPORT_EMAIL}
              </a>
            </li>
          </ul>
        </nav>

        {/* Required by CLAUDE.md on any surface carrying company details. */}
        <p className="mt-6 max-w-2xl text-xs leading-relaxed text-muted">
          Cavy is a trading name of Guinea Pig App Ltd, registered in England &amp; Wales, company
          no. 17272796. Registered address: 75 Aintree Road, Chatham, Kent, ME5 8PQ. Registered
          with the ICO under reference ZC196530.
        </p>
      </div>
    </footer>
  )
}

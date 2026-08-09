import Link from 'next/link'

/**
 * Minimal chrome for the auth screens.
 *
 * Deliberately NOT SiteHeader: "For stylists / For models" are pitches to
 * people deciding whether to join, and someone on the sign-in page has already
 * decided. But they still need a way back out, which they lost when the header
 * moved from the root layout into (public) — so this is the wordmark and
 * nothing else.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-4 py-5 sm:px-6">
        <Link
          href="/"
          className="font-display text-2xl text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          Cavy
        </Link>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

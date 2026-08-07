import Link from 'next/link'
import type { Metadata } from 'next'
import { TREATMENTS } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

/**
 * A real 404. The framework default renders unstyled black-on-white inside our
 * own header and footer, which reads as a broken page rather than a missing
 * one. It also matters for SEO: /[treatment] has dynamicParams = false, so
 * every mistyped treatment slug lands here and should be a proper 404 with
 * somewhere to go next, not a dead end.
 */
export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-20 text-center sm:py-28">
      <p className="font-display text-6xl text-rose/30">404</p>
      <h1 className="mt-3 font-display text-3xl text-warm-dark sm:text-4xl">
        That page doesn’t exist
      </h1>
      <p className="mt-4 text-warm-dark/80">
        The link may be out of date, or the address slightly off. Here’s where most people are
        heading.
      </p>

      <ul className="mt-8 flex flex-wrap justify-center gap-2">
        {TREATMENTS.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/${t.slug}`}
              className="flex min-h-11 items-center rounded-[999px] bg-soft-pink px-4 text-sm font-bold text-rose transition-colors hover:bg-rose hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
            >
              {t.category}
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href="/"
        className="mt-8 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
      >
        Back to the homepage
      </Link>
    </section>
  )
}

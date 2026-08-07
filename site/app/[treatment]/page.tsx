import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RoleGate } from '@/components/RoleGate'
import { StylistCard } from '@/components/StylistCard'
import { countByCategory, stylistsByCategory } from '@/lib/stylists'
import { SITE_URL, TREATMENTS, getTreatment } from '@/lib/site'

export const revalidate = 900

/**
 * Root-level dynamic segment. Safe alongside /terms, /privacy, /for-stylists
 * and the rest because the App Router matches static segments before dynamic
 * ones — a literal folder always wins. `dynamicParams = false` then means only
 * the six known slugs resolve and anything else is a real 404, so this route
 * can never become a catch-all that swallows typos and soft-404s them.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return TREATMENTS.map((t) => ({ treatment: t.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ treatment: string }>
}): Promise<Metadata> {
  const t = getTreatment((await params).treatment)
  if (!t) return {}
  return {
    title: `${t.category} models wanted`,
    description: t.summary,
    alternates: { canonical: `/${t.slug}` },
    openGraph: {
      title: `${t.category} models wanted · Cavy`,
      description: t.summary,
      url: `${SITE_URL}/${t.slug}`,
    },
  }
}

export default async function TreatmentPage({
  params,
}: {
  params: Promise<{ treatment: string }>
}) {
  const t = getTreatment((await params).treatment)
  if (!t) notFound()

  const [stylists, count] = await Promise.all([
    stylistsByCategory(t.dbSlug),
    countByCategory(t.dbSlug),
  ])

  const others = TREATMENTS.filter((o) => o.slug !== t.slug)

  return (
    <>
      {/* Breadcrumbs are a real hierarchy here, so the markup is honest. No
          AggregateRating or ItemList is emitted — there is nothing to describe
          yet, and inventing structured data is how you lose rich results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Cavy', item: SITE_URL },
              {
                '@type': 'ListItem',
                position: 2,
                name: `${t.category} models`,
                item: `${SITE_URL}/${t.slug}`,
              },
            ],
          }),
        }}
      />

      <nav aria-label="Breadcrumb" className="mx-auto flex max-w-3xl items-center px-6 pt-6 text-sm">
        {/* Negative margin keeps the 44px tap target from changing how the
            breadcrumb looks. */}
        <Link
          href="/"
          className="-my-2 inline-flex min-h-11 items-center rounded-sm text-muted transition-colors hover:text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          Cavy
        </Link>
        <span aria-hidden className="px-2 text-muted/50">
          /
        </span>
        <span className="text-warm-dark">{t.category} models</span>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pb-8 pt-6">
        <h1 className="font-display text-4xl leading-tight text-warm-dark sm:text-5xl">
          {t.category} models wanted
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-warm-dark/80">{t.summary}</p>
        <p className="mt-4 text-sm text-muted">
          {count > 0
            ? `${count} ${count === 1 ? 'stylist is' : 'stylists are'} offering ${t.category.toLowerCase()} on Cavy.`
            : 'Cavy hasn’t launched yet — join the waitlist and we’ll email you when stylists near you start looking.'}
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-6">
        <h2 className="font-display text-2xl text-warm-dark">Why stylists need {t.noun}</h2>
        <p className="mt-3 text-warm-dark/80">{t.why}</p>

        <h2 className="mt-10 font-display text-2xl text-warm-dark">What you’re agreeing to</h2>
        <p className="mt-3 text-warm-dark/80">{t.expect}</p>

        {t.patchTest && (
          <div className="mt-6 rounded-lg border border-rose/25 bg-input-bg p-5">
            <h3 className="font-display text-lg text-warm-dark">Patch test</h3>
            <p className="mt-2 text-sm text-warm-dark/80">{t.patchTest}</p>
          </div>
        )}
      </section>

      {stylists.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 py-10">
          <h2 className="font-display text-2xl text-warm-dark">
            Stylists offering {t.category.toLowerCase()}
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stylists.map((s) => (
              <StylistCard key={s.id} stylist={s} />
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-6 py-10">
        <RoleGate />
      </section>

      <section className="border-t border-hairline">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h2 className="font-display text-xl text-warm-dark">Other treatments</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map((o) => (
              <li key={o.slug}>
                <Link
                  href={`/${o.slug}`}
                  className="flex min-h-11 items-center rounded-[999px] bg-soft-pink px-4 text-sm font-bold text-rose transition-colors hover:bg-rose hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                >
                  {o.category}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}

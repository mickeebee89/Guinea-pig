import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RoleGate } from '@/components/RoleGate'
import { StylistCard } from '@/components/StylistCard'
import { countByCategory, stylistsByCategory } from '@/lib/stylists'
import { SITE_URL, TREATMENTS, getTreatment, MIN_STYLISTS_TO_INDEX } from '@/lib/site'

export const revalidate = 900

/**
 * Root-level dynamic segment. Safe alongside /terms, /privacy, /for-stylists
 * and the rest because the App Router matches static segments before dynamic
 * ones — a literal folder always wins. `dynamicParams = false` then means only
 * the slugs in TREATMENTS resolve and anything else is a real 404, so this route
 * can never become a catch-all that swallows typos and soft-404s them.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return TREATMENTS.map((t) => ({ treatment: t.slug }))
}

/**
 * ⚠️ EVERY HEADING THAT BOLTS "models" ONTO A NAME USES `noun`, NOT `category`.
 *
 * `category` is the stored `treatment_categories.name`, and four of the nine
 * are plural — Nails, Lashes, Brows, Facials. `${t.category} models wanted`
 * therefore shipped "Nails models wanted", "Lashes models wanted" and "Brows
 * models wanted" to the live site, in the H1, the <title>, the OG title, the
 * breadcrumb and the structured data. Facials made it four; it did not cause
 * it. Corrected 3 Nov 2026.
 *
 * `noun` has existed for exactly this since the array was written ("hair
 * models", "nail models", "lash models") and already read correctly in the
 * one place that used it. It is lowercase because it also appears mid-sentence
 * — "Why stylists need nail models" — so the five heading positions capitalise
 * it here rather than a tenth field carrying the same words in title case.
 *
 * ⚠️ THE LOWERCASE `category` USES ARE CORRECT AND STAY. "No one is offering
 * nails on Cavy yet" and "Stylists offering nails" want the plural, because
 * there the word is the treatment and not the person.
 *
 * Not `text-transform: capitalize`: it cannot reach <title>, the OG title or
 * the JSON-LD, and those are three of the five.
 */
const heading = (noun: string) => noun.charAt(0).toUpperCase() + noun.slice(1)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ treatment: string }>
}): Promise<Metadata> {
  const t = getTreatment((await params).treatment)
  if (!t) return {}

  // ⚠️ THE PAGE DECIDES FOR ITSELF (item 114). Below the threshold it renders
  // normally for a person and asks not to be ranked. `follow` stays true: the
  // page is thin, not untrustworthy, and its links should still be crawled.
  //
  // The SITEMAP uses the same count and the same constant — a sitemap that
  // lists a noindexed page is a site contradicting itself, and the two living
  // in different files is how that happens.
  const count = await countByCategory(t.dbSlug)
  const thin = count < MIN_STYLISTS_TO_INDEX

  return {
    title: `${heading(t.noun)} wanted`,
    description: t.summary,
    alternates: { canonical: `/${t.slug}` },
    ...(thin ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: `${heading(t.noun)} wanted · Cavy`,
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
                name: heading(t.noun),
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
        <span className="text-warm-dark">{heading(t.noun)}</span>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pb-8 pt-6">
        <h1 className="font-display text-4xl leading-tight text-warm-dark sm:text-5xl">
          {heading(t.noun)} wanted
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-warm-dark/80">{t.summary}</p>
        <p className="mt-4 text-sm text-muted">
          {count > 0
            ? `${count} ${count === 1 ? 'stylist is' : 'stylists are'} offering ${t.category.toLowerCase()} on Cavy.`
            : `No one is offering ${t.category.toLowerCase()} on Cavy yet. Sign up below and you’ll see stylists here as they join.`}
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

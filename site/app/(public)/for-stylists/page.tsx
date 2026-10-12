import type { Metadata } from 'next'
import Link from 'next/link'
import { RoleGate } from '@/components/RoleGate'

export const metadata: Metadata = {
  title: 'For stylists',
  description:
    'Build your portfolio on real people. Find models near you who want the treatment, agree it in chat, and keep the photos.',
  alternates: { canonical: '/for-stylists' },
}

const POINTS = [
  {
    title: 'Practise on real people',
    body: 'Mannequin heads only take you so far. Cavy puts you in front of people who actually want the treatment you need to practise.',
  },
  {
    title: 'Keep the photos',
    body: 'Most stylists are here to build a book. Agree the photos in chat before the appointment and the work is yours to post.',
  },
  {
    title: 'Everyone does the ID check',
    // Was "Every member completes identity verification". No document is
    // requested, seen or kept — a person compares a selfie holding a
    // handwritten note against the profile photo. Describing that as identity
    // verification invites someone to accept a risk on the strength of a check
    // that did not happen. See app/(app)/verify/page.tsx for the rule.
    body: 'Every member sends a selfie holding their name on a piece of paper, and a person checks it against their profile photo before they can offer or apply for treatments. It’s not an ID document check — but it means there’s a real person behind the profile and the photo isn’t lifted from somewhere else.',
  },
  {
    title: 'You set the terms',
    body: 'You decide what you’re practising, when you’re free, and whether it’s free or discounted. Cavy doesn’t take a cut of the treatment.',
  },
]

/**
 * ⚠⚠ IT READS `?ref=` AND FORWARDS IT, AND THAT IS NOT A CONVENIENCE.
 *
 * Founding Provider status comes from `signup_source`, which only exists if
 * `?ref=` survives all the way to /sign-up: site/lib/signup.ts reads it,
 * handle_new_auth_user (0011) grants Founding to a stylist whose source is
 * non-empty while places remain. **Any non-empty value qualifies — there is no
 * code list.**
 *
 * Until 12 Oct 2026 this page took no searchParams at all and its CTA was the
 * fixed string `/sign-up?role=stylist`. So a QR code or printed card pointing at
 * `/for-stylists?ref=…` **silently dropped the ref on the click**, and the
 * visitor got a standard account — while the paragraph below told them signing
 * up through their invite link would make them a Founding Provider. The copy and
 * this forwarding are one change: either alone is a lie or a dead parameter.
 *
 * ⚠️ ONE PARAMETER, AND ONLY THE ONE THAT DOES SOMETHING. role is already fixed
 * to `stylist` by this page's whole purpose, so it is not read from the URL —
 * forwarding it would let a link on the stylist page send somebody to the model
 * form. Anything else in the query string is dropped.
 *
 * ⚠️ encodeURIComponent, because the value reaches an href. It is trimmed and
 * capped at the same 120 characters /sign-up applies, so a link that is too long
 * fails the same way in both places rather than only at the far end.
 */
export default async function ForStylists({
  // ⚠⚠ READING searchParams MAKES THIS ROUTE DYNAMIC, AND THAT IS THE POINT.
  // The href must be correct in the INITIAL HTML. A client-side read
  // (useSearchParams in the CTA) would keep the page static but leave the link
  // without its ref until hydration — so a fast click, or a visitor with no JS,
  // would land on /sign-up with no source and get a standard account. That is
  // precisely the failure this change exists to fix, so trading the static
  // prerender for a correct first byte is the right way round.
  //
  // ⚠️ AND THIS IS THE FIRST PUBLIC ROUTE TO LEAVE THE STATIC SET. Measured
  // 12 Oct 2026: every other marketing page is prerendered — /, /[treatment],
  // /community, /delete-account, /for-models, /how-it-works, /privacy, /terms.
  // **/for-models is this page's direct sibling and is still static.** So do not
  // read this as the new normal: it is one page paying for one guarantee, and
  // the next public page that wants searchParams needs its own reason.
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const { ref } = await searchParams
  const source = ref?.trim().slice(0, 120)
  const signUpHref = source
    ? `/sign-up?role=stylist&ref=${encodeURIComponent(source)}`
    : '/sign-up?role=stylist'

  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-8 pt-14 sm:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose">For stylists</p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-warm-dark sm:text-5xl">
          You need people to practise on.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-warm-dark/80">
          Cavy connects you with models who want hair and beauty treatments free or discounted,
          because you’re building your portfolio. You practise, they glow, and you both agreed the
          terms before anyone turned up.
        </p>
        <p className="mt-4 rounded-md border border-hairline bg-white p-4 text-sm text-warm-dark/80">
          {/* Until 22 Sep 2026: "Join the waitlist as a stylist and you'll get the
              free early-stylist account when we launch."
              ⚠️ And until 12 Oct 2026: "If you joined our waitlist before launch,
              use the sign-up link we email you: it makes you a Founding Provider,
              with no verification fee." NO SUCH EMAIL WAS EVER GOING TO ARRIVE —
              the waitlist belonged to the old Guinea Pig App brand, was never
              carried over to Cavy, and its form, route and rate limiter went on
              22 Sep 2026 (audit item 71); the table was deleted 12 Oct 2026.
              What replaces it describes the mechanism that actually exists: an
              invite link, £14.99 waived, 200 places. Terms section 5. */}
          <strong className="font-bold text-warm-dark">Cavy is open.</strong>{' '}
          <Link href={signUpHref} className="text-rose underline decoration-rose/30 underline-offset-2">
            Sign up as a stylist
          </Link>{' '}
          to set up your shop. If you’ve been given an invite link, sign up through it: that makes
          you a Founding Provider, so you won’t pay the £14.99 verification fee. Places are limited
          to the first 200. The full terms are in{' '}
          <Link href="/terms#5" className="text-rose underline decoration-rose/30 underline-offset-2">
            section 5
          </Link>
          .
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-8">
        <ul className="grid gap-8 sm:grid-cols-2">
          {POINTS.map((p) => (
            <li key={p.title}>
              <h2 className="font-display text-xl text-warm-dark">{p.title}</h2>
              <p className="mt-2 text-muted">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12">
        <RoleGate />
      </section>
    </>
  )
}

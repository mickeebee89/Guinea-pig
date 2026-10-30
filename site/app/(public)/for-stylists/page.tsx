import type { Metadata } from 'next'
import Link from 'next/link'
import { PILL_PRIMARY_CONTROL } from '@/components/buttons'

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
    // ⚠️ THE TURNAROUND IS THE POINT FOR A STYLIST READING THIS. She signs up,
    // uploads a selfie, and then waits — and until 30 Oct 2026 nothing on this
    // page told her a human was looking or roughly when. With zero bookable
    // slots on the platform, that wait is her entire first experience.
    // "usually within 24 hours" is the same promise StylistSetup.tsx already
    // makes her once she is inside; saying it before she signs up costs us
    // nothing and is the difference between a wait and an abandonment.
    body: 'Every member sends a selfie holding their name on a piece of paper, and a real person — one of us, not software — checks it against their profile photo before they can offer or apply for treatments. It’s usually done within 24 hours, and you’ll get an email either way. It’s not an ID document check — but it means there’s a real person behind the profile and the photo isn’t lifted from somewhere else.',
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
        {/* ⚠️ THE PAGE HAD NO BUTTON UNTIL 30 Oct 2026 — only the text link
            inside the box below, and a RoleGate at the very bottom asking a
            visitor who had already picked a side to pick one again. A stylist
            who read the first paragraph and was convinced had nothing to click
            without reading on.

            ⚠️ signUpHref, NEVER the literal '/sign-up?role=stylist'. This
            route is dynamic precisely so the ?ref= is already in this href in
            the first byte of HTML; a hardcoded string here would drop it on
            the most likely click on the page. Same rule for the closing CTA. */}
        <div className="mt-7">
          <Link href={signUpHref} className={PILL_PRIMARY_CONTROL}>
            Sign up as a stylist
            {/* Matches RoleGate's pill, but hidden from screen readers: the
                accessible name should be the label, not "right arrow". */}
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
        </div>
        <p className="mt-4 rounded-md border border-hairline bg-white p-4 text-sm text-warm-dark/80">
          {/* Until 22 Sep 2026: "Join the waitlist as a stylist and you'll get the
              free early-stylist account when we launch."
              ⚠️ And until 12 Oct 2026: "If you joined our waitlist before launch,
              use the sign-up link we email you: it makes you a Founding Provider,
              with no verification fee." NO SUCH EMAIL WAS EVER GOING TO ARRIVE —
              the waitlist belonged to the old Guinea Pig App brand, was never
              carried over to Cavy, and its form, route and rate limiter went on
              22 Sep 2026 (audit item 71); the table was deleted 12 Oct 2026.
              What replaced it described an invite link, £14.99 waived, 200
              places.
              ⚠️⚠️ AND THAT WENT ON 23 Oct 2026 (migration 0102): the stylist
              verification fee is switched off, so "£14.99 waived" and "200
              places" both describe a benefit against a charge nobody is asked
              for. The invite link still works and still records where a signup
              came from — it is simply no longer a discount, because there is
              nothing to discount.
              ⚠️ THE SENTENCE HAS TO SURVIVE BEING READ BY A COLLEGE. "We ask
              nothing of your students" must be true with no footnote, so there
              is no "free for now", no tranche and no cap. */}
          <strong className="font-bold text-warm-dark">Cavy is open, and it’s free for stylists.</strong>{' '}
          <Link href={signUpHref} className="text-rose underline decoration-rose/30 underline-offset-2">
            Sign up as a stylist
          </Link>{' '}
          to set up your shop. There’s no sign-up fee, no verification fee and no subscription —
          we don’t charge stylists anything. Before your shop goes live you’ll send a selfie for
          one of us to check by hand, which usually takes under 24 hours. The full terms are in{' '}
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

      {/* ⚠️ A CLOSING CTA, NOT <RoleGate />. RoleGate asks "stylist or
          model?" — the right question on /, /how-it-works and /[treatment],
          and a step backwards here, where the visitor answered it by arriving.
          It also sent them to a fixed /sign-up?role=stylist with no ?ref=, so
          the page's own forwarding was undone by its biggest link.

          Both other routes are kept as quiet text rather than dropped: someone
          who read this page and decided they are the model, not the stylist,
          still needs the door. /for-models keeps the full RoleGate — it has
          the same shape as this page did and is deliberately unchanged for
          now. */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-lg border border-hairline bg-white p-6 text-center sm:p-8">
          <p className="font-display text-2xl leading-snug text-warm-dark sm:text-[1.75rem]">
            Set up your shop and start practising.
          </p>
          <p className="mx-auto mt-3 max-w-md text-muted">
            It’s free for stylists, and you decide what you’re practising, when you’re free and
            what it costs.
          </p>
          <Link href={signUpHref} className={`mt-6 ${PILL_PRIMARY_CONTROL}`}>
            Sign up as a stylist
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
          <p className="mt-6 text-sm text-muted">
            Looking for treatments instead?{' '}
            <Link href="/for-models" className="text-rose underline decoration-rose/30 underline-offset-2">
              For models
            </Link>
            . Already have an account?{' '}
            <Link href="/sign-in" className="font-bold text-rose underline decoration-rose/30 underline-offset-2">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </>
  )
}

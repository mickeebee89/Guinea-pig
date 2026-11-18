import type { Metadata } from 'next'
import Link from 'next/link'
import { RoleGate } from '@/components/RoleGate'

export const metadata: Metadata = {
  title: 'For models',
  description:
    // ⚠️ "verified stylists" dropped — see the note in the first POINT below.
    // This one is the meta description, so it is also what a search result
    // shows: the last place to make a safety claim the product cannot keep.
    'Get hair and beauty treatments free or discounted from stylists building their portfolios. No experience needed.',
  alternates: { canonical: '/for-models' },
}

const POINTS = [
  {
    title: 'You don’t need experience',
    // ⚠️⚠️ "you qualify" WAS TRUE OF BROWSING AND FALSE OF APPLYING. She
    // qualifies to look round for nothing. To apply she needs the £4.99/month
    // membership AND a selfie a person has approved, and this page named
    // neither until 30 Oct 2026. Browsing being free is the strongest thing on
    // the page, so it is said first rather than used to hide the rest.
    // ── ⚠️⚠️ REWRITTEN 18 Nov 2026: THE GATES WERE SWITCHED OFF ───────
    // `subscription_enabled`, `verification_required_to_apply` and
    // `verification_required_to_publish` are all false in `settings`, so every
    // sentence naming one of them as a condition stopped being true.
    //
    // ⚠⚠ THIS PAGE IS NOT FLAG-AWARE AND MUST NOT BECOME SO. It is a
    // statically prerendered `(public)` route — adding a database read would
    // make it dynamic and `scripts/check-client-boundary.mjs` would have to
    // catch it, which is a worse trade than wording the page so it is true
    // either way. Marketing copy that silently changes with a settings row is
    // also harder to be honest about than copy that simply does not claim.
    //
    // ⚠️ SO THE CLAIMS ARE DROPPED, NOT INVERTED. Nothing here now says a
    // check or a payment IS required, and nothing says it never will be —
    // which is what lets the flags move again without this page lying in the
    // other direction.
    //
    // ⚠️ THE OLD SENTENCE NAMED BOTH GATES, correctly, when both were on.
    // Neither is asked now. "Browsing is free" became too weak rather than too
    // strong — applying is free as well — and a page that still warns about a
    // £4.99 membership is costing signups for a charge nobody makes.
    body: 'You’re not modelling. You’re the person in the chair. If you’re 18 or over and happy to sit for a treatment, you’re who stylists are looking for. Browsing and applying are both free at the moment — you just need an account.',
  },
  {
    title: 'The price is on the slot, before you apply',
    // ⚠️ "often nothing" DESCRIBED NOTHING. Measured 30 Oct 2026: one real
    // stylist has ever posted one slot, and there are zero bookable slots
    // today. "Often" is a frequency claim over a sample of one. What IS true
    // is how the pricing works, so the sentence now describes the mechanism
    // rather than a pattern that has not happened yet.
    body: 'Stylists set a price on each time they offer, and most are practising, so it is usually free or heavily discounted. You see the price before you apply, and you agree the details with them in the chat.',
  },
  {
    title: 'You choose who',
    // ⚠️⚠️ "read what other models said about them" CUT 30 Oct 2026. There
    // are ZERO reviews in the database — not few, none — so this invited a
    // visitor to look for something that is not on any page yet. Reviews are
    // built and do work; the sentence comes back when there are some.
    // ⚠️ "verified stylists" dropped, same reason as the meta above: an
    // unverified shop can be live, so this described the list wrongly.
    body: 'Browse stylists near you, see what they’re practising and where they are, and only apply to the ones you like.',
  },
  {
    title: 'You can say no to photos',
    body: 'Most stylists want to photograph their work. That’s usually why the treatment is free. It’s still your call, and worth settling in chat first.',
  },
]

export default function ForModels() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-8 pt-14 sm:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose">For models</p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-warm-dark sm:text-5xl">
          You want the treatment.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-warm-dark/80">
          Stylists building their portfolios need people to practise on, and they’d rather it was
          someone who actually wants the result. That’s the whole swap: they get the practice, you
          get the hair, lashes, brows, nails or makeup.
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
        <p className="mt-8 text-sm text-muted">
          Meeting someone new? Read the{' '}
          <Link
            href="/community"
            className="text-rose underline decoration-rose/30 underline-offset-2"
          >
            Community Guidelines
          </Link>{' '}
          before your first appointment — the safety section is short and worth two minutes.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12">
        <RoleGate />
      </section>
    </>
  )
}

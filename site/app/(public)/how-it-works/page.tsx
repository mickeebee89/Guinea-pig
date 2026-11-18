import type { Metadata } from 'next'
import Link from 'next/link'
import { RoleGate } from '@/components/RoleGate'

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'What a Cavy treatment actually involves — how you find each other, what it costs, and what stylists usually ask for in return.',
  alternates: { canonical: '/how-it-works' },
}

const STEPS = [
  {
    n: '1',
    title: 'Find each other',
    // ⚠️ "verified stylists" DROPPED. With
    // `verification_required_to_publish` false, a shop can be live and
    // bookable without a passed ID check, so "verified stylists" described
    // the list as something it is not. The badge still exists and still shows
    // on the stylists who have one — which is the honest version of this
    // claim, and it belongs on the card rather than in a blanket sentence.
    body: 'Models browse stylists nearby and see which treatments they’re practising. Stylists set their availability and say when they’re looking.',
  },
  {
    n: '2',
    title: 'Apply, and get accepted',
    // ⚠️⚠️ THE MEMBERSHIP AND THE CHECK BELONG HERE, NOT IN A FOOTNOTE. The
    // H1 above promises no surprises, and until 30 Oct 2026 this step described
    // applying without mentioning that a model needs a paid membership and a
    // passed account check before she can do it. Those were the surprise.
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
    // ⚠️ IT NAMED BOTH GATES, WHICH WAS RIGHT WHEN BOTH WERE ON. Neither is
    // asked today: `model_may_apply` and `tg_session_apply_gate` both read the
    // flags and let an unverified, unsubscribed model straight through. A
    // visitor reading this would have expected two obstacles that are not
    // there — the same surprise this sentence was written to remove, pointing
    // the other way.
    body: 'Browsing and applying are both free at the moment. A model applies for a specific slot and the stylist decides who to take. Nobody is matched automatically and nobody is obliged to accept.',
  },
  {
    n: '3',
    title: 'Agree the details in chat',
    body: 'What the treatment involves, how long it takes, where it happens, whether there’s a cost, and whether photos are being taken. All before anyone travels.',
  },
  {
    n: '4',
    title: 'Turn up',
    body: 'The treatment happens in person, between the two of you. Afterwards you can each leave a review.',
  },
]

export default function HowItWorks() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-8 pt-14 sm:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose">How it works</p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-warm-dark sm:text-5xl">
          Four steps, and no surprises
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-warm-dark/80">
          Cavy introduces stylists and models. The treatment itself is arranged and carried out
          directly between the two of you, in person.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-4">
        <ol className="space-y-8">
          {STEPS.map((step) => (
            <li key={step.n} className="sm:grid sm:grid-cols-[3.5rem_1fr] sm:gap-x-4">
              <span className="font-display text-3xl leading-none text-rose/40 sm:pt-1 sm:text-right">
                {step.n}
              </span>
              <div>
                <h2 className="font-display text-xl text-warm-dark">{step.title}</h2>
                <p className="mt-2 text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-lg border border-hairline bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
          <h2 className="font-display text-2xl text-warm-dark">What it costs</h2>
          {/* Verbatim from the app's shop page, so the website and the app tell
              people exactly the same thing about money and photos. */}
          <p className="mt-3 text-warm-dark/80">
            Any cost is agreed directly with your stylist in the chat and paid in person. Cavy
            doesn’t handle payments for treatments.
          </p>
          <p className="mt-3 text-warm-dark/80">
            Most stylists are building a portfolio and will ask to photograph their work — that’s
            usually why a treatment is free or discounted. It’s your choice, and worth agreeing in
            the chat first.
          </p>
          {/* ⚠️⚠️ "and a one-off verification fee for stylists" UNTIL 30 Oct 2026,
              AND IT WAS THE WORST-PLACED ERROR ON THE SITE. provider_fee_enabled()
              reads false (0102, 23 Oct) — measured, not assumed — so it
              contradicted for-stylists ("no verification fee") and Terms §5, and
              the homepage links HERE labelled "What it costs". A trainee stylist
              following the money link read that she owed £14.99, then clicked
              through to /terms#9, which no longer mentions a stylist fee at all.
              ⚠️ THE #9 LINK IS STILL RIGHT: §9 is where the MEMBERSHIP's refund
              terms live, and that is now the only thing this paragraph claims. */}
          <p className="mt-5 text-sm text-muted">
            {/* ⚠️ WAS "Cavy itself has one paid feature: a monthly membership
                for models". `subscription_enabled` is false, so there is no
                paid feature at all right now — and this paragraph sits under a
                heading about money, which is the one place a visitor is
                entitled to a straight answer. "at the moment" is doing real
                work: it is true today and does not promise it is permanent. */}
            Cavy isn’t charging anyone at the moment — no sign-up fee, no verification fee and
            no subscription, for models or for stylists. If that changes, the price is always
            shown before you pay, and the refund terms are in{' '}
            <Link
              href="/terms#9"
              className="text-rose underline decoration-rose/30 underline-offset-2"
            >
              section 9
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-12">
        <RoleGate />
      </section>
    </>
  )
}

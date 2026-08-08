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
    body: 'Models browse verified stylists nearby and see which treatments they’re practising. Stylists set their availability and say when they’re looking.',
  },
  {
    n: '2',
    title: 'Apply, and get accepted',
    body: 'Models apply for a specific slot. The stylist decides who to take. Nobody is matched automatically and nobody is obliged to accept.',
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
          <p className="mt-5 text-sm text-muted">
            Cavy itself has paid features — a membership for models and a one-off verification fee
            for stylists. Prices are always shown before you pay, and the refund terms are in{' '}
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

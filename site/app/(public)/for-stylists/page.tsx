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
    title: 'Everyone is verified',
    body: 'Every member completes identity verification before they can offer or apply for treatments, so you know who you’re meeting.',
  },
  {
    title: 'You set the terms',
    body: 'You decide what you’re practising, when you’re free, and whether it’s free or discounted. Cavy doesn’t take a cut of the treatment.',
  },
]

export default function ForStylists() {
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
          <strong className="font-bold text-warm-dark">Join the waitlist as a stylist</strong> and
          you’ll get the free early-stylist account when we launch. Details are confirmed at launch
          and it’s subject to availability — the full terms are in{' '}
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

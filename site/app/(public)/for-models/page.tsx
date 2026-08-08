import type { Metadata } from 'next'
import Link from 'next/link'
import { RoleGate } from '@/components/RoleGate'

export const metadata: Metadata = {
  title: 'For models',
  description:
    'Get hair and beauty treatments free or discounted from verified stylists building their portfolios. No experience needed.',
  alternates: { canonical: '/for-models' },
}

const POINTS = [
  {
    title: 'You don’t need experience',
    body: 'You’re not modelling. You’re the person in the chair. If you’re 18 or over and happy to sit for a treatment, you qualify.',
  },
  {
    title: 'Free or discounted, agreed up front',
    body: 'The stylist tells you what the treatment involves and what it costs — usually nothing — in the chat, before you commit.',
  },
  {
    title: 'You choose who',
    body: 'Browse verified stylists near you, read what other models said about them, and only apply to the ones you like.',
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

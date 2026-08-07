import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { FeaturedStylists } from '@/components/FeaturedStylists'
import { RoleGate } from '@/components/RoleGate'
import { SITE_TAGLINE } from '@/lib/site'

export const revalidate = 3600

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  description:
    'Stylists need people to practise on. Models want the treatment without the salon price. Cavy is the swap — join the UK waitlist.',
}

// A real sequence, so numbering it is honest. If these were three unordered
// benefits they would not be numbered.
const STEPS = [
  {
    n: '1',
    title: 'Find each other',
    body: 'Models browse verified stylists nearby and see what they’re practising. Stylists post when they need someone.',
  },
  {
    n: '2',
    title: 'Agree it in chat',
    body: 'Sort out what the treatment involves, when, where, and what — if anything — it costs. All inside the app.',
  },
  {
    n: '3',
    title: 'Turn up and glow',
    body: 'The stylist gets the practice and the photos for their portfolio. You get the treatment.',
  },
]

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-4 pt-14 text-center sm:pt-20">
        {/* Mascot and wordmark share one pink disc so they read as a single
            lockup rather than an icon with a caption. The h1 lives inside the
            circle, so the page still has exactly one top-level heading and the
            image stays decorative (alt=""). */}
        <div className="mx-auto grid size-44 place-items-center rounded-full bg-soft-pink sm:size-52">
          <div className="flex flex-col items-center">
            <Image
              src="/guinea-pig-logo.png"
              alt=""
              width={208}
              height={208}
              priority
              className="size-20 object-contain sm:size-24"
            />
            <h1 className="-mt-1 font-display text-4xl leading-none text-rose sm:text-5xl">
              Cavy
            </h1>
          </div>
        </div>

        <p className="mt-5 font-display text-xl text-warm-dark sm:text-2xl">{SITE_TAGLINE}</p>

        <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-warm-dark/80">
          Stylists need people to practise on. Models want the treatment without the salon price.
          Cavy is the swap.
        </p>

        <p className="mt-4 text-sm font-bold uppercase tracking-[0.16em] text-rose">
          Launching soon in the UK
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <RoleGate />
      </section>

      <section className="border-y border-hairline bg-white/60">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-display text-3xl text-warm-dark">How it works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n}>
                <span className="font-display text-4xl text-rose/30">{step.n}</span>
                <h3 className="mt-1 font-display text-xl text-warm-dark">{step.title}</h3>
                <p className="mt-2 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <Link
            href="/how-it-works"
            className="mt-6 inline-flex min-h-11 items-center font-bold text-rose underline decoration-rose/30 underline-offset-4 hover:decoration-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
          >
            What it costs, and what stylists ask for
          </Link>
        </div>
      </section>

      {/* Renders nothing until there are published stylists. */}
      <FeaturedStylists />
    </>
  )
}

import Link from 'next/link'

/**
 * The two-sided choice IS the hero.
 *
 * Cavy is a swap: a stylist needs someone to practise on, a model wants the
 * treatment without the salon price. So the page opens on the two
 * sides meeting rather than on a headline about them — and it mirrors the app's
 * own first screen (WelcomeScreen's "I want to be a…"), so the web and the app
 * ask the same question in the same words.
 *
 * ── SIGN-UP, NOT A WAITLIST, SINCE 22 Sep 2026 (audit item 71) ───────────
 * Until then each side opened a waitlist form (WaitlistForm, /api/waitlist),
 * because Cavy hadn't launched. It has, so each side is now a link to the real
 * sign-up with the role already chosen: /sign-up?role=stylist or
 * /sign-up?role=model (sign-up/page.tsx reads ?role). The waitlist form, its
 * API route and its rate limiter were removed with it.
 *
 * No default selection, still: the role is chosen by which side you tap.
 */

const PANELS: { role: 'stylist' | 'model'; label: string; deal: string; detail: string; cta: string }[] = [
  {
    role: 'stylist',
    label: 'I’m a stylist',
    deal: 'You need people to practise on.',
    detail: 'Build your portfolio on real heads and real faces, without paying model rates.',
    cta: 'Sign up as a stylist',
  },
  {
    role: 'model',
    label: 'I’m a model',
    deal: 'You want the treatment.',
    detail: 'Hair and beauty work, free or discounted, from stylists building their books.',
    cta: 'Sign up as a model',
  },
]

function Panel({ panel }: { panel: (typeof PANELS)[number] }) {
  return (
    <Link
      href={`/sign-up?role=${panel.role}`}
      className={[
        'block w-full rounded-lg border border-hairline bg-white p-5 text-left text-warm-dark transition-all sm:p-7',
        'hover:border-rose/40 hover:shadow-[var(--shadow-card)] sm:hover:-translate-y-0.5',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose',
      ].join(' ')}
    >
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-rose">{panel.label}</span>
      <span className="mt-2 block font-display text-[1.375rem] leading-snug sm:mt-3 sm:text-[1.75rem]">
        {panel.deal}
      </span>
      <span className="mt-2 block text-sm text-muted">{panel.detail}</span>
      <span className="mt-4 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white">
        {panel.cta} →
      </span>
    </Link>
  )
}

export function RoleGate() {
  return (
    <div>
      {/* Stacked on phones with the badge in the flow between the two cards;
          side by side from `sm` with the badge absolutely centred on the seam.
          The badge is a real element on mobile rather than a hidden one — it is
          the page's signature and most people will see this on a phone. */}
      <div className="relative grid gap-3 sm:grid-cols-2 sm:gap-6">
        <Panel panel={PANELS[0]} />

        {/* Reads "or", not "↔". A double-headed arrow between two stacked cards
            on a phone looks like a swipe affordance, and nothing slides. "or"
            says the true thing: these are alternatives, pick one. It also works
            unchanged when the cards sit side by side. */}
        <span
          aria-hidden
          className={[
            'z-10 mx-auto grid size-11 place-items-center rounded-full border border-hairline',
            'bg-cream font-display text-sm lowercase text-muted',
            'sm:pointer-events-none sm:absolute sm:left-1/2 sm:top-1/2 sm:size-12 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:text-base',
          ].join(' ')}
        >
          or
        </span>

        <Panel panel={PANELS[1]} />
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Pick a side to sign up. Already have an account?{' '}
        <Link href="/sign-in" className="font-bold text-rose underline decoration-rose/30 underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  )
}

'use client'

import { useRef, useState } from 'react'
import { WaitlistForm, type Role } from './WaitlistForm'

/**
 * The two-sided choice IS the hero.
 *
 * Cavy is a swap: a stylist needs someone to practise on, a model wants the
 * treatment without the salon price. So the page opens on the two
 * sides meeting rather than on a headline about them — and it mirrors the app's
 * own first screen (WelcomeScreen's "I want to be a…"), so the web and the app
 * ask the same question in the same words.
 *
 * No default selection. The role decides which launch email someone gets, so
 * it should be chosen, not inherited from whichever option we happened to
 * preselect.
 */

const PANELS: { role: Role; label: string; deal: string; detail: string }[] = [
  {
    role: 'stylist',
    label: 'I’m a stylist',
    deal: 'You need people to practise on.',
    detail: 'Build your portfolio on real heads and real faces, without paying model rates.',
  },
  {
    role: 'model',
    label: 'I’m a model',
    deal: 'You want the treatment.',
    detail: 'Hair and beauty work, free or discounted, from stylists building their books.',
  },
]

function Panel({
  panel,
  active,
  onChoose,
}: {
  panel: (typeof PANELS)[number]
  active: boolean
  onChoose: () => void
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={active}
      className={[
        'w-full rounded-lg border p-5 text-left transition-all sm:p-7',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose',
        active
          ? 'border-rose bg-rose text-white shadow-[var(--shadow-card)]'
          : 'border-hairline bg-white text-warm-dark hover:border-rose/40 hover:shadow-[var(--shadow-card)] sm:hover:-translate-y-0.5',
      ].join(' ')}
    >
      <span
        className={[
          'text-xs font-bold uppercase tracking-[0.16em]',
          active ? 'text-white/70' : 'text-rose',
        ].join(' ')}
      >
        {panel.label}
      </span>
      <span className="mt-2 block font-display text-[1.375rem] leading-snug sm:mt-3 sm:text-[1.75rem]">
        {panel.deal}
      </span>
      <span className={['mt-2 block text-sm', active ? 'text-white/85' : 'text-muted'].join(' ')}>
        {panel.detail}
      </span>
    </button>
  )
}

export function RoleGate() {
  const [role, setRole] = useState<Role | null>(null)
  const headingRef = useRef<HTMLDivElement>(null)

  function choose(next: Role) {
    setRole(next)
    window.requestAnimationFrame(() => {
      const form = headingRef.current
      if (!form) return
      // Scroll the form into view, but move focus to its HEADING rather than
      // its first input. Focusing an input would throw up the on-screen
      // keyboard the instant someone taps a role — which on a phone means the
      // page jumps and half the form is hidden before they've read it.
      // Focusing the heading still tells a screen reader where it has landed.
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      form.querySelector<HTMLElement>('[data-form-heading]')?.focus()
    })
  }

  return (
    <div>
      {/* Stacked on phones with the badge in the flow between the two cards;
          side by side from `sm` with the badge absolutely centred on the seam.
          The badge is a real element on mobile rather than a hidden one — it is
          the page's signature and most people will see this on a phone. */}
      <div className="relative grid gap-3 sm:grid-cols-2 sm:gap-6">
        <Panel panel={PANELS[0]} active={role === PANELS[0].role} onChoose={() => choose(PANELS[0].role)} />

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

        <Panel panel={PANELS[1]} active={role === PANELS[1].role} onChoose={() => choose(PANELS[1].role)} />
      </div>

      <div ref={headingRef} className="mt-6 scroll-mt-20">
        {role ? (
          <WaitlistForm key={role} role={role} />
        ) : (
          <p className="text-center text-sm text-muted">
            Pick a side to join the waitlist. You can be both later.
          </p>
        )}
      </div>
    </div>
  )
}

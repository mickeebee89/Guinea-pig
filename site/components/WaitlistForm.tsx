'use client'

import { useId, useState } from 'react'
import Link from 'next/link'

export type Role = 'stylist' | 'model'

const COPY: Record<Role, { heading: string; blurb: string; cta: string }> = {
  stylist: {
    heading: 'Join as a stylist',
    blurb:
      'Get the free early-stylist account when we launch, and first pick of models in your area.',
    cta: 'Join as a stylist',
  },
  model: {
    heading: 'Join as a model',
    blurb: 'Be first to hear when stylists near you start looking for models.',
    cta: 'Join as a model',
  },
}

export function WaitlistForm({ role }: { role: Role }) {
  const id = useId()
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const copy = COPY[role]

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setStatus('sending')

    const form = new FormData(e.currentTarget)
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: form.get('first_name'),
        email: form.get('email'),
        city: form.get('city'),
        social_handle: form.get('social_handle'),
        company: form.get('company'),
        consent: form.get('consent') === 'on',
        role,
      }),
    }).catch(() => null)

    const data = await res?.json().catch(() => null)

    if (!res || !data?.ok) {
      setStatus('idle')
      setError(data?.error ?? 'We couldn’t reach the waitlist just now. Please try again.')
      return
    }
    setStatus('done')
  }

  if (status === 'done') {
    return (
      <div
        role="status"
        className="rounded-lg border border-hairline bg-white p-6 text-center shadow-[var(--shadow-card)] sm:p-8"
      >
        <p
          data-form-heading
          tabIndex={-1}
          className="font-display text-2xl text-warm-dark outline-none"
        >
          You’re on the list.
        </p>
        <p className="mt-2 text-muted">
          We’ll email you the moment Cavy opens
          {role === 'stylist' ? ', with your early-stylist account ready to claim.' : ' in your area.'}
        </p>
      </div>
    )
  }

  const field =
    'w-full rounded-md border border-hairline bg-input-bg px-4 py-3 text-warm-dark placeholder:text-muted/70 outline-none transition-colors focus-visible:border-rose focus-visible:ring-2 focus-visible:ring-rose/30'
  const label = 'block text-sm font-bold text-warm-dark'

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-hairline bg-white p-6 shadow-[var(--shadow-card)] sm:p-8"
    >
      {/* Focus target when a role is chosen — a heading, never an input, so the
          on-screen keyboard stays down until someone actually taps a field. */}
      <h3 data-form-heading tabIndex={-1} className="font-display text-2xl text-warm-dark outline-none">
        {copy.heading}
      </h3>
      <p className="mt-1 text-sm text-muted">{copy.blurb}</p>

      <div className="mt-6 space-y-4">
        <div>
          <label className={label} htmlFor={`${id}-name`}>
            First name
          </label>
          <input
            id={`${id}-name`}
            name="first_name"
            required
            maxLength={80}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            className={`mt-1.5 ${field}`}
          />
        </div>

        <div>
          <label className={label} htmlFor={`${id}-email`}>
            Email
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            required
            maxLength={200}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            className={`mt-1.5 ${field}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor={`${id}-city`}>
              Town or city <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={`${id}-city`}
              name="city"
              maxLength={120}
              autoComplete="address-level2"
              autoCapitalize="words"
              enterKeyHint="next"
              className={`mt-1.5 ${field}`}
            />
          </div>
          <div>
            <label className={label} htmlFor={`${id}-social`}>
              Instagram or TikTok <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={`${id}-social`}
              name="social_handle"
              maxLength={120}
              placeholder="@yourhandle"
              autoComplete="off"
              // iOS capitalises and autocorrects by default, which mangles a
              // handle into "@Yourhandle" or something else entirely.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              className={`mt-1.5 ${field}`}
            />
          </div>
        </div>

        {/* Honeypot. Hidden from people and from screen readers; bots fill it. */}
        <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor={`${id}-company`}>Company</label>
          <input id={`${id}-company`} name="company" tabIndex={-1} autoComplete="off" />
        </div>

        {/* The whole label is the tap target, not just the 20px box. */}
        <label className="-mx-2 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm text-warm-dark/80 active:bg-input-bg">
          <input
            name="consent"
            type="checkbox"
            required
            className="mt-0.5 size-5 shrink-0 accent-rose focus-visible:ring-2 focus-visible:ring-rose/40"
          />
          <span>
            Email me when Cavy launches. I’m 18 or over and I’ve read the{' '}
            <Link href="/privacy" className="text-rose underline decoration-rose/30 underline-offset-2">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm font-bold text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="mt-6 w-full rounded-[999px] bg-rose px-6 py-3.5 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:opacity-60"
      >
        {status === 'sending' ? 'Joining…' : copy.cta}
      </button>

      <p className="mt-3 text-center text-xs text-muted">
        No spam. One email at launch, then you choose.
      </p>
    </form>
  )
}

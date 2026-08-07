'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/lib/site'

/**
 * Route-level error boundary. Without one, an unexpected throw shows the
 * framework's own error screen — which in production is a bare "Application
 * error: a client-side exception has occurred".
 *
 * The message deliberately does not apologise or speculate about the cause. It
 * says what happened, offers the one thing that usually works (try again), and
 * gives a way out.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[site] unhandled error:', error)
  }, [error])

  return (
    <section className="mx-auto max-w-2xl px-6 py-20 text-center sm:py-28">
      <h1 className="font-display text-3xl text-warm-dark sm:text-4xl">
        Something went wrong at our end
      </h1>
      <p className="mt-4 text-warm-dark/80">
        This page didn’t load properly. Trying again usually sorts it.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-6 font-bold text-rose transition-colors hover:bg-rose hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        >
          Back to the homepage
        </Link>
      </div>

      <p className="mt-8 text-sm text-muted">
        Still stuck?{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-rose underline decoration-rose/30 underline-offset-2"
        >
          {SUPPORT_EMAIL}
        </a>
        {/* The digest is the only handle support has to find this in the logs. */}
        {error.digest && <span className="mt-1 block text-xs text-muted/70">Ref: {error.digest}</span>}
      </p>
    </section>
  )
}

import Link from 'next/link'

export const metadata = { title: 'Link problem', robots: { index: false, follow: false } }

/**
 * Where every failed auth callback lands. Reset and confirmation links expire,
 * get used twice, or get mangled by an email client — so this is a normal
 * outcome, not an error page, and it says what to do rather than what broke.
 */
export default async function AuthProblem({
  searchParams,
}: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams

  return (
    <section className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="font-display text-3xl text-warm-dark">That link didn’t work</h1>
      <p className="mt-4 text-warm-dark/80">
        Confirmation and reset links expire after a while, and each one can only be used once.
        Asking for a new one almost always fixes it.
      </p>
      {reason && (
        <p className="mt-4 rounded-md border border-hairline bg-white px-4 py-3 text-sm text-muted">
          {reason}
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 font-bold text-white"
        >
          Send a new reset link
        </Link>
        <Link
          href="/sign-in"
          className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-6 font-bold text-rose"
        >
          Back to sign in
        </Link>
      </div>
    </section>
  )
}

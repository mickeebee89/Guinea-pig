import Link from 'next/link'
import { SITE_NAME } from '@/lib/site'

export const metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
}

/**
 * The unsubscribe page, reached from the link at the foot of every notification
 * email. Audit item 74.
 *
 * ── WHY IT ASKS FIRST ──────────────────────────────────────────────────────
 * Clicking a link is a GET, and mail clients and security scanners fetch links
 * in emails without a person doing anything. So a GET must never change
 * anything: this page only offers a button, which POSTs to ./confirm.
 * ./confirm also serves the one-click header that Gmail and Yahoo POST to
 * directly.
 *
 * ── NO SIGN-IN, AND WHY THAT IS SAFE ───────────────────────────────────────
 * The token in the link is 32 random bytes, held against one account
 * (email_unsubscribe_tokens, 0047). It can only turn email OFF. Turning it
 * back on needs a sign-in, so a forwarded or leaked link cannot be used to
 * re-subscribe someone, and it reveals nothing: the page never says whose
 * address it is, or whether the token matched an account that exists.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; done?: string; failed?: string }>
}) {
  const { t, done, failed } = await searchParams
  const token = (t ?? '').trim()

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="mb-6 font-display text-2xl text-rose">{SITE_NAME}</p>

      {done ? (
        <>
          <h1 className="font-display text-2xl text-warm-dark">You’re unsubscribed</h1>
          <p className="mt-3 text-sm text-muted">
            We won’t email you about activity on Cavy any more. You’ll still get emails about your
            account itself, such as resetting your password — those aren’t something we can switch
            off.
          </p>
          <p className="mt-3 text-sm text-muted">
            Changed your mind? Sign in and turn them back on in{' '}
            <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>.
          </p>
        </>
      ) : failed ? (
        <>
          <h1 className="font-display text-2xl text-warm-dark">That link didn’t work</h1>
          <p className="mt-3 text-sm text-muted">
            It may be from an old email, or only part of it was copied. You can turn these emails
            off yourself: sign in and open{' '}
            <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>.
          </p>
        </>
      ) : !token ? (
        <>
          <h1 className="font-display text-2xl text-warm-dark">Unsubscribe</h1>
          <p className="mt-3 text-sm text-muted">
            This page needs the link from one of our emails. You can also turn these emails off by
            signing in and opening{' '}
            <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl text-warm-dark">Stop these emails?</h1>
          <p className="mt-3 text-sm text-muted">
            You’ll stop getting emails about applications, bookings, messages, your ID check and
            payments. Everything still happens in Cavy — you just won’t be told by email.
          </p>
          <p className="mt-3 text-sm text-muted">
            We’ll still email you about your account itself, such as resetting your password.
          </p>
          {/* A form, so the change is a POST. See the note above. */}
          <form action="/email/unsubscribe/confirm" method="post" className="mt-6">
            <input type="hidden" name="t" value={token} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
            >
              Yes, unsubscribe
            </button>
          </form>
        </>
      )}
    </main>
  )
}

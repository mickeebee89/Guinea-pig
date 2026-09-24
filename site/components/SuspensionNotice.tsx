'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SUPPORT_EMAIL } from '@/lib/site'

/**
 * What a suspended or banned member sees on the web. Audit item 120.
 *
 * ── ⚠️ THIS EXPLAINS. IT DOES NOT ENFORCE. ────────────────────────────────
 *
 * The enforcement is four RESTRICTIVE policies in suspension-enforcement.sql:
 * no INSERT on sessions, messages or reviews, and no UPDATE on providers. They
 * apply to anybody holding that session's token, including someone calling
 * PostgREST directly with no browser involved, which is why the gate does not
 * need to be — and must not pretend to be — the thing that stops anything.
 *
 * That division is deliberate and is the same one 0018 drew for blocking: the
 * listing-side filter is presentation, and the RESTRICTIVE policy is what
 * actually stops the write. A gate that believed it was the control would be
 * the more dangerous design, because it would invite someone to remove a policy
 * on the grounds that the UI already covers it.
 *
 * Reads stay allowed on purpose — suspension-enforcement.sql says so in as many
 * words — precisely so the app can render this screen and the member can still
 * see their own data.
 *
 * ── WHY A CLIENT COMPONENT, WHEN THE GATE ABOVE IT IS A SERVER ONE ────────
 *
 * Because it needs the pathname, and it needs it for ONE reason: Settings has
 * to stay reachable (below). The suspension itself is read on the server in
 * app/(app)/layout.tsx and passed down, so nothing about who is suspended is
 * decided here.
 *
 * It was tempting to put this in proxy.ts, which sees every path. That file
 * says, in its own header: "If this file ever starts making authorisation
 * decisions, that property is gone." Forgetting a path there costs a stale
 * token today; it would have started costing an unexplained refusal.
 *
 * ── ⚠️ SETTINGS IS NOT OPTIONAL, AND THIS IS THE PART TO NOT BREAK ────────
 *
 * Account deletion lives in Settings, and in-app deletion is an Apple 5.1.1(v)
 * and Play requirement — not a courtesy. A banned member is exactly the person
 * most likely to want their data gone, and under UK GDPR that right does not
 * pause because somebody has been banned.
 *
 * So a suspended member keeps Settings, with the notice as a banner above it
 * rather than instead of it. Mobile does NOT do this yet: SuspensionGate wraps
 * its whole stack and offers only Sign out, so a banned member there cannot
 * delete their account at all. That is audit item 124.
 */

export type ActiveSuspension = {
  banned: boolean
  suspendedUntil: string | null
  /**
   * ⚠️ The admin's MESSAGE, never their reason. my_suspension() stopped
   * returning `reason` in 0058 because it is moderation evidence and may name
   * whoever reported them (item 118). There is deliberately no way to get the
   * reason here.
   */
  message: string | null
}

/** Paths a suspended member keeps. See the header — this list is a legal one. */
const STILL_REACHABLE = ['/settings']

export function SuspensionNotice({
  suspension,
  isProvider,
  children,
}: {
  suspension: ActiveSuspension | null
  isProvider: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()

  if (!suspension) return <>{children}</>

  const allowed = STILL_REACHABLE.some(p => pathname === p || pathname.startsWith(p + '/'))

  const until = (() => {
    if (suspension.banned || !suspension.suspendedUntil) return null
    const d = new Date(suspension.suspendedUntil)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  })()

  const heading = suspension.banned
    ? 'Your account has been closed'
    : 'Your account is suspended'

  // ⚠️ A BAN SAYS NOTHING ABOUT A WAY BACK. "You can appeal and we'll
  // reconsider" is a sentence this product cannot keep. It says they can write
  // to us, which is true, and claims nothing beyond it. Same wording as the
  // notification 0061 sends, because hearing two different versions of one
  // decision is its own kind of unfairness.
  const explanation = suspension.banned
    ? 'Your account has been closed following a review of activity on Cavy. You won’t be able to apply for treatments, send messages or leave reviews.'
    : until
      ? `Your account is suspended until ${until}. Until then you can’t apply for treatments, send messages or leave reviews.`
      : 'Your account is suspended. Until it’s lifted you can’t apply for treatments, send messages or leave reviews.'

  const panel = (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 sm:p-6">
      <h1 className="text-lg font-semibold text-warmDark">{heading}</h1>
      <p className="mt-2 text-sm leading-relaxed text-warmDark/80">{explanation}</p>

      {/* She will notice an empty diary either way, and silence about it is its
          own message — the reasoning 0057 set out for revocation. The count is
          not available here, so this says only what is certainly true. */}
      {isProvider && (
        <p className="mt-2 text-sm leading-relaxed text-warmDark/80">
          Your shop is hidden and isn’t taking new bookings, and any upcoming bookings
          have been cancelled. Those models were told the booking is off and that it was
          our decision, not yours.
        </p>
      )}

      {suspension.message && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-white p-4">
          {/* NOT "Reason". What this carries is the message written for them;
              the reason is evidence they never see (item 118). */}
          <p className="text-xs font-semibold uppercase tracking-wide text-warmDark/50">
            What this means
          </p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-warmDark">
            {suspension.message}
          </p>
        </div>
      )}

      <p className="mt-4 text-sm text-warmDark/70">
        If you think this is wrong, write to{' '}
        <a className="font-medium underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      {!allowed && (
        <p className="mt-4 text-sm text-warmDark/70">
          You can still{' '}
          <Link className="font-medium underline" href="/settings">go to your settings</Link>{' '}
          to manage or delete your account.
        </p>
      )}
    </div>
  )

  // On Settings it is a banner ABOVE the page, not instead of it — deleting an
  // account is the one thing that must never be behind this.
  if (allowed) {
    return (
      <>
        <div className="mb-6">{panel}</div>
        {children}
      </>
    )
  }

  return panel
}

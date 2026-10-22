'use client'

import { modelProfileUrl, stylistProfileUrl } from '@/lib/site'

/**
 * A link from the console to what a member actually looks like on the site.
 *
 * ── ⚠️⚠️ A LINK THAT 404s LOOKS LIKE THE FEATURE WORKING ─────────────────
 * That is the whole design rule here. Every case below either produces a link
 * that resolves, or produces PLAIN TEXT saying why it does not. Nothing is
 * rendered as a link on the hope that the row behind it exists.
 *
 * ⚠️ AND "NO SHOP" IS NOT THE SAME CLAIM AS "I DON'T KNOW". `providerId` is
 * deliberately `string | null | undefined`:
 *
 *   string     — a providers.id. Link it.
 *   null       — looked, and there is no provider row. Say "no shop".
 *   undefined  — the lookup has not run, or it failed. Say nothing useful,
 *                because asserting "no shop" from a failed read is how a
 *                console tells you something false with confidence.
 *
 * Collapsing the last two into one falsy check would make a dropped query
 * indistinguishable from a model, which is the version of this component that
 * would quietly mislead.
 *
 * ── WHY ABSOLUTE AND WHY A NEW TAB ───────────────────────────────────────
 * Different apps on different origins — the console is on Vercel, the site is
 * cavybeauty.com. A relative href would resolve against the console and 404.
 * New tab because the console is where the work is: comparing a selfie to a
 * profile means going back and forth, not navigating away from the queue.
 *
 * ⚠️ `rel="noreferrer"` alongside `noopener`: these URLs carry a member's user
 * id in the path, and a Referer header would hand that id to anything the site
 * loads from another origin.
 *
 * ── ⚠️ WHAT THIS CANNOT PROMISE ──────────────────────────────────────────
 * The console and the site are different origins, so they hold SEPARATE
 * sessions. Being signed into the console does not sign you into
 * cavybeauty.com, and `/model/[id]` and `/stylist/[id]` both call
 * `requireUser()` — so the first click of a session lands on /sign-in rather
 * than the profile. That is a redirect, not a refusal, and signing in as an
 * admin account resolves it: both pages gate on nothing beyond a session, and
 * `providers_select_admin` plus 0100's `is_admin()` escapes do the rest.
 */
/**
 * The shop link on its own, for a row that IS a providers row.
 *
 * ⚠️ NOT SiteProfileLink WITH role="provider". On the Providers page the id in
 * hand is already a providers.id, so there is no decision to make and no
 * uncertainty to express — forcing that row through the role-aware component
 * would mean inventing a `userId` it never reads. Same anchor, same rel, same
 * new tab, so the two cannot drift apart in how they open.
 */
export function ShopLink({ providerId, className = '' }: { providerId: string; className?: string }) {
  return (
    <a href={stylistProfileUrl(providerId)} target="_blank" rel="noopener noreferrer"
       className={`font-medium text-[#DB4B86] hover:underline ${className}`}>
      View shop ↗
    </a>
  )
}

export function SiteProfileLink({
  role,
  userId,
  providerId,
  className = '',
}: {
  role: string | null
  userId: string
  /** `undefined` means NOT LOOKED UP. See the note above — it is not `null`. */
  providerId?: string | null
  className?: string
}) {
  const link = 'font-medium text-[#DB4B86] hover:underline'
  const muted = 'text-[#3D2E2E]/40'

  const modelLink = (label: string) => (
    <a href={modelProfileUrl(userId)} target="_blank" rel="noopener noreferrer" className={link}>
      {label} ↗
    </a>
  )

  const stylistLink = (label: string) => (
    <a href={stylistProfileUrl(providerId as string)} target="_blank" rel="noopener noreferrer"
       className={link}>
      {label} ↗
    </a>
  )

  // ⚠️ A 'both' account has BOTH profiles and they are different pages with
  // different ids. Offering one would silently pick a side — and on the one
  // account where the distinction matters most, because it is the account that
  // exists to exercise both.
  if (role === 'both') {
    return (
      <span className={`inline-flex gap-2 ${className}`}>
        {modelLink('Model')}
        {typeof providerId === 'string'
          ? stylistLink('Shop')
          : providerId === null
            ? <span className={muted} title="This account has no provider row.">no shop</span>
            : <span className={muted} title="The provider lookup did not run, so whether there is a shop is unknown.">shop unknown</span>}
      </span>
    )
  }

  if (role === 'provider') {
    if (typeof providerId === 'string') return <span className={className}>{stylistLink('View shop')}</span>
    return (
      <span className={`${muted} ${className}`}
        title={providerId === null
          ? 'This stylist has no provider row, so there is no shop page to open.'
          : 'The provider lookup did not run, so there is no id to link to.'}>
        {providerId === null ? 'no shop' : 'unknown'}
      </span>
    )
  }

  if (role === 'model') {
    return <span className={className}>{modelLink('View profile')}</span>
  }

  // ⚠️ An unrecognised role is not a model. /model/[id] reads public_profiles,
  // which has no WHERE clause and holds EVERY account — so it would render a
  // "model" page for anything, attributes empty, looking like a real but blank
  // profile. Guessing here would produce the most convincing wrong page of the
  // lot.
  return (
    <span className={`${muted} ${className}`} title={`Unrecognised role: ${role ?? 'none'}`}>
      —
    </span>
  )
}

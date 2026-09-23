'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { adminErrorText, humanError, shopsNote } from '@/lib/adminActions'
import type { ActionResult, ShopState } from '@/lib/adminActions'
import { reviewerNames } from '@/lib/reviewers'
import { ReviewerLine } from '@/components/ReviewerLine'

interface VerificationRequest {
  id: string
  selfie_url: string
  status: string
  notes: string | null
  created_at: string
  reviewed_at: string | null
  /** auth.users id since 0036. NULL on every request reviewed before 10 Sep 2026
   *  until 0037 reconstructed them. */
  reviewed_by: string | null
  reviewed_by_source: 'recorded' | 'reconstructed' | null
  user: {
    id: string
    first_name: string
    last_name: string | null
    last_initial: string | null
    email: string
    role: string
    is_verified: boolean
    /**
     * What the selfie is supposed to be compared AGAINST. Audit item 98.
     *
     * The `profile-pics` bucket is PUBLIC (storage-lockdown.sql:15) and this
     * column holds a full public URL, written by getPublicUrl — so unlike the
     * selfie it needs no signing, and there is no expiry to manage.
     */
    profile_pic_url: string | null
  }
}

/**
 * ── THE STYLIST'S WORDS, WHICH ARE NOT THE ADMIN'S ───────────────────────
 *
 * shopsNote() in lib is third person, for someone scanning a queue. This is
 * second person, for the person it happened to, and they say different things
 * on purpose.
 *
 * ⚠️ WORDED FROM `shops`, NEVER ASSUMED. The old message told every approved
 * provider "your verified badge and profile are now live" — untrue whenever the
 * shop could not publish. That is the same untruth the console was telling the
 * ADMIN until 0039, aimed at the stylist instead, and it is worse here: they
 * have no queue to check it against.
 *
 * Since 0041 this names the half that is actually missing, from has_name and
 * has_categorised_treatment. It used to recite both requirements, which told a
 * stylist whose shop HAS a name to go and fix the name.
 */
function stylistApprovalBody(role: string | undefined, shops: ShopState[]): string {
  if (role === 'model' || shops.length === 0) {
    return 'Your Cavy profile is now verified. Your badge is live!'
  }
  const hidden = shops.filter(sh => !sh.published)
  if (hidden.length === 0) {
    return 'Your identity check passed — your verified badge and your shop are now live.'
  }

  // The first hidden shop. Nearly every stylist has one; if that ever stops
  // being true this under-reports rather than misreports, which is the right
  // way round for a message going to a person.
  const sh = hidden[0]
  const missing = [
    sh.has_name === false ? 'a name' : null,
    sh.has_categorised_treatment === false ? 'at least one treatment with a category' : null,
  ].filter(Boolean)

  return 'Your identity check passed and your verified badge is live. '
    + (missing.length > 0
        ? `Your shop is not public yet — it still needs ${missing.join(' and ')}. `
          + `Add ${missing.length > 1 ? 'those' : 'that'} from your dashboard and it will go live.`
        : 'Your shop is not public yet — open your dashboard to check it.')
}

/**
 * Shown where the PROFILE PICTURE should be, and worded differently from
 * NO_PHOTO_SVG on purpose. "No photo" beside the selfie means the file is
 * missing; here it means the member never set one — which is a fact about the
 * decision being asked for, not a broken image. Audit item 98.
 */
const NO_AVATAR_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect fill="%23fdf7f4" width="144" height="144"/><text x="72" y="70" text-anchor="middle" fill="%23b08a7e" font-size="13">No profile</text><text x="72" y="88" text-anchor="middle" fill="%23b08a7e" font-size="13">picture</text></svg>'

// Shown when there's no signed URL (missing image, or an old public-URL row).
const NO_PHOTO_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect fill="%23f5f0ed" width="144" height="144"/><text x="72" y="76" text-anchor="middle" fill="%239b8b86" font-size="14">No photo</text></svg>'

export default function VerificationQueuePage() {
  const [requests, setRequests]     = useState<VerificationRequest[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})   // selfie signed URLs, keyed by request id
  const [lightbox, setLightbox]     = useState<string | null>(null)          // enlarged selfie (signed URL) or null
  const [filter, setFilter]     = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [notes, setNotes]       = useState<Record<string, string>>({})
  const [working, setWorking]   = useState<string | null>(null)
  const [names, setNames]       = useState<Record<string, string>>({})

  const { loading, reload } = useLoader(filter, async stale => {
    const { data, error } = await supabase
      .from('verification_requests')
      .select('id, selfie_url, status, notes, created_at, reviewed_at, reviewed_by, reviewed_by_source, user:users!user_id(id, first_name, last_name, last_initial, email, role, is_verified, profile_pic_url)')
      .eq('status', filter)
      .order('created_at', { ascending: false })
    if (error) console.error('verification requests load failed:', error)
    if (stale()) return
    const rows = (data ?? []) as unknown as VerificationRequest[]
    setRequests(rows)
    const resolved = await reviewerNames(rows.map(r => r.reviewed_by))
    if (stale()) return
    setNames(resolved)

    // verification-selfies is a PRIVATE bucket. selfie_url now holds a storage path;
    // sign it for ~5 minutes so the <img> can load. Old test rows hold full public
    // URLs (not paths) → signing fails → they fall back to the "No photo" placeholder.
    const entries = await Promise.all(
      rows.map(async r => {
        if (!r.selfie_url) return [r.id, ''] as const
        const { data: signed } = await supabase.storage
          .from('verification-selfies')
          .createSignedUrl(r.selfie_url, 300)
        return [r.id, signed?.signedUrl ?? ''] as const
      }),
    )
    if (stale()) return
    setSignedUrls(Object.fromEntries(entries))
  })

  /**
   * ── FIVE WRITES BECOME ONE, AND THREE ALERTS STOP EXISTING ───────────
   *
   * Approving was: users.is_verified, then providers.is_published, then
   * verification_requests, then a notification, then the audit row — five
   * sequential client writes, each checked, none able to undo the one before.
   * The three alerts that described what happens when it breaks half way are
   * quoted verbatim in audit item 29 and in 0035's header, because they are the
   * design admitting in prose that it could not be consistent:
   *
   *     :81  "Couldn't verify this user … Nothing else was changed."
   *     :87  "The user was verified, but their shop could not be published …
   *           The request has been left pending — try again."
   *     :97  "This user is verified and published, but the request could not be
   *           closed … approve it again to clear it."
   *
   * ⚠️ THEY ARE DELETED RATHER THAN REWORDED. Only the first described a clean
   * failure; the other two described HALF-CHANGED states that
   * admin_decide_verification cannot produce. A message describing an
   * impossible state is worse than none — the next person reads it as evidence
   * the state can happen, and writes code to handle it.
   *
   * What the function does inside one transaction: locks the request, refuses a
   * second decision on it ⟨D4⟩, sets is_verified, publishes explicitly but only
   * where provider_shop_is_publishable passes ⟨D1⟩, closes the request with
   * reviewed_by AND reviewed_by_source ('recorded', which 0037's paired CHECK
   * requires), and writes the audit row.
   *
   * What stays out here: the notification ⟨D2⟩. A failed message must not roll
   * back a verification. It is worded from `shops` — see stylistApprovalBody.
   *
   * Two client-side guards are also gone. supabase.auth.getUser() checked the
   * actor before writing, because five separate writes needed to know who was
   * acting; the function reads auth.uid() itself and refuses without one. And
   * `if (!req.user)` refused whenever RLS hid the joined users row — the
   * function resolves the user as definer and returns user_id, which is how the
   * notification below reaches someone this page cannot see.
   */
  async function approve(req: VerificationRequest) {
    setWorking(req.id)
    const note = notes[req.id] ?? ''
    try {
      const { data, error } = await supabase.rpc('admin_decide_verification', {
        p_request_id: req.id,
        p_decision:   'approved',
        p_note:       note.trim() || null,
      })
      if (error) {
        // A fee refusal (CV002, 0045) gets plain words; anything else, the function's own.
        alert(`Couldn't approve this request.\n\n${adminErrorText(error)}\n\nNothing has changed.`)
        return
      }

      const result = (data ?? {}) as ActionResult
      const shops  = result.shops ?? []

      // ONE dialog, built from whichever facts apply. This was two alerts —
      // already-verified, then the shop note — so approving Test A cost two
      // OK-clicks for one decision. An alert per fact is a queue of
      // interruptions rather than a report of what happened.
      const said: string[] = []
      if (result.already_verified) {
        said.push('This account was already verified before you approved it — the request is now '
          + 'closed and attributed to you.')
      }
      const shopNote = shopsNote(shops)
      if (shopNote) {
        said.push(`Verifying did not make the shop live. ${shopNote}`)
        // Only when there is a shop note: on its own it refers to nothing.
        said.push('The decision is recorded either way — this is what the shop looks like now.')
      }
      if (said.length > 0) alert(said.join('\n\n'))

      if (!result.user_id) return   // cannot notify someone the function did not name
      const { error: notifyErr } = await supabase.from('notifications').insert({
        user_id: result.user_id,
        type:    'verification',
        title:   result.role === 'model' ? 'You\'re verified! ✅' : 'You\'re verified! 🎉',
        body:    stylistApprovalBody(result.role, shops),
      })
      // The decision STANDS. Only the message failed, and that distinction is
      // exactly what the admin needs in order to act.
      if (notifyErr) {
        alert(`The decision is recorded, but they could not be notified: ${notifyErr.message}\n\n`
          + 'Nothing needs re-approving. Tell them by hand if it matters.')
      }
    } finally {
      setWorking(null)
      reload()
    }
  }

  async function reject(req: VerificationRequest) {
    setWorking(req.id)
    const note = notes[req.id] ?? ''
    try {
      const { data, error } = await supabase.rpc('admin_decide_verification', {
        p_request_id: req.id,
        p_decision:   'rejected',
        p_note:       note.trim() || null,
      })
      // Don't tell someone they were rejected if the rejection didn't save.
      if (error) {
        alert(`Couldn't reject this request.\n\n${humanError(error.message)}\n\nThe user has NOT been notified.`)
        return
      }

      const result = (data ?? {}) as ActionResult
      if (!result.user_id) return
      const { error: notifyErr } = await supabase.from('notifications').insert({
        user_id: result.user_id,
        type:    'verification',
        title:   'Verification not approved',
        body:    note.trim()
          ? `Your verification was not approved: ${note.trim()}`
          : 'Your verification was not approved. Please resubmit with a clearer photo.',
      })
      // Said plainly: a rejected person who is never told is the silent failure
      // this console exists to remove.
      if (notifyErr) {
        alert(`The rejection is recorded, but they could not be notified: ${notifyErr.message}\n\n`
          + 'They have NOT been told. Contact them by hand.')
      }
    } finally {
      setWorking(null)
      reload()
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-2">Verification Queue</h1>
      <p className="text-sm text-[#3D2E2E]/50 mb-6">Review selfie verification requests from users.</p>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['pending', 'approved', 'rejected'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize border transition-colors ${
              filter === f
                ? 'bg-[#8C4A58] text-white border-[#8C4A58]'
                : 'bg-white text-[#3D2E2E]/60 border-black/10 hover:border-[#8C4A58]/40'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-xl border border-black/5 p-10 text-center text-[#3D2E2E]/30 text-sm">
          No {filter} requests
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map(req => (
            <div key={req.id} className="bg-white rounded-xl border border-black/5 shadow-sm overflow-hidden">
              <div className="flex gap-6 p-5">
                {/* ── THE TWO PHOTOS, SIDE BY SIDE. Audit item 98. ───────────
                    Until 23 Sep 2026 this queue showed the SELFIE AND NOTHING
                    ELSE. `profile_pic_url` appeared nowhere in the whole admin
                    console, so the comparison every surface describes —

                      Privacy §7: "a selfie you take holding a handwritten note,
                      which a member of our team looks at alongside your profile
                      photo"

                    — was not something the tooling could do. A reviewer was
                    deciding from a selfie and a name. Published in six places
                    including Privacy twice, so this was a claim with no
                    mechanism behind it, which is what this audit exists to
                    find. */}
                <div className="shrink-0 flex gap-3">
                  <figure className="m-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={signedUrls[req.id] || NO_PHOTO_SVG}
                      alt="Verification selfie"
                      className="w-36 h-36 object-cover rounded-xl border border-black/5 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => { if (signedUrls[req.id]) setLightbox(signedUrls[req.id]) }}
                      onError={e => { (e.target as HTMLImageElement).src = NO_PHOTO_SVG }}
                    />
                    <figcaption className="mt-1 text-center text-xs text-[#3D2E2E]/50">Selfie sent</figcaption>
                  </figure>

                  <figure className="m-0">
                    {/* The profile-pics bucket is public and this column holds a
                        full URL, so no signing — unlike the selfie beside it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={req.user?.profile_pic_url || NO_AVATAR_SVG}
                      alt={req.user?.profile_pic_url ? 'Profile picture' : 'No profile picture set'}
                      className={`w-36 h-36 object-cover rounded-xl border border-black/5 transition-opacity ${
                        req.user?.profile_pic_url ? 'cursor-pointer hover:opacity-90' : ''
                      }`}
                      onClick={() => { if (req.user?.profile_pic_url) setLightbox(req.user.profile_pic_url) }}
                      onError={e => { (e.target as HTMLImageElement).src = NO_AVATAR_SVG }}
                    />
                    <figcaption className="mt-1 text-center text-xs text-[#3D2E2E]/50">
                      Profile picture
                    </figcaption>
                  </figure>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-1">
                    <div>
                      {/* req.user is null when RLS hides the row — show that rather
                         than crashing the whole queue. */}
                      <span className="font-semibold text-[#3D2E2E]">
                        {req.user
                          ? `${req.user.first_name} ${req.user.last_name ?? (req.user.last_initial ? req.user.last_initial + '.' : '')}`
                          : 'Account not visible'}
                      </span>
                      <span className="ml-2 text-xs text-[#3D2E2E]/40">{req.user?.email ?? '—'}</span>
                      {req.user && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                          style={{ background: req.user.role === 'model' ? '#E8B5C220' : '#C8788A20', color: req.user.role === 'model' ? '#7B5EA7' : '#8C4A58' }}>
                          {req.user.role}
                        </span>
                      )}
                      {req.user?.is_verified && (
                        <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Already verified</span>
                      )}
                    </div>
                    <span className="text-xs text-[#3D2E2E]/40 shrink-0">{formatDate(req.created_at)}</span>
                  </div>
                  <p className="text-sm text-[#3D2E2E]/50 mb-3">{req.user?.email ?? '—'}</p>

                  {/* ⚠️ A COMPARISON AGAINST NOTHING IS NOT A COMPARISON.
                      Audit item 98.

                      This is the COMMON case today, not an edge one: nothing
                      in site/ can set a profile picture, so every member who
                      has only ever used the website has none. It says what is
                      missing and what approving would and would not mean, and
                      it does NOT block — blocking would strand every web-only
                      stylist who has already paid the £14.99, which is a worse
                      outcome than a reviewer who knows what they are deciding.
                      The person decides; the console's job is to make sure
                      they are not deciding blind. */}
                  {req.user && !req.user.profile_pic_url && (
                    <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-3">
                      <span className="font-semibold">No profile picture to compare against.</span>
                      {filter === 'pending'
                        ? ' Approving confirms a real person sent a selfie — it cannot confirm their profile photo is their own, which is what this check is for.'
                        : ' This was decided with nothing to compare the selfie against.'}
                    </p>
                  )}

                  {req.user?.role === 'provider' && filter === 'pending' && (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                      Provider — approval verifies them and makes their shop live
                    </p>
                  )}

                  {req.notes && filter !== 'pending' && (
                    <p className="text-sm text-[#3D2E2E]/60 italic mb-3">Notes: {req.notes}</p>
                  )}

                  {/* Reviewed requests say who, and how that is known. Rendered
                      only through ReviewerLine so the reconstructed marker
                      travels with the name to every screen that shows one. */}
                  {filter !== 'pending' && (
                    <div className="mb-3">
                      <ReviewerLine
                        reviewerId={req.reviewed_by}
                        source={req.reviewed_by_source}
                        reviewedAt={req.reviewed_at}
                        names={names}
                      />
                    </div>
                  )}

                  {filter === 'pending' && (
                    <>
                      <textarea
                        placeholder="Notes (optional — shown to user on rejection)"
                        value={notes[req.id] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [req.id]: e.target.value }))}
                        className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm resize-none mb-3"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => approve(req)}
                          disabled={working === req.id}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {working === req.id ? 'Working…' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => reject(req)}
                          disabled={working === req.id}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Enlarged selfie lightbox — click anywhere or the × to close */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute top-4 right-5 text-white/90 text-4xl leading-none hover:text-white"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Verification selfie enlarged"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}

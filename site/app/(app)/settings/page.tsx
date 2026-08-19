import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { indexById, displayName, type ProfileRef } from '@/lib/queries/util'
import { getStylistSetup } from '@/lib/queries/shop'
import { BlockedList, type BlockedPerson } from './BlockedList'

export const metadata = { title: 'Settings' }

/**
 * Settings. The blocked list, and the stylist's ID-check status.
 *
 * ── WHY THE ID CHECK IS ALSO HERE, NOT ONLY ON THE SETUP PANEL ────────────
 * The panel is the primary route and shows the link exactly when it is
 * actionable. But the panel DISAPPEARS once the shop is published — it switches
 * to "Your shop is live" — so a verified stylist has no route to that page at
 * all. Fine while nothing ever needs redoing; not fine the first time a check
 * has to be repeated, because there would be nowhere to send them.
 *
 * Mobile already keeps a verification entry in its settings, so this is parity
 * rather than a new idea, and someone who learned the app will look here.
 */
export default async function SettingsPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  // ONLY blocks this user created. blocks_select_involved would also return
  // rows where they are the blocked party, and showing those would reveal who
  // has blocked them — which the design deliberately hides. A block conceals
  // the pair in both directions precisely so neither person can tell which way
  // round it was.
  const setup = await getStylistSetup(supabase, user.id)

  const { data: rows } = await supabase
    .from('blocks')
    .select('blocked_id, created_at')
    .eq('blocker_id', user.id)
    .order('created_at', { ascending: false })

  const blocks = (rows ?? []) as { blocked_id: string; created_at: string }[]

  const profiles = blocks.length > 0
    ? await supabase.from('public_profiles')
        .select('id, first_name, last_initial, profile_pic_url')
        .in('id', blocks.map(b => b.blocked_id))
    : { data: [] }
  const nameMap = indexById<ProfileRef>(profiles.data)

  const people: BlockedPerson[] = blocks.map(b => ({
    userId: b.blocked_id,
    // "Someone" rather than a blank: a deleted account still has a block row,
    // and an unlabelled Unblock button is worse than an honest placeholder.
    name: displayName(nameMap[b.blocked_id], 'Someone'),
    picUrl: nameMap[b.blocked_id]?.profile_pic_url ?? null,
    blockedAt: b.created_at,
  }))

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Settings</h1>

      {/* Stylists only. A model has no standalone ID check — theirs happens
          inside the apply gate with the subscription, and offering it separately
          is what produced verified-but-unsubscribed accounts in the app. */}
      {setup.providerId && (
        <section className="mb-8">
          <h2 className="mb-2 font-display text-lg text-warm-dark">ID check</h2>
          <p className="mb-3 text-sm text-muted">
            {setup.idCheck === 'approved'
              ? 'Passed. A person compared your photo against your profile picture.'
              : setup.idCheck === 'pending'
                ? 'Sent — a person reviews these, usually within 24 hours. Nothing for you to do.'
                : setup.idCheck === 'rejected'
                  ? 'The last one wasn’t accepted, so it needs doing again.'
                  : 'Not done yet. It’s what makes your shop live.'}
          </p>
          {/* No link while it is pending: there is nothing to do on that page
              but read the same sentence again. */}
          {setup.idCheck !== 'pending' && (
            <Link href="/verify" className="text-sm font-bold text-rose hover:underline">
              {setup.idCheck === 'approved' ? 'See your ID check' :
               setup.idCheck === 'rejected' ? 'Try again' : 'Do the ID check'} →
            </Link>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-lg text-warm-dark">Blocked people</h2>
        <p className="mb-4 text-sm text-muted">
          Blocking stops someone messaging you, hides them from your lists, and cancels any
          booking between you. You can undo it here at any time.
        </p>
        <BlockedList people={people} />
      </section>
    </>
  )
}

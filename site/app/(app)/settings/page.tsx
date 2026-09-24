import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { indexById, displayName, type ProfileRef } from '@/lib/queries/util'
import { getStylistSetup } from '@/lib/queries/shop'
import { BlockedList, type BlockedPerson } from './BlockedList'
import { getGateState } from '@/lib/verification'
import { MembershipSection, type MembershipView } from './MembershipSection'
import { EmailNotificationsSection } from './EmailNotificationsSection'
import { DeleteAccountSection } from './DeleteAccountSection'
import { PostcodeField } from '@/components/PostcodeField'
import { NameSection } from './NameSection'
import { isModel as isModelRole } from '@/lib/roles'

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

  // ── TWO READS, TWO JOBS, KEPT APART ─────────────────────────────────────
  // getGateState DECIDES whether this account has a membership: it applies the
  // date check, grants on past_due, folds in the admin waiver, and asks Stripe
  // when its own row cannot settle it.
  //
  // The row read below is DISPLAY ONLY — the status and renewal date exactly as
  // we hold them, so a person can see what our records say. It is deliberately
  // not turned into a second opinion about membership. Audit item 48 is what
  // happens when a surface starts deciding that for itself: dashboard.ts grew a
  // `status = 'active'` test under the same name as the real gate and disagreed
  // with it about every cancelling, past_due and comped account.
  const gate = await getGateState(supabase, user.id)
  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle()
  const membership: MembershipView = {
    subscribed: gate.subscribed,
    waived: gate.waived,
    status: (subRow as { status?: string } | null)?.status ?? null,
    renewsOn: (subRow as { current_period_end?: string } | null)?.current_period_end ?? null,
  }

  // ── WHO SEES THE MEMBERSHIP SECTION ─────────────────────────────────────
  // Models, as on mobile (settings.tsx:650 — `isModel`, which counts 'both').
  // A stylist was being shown "No membership on this account… join here", a
  // pitch for a membership that only matters to someone applying for sessions.
  //
  // ⚠️ PLUS anyone holding a subscription that has not expired, whatever their
  // role. Nothing stops a stylist paying — /subscribe and create_subscription
  // check no role — so hiding the section by role alone would hide the CANCEL
  // control from someone who is being billed. "Cancel any time" has to be true
  // for whoever is actually paying.
  const { data: me } = await supabase
    .from('users')
    .select('role, notification_preferences, postcode, first_name, last_initial')
    .eq('id', user.id).maybeSingle()

  // The last change drives the cooldown note, so she is told the rule BEFORE
  // she tries rather than by a refusal. Her own rows only — name_changes'
  // policy permits exactly that, and an admin's view of everyone (0056).
  const { data: lastChange } = await supabase
    .from('name_changes').select('changed_at')
    .eq('user_id', user.id)
    .order('changed_at', { ascending: false })
    .limit(1).maybeSingle()
  const role = (me as { role?: string } | null)?.role
  const postcode = (me as { postcode?: string | null } | null)?.postcode ?? null
  // Default ON: null, a missing key, or anything but an explicit false (item 74).
  const emailNotifications =
    (me as { notification_preferences?: { email?: { enabled?: boolean } } } | null)
      ?.notification_preferences?.email?.enabled !== false
  // This file had it right before item 116 existed — it is the only place on
  // the web that ever checked for 'both'. Same test, shared name now.
  const isModel = isModelRole(role)
  const holdsSubscription = !!membership.status && membership.status !== 'expired'
  const showMembership = isModel || holdsSubscription

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

      {showMembership && (
        <section className="mb-8">
          <h2 className="mb-2 font-display text-lg text-warm-dark">Membership</h2>
          <MembershipSection view={membership} />
        </section>
      )}

      {/* Account-level, so it comes first and shows for both roles. A
          stylist's /shop name is her SHOP's name, which can be a salon; this
          is the one that appears on her reviews, bookings and messages.

          Wired in once 0056 was applied — it reads `name_changes`, which is
          not in the generated types until then, so committing it earlier
          would have pushed a tree that cannot build (item 75's failure). */}
      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg text-warm-dark">Your name</h2>
        <NameSection
          firstName={(me as { first_name?: string } | null)?.first_name ?? ''}
          lastInitial={(me as { last_initial?: string | null } | null)?.last_initial ?? null}
          changedAt={(lastChange as { changed_at: string } | null)?.changed_at ?? null}
        />
      </section>

      {/* ⚠️ SHOWN TO BOTH ROLES, AND IT IS THE ONLY COPY FOR A MODEL.
          A model has no profile page on this website at all, so there is
          nowhere else to put this — and until it existed, nothing on the web
          could set a coordinate for anyone. The stylist also gets one on
          /shop, next to the area she writes in her own words, because that is
          where she is already thinking about where she works. Both write the
          same column through the same action. */}
      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg text-warm-dark">Where you are</h2>
        <PostcodeField
          initial={postcode}
          hint={
            setup.providerId
              ? 'Used to work out how far away you are from models. Never shown to anyone — they see the area you write on your shop page, not this.'
              : 'Used to sort stylists and their updates by how far away they are. Never shown to anyone, and you can remove it at any time.'
          }
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg text-warm-dark">Emails</h2>
        <EmailNotificationsSection enabled={emailNotifications} />
      </section>

      {/* Last, and visually quietest. It is a right, not a feature — it has to
          be findable without being offered. */}
      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg text-warm-dark">Your account</h2>
        <DeleteAccountSection />
      </section>

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

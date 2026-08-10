import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { indexById, displayName, type ProfileRef } from '@/lib/queries/util'
import { BlockedList, type BlockedPerson } from './BlockedList'

export const metadata = { title: 'Settings' }

/**
 * Settings. Currently the blocked list and nothing else — it exists now
 * because unblocking was app-only, which made blocking a one-way door on the
 * web. Shop and treatment editing land here later.
 */
export default async function SettingsPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  // ONLY blocks this user created. blocks_select_involved would also return
  // rows where they are the blocked party, and showing those would reveal who
  // has blocked them — which the design deliberately hides. A block conceals
  // the pair in both directions precisely so neither person can tell which way
  // round it was.
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

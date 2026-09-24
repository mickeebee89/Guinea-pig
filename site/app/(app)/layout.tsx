import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getConversations } from '@/lib/queries/conversations'
import { getDashboardUser } from '@/lib/queries/dashboard'
import { isStylist as isStylistRole, isModel as isModelRole } from '@/lib/roles'
import { getUnreadNotificationCount } from '@/lib/queries/notifications'
import { AppNav } from '@/components/AppNav'
import { SuspensionNotice, type ActiveSuspension } from '@/components/SuspensionNotice'

/**
 * THE AUTH GATE for everything under (app).
 *
 * This is the gate — not proxy.ts. That file only refreshes the session cookie
 * and deliberately makes no authorisation decision, so forgetting to add a path
 * to its matcher costs a stale token rather than an auth bypass.
 *
 * Because this is a layout, a route is protected by living in the folder. There
 * is no list to keep in sync and no per-page check to forget: a new page under
 * (app) inherits the gate by existing.
 *
 * getUser(), never getSession() — getSession() trusts whatever the cookie says
 * without verifying it against the auth server. Fine for a display name, not
 * for deciding who gets in.
 *
 * ── THE UNREAD BADGE COSTS SOMETHING, AND IT IS WORTH KNOWING WHAT ─────────
 * It re-runs the whole conversation query on every (app) page load, because the
 * "which sessions are openable" rule that decides what counts as unread lives
 * in that query and cannot be reduced to a single count(*) without duplicating
 * it. Duplicating it is how the two drift apart and the badge starts disagreeing
 * with the list.
 *
 * At this data size that is a few indexed queries and not worth optimising. If
 * it ever is, the fix is ONE database function returning the count, called from
 * both places — not a second copy of the rule here.
 *
 * The notification dot beside it is cheap by comparison — one count(*) on an
 * indexed pair of columns, no rows returned. It is in the nav rather than only
 * in the panel halfway down the dashboard because a stylist who does not scroll
 * never learns an application came in, and the panel is below the fold on a
 * phone.
 *
 * It fails soft: a badge is not worth a 500 on every page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  let unread = 0
  let unreadNotifications = 0
  // Default to the MODEL nav if the role read fails: browsing and applying are
  // harmless to offer, where offering a shop editor to someone with no shop is
  // a link to a refusal.
  let isProvider = false
  let isModel = true
  /**
   * ⚠️ FAILS OPEN, DELIBERATELY. If this read fails the member sees the app,
   * not a suspension notice — and the four RESTRICTIVE policies still refuse
   * every write. Telling someone they are suspended because an RPC wobbled
   * would be the worse error, and it is the same stance shop/actions.ts takes:
   * "An RPC error is not treated as 'not suspended' OR as suspended... the
   * database still decides."
   */
  let suspension: ActiveSuspension | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const [convs, me, notes, susp] = await Promise.all([
      getConversations(supabase, user.id),
      getDashboardUser(supabase, user.id),
      getUnreadNotificationCount(supabase, user.id),
      // Read here rather than in each page: a suspension is a property of the
      // person, so it belongs where the auth gate is. Item 120.
      supabase.rpc('my_suspension'),
    ])
    unread = convs.reduce((n, c) => n + c.unreadCount, 0)
    isProvider = isStylistRole(me.role)
    isModel = isModelRole(me.role)
    unreadNotifications = notes

    const row = (susp.data as
      { banned: boolean; suspended_until: string | null; message: string | null }[] | null)?.[0]
    // my_suspension() returns only an ACTIVE one, so a row IS the suspension:
    // there is no expiry check to get wrong here, and deliberately so.
    if (row) {
      suspension = {
        banned: !!row.banned,
        suspendedUntil: row.suspended_until ?? null,
        message: row.message ?? null,
      }
    }
  } catch (e) {
    console.error('[app layout] unread count failed', e)
  }

  return (
    <div className="min-h-dvh bg-cream">
      <AppNav
        unread={unread}
        unreadNotifications={unreadNotifications}
        isProvider={isProvider}
        isModel={isModel}
      />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Explains; never enforces. The nav stays so they are not trapped on a
            dead page, and Settings stays reachable so they can delete their
            account — see SuspensionNotice's header. */}
        <SuspensionNotice suspension={suspension} isProvider={isProvider}>
          {children}
        </SuspensionNotice>
      </main>
    </div>
  )
}

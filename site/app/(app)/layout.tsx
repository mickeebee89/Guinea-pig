import { redirect } from 'next/navigation'
import { createSupabaseServerClient, getUser } from '@/lib/supabase-server'
import { getConversations } from '@/lib/queries/conversations'
import { AppNav } from '@/components/AppNav'

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
 * It fails soft: a badge is not worth a 500 on every page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/sign-in')

  let unread = 0
  try {
    const supabase = await createSupabaseServerClient()
    const convs = await getConversations(supabase, user.id)
    unread = convs.reduce((n, c) => n + c.unreadCount, 0)
  } catch (e) {
    console.error('[app layout] unread count failed', e)
  }

  return (
    <div className="min-h-dvh bg-cream">
      <AppNav unread={unread} />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}

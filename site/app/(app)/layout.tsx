import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase-server'

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
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/sign-in')

  return <>{children}</>
}

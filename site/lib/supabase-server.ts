import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * The AUTHENTICATED client. Cookie-backed session, one per request.
 *
 * ⚠️ NEVER IMPORT THIS FROM app/(public)/**.
 *
 * Reading cookies makes a route dynamic. The entire phase-1 SEO surface —
 * homepage, six treatment pages, four legal pages — depends on those routes
 * staying statically rendered. One import of this module into (public) turns
 * them dynamic, and nothing fails: the pages still work, still look right, and
 * quietly stop being prerendered. That is why the check is a build step
 * (scripts/check-client-boundary.mjs) and not a comment.
 *
 * Use `@/lib/supabase-public` in (public). It has no cookie access and cannot
 * make a route dynamic.
 *
 * The names are deliberately not `supabase.ts` and `supabase-auth.ts` — an
 * import line should say which half of the app it belongs to without anyone
 * having to remember the rule.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Harmless: proxy.ts refreshes the session on every (app) request,
            // so the write that matters happens there.
          }
        },
      },
    },
  )
}

/**
 * The signed-in user, or null. Verified against the auth server rather than
 * decoded from the cookie.
 *
 * Uses getUser(), never getSession(). getSession() returns whatever the cookie
 * claims without checking it — fine for reading a display name, not fine for
 * deciding whether someone is allowed in.
 */
export async function getUser() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the Supabase session cookie. That is ALL it does.
 *
 * ── THE MATCHER IS AN ALLOWLIST. NEVER A CATCH-ALL. ────────────────────────
 *
 * The admin console's proxy.ts used a catch-all with exclusions:
 *
 *   matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)']
 *
 * When that app sat at the repo root, Turbopack compiled it into THIS site's
 * build and it would have put a login wall in front of every public page and
 * every crawler. It only failed because a dependency was missing. See
 * web-phase-1-handover.md.
 *
 * So: list the authenticated paths explicitly. A path nobody added is a path
 * this file never touches, which means it stays static — the safe direction.
 * A catch-all with exclusions fails the other way: forget an exclusion and a
 * public page silently becomes dynamic, or worse, gated.
 *
 * ── THIS IS NOT THE AUTH GATE ──────────────────────────────────────────────
 *
 * app/(app)/layout.tsx is the gate. It is a Server Component that calls
 * getUser() and redirects. Keeping the two separate means forgetting to add a
 * path here costs a STALE TOKEN, not an auth bypass — a user gets signed out
 * early instead of a stranger getting in.
 *
 * If this file ever starts making authorisation decisions, that property is
 * gone.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Touching the user is what triggers a refresh when the access token is near
  // expiry. The result is deliberately unused — authorisation happens in the
  // (app) layout, not here.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    // Authenticated area. Add new (app) routes here.
    '/dashboard/:path*',
    '/account/:path*',
    // Auth screens need the cookie writer for sign-in and for the callbacks
    // that exchange a code for a session.
    //
    // No '/sign-out' entry: signing out is a Server Action, not a route, so it
    // POSTs to whichever (app) page hosts the button — already covered above.
    // A GET /sign-out would be fireable by an <img src> on any other site.
    '/sign-in',
    '/sign-up',
    '/forgot-password',
    '/auth/:path*',
  ],
}

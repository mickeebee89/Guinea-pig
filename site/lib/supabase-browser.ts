import { createBrowserClient } from '@supabase/ssr'

/**
 * The BROWSER client. Session read from the same cookies the server client
 * writes, running in the user's browser.
 *
 * ⚠️ NEVER IMPORT THIS FROM app/(public)/**.
 *
 * It exists for one reason: realtime. A `postgres_changes` subscription is a
 * WebSocket, and a WebSocket cannot live in a Server Component. Chat is the
 * whole point of slice 2, so `(app)` needs a client-side session client and
 * there is no way around that.
 *
 * ── WHY THIS NEEDED A DECISION, NOT JUST A FILE ────────────────────────────
 *
 * Phase 1 deliberately named the key `SUPABASE_ANON_KEY` with NO `NEXT_PUBLIC_`
 * prefix. This file requires the prefixed form, so it reverses that — and it is
 * worth being precise about what was and wasn't given up.
 *
 * The anon key is PUBLIC BY DESIGN and always was. It is in every mobile app
 * bundle already. The prefix was never a security boundary; it was a forcing
 * function that made a client-side query on a `(public)` page *impossible to
 * write*, which protected static rendering and therefore the entire SEO surface.
 *
 * That purpose survives. The guarantee just moves from "the key is unreachable"
 * to "the build fails" — enforced by scripts/check-client-boundary.mjs, which
 * already does exactly this for the other two clients. A build that fails is a
 * stronger guarantee than a convention that holds only while everyone remembers
 * it (principle 1, web-phase-1-handover.md).
 *
 * ── SINGLETON, DELIBERATELY ────────────────────────────────────────────────
 *
 * Every call to createBrowserClient() opens its own realtime connection. A
 * component that creates one per render, or two components that each make their
 * own, produce duplicate subscriptions — which shows up as messages arriving
 * twice, not as an error. Memoised here so that cannot happen.
 *
 * Use `@/lib/supabase-server` for anything rendered on the server, which is
 * every initial page load. This client is for subscriptions and for writes made
 * from an interaction.
 */
let client: ReturnType<typeof createBrowserClient> | undefined

export function getSupabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return client
}

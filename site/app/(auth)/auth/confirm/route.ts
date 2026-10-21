import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { POSTCODE_MAX } from '@/lib/signup'
import { lookupPostcode } from '@/lib/postcode'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Email confirmation callback — https://cavybeauty.com/auth/confirm
 *
 * Registered in Supabase Auth → URL Configuration alongside the existing
 * guineapigapp.co.uk entries. ADDITIVE: the shipped mobile app still points at
 * guineapigapp.co.uk/auth/confirmed and keeps working untouched. Nothing is
 * redirected — a 301 on an auth callback is the one redirect that can lose the
 * credential, because implicit-flow tokens arrive in the URL fragment and
 * fragment survival across redirects is browser-dependent.
 *
 * TWO LINK FORMATS, BOTH HANDLED
 *   Supabase sends either `?code=` (PKCE) or `?token_hash=&type=` depending on
 *   the email template and project settings. I cannot see which this project
 *   uses, so both are handled rather than guessing and shipping a callback that
 *   works for one and silently 400s for the other.
 *
 *   A third form exists — `#access_token=` in the fragment — which a server
 *   route can never see, because browsers do not send fragments. If that turns
 *   out to be the format in use, this route will report "link is invalid" and
 *   the fix is a client-side handler, not a change here. The failure is at
 *   least legible.
 */
/**
 * Store the postcode she typed at signup, now that she has a session.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  ⚠⚠ WHY HERE AND NOT AT SIGNUP
 * ═══════════════════════════════════════════════════════════════════════
 * `set_my_postcode` is SECURITY INVOKER and writes `where id = auth.uid()`.
 * **signUp() returns a confirmation email, not a session**, so at signup there
 * is no `auth.uid()` and that function raises 42501. This route is the first
 * place a session exists — both branches below establish one.
 *
 * The only alternative was writing it inside `handle_new_auth_user`, which puts
 * location in the signup transaction, where anything that raises reaches the
 * user as "Database error saving new user".
 *
 * ⚠⚠ THE POSTCODE IS RE-LOOKED-UP, NOT TRUSTED. `raw_user_meta_data` is
 * whatever was sent to GoTrue, and anyone can call signUp directly with the
 * anon key and put an arbitrary string in it. So the string is capped,
 * re-resolved through the same server-side lookup the settings page uses, and
 * the COORDINATE always comes from that lookup — never from the metadata.
 *
 * ⚠️ IT CANNOT BREAK CONFIRMATION. Every failure path returns silently: a
 * member whose postcode could not be stored is signed in with no postcode,
 * which is the same state as not having typed one, and Settings fixes it. A
 * confirmation link that failed because of a postcode would be the worst
 * trade in this flow.
 */
async function storeSignupPostcode(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const raw = (user.user_metadata as { signup_postcode?: unknown } | null)?.signup_postcode
    if (typeof raw !== 'string') return
    // ⚠️ CAPPED BEFORE IT IS LOOKED AT. See POSTCODE_MAX: the cap on our own
    // write cannot bind a crafted client, so the read side slices too. The
    // worst case is 8 junk characters handed to a lookup that refuses them.
    const candidate = raw.trim().slice(0, POSTCODE_MAX)
    if (!candidate) return

    // ⚠️ ALREADY SET? LEAVE IT. A confirmation link can be opened more than
    // once, and she may have set a different postcode in Settings in between.
    // Overwriting it with the signup value would undo a deliberate change.
    const { data: existing } = await supabase
      .from('users').select('postcode').eq('id', user.id).maybeSingle()
    if ((existing as { postcode: string | null } | null)?.postcode) return

    const found = await lookupPostcode(candidate)
    if (!found.ok) return   // malformed, gone, unplaceable, or the service is down

    // The audited path: all five arguments, the towns included (0099), and the
    // all-or-none invariant enforced in SQL.
    const { error } = await supabase.rpc('set_my_postcode', {
      p_postcode: found.place.postcode,
      p_lat: found.place.latitude,
      p_lng: found.place.longitude,
      p_district: found.place.adminDistrict ?? undefined,
      p_bua: found.place.bua ?? undefined,
    })
    if (error) console.error('[confirm] postcode save failed', { code: error.code, message: error.message })
  } catch (e) {
    // ⚠️ SWALLOWED ON PURPOSE, AND THIS IS THE ONE PLACE IN THE CODEBASE WHERE
    // THAT IS RIGHT. The caller's next line redirects her into the product. An
    // exception escaping here would turn a confirmed account into an error page
    // over an optional field.
    console.error('[confirm] postcode save threw', e)
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const next = url.searchParams.get('next') ?? '/dashboard'

  // Supabase reports its own failures here — an expired link, a used link.
  const authError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (authError) {
    return NextResponse.redirect(
      new URL(`/auth/problem?reason=${encodeURIComponent(authError)}`, url.origin),
    )
  }

  const supabase = await createSupabaseServerClient()

  const code = url.searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/problem?reason=${encodeURIComponent(error.message)}`, url.origin),
      )
    }
    // ⚠️ AFTER the exchange, so there is a session to write with. Awaited
    // rather than fired and forgotten: a serverless function can be frozen the
    // moment it returns a response, so an un-awaited write is a write that may
    // never happen.
    await storeSignupPostcode(supabase)
    return NextResponse.redirect(new URL(next, url.origin))
  }

  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'signup' | 'email_change' | 'recovery' | 'invite',
      token_hash: tokenHash,
    })
    if (error) {
      return NextResponse.redirect(
        new URL(`/auth/problem?reason=${encodeURIComponent(error.message)}`, url.origin),
      )
    }
    // ⚠️ BOTH BRANCHES, because CLAUDE.md records that the live templates use
    // token_hash links — so THIS is the one that actually runs today, and the
    // `code` branch above is the one that would be missed if only one were
    // wired. A postcode stored on one link format and not the other would look
    // like the lookup being unreliable.
    await storeSignupPostcode(supabase)
    return NextResponse.redirect(new URL(next, url.origin))
  }

  return NextResponse.redirect(
    new URL('/auth/problem?reason=This%20link%20is%20missing%20its%20confirmation%20code', url.origin),
  )
}

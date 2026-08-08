import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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
    return NextResponse.redirect(new URL(next, url.origin))
  }

  return NextResponse.redirect(
    new URL('/auth/problem?reason=This%20link%20is%20missing%20its%20confirmation%20code', url.origin),
  )
}

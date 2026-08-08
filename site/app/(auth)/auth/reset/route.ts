import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * Password-reset callback — https://cavybeauty.com/auth/reset
 *
 * Same additive story as /auth/confirm: registered alongside
 * guineapigapp.co.uk/auth/reset, which the shipped app still uses and which is
 * NOT redirected.
 *
 * This route only exchanges the link for a session. Setting the new password
 * happens on /auth/new-password, because the exchange can only be performed
 * ONCE — doing it in a page component would fail the moment the user reloads,
 * mistypes a password, or hits back.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl

  const authError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (authError) {
    return NextResponse.redirect(
      new URL(`/auth/problem?reason=${encodeURIComponent(authError)}`, url.origin),
    )
  }

  const supabase = await createSupabaseServerClient()
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')

  let error = null
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code))
  } else if (tokenHash) {
    ({ error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash }))
  } else {
    return NextResponse.redirect(
      new URL('/auth/problem?reason=This%20reset%20link%20is%20missing%20its%20code', url.origin),
    )
  }

  if (error) {
    return NextResponse.redirect(
      new URL(`/auth/problem?reason=${encodeURIComponent(error.message)}`, url.origin),
    )
  }

  // Session cookie is now set, so /auth/new-password can call updateUser().
  return NextResponse.redirect(new URL('/auth/new-password', url.origin))
}

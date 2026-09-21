/**
 * Reading a Supabase Auth error without showing the user Supabase's words.
 *
 * GoTrue's messages are written for developers ("For security purposes, you can
 * only request this after 42 seconds.") and change between versions. Anything a
 * person sees is decided here, by CODE and STATUS, and the raw message only ever
 * goes to the server log.
 *
 * Plain module, not 'use server': a server-action file may only export async
 * functions, and this is shared by two of them.
 */

type AuthErrorLike = { status?: number; code?: string; message?: string } | null | undefined

/**
 * Too many emails, too soon. Supabase allows one auth email per user per 60 s,
 * plus a project-wide hourly cap; both arrive as 429. The message test is a
 * backstop for a GoTrue that reports the status without a code.
 */
export function isRateLimited(e: AuthErrorLike): boolean {
  if (!e) return false
  if (e.status === 429) return true
  if (e.code === 'over_email_send_rate_limit' || e.code === 'over_request_rate_limit') return true
  return /for security purposes|rate limit/i.test(e.message ?? '')
}

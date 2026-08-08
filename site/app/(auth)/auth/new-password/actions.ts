'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * Set the new password, server-side.
 *
 * WHY A SERVER ACTION AND NOT createBrowserClient
 *   A browser Supabase client needs NEXT_PUBLIC_SUPABASE_ANON_KEY, and phase 1
 *   deliberately named the key WITHOUT that prefix so it is unreachable from
 *   Client Components — which is what makes it impossible to accidentally write
 *   a client-side query that bypasses the ISR cache and breaks SEO on the
 *   public half.
 *
 *   Adding a NEXT_PUBLIC_ variant "just for auth" would put the key back in
 *   every bundle and quietly retire that guarantee for the whole app. A Server
 *   Action reaches the same session through the same cookie-backed client the
 *   rest of (app) uses, and the key stays server-only.
 *
 *   If a future feature genuinely needs a browser client — realtime chat in
 *   slice 2 is the likely one — that is a deliberate decision to make then,
 *   with the trade-off understood, not a side effect of a password form.
 */
export async function updatePassword(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  // Re-checked here, not only in the browser: the client checks are for a fast,
  // specific message, not for enforcement.
  if (password.length < 8) return { error: 'At least 8 characters' }
  if (password !== confirm) return { error: 'Passwords do not match' }

  const supabase = await createSupabaseServerClient()

  // Only reachable with a session, which /auth/reset established from the
  // emailed link. Without one there is nothing to update and nobody has proved
  // they own the mailbox.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Your reset link has expired. Please request a new one.' }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  return { ok: true }
}

'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * Sign out.
 *
 * A Server Action rather than a GET route on purpose. A GET /sign-out can be
 * triggered by an <img src="https://cavybeauty.com/sign-out"> on any other
 * site — harmless-looking, and it logs the user out mid-session with no way to
 * tell why. Server Actions are POST with an origin check, so a third-party page
 * cannot fire this.
 */
export async function signOut() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/')
}

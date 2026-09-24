'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

/**
 * Correcting your own name. Audit item 104.
 *
 * ⚠️ THE RULES ARE IN THE DATABASE, AND THIS DOES NOT REPEAT THEM.
 *
 * `guard_users_name_change` (0056) enforces the cooldown, the suspension
 * check, the empty-name check and the one-letter initial. That is not belt and
 * braces — it is the ONLY place they can live: `users can update own row` is
 * permissive over the whole row and 0040's denylist does not name first_name,
 * so a member can write this column directly through the API. A limit checked
 * only here would be a limit only for people who use the button.
 *
 * So this trims, sends, and TRANSLATES what comes back. Re-implementing the
 * cooldown here would create a second copy of the number that could disagree
 * with the trigger's, and the trigger's is the one that decides.
 */

export type NameResult = { ok: true } | { ok: false; error: string }

export async function saveMyName(firstName: string, lastInitial: string): Promise<NameResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const first = firstName.trim()
  const initial = lastInitial.trim().toUpperCase()

  // Checked here too, only because it costs a round trip to be told by the
  // database what the form already knows. Everything else is the trigger's.
  if (!first) return { ok: false, error: 'Your first name cannot be empty.' }
  if (first.length > 40) return { ok: false, error: 'That first name is too long (40 characters at most).' }
  if (initial && !/^[A-Za-z]$/.test(initial)) {
    return { ok: false, error: 'Your surname initial should be a single letter, or left blank.' }
  }

  const { error } = await supabase
    .from('users')
    .update({ first_name: first, last_initial: initial || null })
    .eq('id', user.id)

  if (error) {
    console.error('[settings] name change refused', { code: error.code, message: error.message })
    // ⚠️ THE TRIGGER'S MESSAGES ARE WRITTEN FOR HER AND ARE SHOWN AS-IS.
    //
    // They name the date she can change it again, and the reason a suspended
    // account cannot. Replacing them with something generic would throw away
    // the only sentence that tells her what to do — and these are the two
    // codes it raises deliberately, not incidental database errors.
    //
    // 22023 is the cooldown; 42501 is suspended or not-your-row; 23514 is a
    // shape the form should have caught.
    if (['22023', '42501', '23514'].includes(error.code ?? '')) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: 'That didn’t save. Your name is unchanged.' }
  }

  // Her name is on every surface that joins public_profiles, which is most of
  // them. These are the ones she can see from here.
  revalidatePath('/settings')
  revalidatePath('/profile')
  revalidatePath('/dashboard')
  revalidatePath(`/model/${user.id}`)
  return { ok: true }
}

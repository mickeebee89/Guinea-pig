'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { MAX_INVITE_MESSAGE, inviteErrorMessage } from '@/lib/queries/invites'

type Result = { ok: true } | { ok: false; error: string }


/**
 * Invite one model.
 *
 * ── ⚠️ EVERY CHECK THAT MATTERS IS IN `invite_model`, NOT HERE ────────────
 * Published shop, discoverability, blocks either way, suspension, the
 * one-per-pair rule and the banned-words screen all live inside the function
 * (0113). This action does three things and no more: it holds the session, it
 * caps the message before sending it, and it turns a SQLSTATE into a sentence.
 *
 * That is not laziness about validation — it is where validation has to be.
 * A check in this file protects this file. The Salon Floor calls the same
 * function from `salon-floor/actions.ts`, dormant mobile calls it from a
 * screen nobody here can see, and a check written twice is a check that will
 * disagree with itself. 0113's header has the full argument.
 *
 * ⚠️ THE STYLIST NEVER SEES THE MODEL'S EMAIL ADDRESS, and nothing in this
 * path could give it to her: `invitable_models` does not return one, the
 * invite row does not hold one, and the email is sent by the database's own
 * notification path, which she never touches.
 */
export async function sendInvite(modelUserId: string, message: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const trimmed = message.trim()
  if (trimmed.length > MAX_INVITE_MESSAGE) {
    return {
      ok: false,
      error: `That message is a bit long — ${MAX_INVITE_MESSAGE} characters or fewer.`,
    }
  }

  const { error } = await supabase.rpc('invite_model', {
    p_model_user_id: modelUserId,
    // ⚠️ `undefined`, NOT `null`, FOR AN EMPTY MESSAGE — and the generated
    // types are what said so: a DEFAULTed argument is typed `string |
    // undefined`, because omitting the key is how PostgREST lets the
    // function's own default apply. Sending an explicit null would also work
    // today, but it asserts a value where the point is to assert nothing, and
    // it is the same call the one-argument callers make.
    p_message: trimmed === '' ? undefined : trimmed,
  })

  if (error) {
    // ⚠️ MAPPED ON SQLSTATE, NOT ON MESSAGE TEXT, and the sentences live in
    // lib/queries/invites.ts because the Salon Floor refuses the same six
    // codes from the same function. Its header has the 42501 argument.
    console.error('[models] invite failed', { code: error.code, message: error.message })
    return { ok: false, error: inviteErrorMessage(error.code) }
  }

  revalidatePath('/models')
  return { ok: true }
}

/**
 * The model declines an invite.
 *
 * ⚠️ IT TELLS THE STYLIST NOTHING BEYOND THE STATUS. No notification, no
 * email, no reason, no count. She can see on her own list that it was
 * declined, and that is the whole of it — a decline that arrived as an
 * interruption would make saying no cost something, and the point of the
 * button is that it costs nothing.
 *
 * ⚠️ BOTH COLUMNS, BECAUSE THE CHECK CONSTRAINT DEMANDS BOTH.
 * `invites_declined_at_agrees` ties status to declined_at, so setting one
 * without the other is refused by the database. RLS pins the destination
 * state to 'declined', so this cannot be used to un-decline.
 */
export async function declineInvite(inviteId: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('invites')
    .update({ status: 'declined', declined_at: new Date().toISOString() })
    .eq('id', inviteId)

  if (error) {
    console.error('[models] decline failed', error)
    return { ok: false, error: 'That didn’t save. Nothing has changed.' }
  }

  revalidatePath('/invites')
  revalidatePath('/notifications')
  return { ok: true }
}

/**
 * The model's own discoverability switch.
 *
 * ⚠️ TURNING IT OFF DOES NOT WITHDRAW INVITES ALREADY SENT. She keeps the
 * ones she has, and can decline them. Deleting them would remove her own
 * record of who approached her, which is the opposite of what a safety
 * control should do.
 */
export async function setDiscoverable(discoverable: boolean): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('users')
    .update({ discoverable })
    .eq('id', user.id)

  if (error) {
    console.error('[models] discoverable toggle failed', error)
    return { ok: false, error: 'That didn’t save. Your setting is unchanged.' }
  }

  revalidatePath('/settings')
  return { ok: true }
}

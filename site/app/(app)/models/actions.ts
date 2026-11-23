'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { MAX_INVITE_MESSAGE } from '@/lib/queries/invites'

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
    // ⚠️ MAPPED ON SQLSTATE, NOT ON MESSAGE TEXT — the rule
    // salon-floor/actions.ts already states in full. The codes are chosen in
    // 0113 to be distinguishable; the wordings are not promised to anyone.
    console.error('[models] invite failed', { code: error.code, message: error.message })
    switch (error.code) {
      case '42501':
        // ⚠️ ONE SENTENCE FOR TWO CAUSES, DELIBERATELY. The function returns
        // 42501 for "your shop is not published" AND for "that member cannot
        // be invited" (not a model, not discoverable, blocked, suspended) —
        // and the second group is one code on purpose, so a stylist cannot
        // probe which. But the FIRST is about her own account and is
        // actionable, so the two are told apart here by what she can see: if
        // she reached this page at all her shop is published, because
        // invitable_models returns nothing otherwise.
        return {
          ok: false,
          error: 'That member can’t be invited. They may have turned off invites, or your shop may '
            + 'have come unpublished — check your shop page.',
        }
      case '23505':
        return { ok: false, error: 'You’ve already invited them. One invite each, so they don’t get chased.' }
      case '23514':
        return { ok: false, error: 'That message can’t be sent. Please reword it and try again.' }
      case '55000':
        // ⚠️ NOT HER FAULT, AND IT MUST NOT READ AS IF IT WERE. The screen
        // could not read its word list, so nothing was sent — the same
        // distinction lib/postcode.ts draws for 'unavailable'.
        return { ok: false, error: 'We couldn’t check that message just now, so nothing was sent. Try again in a moment.' }
      case '22023':
        return { ok: false, error: 'That’s your own account.' }
      case '22001':
        return { ok: false, error: `That message is a bit long — ${MAX_INVITE_MESSAGE} characters or fewer.` }
      default:
        return { ok: false, error: 'That didn’t send. Nothing has changed.' }
    }
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

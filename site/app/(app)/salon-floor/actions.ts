'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { FLOOR_MAX } from './constants'

type Result = { ok: true } | { ok: false; error: string }
/** `held` means the screen put it in review rather than on the floor. */
type PostResult = { ok: true; held: boolean } | { ok: false; error: string }

/**
 * Post to the Salon Floor. Audit item 141.
 *
 * ⚠️ THE AUTHOR IS TAKEN FROM THE SESSION, NEVER FROM THE CLIENT. RLS would
 * refuse a mismatched author_user_id anyway (0072), but sending one at all
 * invites a caller to try, and the server knows who it is talking to.
 *
 * provider_id is resolved here too rather than passed in: a stylist's post
 * carries her shop so it can reach cavybeauty.com through public_stylist_status,
 * and a model's carries null, which is what keeps her post off the public web.
 * Letting a client choose that value is letting it choose whether a post is
 * published to the open internet.
 */
export async function postToFloor(body: string): Promise<PostResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const text = body.trim()
  if (!text) return { ok: false, error: 'Write something first.' }
  if (text.length > FLOOR_MAX) {
    return { ok: false, error: `That is longer than ${FLOOR_MAX} characters.` }
  }

  const { data: prov } = await supabase
    .from('providers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  // ⚠️ READ BACK WHAT THE SCREEN DECIDED. The composer needs to tell the author
  // when a post has gone for review, and the only honest source for that is the
  // row the trigger just wrote. A client-side copy of the digit rule would be a
  // second implementation of it, free to disagree with the database the moment
  // either changes — the fault this codebase has recorded in safeList, in
  // FeaturedStylists, in five copies of `date >= today`, and in two email
  // allowlists.
  const { data: row, error } = await supabase
    .from('status_posts')
    .insert({
      author_user_id: user.id,
      provider_id: (prov as { id: string } | null)?.id ?? null,
      body: text,
    })
    .select('moderation_status')
    .single()

  if (error) {
    console.error('[salon-floor] post failed', error)
    return { ok: false, error: 'That didn’t post. Nothing has changed.' }
  }

  revalidatePath('/salon-floor')
  return { ok: true, held: (row as { moderation_status: string }).moderation_status !== 'approved' }
}

/** Take your own back down. No edit, deliberately — see 0031. */
export async function removeFromFloor(postId: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('status_posts').delete().eq('id', postId)
  if (error) {
    console.error('[salon-floor] delete failed', error)
    return { ok: false, error: 'That didn’t come down. Nothing has changed.' }
  }

  revalidatePath('/salon-floor')
  return { ok: true }
}

/**
 * A stylist invites the author of a post.
 *
 * ⚠️ NO RATE LIMIT, DECIDED 2 Oct 2026. A stylist may invite whoever she likes,
 * as often as she likes — and since 0073 that reaches an inbox rather than a
 * badge, so the decision has more weight than it did.
 *
 * It writes a notification and nothing else: there is no invite record, no
 * accept, no decline. **The application IS the response.** She lands on the
 * shop with Apply on it, which is the flow she already knows; a parallel
 * accept/decline would give two ways to say yes and two things to keep in step.
 */
export async function inviteFromFloor(modelUserId: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  // ⚠️ ONE RPC SINCE 0081 (item 144 stage C). The provider lookup, the
  // self-invite check and the copy all moved into invite_model, which derives
  // the inviting stylist from auth.uid() — so an invite cannot be sent AS
  // somebody else, and the wording exists once rather than three times. Mobile
  // had two other copies of it saying 'wants you as their model' and 'Tap to
  // view their shop', both of which reached inboxes.
  const { error } = await supabase.rpc('invite_model', {
    p_model_user_id: modelUserId,
  })

  if (error) {
    // ⚠️ MAPPED ON SQLSTATE, NOT ON MESSAGE TEXT. The two refusals carry
    // distinct codes on purpose — 42501 for "not a stylist" and 22023 for
    // "your own account" — so this does not depend on wording that a later
    // migration might reword. Matching on sqlerrm is what made 0079's test 5
    // defensible and a sqlstate match wrong THERE; here it is the reverse,
    // because here the codes differ and the messages are what might change.
    console.error('[salon-floor] invite failed', { code: error.code, message: error.message })
    if (error.code === '42501') return { ok: false, error: 'Only a stylist can invite someone.' }
    if (error.code === '22023') return { ok: false, error: 'That is your own post.' }
    return { ok: false, error: 'That didn’t send. Nothing has changed.' }
  }

  return { ok: true }
}

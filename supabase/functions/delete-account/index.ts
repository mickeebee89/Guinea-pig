// Supabase Edge Function — delete-account
// Permanently deletes the AUTHENTICATED caller's own account: their DB rows,
// their storage objects, and their auth user. Never trusts a passed id — the
// target id is always derived from the verified JWT.
// Deploy: supabase functions deploy delete-account

import { createClient } from 'npm:@supabase/supabase-js@2'

// ── Clients ───────────────────────────────────────────────────────────────────

// Service-role client — bypasses RLS for the authoritative cascade of deletes.
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Resolve the caller from the JWT. The id we delete is ALWAYS this user's id —
// the request body is ignored entirely, so a caller can never target someone else.
async function getVerifiedUser(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  )
  const { data: { user } } = await anonClient.auth.getUser()
  return user
}

// ── Deletion ──────────────────────────────────────────────────────────────────

// Clear every object a user owns in a bucket. All app buckets key by `${userId}/…`,
// so listing that folder and removing its files covers them.
async function clearBucketFolder(bucket: string, userId: string, errors: Record<string, string>) {
  try {
    const { data: files, error } = await db.storage.from(bucket).list(userId, { limit: 1000 })
    if (error) { errors[`storage_${bucket}`] = error.message; return }
    if (files && files.length > 0) {
      const paths = files.map(f => `${userId}/${f.name}`)
      const { error: rmErr } = await db.storage.from(bucket).remove(paths)
      if (rmErr) errors[`storage_${bucket}`] = rmErr.message
    }
  } catch (e) {
    errors[`storage_${bucket}`] = e instanceof Error ? e.message : String(e)
  }
}

async function deleteAccount(me: string) {
  const errors: Record<string, string> = {}

  // Best-effort: record the error but keep going, so one missing table can't strand
  // a half-deleted user. Works for both .delete() and .update() (both return {error}).
  const run = async (label: string, q: any) => {
    const { error } = await q
    if (error) errors[label] = error.message
  }

  // ── Precompute the id sets the blocking-FK deletes below key on ──────────────
  // Everything the auth.admin.deleteUser() cascade CANNOT reach (NO ACTION / RESTRICT
  // FKs) must be cleared/nulled first, or the final users/auth delete FAILS.

  const { data: provRows } = await db.from('providers').select('id').eq('user_id', me)
  const providerIds: string[] = (provRows ?? []).map((r: any) => r.id)

  // sessions has BOTH model_id and model_user_id (both hold the model's user id) —
  // resolve via both plus provider_id so no session is missed.
  const sessionSet = new Set<string>()
  const addSessions = (rows: any[] | null) => { for (const r of rows ?? []) sessionSet.add(r.id) }
  addSessions((await db.from('sessions').select('id').eq('model_id', me)).data)
  addSessions((await db.from('sessions').select('id').eq('model_user_id', me)).data)
  if (providerIds.length > 0) addSessions((await db.from('sessions').select('id').in('provider_id', providerIds)).data)
  const sessionIds = [...sessionSet]

  const reportSet = new Set<string>()
  const addReports = (rows: any[] | null) => { for (const r of rows ?? []) reportSet.add(r.id) }
  addReports((await db.from('reports').select('id').eq('reporter_id', me)).data)
  addReports((await db.from('reports').select('id').eq('reported_id', me)).data)
  if (sessionIds.length > 0) addReports((await db.from('reports').select('id').in('session_id', sessionIds)).data)
  const reportIds = [...reportSet]

  // ── Ordered clear of the blocking (NO ACTION / RESTRICT) references ──────────

  // 1) moderation_actions → reports (NO ACTION): clear before deleting reports.
  if (reportIds.length > 0) await run('moderation_actions', db.from('moderation_actions').delete().in('related_report_id', reportIds))

  // 2) session_consents → sessions (RESTRICT): the critical one — blocks sessions.
  if (sessionIds.length > 0) await run('session_consents', db.from('session_consents').delete().in('session_id', sessionIds))

  // 3) reports (NO ACTION → users/sessions): delete by the ids gathered above.
  if (reportIds.length > 0) await run('reports', db.from('reports').delete().in('id', reportIds))

  // 4) reviews (NO ACTION → users/sessions): by the user, about the user, or in their sessions.
  await run('reviews_reviewer', db.from('reviews').delete().eq('reviewer_id', me))
  await run('reviews_reviewee', db.from('reviews').delete().eq('reviewee_id', me))
  if (sessionIds.length > 0) await run('reviews_session', db.from('reviews').delete().in('session_id', sessionIds))

  // 5) messages (sender_id NO ACTION → users; session_id → sessions).
  await run('messages_sender', db.from('messages').delete().eq('sender_id', me))
  if (sessionIds.length > 0) await run('messages_session', db.from('messages').delete().in('session_id', sessionIds))

  // 6) notifications (session_id NO ACTION → sessions; plus the user's own).
  await run('notifications_user', db.from('notifications').delete().eq('user_id', me))
  if (sessionIds.length > 0) await run('notifications_session', db.from('notifications').delete().in('session_id', sessionIds))

  // 7) admin_audit_log (NO ACTION): NULL the pointers rather than delete — preserve the audit trail.
  await run('audit_user', db.from('admin_audit_log').update({ target_user_id: null }).eq('target_user_id', me))
  if (providerIds.length > 0) await run('audit_provider', db.from('admin_audit_log').update({ target_provider_id: null }).in('target_provider_id', providerIds))
  if (sessionIds.length > 0)  await run('audit_session',  db.from('admin_audit_log').update({ target_session_id: null }).in('target_session_id', sessionIds))

  // 8) verification_requests.reviewed_by (NO ACTION): NULL where this user reviewed
  //    OTHERS as an admin (their OWN requests cascade from users).
  await run('verification_reviewed_by', db.from('verification_requests').update({ reviewed_by: null }).eq('reviewed_by', me))

  // 9) sessions — now unblocked.
  if (sessionIds.length > 0) await run('sessions', db.from('sessions').delete().in('id', sessionIds))

  // 10) providers — cascades its children (availability, provider_treatments,
  //     portfolio_items, treatments, favourites(provider_id)).
  if (providerIds.length > 0) await run('providers', db.from('providers').delete().eq('user_id', me))

  // 11) storage objects (all buckets key by `${userId}/…`).
  for (const bucket of ['verification-selfies', 'profile-pics', 'model-photos', 'portfolio-photos']) {
    await clearBucketFolder(bucket, me, errors)
  }

  // 12) public users row — public.users has NO FK to auth.users, so the auth delete
  //     does NOT cascade it. Delete it explicitly here; this row's own cascades then
  //     clear the CASCADE-from-users children (blocks, favourites(user_id),
  //     model_attributes, model_photos, notifications(user_id), subscriptions,
  //     verification_payments/requests, etc.).
  await run('users', db.from('users').delete().eq('id', me))

  // 13) auth user LAST — the source of truth for "account gone"; fatal on failure.
  const { error: authErr } = await db.auth.admin.deleteUser(me)
  if (authErr) errors['auth'] = authErr.message

  return errors
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const user = await getVerifiedUser(req)
  if (!user) return respond({ error: 'Unauthorized' }, 401)

  try {
    const errors = await deleteAccount(user.id)
    // The auth-user delete is the source of truth for "account gone". Anything else
    // is non-fatal cleanup (logged for follow-up); auth failure is the real failure.
    if (errors['auth']) {
      console.error('[delete-account] auth delete failed', user.id, errors)
      return respond({ error: 'Could not delete account', details: errors }, 500)
    }
    if (Object.keys(errors).length > 0) {
      console.warn('[delete-account] completed with non-fatal cleanup errors', user.id, errors)
    }
    return respond({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[delete-account]', user.id, err)
    return respond({ error: message }, 500)
  }
})

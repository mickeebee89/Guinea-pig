// Supabase Edge Function — send-push
// Called by DB triggers (pg_net) on `notifications` / `messages` INSERT. Sends an Expo
// push to the recipient's registered device tokens, respecting their notification
// preferences, and prunes dead tokens. Guarded by a shared secret header.
// Deploy: supabase functions deploy send-push --no-verify-jwt
// Secret:  supabase secrets set PUSH_HOOK_SECRET=<a long random string>

import { createClient } from 'npm:@supabase/supabase-js@2'

// Service-role — reads any recipient's tokens/prefs and prunes tokens (bypasses RLS).
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── Shared-secret guard, and it says WHY it refused ──────────────────────
  //
  // Only our DB triggers may call this, and they carry the secret in the header.
  // The catch is that the SAME secret lives in two places that nothing keeps in
  // step: this env var, and the bodies of tg_message_push / tg_notify_push,
  // where it is baked in literally (see supabase/push-setup.sql:38, :82).
  //
  // Rotate one and not the other and every push fails — silently, with both
  // halves looking correctly configured, and `supabase secrets list` showing a
  // healthy digest. That is a configuration mismatch no check in this project
  // can currently see, so the least this function can do is describe the
  // rejection instead of returning a bare 403.
  //
  // The comparisons below leak nothing: they report whether a header arrived and
  // whether the length and first six characters agree, never a value. That is
  // enough to tell "not our trigger at all" from "our trigger, holding the old
  // secret" — which are the two cases with completely different fixes.
  const expectedSecret = Deno.env.get('PUSH_HOOK_SECRET')
  if (!expectedSecret) {
    // Fail closed, same as purge-selfies with CRON_SECRET. An unset secret must
    // never mean "let everyone in".
    console.error('[send-push] PUSH_HOOK_SECRET is not configured — refusing all calls')
    return respond({ error: 'PUSH_HOOK_SECRET not configured' }, 500)
  }

  const gotSecret = req.headers.get('x-push-secret')
  if (gotSecret !== expectedSecret) {
    console.error('[send-push] REJECTED', JSON.stringify({
      headerPresent:  gotSecret !== null,
      lengthMatches:  gotSecret?.length === expectedSecret.length,
      prefixMatches:  gotSecret?.slice(0, 6) === expectedSecret.slice(0, 6),
      hint: gotSecret === null
        ? 'No x-push-secret header — caller is not one of our DB triggers.'
        : 'Header present but wrong. If length and prefix match, the tail differs; '
        + 'if they do not, the trigger is almost certainly holding a pre-rotation '
        + 'secret. Re-run supabase/push-setup.sql with the current value.',
    }))
    return respond({ error: 'Forbidden' }, 403)
  }

  let body: { user_id?: string; title?: string; body?: string; data?: Record<string, unknown> }
  try { body = await req.json() } catch { return respond({ error: 'Invalid JSON' }, 400) }

  const userId = body.user_id
  if (!userId || !body.title) return respond({ error: 'user_id and title required' }, 400)

  try {
    // No preference gating: notification toggles were removed, so every notification
    // pushes. (A future opt-out would re-introduce a check here.)
    const { data: tokenRows } = await db.from('push_tokens').select('token').eq('user_id', userId)
    const tokens = (tokenRows ?? []).map((r: any) => r.token as string).filter(Boolean)
    if (tokens.length === 0) return respond({ sent: 0 })

    const messages = tokens.map((to) => ({
      to, title: body.title, body: body.body ?? '', data: body.data ?? {},
      sound: 'default', channelId: 'default',
    }))

    // Expo accepts up to 100 messages per request. Track tokens Expo says are dead.
    const invalid: string[] = []
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100)
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(chunk),
      })
      const json = await res.json().catch(() => null)
      const tickets: any[] = json?.data ?? []
      tickets.forEach((t, idx) => {
        if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
          invalid.push(chunk[idx].to)
        }
      })
    }

    // Prune uninstalled/reset devices so we stop pushing to them.
    if (invalid.length > 0) await db.from('push_tokens').delete().in('token', invalid)

    return respond({ sent: tokens.length - invalid.length, pruned: invalid.length })
  } catch (err) {
    console.error('[send-push]', err)
    return respond({ error: err instanceof Error ? err.message : 'error' }, 500)
  }
})

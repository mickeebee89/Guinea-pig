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

// Which on/off preference bucket gates each type. Types not listed are ALWAYS sent
// (transactional / safety: verification, admin_warning, admin_message, system).
function prefBucket(type: string | undefined): 'session_updates' | 'review_reminders' | 'promotions' | null {
  switch (type) {
    case 'session_accepted': case 'session_declined': case 'session_completed':
    case 'session_cancelled': case 'session_applied': case 'new_message':
      return 'session_updates'
    case 'review_reminder': return 'review_reminders'
    case 'new_availability': case 'stylist_invite': return 'promotions'
    default: return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Shared-secret guard — only our DB triggers (which include this header) may call this.
  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_HOOK_SECRET')) {
    return respond({ error: 'Forbidden' }, 403)
  }

  let body: { user_id?: string; title?: string; body?: string; data?: Record<string, unknown> }
  try { body = await req.json() } catch { return respond({ error: 'Invalid JSON' }, 400) }

  const userId = body.user_id
  if (!userId || !body.title) return respond({ error: 'user_id and title required' }, 400)

  try {
    // Respect the recipient's notification preferences (default: promotions off).
    const bucket = prefBucket(body.data?.type as string | undefined)
    if (bucket) {
      const { data: u } = await db.from('users').select('notification_preferences').eq('id', userId).maybeSingle()
      const prefs = ((u as any)?.notification_preferences ?? { session_updates: true, review_reminders: true, promotions: false }) as Record<string, boolean>
      if (prefs[bucket] === false) return respond({ skipped: 'pref_off' })
    }

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

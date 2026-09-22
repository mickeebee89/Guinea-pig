// Supabase Edge Function — send-email
//
// Email for the eight events a web-only member would otherwise never hear
// about. Called by DB triggers (pg_net) on `notifications` INSERT and, for
// chat, from tg_message_push. Audit item 74, migration 0047.
//
// Deploy: supabase functions deploy send-email --no-verify-jwt
//   --no-verify-jwt because the caller is a database trigger, which carries the
//   shared secret in a header instead of a JWT. Same as send-push.
//
// Secrets it needs (edge-function secrets, never in this file):
//   RESEND_API_KEY     a restricted key: Sending access, cavybeauty.com only
//   EMAIL_HOOK_SECRET  the shared secret the triggers send
//
// ── THE SHARED SECRET INSTALLS ITSELF ──────────────────────────────────────
// push_hook_secret had to be pasted into two places, and the live value ended
// up in pg_proc (audit item 36). Here nobody holds the value: POST
// {"kind":"install-secret"} with the service-role key and this function writes
// its own EMAIL_HOOK_SECRET into Vault through install_email_hook_secret().
// The secret never appears on a screen or in a shell history.
//
// "with the service-role key" is checked by ASKING, not by matching text — see
// isServiceRole() below, and audit item 74 for the day that distinction cost.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
//   * It never writes `notifications` or `messages`. An email cannot cause an
//     email.
//   * It never takes a recipient address from the caller. The address is looked
//     up from users.email by user_id, so a forged payload cannot redirect mail.
//   * It never puts a chat message's text in an email. The email says a message
//     is waiting; the message stays in the app, where block and report are.
//   * Resend open and click tracking stay OFF. The Privacy policy says there is
//     no tracking, and this is one of the places that could make that false.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// Said once, loudly, at start-up: without it every database call below fails,
// and the reason would otherwise arrive as an unrelated PostgREST message.
if (!SERVICE_KEY) console.error('[send-email] SUPABASE_SERVICE_ROLE_KEY is not injected — every database call will fail.')

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const SITE = 'https://cavybeauty.com'
const FROM = 'Cavy <notifications@cavybeauty.com>'
const REPLY_TO = 'support@cavybeauty.com'
/** One email per conversation per hour, however many messages arrive. */
const CHAT_THROTTLE_MINUTES = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-email-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// ── The copy ────────────────────────────────────────────────────────────────
//
// The notification's own title and body are reused, because they have already
// been written and reviewed once (0028, 0029, 0030, the admin console). The
// email adds a subject, a sentence of context, and where to go. Nothing here
// invents a second voice for the same event.

interface Copy { subject: string; heading: string; cta: string; path: string }

function copyFor(type: string, title: string, sessionId: string | null): Copy {
  const bookings = '/bookings'
  switch (type) {
    case 'session_applied':
      return { subject: 'Someone applied for your session', heading: 'You have a new application',
        cta: 'View the application', path: bookings }
    case 'session_accepted':
      return { subject: 'Your booking is confirmed', heading: 'Your booking is confirmed',
        cta: 'View the booking', path: bookings }
    case 'session_declined':
      return { subject: 'Your booking wasn’t accepted', heading: 'Your booking wasn’t accepted',
        cta: 'Find another stylist', path: '/browse' }
    case 'session_cancelled':
      return { subject: 'A booking has been cancelled', heading: 'A booking has been cancelled',
        cta: 'View your bookings', path: bookings }
    case 'verification':
      return /not approved/i.test(title)
        ? { subject: 'Your ID check wasn’t approved', heading: 'Your ID check wasn’t approved',
            cta: 'Try again', path: '/verify' }
        : { subject: 'You’re verified', heading: 'You’re verified', cta: 'Open Cavy', path: '/dashboard' }
    case 'payment_failed':
      return { subject: 'We couldn’t take your £4.99 payment', heading: 'Your last payment didn’t go through',
        cta: 'Check your membership', path: '/settings' }
    case 'admin_warning':
      return { subject: 'A warning from Cavy', heading: 'A warning from Cavy',
        cta: 'Read it in full', path: '/notifications' }
    default:
      return { subject: 'Something happened on Cavy', heading: title || 'Something happened on Cavy',
        cta: 'Open Cavy', path: sessionId ? `/messages/${sessionId}` : '/dashboard' }
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const FOOTER_TEXT =
  'Cavy is a trading name of Guinea Pig App Ltd, registered in England & Wales, company no. 17272796. ' +
  'Registered address: 75 Aintree Road, Chatham, Kent, ME5 8PQ.'

/** The whole email. One template, so every message looks the same. */
function render(o: { heading: string; body: string; cta: string; url: string; unsubscribeUrl: string }) {
  // unsubscribeUrl is the PAGE (a click is a GET, and it asks first). The
  // one-click POST address is built from the same token in send().

  const paragraphs = o.body.split('\n').map(s => s.trim()).filter(Boolean)
  const text = [
    o.heading, '', ...paragraphs, '',
    `${o.cta}: ${o.url}`, '',
    'You’re getting this because you have a Cavy account. Turn these emails off in Settings, or unsubscribe here:',
    o.unsubscribeUrl, '',
    FOOTER_TEXT,
  ].join('\n')

  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;background:#FFF7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2B2531">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#C23A71">Cavy</p>
    <div style="background:#fff;border:1px solid #F6E1EA;border-radius:12px;padding:24px">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(o.heading)}</h1>
      ${paragraphs.map(p => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`).join('')}
      <p style="margin:24px 0 0">
        <a href="${o.url}" style="display:inline-block;background:#DB4B86;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:999px">${escapeHtml(o.cta)}</a>
      </p>
    </div>
    <p style="margin:20px 0 8px;font-size:12px;line-height:1.5;color:#6E6675">
      You’re getting this because you have a Cavy account. You can turn these emails off in
      <a href="${SITE}/settings" style="color:#C23A71">Settings</a>, or
      <a href="${o.unsubscribeUrl}" style="color:#C23A71">unsubscribe</a>.
      We’ll still email you about your account itself, such as resetting your password.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#6E6675">${escapeHtml(FOOTER_TEXT)}</p>
  </div>
</body></html>`
  return { text, html }
}

// ── The log ────────────────────────────────────────────────────────────────
async function log(row: {
  user_id: string; kind: string; ref_id: string | null; event: string | null
  status: 'sent' | 'failed' | 'skipped'; reason?: string | null; provider_id?: string | null
}) {
  const { error } = await db.from('email_sends').insert(row)
  // A duplicate means another call already recorded this one: not an error.
  if (error && error.code !== '23505') console.error('[send-email] could not log', error.message)
}

/**
 * The two addresses an email carries, both built from the same token.
 *
 * They used to be one address and a string replace on it. That is a silent
 * breakage waiting to happen — change the visible link's shape and the header
 * quietly keeps pointing at the old path — and it also hid the header's URL
 * from site/scripts/check-links.mjs, which reads `${SITE}/…` literals out of
 * this file to prove the pages an email points at still exist. Written out in
 * full, both are checked. Audit item 74.
 */
const unsubscribeLinks = (token: string) => {
  const t = encodeURIComponent(token)
  return {
    // A click is a GET, so this one only ASKS.
    page: `${SITE}/email/unsubscribe?t=${t}`,
    // List-Unsubscribe: Gmail and Yahoo POST here directly.
    oneClick: `${SITE}/email/unsubscribe/confirm?t=${t}`,
  }
}

async function send(o: {
  to: string; subject: string; heading: string; body: string; cta: string; path: string; unsubscribeToken: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' }
  const links = unsubscribeLinks(o.unsubscribeToken)
  const { text, html } = render({ ...o, url: `${SITE}${o.path}`, unsubscribeUrl: links.page })

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [o.to],
        reply_to: REPLY_TO,
        subject: o.subject,
        html,
        text,
        headers: {
          // One-click unsubscribe. Gmail and Yahoo expect these on anything they
          // judge bulk, and it is what makes the header in the client work. The
          // header points at the POST route; the visible link at the page.
          'List-Unsubscribe': `<${links.oneClick}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    })
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}` }
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, error: `resend ${res.status}: ${json?.message ?? 'no message'}` }
  return { ok: true, id: String(json?.id ?? '') }
}

/**
 * Does this bearer token carry service-role authority?
 *
 * ── WHY NOT COMPARE IT TO OUR OWN KEY ──────────────────────────────────────
 * It used to, and it refused the real key on 22 Sep 2026: the string Supabase
 * injects here and the string in the dashboard were not the same string, and
 * equality cannot tell "different credential" from "different spelling of the
 * same authority". It would have broken again on the next rotation, and again
 * on the move to sb_secret_… keys, each time as an unexplained "Forbidden".
 *
 * ── WHAT IS ATTEMPTED, AND WHY NOTHING ELSE CAN PASS IT ────────────────────
 * One GET to the Auth admin API, asking for a user id of all zeros. That API:
 *   * verifies the token's signature against THIS project's JWT secret, so a
 *     forged or another project's token fails;
 *   * requires the service_role claim, so an anon or a signed-in user's token
 *     is refused with 401/403 however it was obtained — an authenticated user
 *     cannot promote their own token, since the claim is set when it is
 *     issued and the signature covers it;
 *   * accepts the new sb_secret_… keys too, which is the point of asking it
 *     rather than matching text.
 *
 * The all-zero id belongs to nobody, so service role gets 404 and no personal
 * data is returned to us. 200 is accepted as well, in case that id ever
 * exists; both mean the admin API let us in, which is the question.
 */
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/00000000-0000-0000-0000-000000000000`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    })
  } catch {
    // Never the error's text: it can carry the URL and the headers with it.
    console.error('[send-email] could not reach the Auth admin API to check the caller')
    return false
  }
  // The body is never read, whatever it was.
  await res.body?.cancel()
  return res.status === 200 || res.status === 404
}

/** Their address and whether they want these at all. */
async function recipient(userId: string) {
  const { data } = await db.from('users')
    .select('email, first_name, notification_preferences').eq('id', userId).maybeSingle()
  const row = data as {
    email: string | null; first_name: string | null
    notification_preferences: { email?: { enabled?: boolean } } | null
  } | null
  if (!row?.email) return { email: null, wants: false, firstName: null }
  // Default ON: null preferences, a missing key, or anything but an explicit
  // false means yes. Nothing has to be backfilled for existing accounts.
  const wants = row.notification_preferences?.email?.enabled !== false
  return { email: row.email, wants, firstName: row.first_name }
}

/** Their token, made on first use. Both links are built from it, in send(). */
async function unsubscribeTokenFor(userId: string) {
  const { data, error } = await db.rpc('email_unsubscribe_token', { p_user_id: userId })
  if (error || !data) throw new Error(`unsubscribe token: ${error?.message ?? 'none returned'}`)
  return String(data)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return respond({ error: 'Invalid JSON' }, 400) }
  const kind = String(body.kind ?? '')

  // ── install-secret and test: the service-role key, not the shared secret ──
  // Both are run by hand by Micky. The service-role key is something he already
  // handles carefully, and it means neither needs the value nobody has.
  if (kind === 'install-secret' || kind === 'test') {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!await isServiceRole(token)) {
      console.error(`[send-email] ${kind} REJECTED: the caller's token has no service-role authority`)
      return respond({ error: 'Forbidden: the token sent cannot use the Auth admin API, so it is not a service-role key' }, 403)
    }

    if (kind === 'install-secret') {
      const secret = Deno.env.get('EMAIL_HOOK_SECRET')
      if (!secret) return respond({ error: 'EMAIL_HOOK_SECRET is not set on this function' }, 500)
      const { data, error } = await db.rpc('install_email_hook_secret', { p_secret: secret })
      if (error) return respond({ error: error.message }, 500)
      // Deliberately reports only what happened, never the value.
      return respond({ ok: true, vault: data, secretLength: secret.length })
    }

    const to = String(body.to ?? '')
    if (!to.includes('@')) return respond({ error: 'A "to" address is required' }, 400)
    const sent = await send({
      to,
      subject: 'Test: this is how Cavy’s emails look',
      heading: 'This is a test email',
      body: 'Nobody else received this. It was sent by hand to check how Cavy’s notification emails '
        + 'arrive: the sender, the reply address, the unsubscribe link and the footer.\n'
        + 'The unsubscribe link in this one does nothing, because there is no real account behind it.',
      cta: 'Open Cavy', path: '/dashboard', unsubscribeToken: 'test-token-not-real',
    })
    return respond(sent.ok ? { ok: true, id: sent.id } : { ok: false, error: sent.error }, sent.ok ? 200 : 502)
  }

  // ── Everything else is a database trigger, carrying the shared secret ─────
  const expected = Deno.env.get('EMAIL_HOOK_SECRET')
  if (!expected) {
    console.error('[send-email] EMAIL_HOOK_SECRET is not configured — refusing all calls')
    return respond({ error: 'EMAIL_HOOK_SECRET not configured' }, 500)
  }
  const got = req.headers.get('x-email-secret')
  if (got !== expected) {
    // Same reporting as send-push: enough to tell "not our trigger" from "our
    // trigger with the wrong value", without printing either secret.
    console.error('[send-email] REJECTED', JSON.stringify({
      headerPresent: got !== null,
      lengthMatches: got?.length === expected.length,
      hint: got === null
        ? 'No x-email-secret header — the caller is not one of our triggers.'
        : got === ''
        ? 'Empty x-email-secret — Vault email_hook_secret is missing. Run the install step in 0047.'
        : 'Wrong value — redeploy the function and run the install step again (0047).',
    }))
    return respond({ error: 'Forbidden' }, 403)
  }

  try {
    if (kind === 'notification') {
      const id = String(body.notification_id ?? '')
      if (!id) return respond({ error: 'notification_id required' }, 400)

      const { data: n } = await db.from('notifications')
        .select('id, user_id, type, title, body, session_id').eq('id', id).maybeSingle()
      const note = n as {
        id: string; user_id: string; type: string; title: string | null
        body: string | null; session_id: string | null
      } | null
      if (!note) return respond({ error: 'no such notification' }, 404)

      // Already emailed? The unique index would refuse the log row anyway; this
      // stops a second send rather than a second log.
      const { data: prior } = await db.from('email_sends')
        .select('id').eq('kind', 'notification').eq('ref_id', note.id).eq('status', 'sent').maybeSingle()
      if (prior) return respond({ skipped: 'already sent' })

      const who = await recipient(note.user_id)
      if (!who.email) {
        await log({ user_id: note.user_id, kind: 'notification', ref_id: note.id, event: note.type, status: 'skipped', reason: 'no address' })
        return respond({ skipped: 'no address' })
      }
      if (!who.wants) {
        await log({ user_id: note.user_id, kind: 'notification', ref_id: note.id, event: note.type, status: 'skipped', reason: 'email notifications off' })
        return respond({ skipped: 'preferences' })
      }

      const c = copyFor(note.type, note.title ?? '', note.session_id)
      const sent = await send({
        to: who.email, subject: c.subject, heading: c.heading,
        body: note.body ?? note.title ?? '', cta: c.cta, path: c.path,
        unsubscribeToken: await unsubscribeTokenFor(note.user_id),
      })
      await log({
        user_id: note.user_id, kind: 'notification', ref_id: note.id, event: note.type,
        status: sent.ok ? 'sent' : 'failed',
        reason: sent.ok ? null : sent.error, provider_id: sent.ok ? sent.id : null,
      })
      return respond(sent.ok ? { ok: true, id: sent.id } : { ok: false, error: sent.error }, sent.ok ? 200 : 502)
    }

    if (kind === 'chat') {
      const userId = String(body.user_id ?? '')
      const sessionId = String(body.session_id ?? '')
      const senderName = String(body.sender_name ?? 'Someone')
      if (!userId || !sessionId) return respond({ error: 'user_id and session_id required' }, 400)

      // One per conversation per hour, however many messages arrive.
      const since = new Date(Date.now() - CHAT_THROTTLE_MINUTES * 60_000).toISOString()
      const { data: recent } = await db.from('email_sends')
        .select('id').eq('kind', 'chat').eq('user_id', userId).eq('ref_id', sessionId)
        .eq('status', 'sent').gte('created_at', since).limit(1).maybeSingle()
      if (recent) return respond({ skipped: 'throttled' })

      const who = await recipient(userId)
      if (!who.email) {
        await log({ user_id: userId, kind: 'chat', ref_id: sessionId, event: 'chat', status: 'skipped', reason: 'no address' })
        return respond({ skipped: 'no address' })
      }
      if (!who.wants) {
        await log({ user_id: userId, kind: 'chat', ref_id: sessionId, event: 'chat', status: 'skipped', reason: 'email notifications off' })
        return respond({ skipped: 'preferences' })
      }

      const sent = await send({
        to: who.email,
        subject: `New message from ${senderName}`,
        heading: `${senderName} sent you a message`,
        // No message text: it stays in the app, with block and report beside it.
        body: 'It’s waiting in your Cavy messages. We’ll only email you once an hour about a '
          + 'conversation, however many messages arrive.',
        cta: 'Read it', path: `/messages/${sessionId}`,
        unsubscribeToken: await unsubscribeTokenFor(userId),
      })
      await log({
        user_id: userId, kind: 'chat', ref_id: sessionId, event: 'chat',
        status: sent.ok ? 'sent' : 'failed',
        reason: sent.ok ? null : sent.error, provider_id: sent.ok ? sent.id : null,
      })
      return respond(sent.ok ? { ok: true, id: sent.id } : { ok: false, error: sent.error }, sent.ok ? 200 : 502)
    }

    return respond({ error: `unknown kind "${kind}"` }, 400)
  } catch (err) {
    console.error('[send-email] unhandled', err)
    return respond({ error: err instanceof Error ? err.message : 'error' }, 500)
  }
})

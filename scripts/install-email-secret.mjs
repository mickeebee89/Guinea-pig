/**
 * install-email-secret.mjs — copy the send-email function's own
 * EMAIL_HOOK_SECRET into Vault, so the database triggers can send the same
 * value. Audit item 74, migration 0047.
 *
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'   # this shell only
 *   node scripts/install-email-secret.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * push_hook_secret had to be pasted into two places by hand, and that is how
 * the live value ended up in pg_proc (audit item 36). Here nobody holds the
 * value: it exists only as the edge function's secret. This asks the function
 * to write it into Vault itself.
 *
 * NOTHING PRINTS THE SECRET. This script never sees it; the function reports
 * only whether Vault was created or updated, and the length.
 *
 * Re-running is safe, and is how you would rotate it: set a new function
 * secret, redeploy, run this again.
 */

import { unsubscribeRouteProblem } from './check-unsubscribe-route.mjs'

const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
if (!KEY) {
  console.error('\nRefusing to run: SUPABASE_SERVICE_ROLE_KEY is not set in this shell.')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'\n")
  process.exit(1)
}

// Installing the secret is what ARMS the whole thing: until Vault holds it,
// every trigger call is refused. So this is the last moment at which a broken
// unsubscribe link can still be caught before real emails carry it.
const problem = await unsubscribeRouteProblem()
if (problem) {
  console.error(`\nRefusing to arm email notifications.\n\n${problem}\n`)
  process.exit(1)
}

const URL_ = 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/send-email'

let res
try {
  res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'install-secret' }),
  })
} catch (e) {
  // Only the code: a network error's text can carry the host and the key.
  console.error(`\nCould not reach the function (${e?.cause?.code ?? e?.code ?? 'network error'}).`)
  console.error('Is send-email deployed? npx supabase functions deploy send-email --no-verify-jwt\n')
  process.exit(1)
}

const body = await res.json().catch(() => null)

if (!res.ok || !body?.ok) {
  console.error(`\nThe function refused (HTTP ${res.status}): ${body?.error ?? 'no message'}`)
  if (res.status === 403) {
    // The function asks the Auth admin API whether this token has service-role
    // authority. It no longer compares it to its own key — that refused the
    // real key on 22 Sep 2026, because the two strings were not identical.
    console.error('403 means the token sent could not use the Auth admin API, so it is not a service-role key.')
    console.error('Check which key is in SUPABASE_SERVICE_ROLE_KEY: the anon key sits beside it and looks the same.')
  }
  if (String(body?.error ?? '').includes('EMAIL_HOOK_SECRET')) {
    console.error('EMAIL_HOOK_SECRET is not set on the function. Set it, redeploy, and run this again.')
  }
  console.error('')
  process.exit(1)
}

console.log(`\nDone. Vault email_hook_secret was ${body.vault}.`)
console.log(`The secret is ${body.secretLength} characters. Its value was not printed, and this script never saw it.`)
console.log('\nNext: node scripts/send-test-email.mjs you@example.com\n')

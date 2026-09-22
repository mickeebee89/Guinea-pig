/**
 * send-test-email.mjs — send ONE notification email to an address you choose,
 * before any member gets one. Audit item 74.
 *
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'   # this shell only
 *   node scripts/send-test-email.mjs you@example.com
 *
 * It sends the real template through the real function and the real Resend
 * key, so what arrives is exactly what a member would get: the sender, the
 * reply address, the button, the unsubscribe line and the footer.
 *
 * It touches no member and no notification. The unsubscribe link in the test
 * carries a token that matches nobody, so clicking it changes nothing.
 */

import { unsubscribeRouteProblem } from './check-unsubscribe-route.mjs'

const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const TO = (process.argv[2] ?? '').trim()

if (!KEY) {
  console.error('\nRefusing to run: SUPABASE_SERVICE_ROLE_KEY is not set in this shell.')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'\n")
  process.exit(1)
}
if (!TO.includes('@')) {
  console.error('\nUsage: node scripts/send-test-email.mjs you@example.com\n')
  process.exit(1)
}

// The point of the test is to read the email as a member would, including the
// unsubscribe line. Sending one with a dead link tests nothing.
const problem = await unsubscribeRouteProblem()
if (problem) {
  console.error(`\nRefusing to send.\n\n${problem}\n`)
  process.exit(1)
}

const URL_ = 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/send-email'

let res
try {
  res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'test', to: TO }),
  })
} catch (e) {
  console.error(`\nCould not reach the function (${e?.cause?.code ?? e?.code ?? 'network error'}).\n`)
  process.exit(1)
}

const body = await res.json().catch(() => null)

if (!res.ok || !body?.ok) {
  console.error(`\nNot sent (HTTP ${res.status}): ${body?.error ?? 'no message'}`)
  if (res.status === 403) {
    console.error('403 means the token sent is not a service-role key — the anon key sits beside it and looks the same.')
  }
  if (String(body?.error ?? '').includes('RESEND_API_KEY')) {
    console.error('RESEND_API_KEY is not set on the function.')
  }
  if (String(body?.error ?? '').startsWith('resend 4')) {
    console.error('Resend refused it. A 403 usually means the key is restricted to a domain that does not match the sender.')
  }
  console.error('')
  process.exit(1)
}

console.log(`\nSent to ${TO}. Resend id: ${body.id}`)
console.log('Check: the sender reads "Cavy", replying goes to support@cavybeauty.com, and the footer')
console.log('carries the company details. Then look in the spam folder too — that is the point of the test.\n')

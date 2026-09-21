/**
 * repair-lapsed-subscriptions.mjs — one-off repair for audit item 63.
 *
 *   node scripts/repair-lapsed-subscriptions.mjs            # PREVIEW. Writes nothing.
 *   node scripts/repair-lapsed-subscriptions.mjs --apply    # writes, through the RPC only
 *
 * Needs three variables in the environment, and reads them from nowhere else:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 * Set them in the current PowerShell session only — see item 63. Their VALUES
 * are never printed, logged or echoed by this script, including in errors.
 *
 * ── WHAT IT REPAIRS ─────────────────────────────────────────────────────
 * subscriptions rows whose status still names a live membership (active,
 * cancelling, past_due) while current_period_end is null or already past.
 * On 21 Sep 2026 that was eight rows: seven 'active' and one 'cancelling', all
 * from 8–17 Jul, before the webhook existed to expire them.
 *
 * For each row it asks STRIPE what the subscription really is, and writes that
 * through public.apply_subscription_state — the only supported writer, which
 * keeps subscriptions and users.subscription_status in step in one
 * transaction (0023–0025). It never updates either table directly.
 *
 * ── NO DEPENDENCIES, ON PURPOSE ─────────────────────────────────────────
 * Plain fetch against PostgREST and Stripe's REST API, so it runs from the repo
 * root without resolving any package. Stripe calls pin
 * `Stripe-Version: 2024-06-20`, the version the edge functions' SDK uses, so a
 * subscription's current_period_start / current_period_end are read from the
 * same top-level fields the webhook reads.
 */

const APPLY = process.argv.includes('--apply')

// ── Environment: present, never printed ────────────────────────────────────
const NEEDED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY']
const missing = NEEDED.filter(k => !process.env[k] || !process.env[k].trim())
if (missing.length) {
  console.error(`\nRefusing to run: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`)
  console.error('Set them in THIS PowerShell session only, for example:')
  for (const k of missing) console.error(`  $env:${k} = '<value>'`)
  console.error('Nothing was read or written.\n')
  process.exit(1)
}
const SUPABASE_URL = process.env.SUPABASE_URL.trim().replace(/\/+$/, '')
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY.trim()

// Live mode only. A test key cannot see live subscriptions, so every row would
// come back "not found" and be expired on the strength of the wrong account.
// The check reads only the prefix and prints nothing of the key.
if (!/^(sk|rk)_live_/.test(STRIPE_KEY)) {
  console.error('\nRefusing to run: STRIPE_SECRET_KEY is not a live-mode key.')
  console.error('The rows being repaired are live subscriptions; a test key cannot see them.')
  console.error('Nothing was read or written.\n')
  process.exit(1)
}

// ── THE MAPPING — A SECOND COPY. KEEP IN STEP WITH stripe-webhook ───────────
// ⚠️ COPIED, NOT IMPORTED. The original is mapStatus() in
// supabase/functions/stripe-webhook/index.ts (:61-73), with the precedence at
// :332-334. It cannot be imported: that file is Deno, loads `npm:` specifiers,
// and starts a server at import. So this is a SECOND COPY. If the webhook's
// mapping changes, this must change with it, or a repair run will write
// something the webhook would not.
//
// The same list exists a third time in stripe-payment's syncSubscription. 0022
// asserts the stored vocabulary is closed, which is what stops a new value
// appearing unnoticed.
function mapStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':   return 'active'
    case 'past_due':
    case 'unpaid':     return 'past_due'
    case 'canceled':
    case 'incomplete_expired': return 'expired'
    // 'incomplete' means the first payment has not completed. Not access yet,
    // and not a lapse either — treat as expired until it becomes active.
    default:           return 'expired'
  }
}

/**
 * The webhook's precedence, for a subscription retrieved rather than delivered.
 *
 * stripe-webhook/index.ts:332-334:
 *   deleted event          -> 'expired'   ("Deleted always wins", :330)
 *   cancel_at_period_end   -> 'cancelling'
 *   otherwise              -> mapStatus(sub.status)
 *
 * The webhook learns a subscription is over from the customer.subscription.
 * deleted EVENT. A retrieved subscription carries no event, so "deleted" is its
 * status being terminal ('canceled' or 'incomplete_expired'). That check comes
 * FIRST, exactly as the deleted branch does in the webhook. Without it, a
 * subscription that was cancelled at period end and has since ended can still
 * carry cancel_at_period_end = true, and would be written back as 'cancelling'
 * — the lapsed state this script exists to clear.
 */
function statusFromStripe(sub) {
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') return 'expired'
  if (sub.cancel_at_period_end) return 'cancelling'
  return mapStatus(sub.status)
}

const iso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null)
const day = (v) => (v ? String(v).slice(0, 10) : '—')
const LIVE = ['active', 'cancelling', 'past_due']

// ── PostgREST, service role ────────────────────────────────────────────────
async function rest(pathAndQuery, init = {}) {
  let res
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (e) {
    // Only the error code: a network error's text can carry the host.
    throw new Error(`database request failed (${e?.cause?.code ?? e?.code ?? 'network error'})`)
  }
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!res.ok) throw new Error(`database ${res.status}: ${body?.message ?? 'no message'}`)
  return body
}

/** The item 63 selection. Re-used after --apply to count what remains. */
async function selectAffected() {
  const now = new Date().toISOString()
  const rows = await rest(
    'subscriptions'
    + '?select=user_id,status,current_period_start,current_period_end,stripe_customer_id,stripe_subscription_id,created_at'
    + `&status=in.(${LIVE.join(',')})`
    + `&or=(current_period_end.is.null,current_period_end.lte.${encodeURIComponent(now)})`
    + '&order=created_at.asc',
  )
  return rows ?? []
}

async function waivedFor(userIds) {
  if (!userIds.length) return new Map()
  const rows = await rest(`users?select=id,subscription_waived&id=in.(${userIds.join(',')})`)
  return new Map((rows ?? []).map(r => [r.id, !!r.subscription_waived]))
}

// ── Stripe, read-only ──────────────────────────────────────────────────────
async function stripeSubscription(id) {
  let res
  try {
    res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Stripe-Version': '2024-06-20' },
    })
  } catch (e) {
    return { error: { code: e?.cause?.code ?? e?.code ?? 'network_error', message: 'could not reach Stripe' } }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return { error: { code: body?.error?.code ?? `http_${res.status}`, message: body?.error?.message ?? '' } }
  }
  return { sub: body }
}

// ── Run ────────────────────────────────────────────────────────────────────
console.log(`\n${APPLY ? 'APPLY' : 'PREVIEW'} — lapsed subscriptions (audit item 63)`)
console.log(APPLY
  ? 'Writes go through apply_subscription_state only.\n'
  : 'Nothing will be written. Re-run with --apply to write.\n')

const rows = await selectAffected()
const waived = await waivedFor(rows.map(r => r.user_id))
console.log(`${rows.length} row(s) selected.\n`)

const tally = {}
const count = (k) => { tally[k] = (tally[k] ?? 0) + 1 }
let waivedAffected = 0

for (const row of rows) {
  const who = String(row.user_id).slice(0, 8)
  const isWaived = waived.get(row.user_id) === true
  if (isWaived) waivedAffected++
  const now = Date.now()
  const head =
    `${who}  ${row.status.padEnd(10)} ends ${day(row.current_period_end)}`
    + (isWaived ? '  [waived]' : '')

  // Rule 8, checked on the row as selected. The query should make this
  // impossible; it is asserted anyway, because this is the line that protects
  // the one real subscriber.
  if (row.current_period_end && new Date(row.current_period_end).getTime() > now) {
    console.log(`${head}  -> SKIPPED: period end is in the future. Not touched.`)
    count('skipped: future end date'); continue
  }

  if (!row.stripe_subscription_id) {
    console.log(`${head}  -> SKIPPED: no stripe_subscription_id to look up. Not touched.`)
    count('skipped: no subscription id'); continue
  }

  const { sub, error } = await stripeSubscription(row.stripe_subscription_id)

  let target, start, end, stripeSays, outcome
  if (error && error.code === 'resource_missing') {
    // Rule 4: ended, keeping the row's own dates. Kept apart from genuine
    // expiries in both the line and the summary.
    target = 'expired'
    start = row.current_period_start
    end = row.current_period_end
    stripeSays = 'NOT FOUND IN LIVE STRIPE'
    outcome = 'expired: not found in live Stripe'
  } else if (error) {
    // Rule 5: skip, report, change nothing.
    console.log(`${head}  -> SKIPPED: Stripe error ${error.code}${error.message ? ` (${error.message})` : ''}. Not touched.`)
    count('skipped: Stripe error'); continue
  } else {
    target = statusFromStripe(sub)
    start = iso(sub.current_period_start)
    end = iso(sub.current_period_end)
    stripeSays = `${sub.status}${sub.cancel_at_period_end ? ' (cancel at period end)' : ''}, period ${day(start)}..${day(end)}`
    outcome = `${target}: from Stripe`

    // If Stripe says the subscription is live, its own period end must be in
    // the future. A "live" subscription with a past end is not something to
    // write back as membership. It needs a person, so it is left untouched.
    if (LIVE.includes(target) && !(end && new Date(end).getTime() > now)) {
      console.log(`${head}  -> Stripe: ${stripeSays}  -> SKIPPED: Stripe calls it ${sub.status} but its period has ended. Not touched.`)
      count('skipped: Stripe live, period ended'); continue
    }
  }

  const plan = `${target}  ${day(start)}..${day(end)}`
  console.log(`${head}  -> Stripe: ${stripeSays}  -> ${APPLY ? 'WRITING' : 'would write'} ${plan}`)

  if (!APPLY) { count(`would write ${outcome}`); continue }

  // Rule 8 again, on a FRESH read immediately before the write: the webhook or
  // the person themselves may have renewed the row since the selection ran.
  const fresh = await rest(
    `subscriptions?select=status,current_period_end&user_id=eq.${encodeURIComponent(row.user_id)}`,
  )
  const cur = fresh?.[0]
  if (!cur || (cur.current_period_end && new Date(cur.current_period_end).getTime() > Date.now())) {
    console.log(`         -> NOT WRITTEN: the row changed since selection (now ${cur?.status ?? 'missing'}, ends ${day(cur?.current_period_end)}).`)
    count('not written: row changed'); continue
  }

  try {
    await rest('rpc/apply_subscription_state', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id:         row.user_id,
        p_status:          target,
        p_customer_id:     row.stripe_customer_id ?? null,
        p_subscription_id: row.stripe_subscription_id,
        p_period_start:    start,
        p_period_end:      end,
      }),
    })
    count(`wrote ${outcome}`)
  } catch (e) {
    console.log(`         -> WRITE FAILED: ${e.message}. Nothing changed for this row (one transaction).`)
    count('write failed')
  }
}

console.log('\nSummary:')
for (const [k, n] of Object.entries(tally).sort()) console.log(`  ${String(n).padStart(3)}  ${k}`)
console.log(`  ${String(waivedAffected).padStart(3)}  of the selected rows have subscription_waived = true`)

if (APPLY) {
  const remaining = await selectAffected()
  console.log(`\nRe-ran the selection: ${remaining.length} row(s) remain lapsed-but-live.`)
  if (remaining.length) console.log('Those are the rows skipped above. Each needs a person.')
}
console.log('')

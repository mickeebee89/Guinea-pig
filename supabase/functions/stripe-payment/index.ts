// Supabase Edge Function — stripe-payment
// Handles Stripe PaymentIntent creation and post-payment confirmation.
// Deploy: supabase functions deploy stripe-payment
// Secret:  supabase secrets set STRIPE_SECRET_KEY=sk_live_...

import Stripe from 'npm:stripe@14'
import { createClient } from 'npm:@supabase/supabase-js@2'

// ── Clients ───────────────────────────────────────────────────────────────────

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
})

// Service-role client for authoritative DB writes
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

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

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'Invalid JSON' }, 400)
  }

  const user = await getVerifiedUser(req)
  if (!user) return respond({ error: 'Unauthorized' }, 401)

  const userId = user.id

  try {
    switch (body.action) {
      case 'create_verification_intent':
        return await createVerificationIntent(userId)
      case 'create_subscription':
        return await createSubscription(userId, user.email ?? '')
      case 'confirm_verification':
        return await confirmVerification(userId, body.paymentIntentId)
      case 'confirm_subscription':
        return await confirmSubscription(userId, body.subscriptionId, body.customerId)
      case 'cancel_subscription':
        return await cancelSubscription(userId)
      case 'revenue_summary':
        return await revenueSummary(userId)
      case 'reconcile_audit':
        return await reconcileAudit(userId)
      case 'sync_subscription':
        return await syncSubscription(userId)
      default:
        return respond({ error: `Unknown action: ${body.action}` }, 400)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[stripe-payment]', body.action, err)
    return respond({ error: message }, 500)
  }
})

// ── create_verification_intent ────────────────────────────────────────────────
// Creates a one-off PaymentIntent for £14.99 verification fee.

async function createVerificationIntent(userId: string) {
  // Dedupe: if this user already paid, never issue a second PaymentIntent — prevents a
  // stale/looping client from double-charging. The client treats this as "already paid".
  const { data: existingPay } = await db.from('verification_payments')
    .select('id').eq('user_id', userId).limit(1).maybeSingle()
  if (existingPay) return respond({ alreadyPaid: true })

  const intent = await stripe.paymentIntents.create({
    amount:   1499,   // £14.99 in pence
    currency: 'gbp',
    description: 'Cavy identity verification fee',
    metadata: { user_id: userId, type: 'verification' },
    automatic_payment_methods: { enabled: true },
  })

  return respond({
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
  })
}

// ── Monthly subscription price ──────────────────────────────────────────────────
// Prefer STRIPE_MONTHLY_PRICE_ID (the dashboard price's real `price_...` id) so we
// NEVER create prices at runtime — set this secret in live (and ideally test). If it
// is unset, fall back to a find-or-create keyed by lookup_key, which returns the SAME
// price on every call. (The old code did `prices.retrieve('guinea_pig_monthly_499')`,
// but that string isn't a valid price id, so the retrieve always missed and a new
// Product+Price was spawned on every single signup.)
const MONTHLY_LOOKUP_KEY = 'guinea_pig_monthly_499'

async function resolveMonthlyPriceId(): Promise<string> {
  const envId = Deno.env.get('STRIPE_MONTHLY_PRICE_ID')
  if (envId) return envId

  console.warn('[stripe-payment] STRIPE_MONTHLY_PRICE_ID not set — using lookup_key find-or-create. Set this secret before going live.')
  const found = await stripe.prices.list({ lookup_keys: [MONTHLY_LOOKUP_KEY], active: true, limit: 1 })
  if (found.data[0]) return found.data[0].id

  const price = await stripe.prices.create({
    unit_amount:  499,
    currency:     'gbp',
    recurring:    { interval: 'month' },
    product_data: { name: 'Guinea Pig Monthly' },
    lookup_key:   MONTHLY_LOOKUP_KEY,
  })
  return price.id
}

// ── create_subscription ───────────────────────────────────────────────────────
// Creates (or retrieves) a Stripe Customer then creates a £4.99/month
// subscription, returning the first invoice's PaymentIntent client_secret.

async function createSubscription(userId: string, email: string) {
  // Reuse existing Stripe customer if we have one
  const { data: existingRow } = await db
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id, status')
    .eq('user_id', userId)
    .maybeSingle()

  // If already active, just return success (idempotent)
  if (existingRow?.status === 'active') {
    return respond({ alreadyActive: true })
  }

  let customerId: string = existingRow?.stripe_customer_id ?? ''

  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { user_id: userId },
    })
    customerId = customer.id
  }

  // Resolve the £4.99/mo price (env-var'd real price id in live; safe find-or-create otherwise).
  const priceId = await resolveMonthlyPriceId()

  // Cancel any existing incomplete subscription before creating a new one
  if (existingRow?.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(existingRow.stripe_subscription_id)
    } catch { /* ignore if already gone */ }
  }

  const subscription = await stripe.subscriptions.create({
    customer:         customerId,
    items:            [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: {
      payment_method_types:          ['card'],
      save_default_payment_method:   'on_subscription',
    },
    expand: ['latest_invoice.payment_intent'],
  })

  const invoice       = subscription.latest_invoice as Stripe.Invoice
  const paymentIntent = invoice.payment_intent   as Stripe.PaymentIntent

  if (!paymentIntent?.client_secret) {
    throw new Error('Failed to get payment intent from subscription.')
  }

  return respond({
    clientSecret:   paymentIntent.client_secret,
    subscriptionId: subscription.id,
    customerId,
  })
}

// ── confirm_verification ──────────────────────────────────────────────────────
// Called by the client after the payment sheet succeeds.
// Verifies the intent with Stripe (prevents spoofed confirms) then RECORDS the payment.
// Paying is NOT verification — is_verified/unlock is granted by admin approval.

async function confirmVerification(userId: string, paymentIntentId: string) {
  if (!paymentIntentId) return respond({ error: 'paymentIntentId required' }, 400)

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
  if (intent.status !== 'succeeded') {
    return respond({ error: `Payment not succeeded: ${intent.status}` }, 400)
  }

  // Verify metadata matches — prevents one user using another's payment
  if (intent.metadata?.user_id !== userId) {
    return respond({ error: 'Payment intent user mismatch' }, 403)
  }

  // Record the payment ONLY. Do not set is_verified and do not mark the attempt
  // passed — verification/unlock is granted by admin approval, not by paying.
  // Column names MUST match the live table: stripe_payment_id / currency_code.
  const { error: insertErr } = await db.from('verification_payments')
    .insert({
      user_id:           userId,
      stripe_payment_id: paymentIntentId,
      amount:            intent.amount,
      currency_code:     (intent.currency ?? 'gbp').toUpperCase(),
    })

  // 23505 = this intent is already recorded (idempotent retry) → benign success.
  // Any other error means the payment was NOT recorded — surface it (never report
  // success on a failed write) so the client can retry instead of silently locking
  // out a user who was charged.
  if (insertErr && (insertErr as { code?: string }).code !== '23505') {
    console.error('[stripe-payment] confirm_verification insert failed', insertErr)
    return respond({ success: false, error: insertErr.message }, 500)
  }

  return respond({ success: true })
}

// ── cancel_subscription ───────────────────────────────────────────────────────
// Cancels the user's subscription AT PERIOD END on Stripe (they keep access until
// then), and records it. Actually calls Stripe — never just a local flag.

async function cancelSubscription(userId: string) {
  // eslint-disable-next-line prefer-const -- reassigned by the Stripe recovery below
  let { data: row } = await db
    .from('subscriptions')
    .select('stripe_subscription_id, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()

  // No local row is NOT proof there is nothing to cancel. On the swallowed-confirm
  // path Stripe bills while we hold nothing, and returning 404 here is what made
  // "cancel at any time" untrue - the promise failed at the one moment it mattered.
  // Ask Stripe before refusing.
  if (!row?.stripe_subscription_id) {
    const recovered = await syncSubscription(userId)
    const body = await recovered.json().catch(() => null)
    if (!body?.active) {
      return respond({ error: 'No subscription to cancel' }, 404)
    }
    const { data: repaired } = await db
      .from('subscriptions')
      .select('stripe_subscription_id, status, current_period_end')
      .eq('user_id', userId)
      .maybeSingle()
    const rr = repaired as { stripe_subscription_id: string | null; status: string; current_period_end: string | null } | null
    if (!rr?.stripe_subscription_id) {
      return respond({ error: 'Subscription found in Stripe but could not be recorded - contact support' }, 500)
    }
    row = rr as typeof row
  }
  // Idempotent: already scheduled to cancel → report success with the same end date.
  if (row.status === 'cancelling') return respond({ success: true, cancelsAt: row.current_period_end })

  // Real Stripe call — cancel at period end so they keep what they paid for.
  await stripe.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true })

  // ── ONE TRANSACTION, BOTH TABLES (migration 0023) ──────────────────────────
  // These used to be two independent statements in a Promise.all. On 31 Aug 2026
  // that shape left three accounts 'expired' in subscriptions and 'active' in
  // users, because the second write violated users_subscription_status_check and
  // the first had already committed. apply_subscription_state does both in one
  // function body, so either both move or neither does.
  const { error: writeErr } = await db.rpc('apply_subscription_state', {
    p_user_id:      userId,
    p_status:       'cancelling',
    p_period_end:   row.current_period_end,
  })
  if (writeErr) {
    console.error('[stripe-payment] cancel_subscription db write failed', writeErr)
    return respond({ success: false, error: writeErr.message }, 500)
  }

  return respond({ success: true, cancelsAt: row.current_period_end })
}

// ── confirm_subscription ──────────────────────────────────────────────────────
// Called after the payment sheet succeeds for a subscription.
// Verifies subscription status with Stripe then writes to subscriptions table.

async function confirmSubscription(
  userId:         string,
  subscriptionId: string,
  // Deliberately IGNORED: the customer is resolved from the subscription itself and
  // ownership-checked below. Trusting a body-supplied customer id would defeat that.
  _customerId?:   string,
) {
  if (!subscriptionId) return respond({ error: 'subscriptionId required' }, 400)

  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  if (!['active', 'trialing'].includes(sub.status)) {
    return respond({ error: `Subscription not active: ${sub.status}` }, 400)
  }

  // OWNERSHIP. Without this, any authenticated caller could pass someone ELSE's
  // active subscription id and be marked subscribed for free — one paid sub could
  // be replayed by any number of accounts. Same class of check confirmVerification
  // does on the payment intent. The user_id is stamped on the Stripe CUSTOMER when
  // the subscription is created, so resolve the customer FROM the subscription
  // (never trust the customerId in the request body) and compare.
  const subCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!subCustomerId) {
    return respond({ error: 'Subscription has no customer' }, 400)
  }
  const customer = await stripe.customers.retrieve(subCustomerId)
  const ownerId  = (customer as Stripe.Customer)?.metadata?.user_id
  if (ownerId !== userId) {
    console.error('[stripe-payment] confirm_subscription ownership mismatch:', {
      userId, subscriptionId, ownerId: ownerId ?? null,
    })
    return respond({ error: 'Subscription does not belong to this user' }, 403)
  }

  const periodStart = new Date(sub.current_period_start * 1000).toISOString()
  const periodEnd   = new Date(sub.current_period_end   * 1000).toISOString()

  // Capture the real billed amount so the Revenue report can total subscriptions
  // (previously left null → subscription revenue always showed £0).
  const price       = sub.items?.data?.[0]?.price
  const amountPence  = price?.unit_amount ?? 499
  const currencyCode = (price?.currency ?? 'gbp').toUpperCase()

  // ── ONE TRANSACTION, BOTH TABLES (migration 0023) ──────────────────────────
  // These used to be two independent statements in a Promise.all. On 31 Aug 2026
  // that shape left three accounts 'expired' in subscriptions and 'active' in
  // users, because the second write violated users_subscription_status_check and
  // the first had already committed. apply_subscription_state does both in one
  // function body, so either both move or neither does.
  const { error: writeErr } = await db.rpc('apply_subscription_state', {
    p_user_id:         userId,
    p_status:          'active',
    p_customer_id:     subCustomerId,
    p_subscription_id: subscriptionId,
    p_period_start:    periodStart,
    p_period_end:      periodEnd,
    p_amount_pence:    amountPence,
    p_currency_code:   currencyCode,
    p_plan:            'monthly',
  })

  console.log('CONFIRM SUB WRITE →', JSON.stringify({ writeErr }))
  if (writeErr) return respond({ success: false, error: writeErr.message })

  return respond({ success: true, periodEnd })
}

// ── revenue_summary ───────────────────────────────────────────────────────────
// ADMIN ONLY. Computes ACTUAL collected revenue straight from Stripe (the source
// of truth) — every succeeded charge, net of refunds, split into subscription vs
// one-off verification. Our DB tables are summaries (one sub row per user; rows
// only for recorded verifications) and cannot equal the Stripe transaction list,
// so revenue is read from Stripe directly.

async function revenueSummary(userId: string) {
  // Gate to admins (admin status lives in the `admins` table).
  const { data: adminRow } = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
  if (!adminRow) return respond({ error: 'Forbidden' }, 403)

  const now        = new Date()
  const dayStart   = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const weekStart  = Math.floor((now.getTime() - 7 * 864e5) / 1000)
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)

  const blank = () => ({ count: 0, today: 0, week: 0, month: 0, allTime: 0 })
  const verifications = blank()
  const subscriptions = blank()
  const recent: { type: string; amountPence: number; created: number; email: string | null }[] = []

  // Page through every charge (newest first). Guard caps the loop far above any real volume.
  let startingAfter: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const page = await stripe.charges.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) })
    for (const c of page.data) {
      if (c.status !== 'succeeded') continue
      const net = c.amount - (c.amount_refunded ?? 0)   // refunds reduce the total
      if (net <= 0) continue
      // Subscription charges belong to an invoice; one-off verification PaymentIntents don't.
      const isSub  = !!c.invoice
      const bucket = isSub ? subscriptions : verifications
      bucket.count   += 1
      bucket.allTime += net
      if (c.created >= monthStart) bucket.month += net
      if (c.created >= weekStart)  bucket.week  += net
      if (c.created >= dayStart)   bucket.today += net
      if (recent.length < 50) {
        recent.push({ type: isSub ? 'subscription' : 'verification', amountPence: net, created: c.created, email: c.billing_details?.email ?? c.receipt_email ?? null })
      }
    }
    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1]?.id
    if (!startingAfter) break
  }

  return respond({ verifications, subscriptions, recent })
}

// -- reconcile_audit ----------------------------------------------------------
// READ-ONLY. Compares Stripe's subscribers against our `subscriptions` table and
// reports the disagreements. Writes nothing, anywhere.
//
// -- WHY THIS EXISTS ---------------------------------------------------------
// subscribe.tsx:105 swallows a failed confirm_subscription ("webhook will sync
// DB - proceed"), and confirmSubscription ALSO returns HTTP 200 with
// { success: false } when its database write fails, which no client checks. On
// either path Stripe bills every month while we hold no row at all - so the
// affected people are invisible to every query that starts from our own tables.
// You cannot count them from this side. You have to ask Stripe.
//
// Same reasoning as the 19 orphaned bookings: fixing the mechanism does not
// repair the damage, and the damage cannot be known without looking.
//
// Deliberately the READ half. sync_subscription will reuse this lookup and add
// repair; shipping the read first means the numbers are known before anything
// is changed by them.
async function reconcileAudit(userId: string) {
  const { data: adminRow } = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
  if (!adminRow) return respond({ error: 'Forbidden' }, 403)

  // Which price is ACTUALLY live. STRIPE_MONTHLY_PRICE_ID silently overrides the
  // `unit_amount: 499` written in this file, and nothing in the repo can reveal
  // what it points at - see the configuration blind spot in
  // audit-records-vs-reality.md. Reported so a routine check answers it.
  let priceReport: Record<string, unknown>
  try {
    const priceId = await resolveMonthlyPriceId()
    const price   = await stripe.prices.retrieve(priceId)
    priceReport = {
      resolved: priceId,
      fromEnvVar: !!Deno.env.get('STRIPE_MONTHLY_PRICE_ID'),
      unitAmount: price.unit_amount,
      currency: price.currency,
      active: price.active,
      matchesExpected499: price.unit_amount === 499,
    }
  } catch (err) {
    priceReport = { resolved: null, error: err instanceof Error ? err.message : String(err) }
  }

  // Every subscription costing someone money, or about to. past_due and unpaid
  // are included deliberately: they are exactly the states a missing webhook
  // hides from us.
  const BILLABLE = ['active', 'trialing', 'past_due', 'unpaid']
  const stripeSubs: {
    id: string; status: string; userId: string | null; customerId: string
    currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; unitAmount: number | null
  }[] = []

  let startingAfter: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const page = await stripe.subscriptions.list({
      status: 'all', limit: 100, expand: ['data.customer'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const sub of page.data) {
      if (!BILLABLE.includes(sub.status)) continue
      const cust = sub.customer as Stripe.Customer | string
      const customerId = typeof cust === 'string' ? cust : cust.id
      // user_id is stamped on the CUSTOMER at creation. A subscription without
      // one cannot be matched to an account at all, which is its own finding.
      const metaUserId = typeof cust === 'string' ? null : (cust?.metadata?.user_id ?? null)
      stripeSubs.push({
        id: sub.id,
        status: sub.status,
        userId: metaUserId,
        customerId,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString() : null,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        unitAmount: sub.items?.data?.[0]?.price?.unit_amount ?? null,
      })
    }
    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1]?.id
  }

  const { data: localRows, error: localErr } = await db
    .from('subscriptions')
    .select('user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end')
  if (localErr) return respond({ error: 'Could not read subscriptions: ' + localErr.message }, 500)

  const local = (localRows ?? []) as {
    user_id: string; stripe_subscription_id: string | null
    stripe_customer_id: string | null; status: string; current_period_end: string | null
  }[]
  const localByUser  = new Map(local.map(r => [r.user_id, r]))
  const stripeByUser = new Map(stripeSubs.filter(s => s.userId).map(s => [s.userId as string, s]))
  const now = Date.now()

  // BILLED BUT INVISIBLE - the population this whole exercise exists to count.
  const billedNoRow = stripeSubs.filter(s => !s.userId || !localByUser.has(s.userId))

  // A local row claiming to grant access with nothing behind it in Stripe.
  const rowNoStripe = local.filter(r =>
    ['active', 'cancelling'].includes(r.status) && !stripeByUser.has(r.user_id))

  // Present in both, disagreeing about status or period end.
  const disagree = local.flatMap(r => {
    const s = stripeByUser.get(r.user_id)
    if (!s) return []
    const statusDiffers = !(
      (r.status === 'active' && ['active', 'trialing'].includes(s.status)) ||
      (r.status === 'cancelling' && s.cancelAtPeriodEnd)
    )
    const endDiffers = (r.current_period_end ?? null) !== (s.currentPeriodEnd ?? null)
    if (!statusDiffers && !endDiffers) return []
    return [{
      userId: r.user_id, ourStatus: r.status, stripeStatus: s.status,
      stripeCancelAtPeriodEnd: s.cancelAtPeriodEnd,
      ourPeriodEnd: r.current_period_end, stripePeriodEnd: s.currentPeriodEnd,
      statusDiffers, endDiffers,
    }]
  })

  // Granting access on a row whose period has already ended.
  // hasActiveSubscription applies the date check only to 'cancelling', so these
  // are live right now.
  const lapsedButGranting = local.filter(r =>
    r.status === 'active' && r.current_period_end != null &&
    new Date(r.current_period_end).getTime() < now)

  // Cannot be reconciled at all: no Stripe customer recorded, so there is
  // nothing to ask about.
  const unverifiable = local.filter(r =>
    ['active', 'cancelling'].includes(r.status) && !r.stripe_customer_id)

  return respond({
    ok: true,
    readOnly: true,
    price: priceReport,
    counts: {
      stripeBillable: stripeSubs.length,
      localRows: local.length,
      billedButNoRow: billedNoRow.length,
      rowButNotBillingInStripe: rowNoStripe.length,
      disagreeing: disagree.length,
      lapsedButStillGranting: lapsedButGranting.length,
      unverifiableNoCustomerId: unverifiable.length,
    },
    billedButNoRow: billedNoRow.map(s => ({
      subscriptionId: s.id, customerId: s.customerId, userId: s.userId,
      status: s.status, periodEnd: s.currentPeriodEnd, unitAmount: s.unitAmount,
    })),
    rowButNotBillingInStripe: rowNoStripe.map(r => ({
      userId: r.user_id, ourStatus: r.status, periodEnd: r.current_period_end,
      stripeSubscriptionId: r.stripe_subscription_id,
    })),
    disagreeing: disagree,
    lapsedButStillGranting: lapsedButGranting.map(r => ({
      userId: r.user_id, periodEnd: r.current_period_end,
    })),
    unverifiableNoCustomerId: unverifiable.map(r => ({
      userId: r.user_id, ourStatus: r.status,
    })),
  })
}

// -- sync_subscription --------------------------------------------------------
// The authoritative answer to "is this person subscribed", reconciled against
// Stripe when our own record cannot be trusted.
//
// -- WHY THE GATE CANNOT JUST READ OUR OWN ROW -------------------------------
// Two failures, in opposite directions, and both are live:
//
//  1. We OVER-GRANT. hasActiveSubscription applies its date check only to
//     'cancelling', so an 'active' row whose period ended keeps granting access
//     for ever. 8 of 11 rows were in that state on 24 Aug 2026.
//
//  2. A naive date check would OVER-REVOKE, from the people actually paying.
//     There is no webhook, so current_period_end is only ever written by
//     confirm_subscription - at initial subscribe. Stripe renews; our row does
//     not move. Someone who subscribed in January still shows a February end
//     date in April, while paying every month. Denying them would be the worse
//     of the two bugs.
//
// So a lapsed-looking row is not evidence of anything. It is a prompt to ask
// Stripe. That is what makes the date check safe, and why this must land in the
// same change as it.
//
// FAST PATH: a row that is unambiguously current returns immediately with no
// Stripe call. Stripe is consulted only when our record is missing, stale, or
// unverifiable - so the common case costs nothing.
async function syncSubscription(userId: string) {
  const { data: rowData } = await db
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()

  const row = rowData as {
    stripe_customer_id: string | null; stripe_subscription_id: string | null
    status: string | null; current_period_end: string | null
  } | null

  const endsInFuture = !!row?.current_period_end &&
    new Date(row.current_period_end).getTime() > Date.now()

  if (row && ['active', 'cancelling'].includes(row.status ?? '') &&
      endsInFuture && row.stripe_customer_id) {
    return respond({
      ok: true, source: 'local', active: true,
      status: row.status, currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.status === 'cancelling',
    })
  }

  // Resolve the customer. Prefer the id we already hold; otherwise find it by the
  // user_id stamped on the customer at creation. A row with no customer id is the
  // malformed shape found on 24 Aug - unreconcilable from our side alone, which is
  // exactly why we look it up rather than trusting the row.
  let customerId = row?.stripe_customer_id ?? null
  if (!customerId) {
    try {
      const found = await stripe.customers.search({
        query: 'metadata[\'user_id\']:\'' + userId + '\'', limit: 1,
      })
      customerId = found.data[0]?.id ?? null
    } catch (err) {
      console.error('[stripe-payment] customer search failed', err)
      // Fail CLOSED on an inconclusive lookup: report that we could not tell,
      // rather than reporting "not subscribed" and cutting off a payer.
      return respond({
        ok: false, source: 'stripe', active: null,
        error: 'Could not reach Stripe to verify subscription state',
      }, 503)
    }
  }

  if (!customerId) {
    // No customer in Stripe at all. Nothing is being billed, so any local row
    // claiming otherwise is wrong.
    if (row && ['active', 'cancelling', 'past_due'].includes(row.status ?? '')) {
      // Was two unchecked writes of subscription_status: 'free'. The constraint
      // rejects 'free', so this branch has been failing silently since Stripe
      // went live while still returning `repaired: true` — the exact
      // success-signal-that-proves-nothing shape this audit keeps finding.
      // 0023 discovered the permitted value and owns it now; the error is
      // checked rather than discarded.
      const { error: expErr } = await db.rpc('apply_subscription_state', {
        p_user_id: userId, p_status: 'expired',
      })
      if (expErr) {
        console.error('[stripe-payment] sync_subscription expire failed', expErr)
        return respond({ ok: false, error: 'Could not expire subscription: ' + expErr.message }, 500)
      }
    }
    return respond({ ok: true, source: 'stripe', active: false, status: 'expired', repaired: !!row })
  }

  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 })
  const BILLABLE = ['active', 'trialing', 'past_due']
  const live = subs.data.find(x => BILLABLE.includes(x.status))

  if (!live) {
    if (row && ['active', 'cancelling', 'past_due'].includes(row.status ?? '')) {
      // Was two unchecked writes of subscription_status: 'free'. The constraint
      // rejects 'free', so this branch has been failing silently since Stripe
      // went live while still returning `repaired: true` — the exact
      // success-signal-that-proves-nothing shape this audit keeps finding.
      // 0023 discovered the permitted value and owns it now; the error is
      // checked rather than discarded.
      const { error: expErr } = await db.rpc('apply_subscription_state', {
        p_user_id: userId, p_status: 'expired', p_customer_id: customerId,
      })
      if (expErr) {
        console.error('[stripe-payment] sync_subscription expire failed', expErr)
        return respond({ ok: false, error: 'Could not expire subscription: ' + expErr.message }, 500)
      }
    }
    return respond({ ok: true, source: 'stripe', active: false, status: 'expired', repaired: !!row })
  }

  // Stripe says they are paying. Write the truth back, so the fast path works
  // next time and cancel_subscription has a row to act on.
  const periodEnd = new Date(live.current_period_end * 1000).toISOString()

  // ── MUST AGREE WITH stripe-webhook's mapStatus() ──────────────────────────
  // This used to be `cancel_at_period_end ? 'cancelling' : 'active'`, which
  // wrote 'active' for a Stripe subscription that is actually past_due. Once
  // the webhook exists, that is two mechanisms writing the same column with
  // different answers: the webhook records past_due on a failed payment and
  // the next read-time sync quietly overwrites it with active, so the user is
  // never shown as behind and the grace period silently restarts.
  //
  // Both are still hand-written lists in separate deployments. Migration 0022
  // asserts the status vocabulary is closed, which is what stops a third value
  // appearing that neither of them names.
  const status = live.cancel_at_period_end
    ? 'cancelling'
    : (live.status === 'past_due' || live.status === 'unpaid') ? 'past_due' : 'active'
  const price     = live.items?.data?.[0]?.price

  const { error: upsertErr } = await db.rpc('apply_subscription_state', {
    p_user_id:         userId,
    p_status:          status,
    p_customer_id:     customerId,
    p_subscription_id: live.id,
    p_period_start:    new Date(live.current_period_start * 1000).toISOString(),
    p_period_end:      periodEnd,
    p_amount_pence:    price?.unit_amount ?? 499,
    p_currency_code:   (price?.currency ?? 'gbp').toUpperCase(),
    p_plan:            'monthly',
  })

  // The users write used to be a second statement here. It is gone:
  // apply_subscription_state does both tables in one transaction, and the
  // past_due -> 'active' mapping for Settings now lives inside that function
  // rather than being repeated in every caller.
  //
  // A failed repair must not be reported as success — that was the defect
  // confirm_subscription had, returning 200 with { success: false } no caller
  // read. Access is still granted, because Stripe says they are paying and that
  // is what the answer turns on.
  if (upsertErr) {
    console.error('[stripe-payment] sync_subscription repair failed',
      JSON.stringify({ upsertErr }))
  }

  return respond({
    ok: true, source: 'stripe', active: true, status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: !!live.cancel_at_period_end,
    repaired: true,
    ...(upsertErr ? { repairWriteFailed: upsertErr.message } : {}),
  })
}

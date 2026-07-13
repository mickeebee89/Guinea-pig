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
    description: 'Guinea Pig identity verification fee',
    metadata: { user_id: userId, type: 'verification' },
    automatic_payment_methods: { enabled: true },
  })

  return respond({
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
  })
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

  // Get or create the monthly recurring price via lookup key
  let priceId: string
  try {
    const existing = await stripe.prices.retrieve('guinea_pig_monthly_499')
    priceId = existing.id
  } catch {
    // Price doesn't exist yet — create it
    const price = await stripe.prices.create({
      unit_amount: 499,
      currency:    'gbp',
      recurring:   { interval: 'month' },
      product_data: { name: 'Guinea Pig Monthly' },
      // Stripe doesn't support lookup_key on creation via this API; store by id below
    })
    priceId = price.id
  }

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
  const { data: row } = await db
    .from('subscriptions')
    .select('stripe_subscription_id, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()

  if (!row?.stripe_subscription_id) return respond({ error: 'No subscription to cancel' }, 404)
  // Idempotent: already scheduled to cancel → report success with the same end date.
  if (row.status === 'cancelling') return respond({ success: true, cancelsAt: row.current_period_end })

  // Real Stripe call — cancel at period end so they keep what they paid for.
  await stripe.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true })

  // Reflect it in BOTH sources of truth: the gate reads subscriptions.status; the
  // Settings panel reads users.subscription_status.
  const [{ error: subErr }, { error: userErr }] = await Promise.all([
    db.from('subscriptions').update({ status: 'cancelling' }).eq('user_id', userId),
    db.from('users')
      .update({ subscription_status: 'cancelling', subscription_next_billing: row.current_period_end })
      .eq('id', userId),
  ])
  if (subErr || userErr) {
    console.error('[stripe-payment] cancel_subscription db write failed', { subErr, userErr })
    return respond({ success: false, error: (subErr || userErr)!.message }, 500)
  }

  return respond({ success: true, cancelsAt: row.current_period_end })
}

// ── confirm_subscription ──────────────────────────────────────────────────────
// Called after the payment sheet succeeds for a subscription.
// Verifies subscription status with Stripe then writes to subscriptions table.

async function confirmSubscription(
  userId:         string,
  subscriptionId: string,
  customerId:     string,
) {
  if (!subscriptionId) return respond({ error: 'subscriptionId required' }, 400)

  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  if (!['active', 'trialing'].includes(sub.status)) {
    return respond({ error: `Subscription not active: ${sub.status}` }, 400)
  }

  const periodStart = new Date(sub.current_period_start * 1000).toISOString()
  const periodEnd   = new Date(sub.current_period_end   * 1000).toISOString()

  // Capture the real billed amount so the Revenue report can total subscriptions
  // (previously left null → subscription revenue always showed £0).
  const price       = sub.items?.data?.[0]?.price
  const amountPence  = price?.unit_amount ?? 499
  const currencyCode = (price?.currency ?? 'gbp').toUpperCase()

  const [{ error: userErr }, { error: subErr }] = await Promise.all([
    // Update users table
    db.from('users')
      .update({
        subscription_status:       'active',
        subscription_next_billing: periodEnd,
      })
      .eq('id', userId),

    // Upsert subscription record
    db.from('subscriptions')
      .upsert(
        {
          user_id:                userId,
          stripe_customer_id:     customerId,
          stripe_subscription_id: subscriptionId,
          status:                 'active',
          current_period_start:   periodStart,
          current_period_end:     periodEnd,
          amount_pence:           amountPence,
          currency_code:          currencyCode,
          plan:                   'monthly',
        },
        { onConflict: 'user_id' },
      ),
  ])

  console.log('CONFIRM SUB WRITE →', JSON.stringify({ userErr, subErr }))
  if (subErr || userErr) return respond({ success: false, userErr, subErr })

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

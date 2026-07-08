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
  await db.from('verification_payments')
    .insert({
      user_id:                  userId,
      stripe_payment_intent_id: paymentIntentId,
      amount:                   intent.amount,
      currency:                 intent.currency,
    })

  return respond({ success: true })
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
        },
        { onConflict: 'user_id' },
      ),
  ])

  console.log('CONFIRM SUB WRITE →', JSON.stringify({ userErr, subErr }))
  if (subErr || userErr) return respond({ success: false, userErr, subErr })

  return respond({ success: true, periodEnd })
}

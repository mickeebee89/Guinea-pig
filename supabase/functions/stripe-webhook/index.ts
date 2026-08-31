// Supabase Edge Function — stripe-webhook
//
// Deploy:  npx supabase functions deploy stripe-webhook --no-verify-jwt
// Secret:  npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//
// ⚠️ --no-verify-jwt IS REQUIRED AND IS NOT A HOLE.
// Stripe does not send a Supabase JWT. Without the flag the gateway rejects
// every delivery before this code runs, and Stripe's dashboard shows 401s that
// look like our bug. Authentication here is the SIGNATURE, which is strictly
// stronger: it proves the body came from Stripe unmodified, which a JWT would
// not. Nothing below runs before constructEventAsync has verified it.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Item 2 gave the app read-time reconcile: when someone opens Cavy we ask
// Stripe what is true and repair our row. That is bounded but passive — it only
// ever learns the truth when a person happens to look. Renewals, failed
// payments, disputes and cancellations made from Stripe's own dashboard all
// happen when nobody is looking, and until now none of them reached us at all.
//
// It is also what stops every renewal costing a Stripe round-trip, since after
// a renewal our row is stale by definition until someone visits.
//
// ── WHAT A FAILED PAYMENT DOES, AND WHY ────────────────────────────────────
// Grace until period end, then let Stripe decide when it is over.
//
//   invoice.payment_failed        -> status 'past_due', ACCESS CONTINUES to
//                                    current_period_end, and we tell the user
//   customer.subscription.deleted -> status 'expired', access ends
//
// Stripe retries a failed payment for up to ~3 weeks before giving up. Cutting
// someone off on the first failure punishes an expired card, and "wrongly
// denying a paying subscriber" is the failure both gates already deliberately
// fail toward avoiding. So the subscription ends when Stripe says it is
// genuinely over, not when a card first hiccups.
//
// The user is TOLD on the first failure. A silent past_due means they discover
// it three weeks later when access stops, with no idea why — the difference
// between "my card expired" and "Cavy cut me off".
//
// ── EVERY DELIVERY IS RECORDED ─────────────────────────────────────────────
// The endpoint URL lives in the Stripe dashboard and the signing secret in the
// Supabase one. Neither is in this repo and nothing compares them, so a webhook
// that was never registered is indistinguishable from one that is registered
// and quiet. Every event lands in stripe_webhook_events (migration 0022) and
// the admin Revenue page shows when the last one arrived.

import Stripe from 'npm:stripe@14'
import { createClient } from 'npm:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
})

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/** Stripe status -> ours. Kept beside the gates' list on purpose; 0022 asserts
 *  the vocabulary is closed so a new value cannot appear unnoticed. */
function mapStatus(stripeStatus: string): 'active' | 'cancelling' | 'past_due' | 'expired' {
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

const iso = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toISOString() : null

/** Never let a formatting failure be the thing that swallows an error. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/**
 * Which of our users this event is about.
 *
 * Tries the customer's metadata.user_id first — the same key reconcile_audit
 * relies on — then falls back to our own row. Returns null rather than
 * guessing; an event we cannot attribute is recorded as 'failed' with the
 * customer id, which is enough to chase it by hand.
 */
async function resolveUserId(customerId: string | null): Promise<string | null> {
  if (!customerId) return null

  const { data: row } = await db
    .from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle()
  if (row?.user_id) return row.user_id as string

  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (!customer.deleted) {
      const metaId = (customer.metadata as Record<string, string> | undefined)?.user_id
      if (metaId) return metaId
    }
  } catch (e) {
    console.warn('[stripe-webhook] customer lookup failed:', describeError(e))
  }
  return null
}

/**
 * Write the state.
 *
 * ── THIS USED TO BE TWO STATEMENTS AND IT SPLIT ───────────────────────────
 * It ran `subscriptions.upsert` and `users.update` in a Promise.all and threw
 * afterwards if either failed. Throwing does not undo the one that succeeded.
 *
 * On 31 Aug 2026 three customer.subscription.deleted events failed on
 * users_subscription_status_check and left exactly that: subscriptions
 * 'expired', users still 'active'. Three accounts reading as paying members
 * with access, on the one event whose entire job is to end access.
 *
 * Now it is a single SECURITY DEFINER function (migration 0023). A function
 * body is one transaction, so a constraint violation on the second table rolls
 * back the first. Both tables move or neither does.
 *
 * The value written for "not paying" is no longer guessed here either. It was
 * 'free', which the constraint rejects; 0023 discovered the permitted value by
 * probing the live constraint and baked it into the function.
 */
async function writeState(args: {
  userId: string
  status: 'active' | 'cancelling' | 'past_due' | 'expired'
  customerId: string | null
  subscriptionId: string | null
  periodStart: string | null
  periodEnd: string | null
}): Promise<void> {
  const { error } = await db.rpc('apply_subscription_state', {
    p_user_id:         args.userId,
    p_status:          args.status,
    p_customer_id:     args.customerId,
    p_subscription_id: args.subscriptionId,
    p_period_start:    args.periodStart,
    p_period_end:      args.periodEnd,
  })

  // Thrown, not logged. A webhook that could not write must return non-2xx so
  // Stripe retries — swallowing it is the defect confirm_subscription had.
  if (error) throw new Error(`db write failed: ${error.message}`)
}

/** Tell the user their payment failed. Once per invoice, not once per retry. */
async function notifyPaymentFailed(userId: string, invoiceId: string, periodEnd: string | null) {
  // Stripe fires payment_failed on every retry. The user needs telling once,
  // not four times over three weeks, so the invoice id is the dedupe key.
  const { data: existing } = await db
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'payment_failed')
    .ilike('body', `%${invoiceId}%`)
    .limit(1)
  // .limit(1) rather than .maybeSingle(): maybeSingle throws when more than one
  // row matches, which would turn "we already told them" into a failed event.
  if ((existing ?? []).length > 0) return

  const until = periodEnd
    ? ` Your membership stays active until ${new Date(periodEnd).toLocaleDateString('en-GB')}.`
    : ''

  const { error } = await db.from('notifications').insert({
    user_id: userId,
    type:    'payment_failed',
    title:   'We couldn’t take your £4.99 payment',
    // The invoice id is carried in the body so a retry can find this row. It is
    // not secret and it is not shown prominently.
    body:
      `Your card was declined.${until} Stripe will try again over the next few days — ` +
      `if you’ve got a new card, update it and nothing else is needed. ` +
      `You haven’t been charged twice. (ref ${invoiceId})`,
  })
  if (error) console.error('[stripe-webhook] payment_failed notification failed', error)
}

/**
 * The subscription this invoice belongs to, from either payload shape.
 *
 * ── WHY THERE ARE TWO ────────────────────────────────────────────────────
 * Two real £4.99 renewals arrived on 31 Aug 2026 and were recorded as
 * "invoice with no subscription (one-off payment)" and IGNORED. They were not
 * one-off payments. `invoice.subscription` was removed in Stripe API version
 * 2025-04-30.basil and moved to
 * `invoice.parent.subscription_details.subscription`, and the payload shape is
 * set by the WEBHOOK ENDPOINT'S API version — not by the SDK pinned in this
 * file. A new endpoint registered in 2026 gets the current version, so the
 * field this code read had already moved.
 *
 * Both shapes are read, so this keeps working whichever version the endpoint
 * is on.
 */
function subscriptionIdFrom(inv: Stripe.Invoice): string | null {
  const direct = (inv as unknown as { subscription?: string | { id: string } | null }).subscription
  if (direct) return typeof direct === 'string' ? direct : direct.id

  const nested = (inv as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null
  }).parent?.subscription_details?.subscription
  if (nested) return typeof nested === 'string' ? nested : nested.id

  return null
}

/**
 * Does Stripe consider this a subscription invoice, regardless of where the id
 * lives? `billing_reason` is stable across both API shapes.
 *
 * This exists so 'ignored' can only ever mean "not ours to act on", never "we
 * could not tell". Conflating those is what turned two real renewals into two
 * rows that looked fine.
 */
function isSubscriptionInvoice(inv: Stripe.Invoice): boolean {
  return [
    'subscription', 'subscription_create', 'subscription_cycle',
    'subscription_update', 'subscription_threshold',
  ].includes(inv.billing_reason ?? '')
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret) {
    // FAIL CLOSED. Without the secret nothing can be verified, and accepting
    // unverified events would let anyone who found the URL write subscription
    // state. Same rule as send-push: a missing secret refuses, loudly.
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — refusing every event')
    return new Response(
      JSON.stringify({ error: 'STRIPE_WEBHOOK_SECRET is not configured on this function' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const signature = req.headers.get('stripe-signature')
  const raw = await req.text()   // must be the RAW body — parsing first breaks the signature

  let event: Stripe.Event
  try {
    if (!signature) throw new Error('no stripe-signature header')
    // The async variant: Deno has no synchronous crypto for this.
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret)
  } catch (e) {
    // Recorded with a synthetic id: an unverified body's event id cannot be
    // trusted, but "something is hitting this endpoint and failing to verify"
    // is exactly what the Revenue panel needs to show. Almost always a
    // signing-secret mismatch between the two dashboards.
    const detail = describeError(e)
    console.error('[stripe-webhook] signature verification failed:', detail)
    await db.from('stripe_webhook_events').insert({
      id:      `unverified_${crypto.randomUUID()}`,
      type:    'signature.failed',
      outcome: 'failed',
      detail:  `Signature verification failed: ${detail}. Usually STRIPE_WEBHOOK_SECRET `
             + `not matching the endpoint's signing secret in the Stripe dashboard.`,
    })
    return new Response(JSON.stringify({ error: 'signature verification failed' }), { status: 400 })
  }

  // ── Idempotency: claim the event id, or discover it is a redelivery ───────
  // The primary key IS the mechanism. 23505 means we already have it.
  const { error: claimErr } = await db.from('stripe_webhook_events').insert({
    id:      event.id,
    type:    event.type,
    outcome: 'processed',       // corrected below if it turns out otherwise
    detail:  'processing',
  })
  if (claimErr) {
    if ((claimErr as { code?: string }).code === '23505') {
      // Seen before — but WHICH before matters. A row we processed or ignored
      // must not be applied twice. A row we FAILED to apply must be allowed to
      // run again, or Stripe's retry hits this branch, gets a 200, and a
      // transient database blip becomes permanent silent data loss with a
      // 'failed' row nobody is watching.
      const { data: prior } = await db.from('stripe_webhook_events')
        .select('outcome').eq('id', event.id).maybeSingle()
      if (prior && (prior as { outcome: string }).outcome !== 'failed') {
        return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 })
      }
      // Fall through and re-run. `finish` updates the existing row.
    } else {
      console.error('[stripe-webhook] could not record event', claimErr)
      // Non-2xx: we would rather Stripe retried than lose the event silently.
      return new Response(JSON.stringify({ error: 'could not record event' }), { status: 500 })
    }
  }

  const finish = async (
    outcome: 'processed' | 'ignored' | 'failed',
    detail: string,
    userId: string | null = null,
  ) => {
    await db.from('stripe_webhook_events')
      .update({ outcome, detail, user_id: userId }).eq('id', event.id)
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null
        const userId = await resolveUserId(customerId)
        if (!userId) {
          await finish('failed', `No user for customer ${customerId}. Event left unapplied.`)
          // 200 deliberately: retrying will not conjure a user, and an endless
          // retry loop would bury real failures in the Stripe dashboard.
          return new Response(JSON.stringify({ received: true, unattributed: true }), { status: 200 })
        }

        // cancel_at_period_end is the "cancelling" state: still paid up, still
        // has access, just will not renew. Deleted always wins.
        const status = event.type === 'customer.subscription.deleted'
          ? 'expired' as const
          : (sub.cancel_at_period_end ? 'cancelling' as const : mapStatus(sub.status))

        await writeState({
          userId, status, customerId,
          subscriptionId: sub.id,
          periodStart: iso(sub.current_period_start),
          periodEnd:   iso(sub.current_period_end),
        })
        await finish('processed', `${event.type} -> ${status}`, userId)
        break
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice
        // Only subscription invoices matter here; the £14.99 provider fee is a
        // PaymentIntent and has no subscription attached.
        const subIdFound = subscriptionIdFrom(inv)
        if (!subIdFound) {
          // 'ignored' must mean "not ours", never "we could not tell". A
          // subscription invoice we cannot resolve is a FAILURE and has to look
          // like one — two real renewals were filed as one-off payments here.
          if (isSubscriptionInvoice(inv)) {
            await finish('failed',
              `Subscription invoice (billing_reason=${inv.billing_reason}) but no subscription id `
              + `in either invoice.subscription or invoice.parent.subscription_details.subscription. `
              + `Check the endpoint's API version in the Stripe dashboard.`)
            // 200, not 500: redelivering the same payload cannot fix a shape
            // problem, and an endless retry would bury real failures.
            return new Response(JSON.stringify({ received: true, unresolved: true }), { status: 200 })
          }
          await finish('ignored',
            `Invoice with no subscription (billing_reason=${inv.billing_reason ?? 'unknown'}) `
            + `— genuinely a one-off payment`)
          break
        }
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null
        const userId = await resolveUserId(customerId)
        if (!userId) {
          await finish('failed', `No user for customer ${customerId}. Event left unapplied.`)
          return new Response(JSON.stringify({ received: true, unattributed: true }), { status: 200 })
        }

        // Read the subscription rather than trusting the invoice's period: on a
        // renewal the invoice line period and the subscription period can differ
        // by proration, and the gates read current_period_end.
        const subId = subIdFound
        const sub = await stripe.subscriptions.retrieve(subId)

        await writeState({
          userId,
          status: sub.cancel_at_period_end ? 'cancelling' : mapStatus(sub.status),
          customerId,
          subscriptionId: subId,
          periodStart: iso(sub.current_period_start),
          periodEnd:   iso(sub.current_period_end),
        })
        // A success clears a past_due without any special case: the status above
        // comes from Stripe, which has already moved it back to active.
        await finish('processed', `payment succeeded, renewed to ${iso(sub.current_period_end)}`, userId)
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        const failedSubId = subscriptionIdFrom(inv)
        if (!failedSubId) {
          if (isSubscriptionInvoice(inv)) {
            await finish('failed',
              `Failed subscription invoice (billing_reason=${inv.billing_reason}) but no `
              + `subscription id in either payload shape. The user has NOT been told their `
              + `payment failed. Check the endpoint's API version.`)
            return new Response(JSON.stringify({ received: true, unresolved: true }), { status: 200 })
          }
          await finish('ignored',
            `Failed invoice with no subscription (billing_reason=${inv.billing_reason ?? 'unknown'}) `
            + `— genuinely a one-off payment`)
          break
        }
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null
        const userId = await resolveUserId(customerId)
        if (!userId) {
          await finish('failed', `No user for customer ${customerId}. Event left unapplied.`)
          return new Response(JSON.stringify({ received: true, unattributed: true }), { status: 200 })
        }

        const subId = failedSubId
        const sub = await stripe.subscriptions.retrieve(subId)
        const periodEnd = iso(sub.current_period_end)

        // past_due, and ACCESS CONTINUES — the gates treat past_due as live
        // until current_period_end. Stripe will retry; if it gives up it sends
        // customer.subscription.deleted and that is what ends access.
        await writeState({
          userId, status: 'past_due', customerId,
          subscriptionId: subId,
          periodStart: iso(sub.current_period_start),
          periodEnd,
        })
        await notifyPaymentFailed(userId, inv.id, periodEnd)
        await finish('processed', `payment failed -> past_due, access continues to ${periodEnd}`, userId)
        break
      }

      default:
        await finish('ignored', `No handler for ${event.type}`)
    }
  } catch (e) {
    const detail = describeError(e)
    console.error('[stripe-webhook] handler failed', event.type, detail)
    await finish('failed', detail)
    // Non-2xx so Stripe retries, and the retry genuinely re-runs: the claim
    // branch above only short-circuits on a row that was processed or ignored,
    // never on a failed one. So a transient failure self-heals on Stripe's next
    // delivery, and a persistent one leaves a 'failed' row the Revenue page
    // surfaces.
    return new Response(JSON.stringify({ error: detail }), { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})

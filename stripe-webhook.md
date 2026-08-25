# The Stripe webhook

_Item 6 of the audit. Built 25 Aug 2026. **Not yet live — needs the endpoint
registering and the secret setting.**_

**Item 2 made subscription state repairable. This makes it observable.** Read-time
reconcile only learns the truth when someone opens the app; renewals, failed
payments, disputes and cancellations made from Stripe's own dashboard all happen
when nobody is looking.

---

## What a failed payment does

Grace until period end, then let Stripe decide when it is over.

| Event | Our status | Access |
|---|---|---|
| `invoice.payment_failed` | `past_due` | **continues** to `current_period_end` |
| `invoice.payment_succeeded` | `active` | continues, period extended |
| `customer.subscription.deleted` | `expired` | **ends** |
| `customer.subscription.updated` with `cancel_at_period_end` | `cancelling` | continues to period end |

Stripe retries a failed payment for up to about three weeks. Cutting someone off
on the first failure punishes an expired card, and *wrongly denying a paying
subscriber* is the failure both gates already deliberately lean away from. So the
subscription ends when Stripe says it is genuinely over, not when a card first
hiccups.

**The user is told on the first failure**, in-app and by push. A silent `past_due`
means they discover it three weeks later when access stops, with no idea why —
the difference between "my card expired" and "Cavy cut me off". Stripe fires
`payment_failed` on every retry, so the invoice id is the dedupe key: told once,
not four times.

`payment_failed` also got a real icon in the mobile notification list. Without one
it rendered as the generic grey fallback dot, which is the wrong weight for the
only warning someone gets before their subscription ends.

---

## Two mechanisms were about to disagree

`sync_subscription` computed `cancel_at_period_end ? 'cancelling' : 'active'`. For
a Stripe subscription that is genuinely `past_due` that writes **`active`** — so
the webhook would record the failed payment and the next read-time sync would
quietly overwrite it. The user would never show as behind, and the grace period
would silently restart on every app open.

Both now use the same mapping. They are still hand-written lists in separate
deployments, which is why **migration `0022` asserts the status vocabulary is
closed**: a value in `subscriptions.status` that neither gate nor the webhook
names would grant nobody access and report nothing.

`past_due` was added to both access gates. It grants.

---

## Silence had to be distinguishable from success

The endpoint URL lives in the Stripe dashboard and the signing secret in the
Supabase one. Neither is in this repo and nothing compares them. **A webhook that
was never registered behaves exactly like one that is registered and quiet:** no
errors, no rows, no difference. Same shape as the cron install script still
holding `<YOUR-RANDOM-CRON-SECRET>`, and as `STRIPE_SECRET_KEY` sitting beside
`stripe_secret_key` with only one ever read.

So every delivery lands in `stripe_webhook_events`, and the admin **Revenue** page
opens with a panel saying when the last event arrived. With nothing received it
says so in red and names both possible causes, rather than rendering an empty
space.

Failures to *verify* are recorded too, under a synthetic id — an unverified body's
event id cannot be trusted, but "something is hitting this endpoint and failing
the signature check" is exactly what needs surfacing. It almost always means the
two dashboards disagree.

**No payloads are stored.** A Stripe event carries customer email, card brand,
last four and billing address. None of it is needed to answer "did this arrive
and what did we do", and keeping it would create a second copy of payment data in
a database whose retention policy says nothing about one.

---

## Idempotency, and the bug in the first draft

Stripe retries on any non-2xx and can redeliver regardless. The event id is the
table's **primary key**, so a duplicate fails the insert with `23505` — the
uniqueness constraint *is* the mechanism, with no second check that could drift
from it.

The first version of this returned 200 on any duplicate. That meant a **failed**
event could never be retried: a transient database blip would return 500, Stripe
would redeliver, the duplicate branch would return 200, and the event was lost
for good with a `failed` row nobody was watching.

Now the short-circuit only applies to rows that were `processed` or `ignored`. A
`failed` row re-runs. Transient failures self-heal on Stripe's next delivery;
persistent ones leave a row the Revenue panel surfaces.

---

## To make it live

1. Apply `0022`.
2. `npx supabase functions deploy stripe-webhook --no-verify-jwt`
3. Register the endpoint in Stripe → Developers → Webhooks, sending
   `customer.subscription.created`, `.updated`, `.deleted`,
   `invoice.payment_succeeded`, `invoice.payment_failed`.
4. `npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...` from that endpoint.
5. Send a test event and check the Revenue panel changes.

**`--no-verify-jwt` is required and is not a hole.** Stripe does not send a
Supabase JWT; without the flag the gateway rejects every delivery before the
function runs, and Stripe's dashboard shows 401s that look like our bug.
Authentication here is the *signature*, which is strictly stronger — it proves the
body came from Stripe unmodified, which a JWT would not. Nothing runs before
`constructEventAsync` has verified it. If `STRIPE_WEBHOOK_SECRET` is unset the
function refuses every event rather than trusting an unverified body.

---

## Still open

**Nothing is proven until step 5.** Everything above is code that compiles and has
never received a real event. The panel exists precisely so that stays visible
rather than being assumed.

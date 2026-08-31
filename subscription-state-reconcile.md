# Subscription state: read it from Stripe when our own row can't settle it

_Item 2 of the audit. Found 19 Aug 2026, fixed and demonstrated on live data
24 Aug 2026._

**The published promise was "cancel at any time from within the app"
(`legal.ts:218`). For anyone who hit one particular path, that was structurally
impossible — no row on our side, so no Cancel button, and `cancel_subscription`
would 404 even if there had been one, while Stripe billed £4.99 every month.**

---

## ⚠️ CORRECTION, 31 Aug 2026 — the conclusion below was wrong

**Three subscriptions were genuinely live in Stripe and had been billing for a
month.** They were found by hand on 31 Aug, cancelled immediately, and the
payments refunded. Nothing further will charge.

So "nobody was affected", "nobody out of pocket" and "no refund or apology is
owed" — all written below on 24 Aug — were false. Real charges were taken against
real cards for about a month while our own table showed those accounts lapsed.

**`reconcile_audit` did surface this. I misread it.** The three are the
`disagreeing: 3` bucket. I read the headline `billedButNoRow: 0` as "nobody is
being charged invisibly" and let it carry the whole conclusion, then described
`disagreeing` as "matched but out of step" without ever establishing *which
direction* they were out of step in. One direction is us giving access away; the
other is Stripe taking money against a row we think is dead. I checked whether
the buckets overlapped and never asked what the disagreement meant.

**The lesson is not "build a reconciler".** The reconciler existed, ran, and
printed the number. The failure was reading the bucket that confirmed the
comfortable story and summarising the one that didn't. A count is not a finding
until you know which way it points — and the bucket I skimmed was the only one
that involved money leaving somebody's account.

It also existed for weeks before the tool did: the disagreement predates
`reconcile_audit`, so the window where nobody could have noticed is longer than
the month of billing.

**Open question for the record:** whether all three were the test accounts, or
whether any belonged to someone other than the test accounts. That decides
whether anything is owed beyond the refunds already made.

---

## Nobody was affected — WRONG, see the correction above

`reconcile_audit` reported **`billedButNoRow: 0`**. The swallowed-confirm path has
never actually fired since Stripe went live on 17 July. Nobody has been charged
without a record, and no refund or apology is owed.

> **False.** Three accounts were being billed. `billedButNoRow` counts people
> with NO row at all; it cannot see someone who has a row that merely disagrees
> with Stripe. Answering "is anyone being charged?" with that one number was the
> mistake — it is the right answer to a narrower question.

That number could not be obtained from our own database. Anyone in that state is
absent from every table we hold, so a query starting from our side returns them
as "not there" — indistinguishable from "does not exist". **The only way to count
them was to ask Stripe.** Same reasoning as the 19 orphaned bookings.

What the audit did find was the inverse of the fear:

| | |
|---|---|
| `billedButNoRow` | **0** — nobody charged invisibly |
| `rowButNotBillingInStripe` | **9** — we grant access, nobody is paying |
| `lapsedButStillGranting` | **8** — period ended, still granting, live that day |
| `unverifiableNoCustomerId` | **1** — a row with no Stripe customer at all |
| `disagreeing` | **3** — matched but out of step. **These three were being charged.** Direction never established at the time |

`rowButNotBillingInStripe` (9) and `disagreeing` (3) are disjoint and together
account for all 12 rows, so **not one row agreed with Stripe**. The other two are
cross-cutting flags over the same 12, not separate buckets.

~~All test accounts. Nobody out of pocket; we were giving access away.~~

**Both halves of that were wrong.** Nine rows were us giving access away; three
were Stripe taking money. Writing one summary sentence over five buckets lost the
distinction that mattered, and it happened to lose it in the reassuring
direction.

---

## The near-miss: right reasoning, false premise

The obvious fix for "8 rows granting access on lapsed subscriptions" is to make
the gate honour `current_period_end` for `active`, exactly as it already did for
`cancelling`. That reasoning is sound and **it would have cut off every paying
subscriber at their first renewal.**

There is no webhook. `current_period_end` is written by `confirm_subscription`
and by nothing else — meaning at initial subscribe, once. Stripe renews monthly;
our row never moves. Someone who subscribes in January still shows a February end
date in April, while paying every month. A bare date check reads that as lapsed.

So the naive fix would have converted over-granting into **over-revoking, aimed
precisely at the people who are paying** — the worse of the two failures, and one
that would have looked like correct behaviour.

**What caught it:** tracing what actually writes `current_period_end`, rather
than trusting `mobile/notes.md:52`, which states the design is *"date-driven"* and
that no webhook is *"fine for now"*. That claim is half-true: the date check
exists, but only on the `cancelling` branch. The mitigation the record relies on
was written down and never fully implemented — the same shape as everything else
this audit found, one layer deeper.

The lesson generalises past this bug: **a stale-looking record is not evidence of
anything.** It is a prompt to go and ask the system that knows.

---

## The fix

**`sync_subscription`** — the authoritative answer, in the edge function that
already holds the Stripe client.

* **Fast path**: a row that is unambiguously current — active or cancelling, end
  date in the future, customer id present — returns immediately with no Stripe
  call. The common case costs nothing.
* Otherwise resolve the customer (by stored id, else by `metadata.user_id`), read
  the real state, **repair both tables**, and return the truth.
* Reports `repairWriteFailed` rather than swallowing it — the exact defect
  `confirm_subscription` has, returning 200 with `{ success: false }` that no
  caller reads.

**Both gates** (`mobile/src/lib/verification.ts`, `site/lib/verification.ts`) use
it, and **fail toward granting** when Stripe is unreachable. Wrongly denying a
paying subscriber is worse than briefly granting a lapsed one, and an outage on
our side must never look like non-payment on theirs.

**`cancel_subscription`** no longer 404s on a missing local row. It asks Stripe,
repairs, then cancels. That 404 was what made the published promise untrue at the
one moment it mattered.

**`subscribe.tsx`** no longer claims success it has not established. What is known
at that point is narrow and worth being precise about: `presentPaymentSheet()`
returning without error means **Stripe confirmed the payment, so the card was
charged**. The only unknown is whether we recorded it — so instead of a message,
it calls `sync_subscription` and branches on the answer:

| Outcome | What the user is told |
|---|---|
| Repaired, active | Normal success screen |
| Stripe has no billable subscription | "Payment taken, membership not set up" — do not pay again, email support, we will activate or refund |
| Stripe unreachable | "Payment taken, still confirming" — a problem at our end, not with your payment; check Settings shortly |

None of those tells someone they are a member when we cannot show that they are.

---

## Demonstrated on live data

Deployed, then `reconcile_audit` re-run after a single account's gate was
exercised:

```
unverifiableNoCustomerId  1 -> 0        the malformed row, repaired
rowButNotBillingInStripe  9 -> 8
lapsedButStillGranting    8 -> 8        unchanged, correctly - that account
                                        was not one of the eight
billedButNoRow            0
```

One account visited, one row repaired, and the counts moved exactly as the
mechanism predicts. The remaining 8 repair themselves as each account is next
read.

---

## Still open

**The webhook — item 4.** Read-time reconcile only learns the truth when someone
opens the app. Failed payments, disputes and dashboard-side cancellations happen
when nobody is looking. It is also what stops every renewal costing a Stripe
round-trip, since after a renewal our row is stale by definition until someone
visits.

The date check is what makes its absence *bounded* rather than unbounded: access
now expires within a billing period unless Stripe confirms otherwise. That is why
the webhook can sit at item 4 rather than first — but it is not optional.

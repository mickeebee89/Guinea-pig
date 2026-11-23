# Putting a charge back

**This file now covers TWO switched-off charges**, because they were turned off
the same way and have to be turned back on the same way:

| charge | flag | off since | section here |
|---|---|---|---|
| stylist verification fee, £14.99 one-off | `provider_fee_enabled` | 23 Oct 2026 (`0102`) | everything below, to §6 |
| model membership, £4.99/mo | `subscription_enabled` | 18 Nov 2026 (`0109`) | §7, at the end |

The second was added on 23 November 2026, when Terms §9 was cut back for the
model membership exactly as it had been cut back for the fee. Keeping both
records in one file is deliberate: the next person to ask "what did we used to
charge, and what did we publish about it?" should find one answer, not two.

---

## Putting the stylist verification fee back

The one-off stylist verification fee was **switched off, not removed**, by
migration `0102_cavy_is_free_for_stylists_and_the_code_says_so_too` on
23 October 2026. Every piece of machinery is still in place. This file is the
whole of what has to move to turn it back on, so that doing so is a decision
rather than an excavation.

> ## ⚠️⚠️ READ THIS FIRST: REINSTATING IS A FIRST RUN, NOT A RESUMPTION
>
> **`verification_payments` has never held a single row.** Measured 23 Oct
> 2026: 0 payments, ever. The fee was configured, published, priced and wired
> to Stripe, and **no stylist has ever been charged by it**.
>
> So the payment path has never run end to end against a real card. Turning the
> flag on does not resume something that used to work — it starts something
> that has never been proven. Treat it as a new feature with old code, and walk
> a real stylist account through it on a test card before telling anyone it
> exists.

---

## 1. The switch

One row. Everything else in this file is copy and documents.

```sql
update public.settings set value = 'true', updated_at = now()
where key = 'provider_fee_enabled';
```

`public.provider_fee_enabled()` reads that row and is the **single source of
truth**. `public.provider_fee_settled(uuid)` short-circuits on it with a `CASE`
before looking at payments, founding status or waivers.

⚠️ **A missing row reads as OFF.** `provider_fee_enabled()` coalesces a missing
row to `false`, because the safe reading of "the flag is gone" is "do not
charge". If the row has been deleted, insert it rather than assuming an update
did anything:

```sql
insert into public.settings (key, value) values ('provider_fee_enabled', 'true')
on conflict (key) do update set value = 'true', updated_at = now();
```

**Check it took, as the stylist and not as postgres** — `postgres` has
`bypassrls`, so asserting as postgres proves nothing about what a member sees:

```sql
select public.provider_fee_enabled();                 -- expect true
select public.provider_fee_settled('<a stylist uuid>'); -- expect false if unpaid
```

## 2. What is already in place and needs nothing

| piece | state |
|---|---|
| `verification_payments` table and RLS | untouched |
| `stripe-payment` edge function, both actions | untouched |
| `stripe-webhook` edge function | untouched |
| `settings.verification_price_pence` (1499) | untouched — the price is still where it was |
| `settings.founding_provider_limit` / `_cap` / `_offer_enabled` | untouched |
| `users.provider_fee_waived`, `users.is_founding_provider` | untouched and still settable |
| `founding_providers` table | untouched, still written |
| `handle_new_auth_user` founding grant at signup | untouched — **founding status has been recorded silently all along** |
| `site/app/(app)/verify/FeePanel.tsx` | still in the repo, just not rendered |
| `site/components/PayForm.tsx` | untouched; serves the model subscription today |
| admin console Fee column, "Free fee" button, Founding controls | see §5 |

## 3. Code to restore

### `site/app/(app)/verify/page.tsx` — the gate that leaves the flow

Re-add the import and the block, which sat immediately before the
"NO PHOTO TO COMPARE AGAINST" comment:

```tsx
import { FeePanel } from './FeePanel'
```

```tsx
  if (!setup.feeSettled) {
    return (
      <Wrap>
        <h2 className="font-display text-xl text-warm-dark">The one-off fee comes first</h2>
        <p className="mt-1 text-sm text-muted">
          There's a £14.99 one-off charge before the ID check, and it's settled once, ever.
        </p>
        <div className="mt-5">
          <FeePanel />
        </div>
        <p className="mt-4 text-xs text-muted">
          Payments are handled by Stripe. Your card details are entered on Stripe's own form and
          never reach Cavy's servers.
        </p>
      </Wrap>
    )
  }
```

⚠️ **Do not re-hardcode £14.99 without checking `verification_price_pence`.**
A price written into copy and a price charged by Stripe are two numbers that
can disagree, and the stylist believes the copy.

### `site/app/(app)/dashboard/page.tsx` — the Founding Provider badge

Sat directly after the stats `<dl>` in the stylist shop panel:

```tsx
                {data.isFoundingProvider && (
                  <p className="mt-3 inline-flex rounded-[999px] bg-soft-pink px-3 py-1 text-xs font-bold text-rose">
                    Founding Provider
                  </p>
                )}
```

`data.isFoundingProvider` is still populated by `queries/dashboard.ts`, so this
is pure JSX — nothing upstream needs changing.

### `site/lib/queries/shop.ts` — `publishRefusal`

The branch is **still there and still correct**; only the wording lost its
price. It currently reads:

> `'The one-off stylist fee needs settling first. You can do it on the ID check page.'`

Restore a price only from `verification_price_pence`, not from memory.

### Nothing to restore in `verify/actions.ts`

The server-side gate is **still in place** — `if (!feeSettled)` — and becomes
live again the moment the flag flips. It needs no edit, which is deliberate:
the half that protects the database should not depend on anyone remembering a
checklist.

## 4. Copy and published documents

### `site/app/(public)/for-stylists/page.tsx`

The CTA now reads *"Cavy is open, and it's free for stylists… There's no
sign-up fee, no verification fee and no subscription."* It previously read:

> If you've been given an invite link, sign up through it: that makes you a
> Founding Provider, so you won't pay the £14.99 verification fee. Places are
> limited to the first 200.

⚠️ This paragraph links to `/terms#5` and must stay consistent with it.

### `site/content/legal.ts` — three published changes, all reversible in place

**Section 5.** Heading changed `Founding Provider accounts` → `Stylist
accounts`. ⚠️ **The number 5 must not move** — `/for-stylists` links to
`/terms#5`. The previous body, verbatim:

> A limited number of stylist accounts are Founding Provider accounts, which
> means you won't pay the £14.99 verification fee. You get one by creating your
> account through an invite or referral link we or a partner have shared — the
> link carries a code that marks where you came from, and typing the address in
> by hand instead won't do it. There are 200 Founding places in total; if they
> have all been taken by the time you sign up, your account will be a standard
> stylist account. You'll still need to complete the identity check before you
> can offer treatments (section 7).

**The payment section.** The stylist half of the first sentence was removed.
Previously:

> Some features of Cavy require payment — a monthly membership subscription for
> models, and a one-off identity-verification fee for stylists. Current prices
> are shown on the website and in the app before you pay, and payments are
> handled by our payment provider (we don't store your full card details).

**The non-refundable clause.** Deleted entirely. Verbatim, to restore as its own
`{ type: 'p' }` block in the payment section:

> Stylist verification fee. The verification fee is a one-off charge for
> processing your identity verification. Because this is a service that begins
> as soon as you pay, by paying you ask us to start it straight away; once
> verification has been carried out, the fee is non-refundable except where the
> law requires otherwise.

⚠️ **Terms are published and dated.** Reinstating a charge is a change in what
members are asked to pay, so it needs the same notice treatment any other
pricing change would — not a silent edit. Section 5 now says *"If we ever
introduce a charge for stylists, we will tell you before it applies to your
account"*, and that sentence is a commitment.

### Comments that describe the fee as live

Each carries its own ⚠️ note pointing here; all are comments, none affect
behaviour: `site/components/PayForm.tsx` (two), `site/app/(app)/subscribe/page.tsx`,
`site/app/(auth)/sign-up/page.tsx`, `site/app/(app)/verify/actions.ts`.

## 5. The admin console — deliberately NOT changed

`admin/app/users/page.tsx` still shows the **Fee** column (`Waived` /
`Founding` / unpaid) and the **"Free fee"** button, and `admin/app/settings/page.tsx`
still shows **Provider Verification Price**, **Founding Provider Slot Limit**
and the **Founding Provider Offer** toggle.

⚠️ These are the manual levers. They are the only way to waive a fee for an
individual, and the only place the price can be changed. Hiding them would mean
the reinstatement path runs through a UI that has to be un-hidden first.

**What they do while the fee is off:** "Free fee" still writes
`provider_fee_waived`, which is still recorded and still honoured — it simply
decides nothing, because `provider_fee_settled` short-circuits before reaching
it. The Fee column reports real state that currently gates nothing.

**Open question, not decided:** whether these should carry an "inactive while
the fee is off" note so the console does not read as if the dials are live.
See the discussion in the commit that added this file.

## 6. Reversal checklist

- [ ] Decide whether reinstating needs advance notice to existing stylists (section 5 says it does)
- [ ] `update public.settings … provider_fee_enabled = 'true'`
- [ ] `select public.provider_fee_enabled()` → true
- [ ] `select public.provider_fee_settled('<unpaid stylist>')` → false
- [ ] Restore the `/verify` fee block and the `FeePanel` import
- [ ] Restore the Founding Provider badge on the dashboard
- [ ] Restore the price in `publishRefusal`, read from `verification_price_pence`
- [ ] Restore the `/for-stylists` CTA wording
- [ ] Restore Terms section 5 body, the payment sentence, the non-refundable clause
- [ ] Update the comments that now say the fee is off
- [ ] ⚠️ **Walk a real stylist account through `/verify` with a Stripe test card — this path has never run**
- [ ] Confirm `verification_payments` gains a row and the webhook writes it


---

# 7. Putting the model membership subscription back

The £4.99/mo model membership was **switched off, not removed**, by migration
`0109_subscription_enabled_global_flag` on **18 November 2026**. The same
shape as the fee: a flag, a function that reads it, and published copy that
had to stop describing a charge nobody is asked for.

> ## ⚠️⚠️ READ THIS FIRST: TWO TEST SUBSCRIPTIONS, NO REAL CUSTOMER
>
> Measured 23 Nov 2026, the day Terms §9 was cut:
>
> * `public.subscriptions` holds **2 rows, both `expired`** — created
>   20 Jun 2026 and 14 Sep 2026, belonging to `micky.buckfield@hotmail.co.uk`
>   and `micky.buckfield+model2@gmail.com`. Both are Micky's own accounts.
> * **All 104 `public.users` rows read `subscription_status = 'none'`.**
>
> So, unlike the fee (which had never run at all), the subscription path HAS
> run end to end — twice, on test accounts. No third party has ever been
> billed, and nobody was mid-term when §9 was cut, which is why cutting it
> withdrew nothing from under a paying member.
>
> That is still not the same as "proven in production". Walk a real card
> through it before telling anyone the membership is back.

## 7.1 The switch

```sql
update public.settings set value = 'true', updated_at = now()
where key = 'subscription_enabled';
```

`public.subscription_enabled()` reads that row. ⚠️ **A missing row reads as
OFF (free)** — same polarity and same reasoning as `provider_fee_enabled()`:
the safe reading of "the flag is gone" is "do not charge". If the row has been
deleted, insert it:

```sql
insert into public.settings (key, value) values ('subscription_enabled', 'true')
on conflict (key) do update set value = 'true', updated_at = now();
```

Check it as a member, not as `postgres` (which has `bypassrls`):

```sql
select public.subscription_enabled();                  -- expect true
select public.model_may_apply('<an unsubscribed model uuid>'); -- expect false
```

⚠️ **Never write `users.subscription_status` or `subscriptions.status`
directly** — call `apply_subscription_state(...)`, which writes both in one
transaction so they cannot disagree (migrations `0023`–`0025`).

## 7.2 Terms §9 — the exact deleted wording

Both blocks were deleted on 23 Nov 2026 and replaced with a single sentence
saying Cavy is not charging anyone at the moment. ⚠️ **The section NUMBER must
not move**: `/how-it-works` links to `/terms#9` and names "section 9" in its
own copy.

**Block 1**, the opening sentence of the section. Verbatim:

> Some features of Cavy require payment — a monthly membership subscription for
> models. Current prices are shown on the website and in the app before you
> pay, and payments are handled by our payment provider (we don't store your
> full card details).

**Block 2**, its own `{ type: 'p' }` block. Verbatim:

> Model membership subscription. The membership renews automatically each month
> at the price shown until you cancel. You can cancel at any time in Settings
> on the website, or in the app, to stop future renewals; when you cancel, your
> membership continues until the end of the month you've already paid for, and
> you won't be charged again. We don't provide partial refunds for the
> remainder of a month once it has started, except where the law requires
> otherwise.

**The heading** changed from `Payments, subscriptions and refunds` to
`Payments and refunds`. Put the word back when the subscription comes back.

**What was NOT deleted:** the "Your cancellation rights" block. It is a
statutory-rights clause, it is what `/how-it-works` sends readers to §9 for,
and it reads correctly whether or not anything is currently for sale.

⚠️ **Terms are published and dated.** §15 says significant changes update the
date and, where appropriate, are notified. Reinstating a charge is a change in
what members are asked to pay, so it needs that treatment — not a silent edit.
The 23 Nov 2026 cut moved the date from 30 October to 23 November for exactly
this reason.

## 7.3 Copy that would have to change back

* `site/app/(public)/how-it-works/page.tsx` — "Cavy isn't charging anyone at
  the moment — no sign-up fee, no verification fee and no subscription, for
  models or for stylists." Written when the flag went off; it names BOTH
  charges, so reinstating either one makes it false.
* `site/content/legal.ts` §5 — "There is no sign-up fee, no verification fee
  and no subscription" is about stylists and is unaffected by the model
  membership. Read it before assuming.

## 7.4 What is already in place and needs nothing

| piece | state |
|---|---|
| `subscriptions` table, `users.subscription_status`, the CHECK constraint | untouched |
| `apply_subscription_state(...)` | untouched — still the only correct writer |
| `stripe-payment` / `stripe-webhook` edge functions | untouched |
| `settings.subscription_price_pence` | untouched — the price is still where it was |
| `site/components/PayForm.tsx`, `/subscribe`, `settings/MembershipSection.tsx` | untouched |
| `model_may_apply`, `tg_session_apply_gate` | untouched — both read the flag already |

## 7.5 Reversal checklist

- [ ] Decide whether reinstating needs advance notice (§15 says a significant change does)
- [ ] `update public.settings … subscription_enabled = 'true'`
- [ ] `select public.subscription_enabled()` → true
- [ ] `select public.model_may_apply('<unsubscribed model>')` → false
- [ ] Restore Terms §9 blocks 1 and 2 and the heading, verbatim from §7.2
- [ ] Move the Terms `updated:` date
- [ ] Fix the `/how-it-works` "isn't charging anyone" paragraph
- [ ] ⚠️ Walk a real model account through `/subscribe` on a Stripe test card
- [ ] Confirm `subscriptions` gains a row and `users.subscription_status` agrees with it

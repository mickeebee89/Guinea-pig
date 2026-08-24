# Audit — records vs code vs reality

_Conducted 19 Aug 2026. Updated 24 Aug 2026 with what has since closed._

_Supersedes the scratch plan at `~/.claude/plans/audit-before-we-go-vivid-thunder.md`,
which is NOT version controlled. Everything that mattered has been copied here._

## Context

Work moved across several sessions and days and the written record drifted from
what is true. This reconciles three sources: the handover and plan files, the
code and database as they are, and everything logged as open / next / TODO /
deferred. It also re-runs the "published claim with no mechanism behind it" check
across the whole product.

**Headline:** the record was wrong in more places than the work was incomplete,
and the claims pass found **six more promises that don't hold** — one involving
live money, one a child-safety commitment.

---

## Status at 24 Aug

| | |
|---|---|
| ✅ Closed | Retention verification (item 1) — and it uncovered far worse, see below |
| ✅ Closed | The dangerous record lines (item 1b) |
| ✅ Closed | Selfie retention: structurally impossible, fixed, proven |
| ✅ Decided | What is retained after a purge |
| 📋 Scoped | Revocation of verification (item 8) — not built |
| ⬜ Open | Items 2–7 |

---

## A. Retention — CLOSED, and it was far worse than "unverified"

The three SQL blocks were run. Both cron jobs are active, `net._http_response`
shows `200`s, and the function genuinely executes.

**But the 90-day selfie retention promise had never been kept and could not have
been.** `purge-selfies` nulls `verification_requests.selfie_url`, and that column
was `NOT NULL` — so its central operation was forbidden by the schema. Four
separate signals reported success while it had never once completed.

Fixed by `0020` and **proven end to end on 24 Aug**: object deleted, reference
cleared, audit row written. Full account in `selfie-retention-never-worked.md`.

*A correction to the brief that prompted this: 1 September had not passed. The
retention tile reads red because no monthly run has happened yet, which is
correct behaviour.*

**Still open from this thread:** the job writes nothing when there is nothing to
purge, so a future breakage would again be invisible. An audit row on every run
turns "no rows" from ambiguous into diagnostic.

---

## B. A paying subscriber can be billed with no way to cancel

**Unfair-practice exposure, not a latent bug. OPEN — this is item 2.**

`legal.ts:218` promises "cancel at any time from within the app".

`mobile/src/app/(app)/subscribe.tsx:105` swallows a failed `confirm_subscription`
with the comment *"webhook will sync DB — proceed"*. **There is no webhook** —
the repo says so in three places. On that path Stripe bills £4.99/month for ever
while our `subscriptions` row is never written, so Settings shows "Free Plan",
the Cancel row (`settings.tsx:689`, gated on `isPaid`) never renders, and
`cancel_subscription` would 404 anyway because it looks up that missing row.

Compounding it: `hasActiveSubscription` never re-checks `current_period_end`, so
a decline or an externally-cancelled subscription keeps granting access
indefinitely.

**Stripe is LIVE** (17 Jul, verified with a real transaction).

So a real subscriber can be charged £4.99 every month, with **no record on our
side that we ever took the money** and no route to stop it, against a published
promise of "cancel at any time". In the UK that is an unfair commercial practice
exposure rather than merely a defect: the promise is in the Terms the user
accepted, and the inability to act on it is structural.

**Two-part fix, order matters:**

* **Now — read-time reconcile.** When reading subscription state, ask Stripe if
  the local row is missing or stale, and render Cancel on what Stripe says rather
  than on what we recorded. Closes the trap for anyone already in it, with no new
  infrastructure.
* **Proper fix — the webhook**, as its own piece (item 6). `subscribe.tsx:106`
  already claims one exists. Until it does, every renewal, decline, chargeback and
  dashboard-side cancellation is invisible to us — and it is what makes "renews
  automatically each month" and the Settings billing date honest.

---

## C. "Report anyone in one tap" — only if you already have a booking

**OPEN — this is item 3.**

`legal.ts:701`, `:683` (child safety) and Terms §12 `:260` all promise it. Every
`reports` and `blocks` insert in both clients sits inside a chat thread and needs
a `session_id`; a chat only opens once a booking is confirmed. Stylist and model
profile screens have no report or block action at all.

So a model harassed by someone she hasn't booked has **no in-app route**. It also
isn't one tap — the modal requires free text, because `reports.reason` is NOT NULL.

| Commitment | Where | Status |
|---|---|---|
| "You can report any concern in the app" | Terms §12, `legal.ts:260` | **Untrue** without a booking |
| "report any account or message in one tap inside the app" | Community Guidelines, child-safety section, `legal.ts:683` | **Untrue** — and this is the CSAE route |
| "block or report anyone in one tap" | Community Guidelines, `legal.ts:701` | **Untrue** |
| Play Console child-safety / CSAE declaration | Submitted; recorded done at `cavy-handover.md:128` | **Cannot verify from the repo** — the submitted wording isn't here. If it asserts an in-app reporting route for any user, it is inaccurate as filed |
| Apple Guideline 1.2 (block + report for UGC) | Store requirement | **Partly** — satisfied inside a booking, absent outside one |

Three published statements are untrue today. The fourth is a declaration to a
platform and needs checking against what was submitted, not against the repo.

---

## The seven items asked about

| Item | Verdict |
|---|---|
| Mobile member-area layout | **Not done.** `/shop` + `/browse` checked at 375px = 2 of 12 routes. The three the record names as riskiest — `/availability`, chat composer over keyboard, portfolio `<dialog>` on iOS — all unchecked |
| Build fails on lint | **Never scoped.** Agreed in conversation, written nowhere, implemented nowhere. Blocked on 98 errors: `admin` 22, `mobile` 76 (+6 tsc). `site` is clean and could be switched on today |
| Test-account teardown | **Partly done; record stale.** `teardown.mjs` only matches `@seed.guineapig.invalid` and refuses other suffixes, so the `@acoxs.com` / `@bevriz.com` rows are out of its reach by design |
| Admin approval at scale | **Never scoped.** One-at-a-time confirmed, no bulk path. The record names the problem; nobody turned it into work |
| Founding-provider manual grant | **Not done.** No per-user grant exists. Admin has a global cap and offer switch, not a grant. Mobile signup still sends no `signup_source`, so no app signup ever qualifies |
| Retention cron | **CLOSED 24 Aug.** Built, never run, then found structurally incapable of running, then fixed and proven. The admin tile existed all along (`admin/app/page.tsx:157`) while `0005:446` still said "STILL TO DO" |
| `support@` / Resend sender | **Not done.** Everything is `guineapigapp.co.uk`, including the CSAE contact. Sender move unstarted. The five templates have never been pasted into Supabase or tested against a real inbox |

---

## Six more claims that don't hold

Beyond the five already fixed.

1. **Cancel any time** — see B. **OPEN**
2. **Report/block in one tap** — see C. **OPEN**
3. **The mobile app still says "identity verification"** — `verify-payment.tsx:351`,
   `:418`, `:576`, and `site/components/StylistCard.tsx:27` renders
   `title="Identity verified"` on logged-out, indexable pages. Same defect fixed
   on web; it survived here. **OPEN**
4. **Patch tests survive deletion for ever** — `0007` retains them with name and
   email hash and is not in `run_retention_purge`'s table list. Its own header
   calls this "a real data-protection gap". `legal.ts:843` publishes that there
   are exactly three exceptions and "all of them are deleted after 6 years". This
   is Article 9 health data. **OPEN**
5. **Patch tests can't be recorded at all** — Privacy describes a data category no
   code writes. The only surface is a checkbox whose value is never persisted. **OPEN**
6. **Resubmitting a selfie strands the old one for ever** — both clients delete the
   prior `verification_requests` row after uploading the new object, and
   `purge-selfies` finds objects only via those rows. **OPEN**

Minor: `users.notification_preferences` is described in Privacy and written by
nothing; Privacy §8 frames disclosure as member-only while stylist profiles are on
the open web; "Premium coming soon" in Settings is false twice over.

**Holding well:** blocking enforcement (`0018`), the 6-year retention bounds, "no
IP or device recorded", "no analytics", the age gate, first-name-plus-initial,
human-only moderation decisions.

---

## Where the record was wrong

All of these were corrected on 24 Aug unless marked open.

| Record | Said | Actually |
|---|---|---|
| `CLAUDE.md:33, 62` | Stripe TEST mode | **LIVE since 17 Jul** — fixed |
| `CLAUDE.md:50` | Gold palette | Contradicted canonical `Colors.ts`; `roseDark` was a gold — fixed |
| `CLAUDE.md:7` | company no. `[NUMBER]` | `17272796` — fixed |
| `CLAUDE.md:33`, `README.md:26` | Cloudinary is the media provider | Called by no code — fixed |
| `site/README.md:61` | Vercel deploy "Not yet done" | Live since 7 Aug — fixed |
| `web-slice-3-progress.md` ×4, `verify/page.tsx:90` | Today's work stamped 14 Aug | Was 19 Aug — fixed |
| `mobile-treatments-orphan-bug.md`, `web-slice-3-progress.md` | Mobile "15 tsc errors" | It is **6**; `cavy-handover.md:17` already said so — fixed |
| `0005:446` | Admin tile "STILL TO DO" | Built — **open** |
| `web-phase-2-plan.md:3` | "SCOPING. Nothing built." | Slices 1–3 shipped — **open** |
| `mobile/notes.md:107` | "There are no migration files" | 0000–0020 exist — **open** |
| `web-slice-3-progress.md:20` | "0000–0011 applied" | 0000–0020 — **open** |
| `mobile-treatments-orphan-bug.md:178, 206` | 0012, 0013 "not applied yet" | Both applied — **open** |
| `legal.ts:777` | App-scope privacy "STILL OUTSTANDING" | Same file `:33` says closed — **open, and a live legal question** |
| `cavy-handover.md:72, 178` | Teardown blocker; P5/P6 not started | All done — **open** |
| `account-deletion-fix.sql:394` | "RETENTION JOB — still to build" | `0005` built it — **open** |

---

## Known blind spot: configuration

**Added 24 Aug 2026.** Every check this project has built covers code or data.
**Nothing covers configuration**, and configuration can silently override both.

Two instances found on the same day:

**1. A secret can override a value the code states plainly.**
`stripe-payment/index.ts:135` says `unit_amount: 499`. But `:127` reads
`STRIPE_MONTHLY_PRICE_ID` and returns it if set, so the live price is whatever
that secret points at. Someone reading the code concludes £4.99 and cannot
discover otherwise from the repository. Confirmed £4.99 on 24 Aug — by looking in
Stripe, which is the only place that could answer.

**2. A secret duplicated between two systems has nothing keeping it in step.**
`PUSH_HOOK_SECRET` lives in the edge-function environment AND baked into the
bodies of `tg_message_push` / `tg_notify_push` (`push-setup.sql:38, :82`). Rotate
one and not the other and every push fails — silently, with both halves looking
correct and `supabase secrets list` showing a healthy digest.

Related: `stripe_secret_key` existed alongside `STRIPE_SECRET_KEY`, differing only
in case. `Deno.env.get` is case-sensitive, so the lowercase one had never been
read by anything — while looking, in a list, exactly like the live one. Unset on
24 Aug. Rotating the wrong one during an incident would have succeeded, updated
the digest, and changed nothing.

### What can actually be done about it

Reading the repo can never answer these. The mitigations are all "make the code
check reality rather than trust a stated value":

* **`send-push` now describes its rejections** — header present? length match?
  prefix match? — so a rotation mismatch is legible in the logs instead of being
  a bare 403. Leaks no values. *(Done 24 Aug.)*
* **`reconcile_audit` will report the resolved Stripe price**, turning "which
  price is actually live" from unanswerable into a routine output.
* **Consider making `resolveMonthlyPriceId` refuse a surprise** — retrieve the
  price and throw if `unit_amount` is not 499, so a wrong env var fails at the
  first subscription rather than quietly charging the wrong amount for months.
  Same principle as `0014`'s asserts.

The general rule this suggests: **where a value exists in two places, the code
should compare them or report the disagreement.** Remembering to keep them in
step is not a mechanism.

---

## Order

**1. ~~Verify retention~~** — done 24 Aug, and it found the structural failure.

**1b. ~~The dangerous record lines~~** — done 24 Aug. `CLAUDE.md` said Stripe was
in TEST mode while it has been LIVE since 17 July; that single stale line is how
someone ends up testing card flows against real money, and the next two items are
both live billing.

**2. Live-money fix — read-time reconcile.** Render Cancel on what Stripe says
rather than what we recorded, and stop treating a failed `confirm_subscription`
as success. Closes the trap for anyone already in it.

**3. Safety fix.** Report/block reachable without a booking, on profile screens in
both clients. Three published statements are untrue until this lands; separately,
check the Play Console child-safety declaration's submitted wording, which is not
in the repo.

**4. Copy fixes.** Mobile "identity verification" wording, `StylistCard` badge
title, Settings "Premium coming soon".

**5. Legal reconciliation.** Patch tests: either add to `run_retention_purge` (the
migration says one line) or correct the published claim. Same for the selfie
resubmit orphan. Plus the zero-purge audit row, so the purge stops being
unobservable when idle.

**6. The webhook**, as its own scoped piece — the proper fix behind item 2, and
what makes "renews automatically each month" and the Settings billing date true.

**7. Remaining record reconciliation.** The rest of the drift table above.

**8. Revocation of verification** — NEW, found 24 Aug. `is_verified` is set to
`true` in two places in the admin console and set to `false` **nowhere in the
product**. Verification is one-way: a mistaken approval, a fraud finding, an
account that later proves to be someone else, or a dispute all have no remedy
except an `UPDATE` by hand.

Not a flag. Three things shape it:

* **A reason and an audit row are mandatory.** This removes someone's ability to
  trade or to book. It meets the `moderation_actions` standard — who, when, why,
  immutable — or it is not fit to exist.
* **Live bookings must have a decided answer.** Revoking a stylist mid-week with
  accepted appointments is the real question. Precedent is mixed: blocking cancels
  the pair's live sessions (`chat/[sessionId].tsx:329`), but blocking is a
  two-party decision and revocation is a status change. **Decide before building.**
* **It must unpublish, explicitly.** `enforce_publish_requires_verified` only fires
  on an update that SETS `is_published` true. Confirmed by evidence: the manual
  resets during this audit left the test shop published while unverified — the
  same state as the six blank providers.

Falls out for free: clearing `is_verified` and deleting the request row leaves the
account in a state `/verify` already handles. Sits naturally next to item 3, both
being safety controls that don't do what their name implies.

**Then** the feature order settled separately: apply flow → payments on web →
model discovery. Items 2 and 3 are **not** that Stripe work — they are existing
live defects and they outrank new payment surfaces.

---

## Verification

- **2** — subscribe on a test account, force `confirm_subscription` to fail,
  confirm Cancel is still reachable and `cancel_subscription` succeeds.
- **3** — from a profile screen with no booking, block and report; confirm rows
  land and the reported user is filtered from discovery.
- **4** — grep for "identity verif" across `mobile/src` and `site` returning only
  the negative phrasing.
- **5** — `run_retention_purge(true)` dry run naming `patch_tests`; a resubmitted
  selfie leaving no unreferenced object.
- **6** — re-read each corrected line against the code it describes.
- **8** — revoke a test stylist: confirm reason recorded, audit row written, shop
  unpublished, and `/verify` offering the submit path again.

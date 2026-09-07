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
| ✅ Closed | Item 2 — subscription reconcile, proven on live data 24 Aug |
| ✅ Closed | Item 3 — report/block without a booking, proven on live data 25 Aug |
| ✅ Closed | Item 4 — copy that overstated the ID check, 25 Aug |
| ✅ Closed | Item 6 — Stripe webhook, live and proven on real traffic 31 Aug |
| ✅ Closed | 0023–0025 — atomic subscription writes, real schema read, price default removed |
| ✅ Closed | Item 5 — patch test copy removed, selfie orphan fixed, 31 Aug |
| 📋 Scoped | Revocation of verification (item 8) — not built |
| ✅ Closed | Item 7 — record reconciliation, 2 Sep |
| ✅ Closed | Items 9 + 10 — findability pass, 2 Sep |
| ✅ Closed | Item 11 — diagnosed 2 Sep; a check with a named cause, not a note |
| ✅ Closed | Item 8 — revocation MECHANISM, proven 2 Sep. UI is item 14 |
| ⬜ Open | Items 12, 13 and 14 |

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

**CLOSED 24 Aug 2026.** Fixed and demonstrated on live data — full account in
`subscription-state-reconcile.md`.

**⚠️ CORRECTED 31 Aug 2026 — a remedy WAS owed and has now been given.** Three
subscriptions were live in Stripe and billing for a month while our table showed
them lapsed; found by hand, cancelled and refunded on 31 Aug. They are the
`disagreeing: 3` bucket, which `reconcile_audit` printed on 24 Aug and I did not
chase the direction of. `billedButNoRow: 0` is true and answers a narrower
question than the one I used it for — it counts people with no row at all, not
people whose row disagrees with Stripe. Full account in
`subscription-state-reconcile.md`. The real damage was the inverse — 9 rows granting
access against nothing billable in Stripe, all test accounts.

**A near-miss worth keeping:** the obvious fix (honour `current_period_end` for
`active`) would have cut off every paying subscriber at their first renewal,
because with no webhook that column is written only at initial subscribe. Caught
by tracing what actually writes it rather than trusting `notes.md:52`, which
calls the design "date-driven" — true only of the `cancelling` branch.

The original finding follows.

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

**CLOSED 25 Aug 2026, proven on live data.** `0021` applied. Full account in
`report-and-block-without-a-booking.md`. Report and block now reach both profile
screens on both clients, plus a new web model-profile route; eight preset reasons
replace the free-text box; and the admin queue sorts child-safety subjects to the
top with a flag that persists after the report is resolved.

The original finding, with both corrections, follows.

**OPEN — this is item 3.**

`legal.ts:701`, `:683` (child safety) and Terms §12 `:260` all promise it. Every
`reports` and `blocks` insert in both clients sits inside a chat thread. Stylist
and model profile screens have no report or block action at all.

So a model harassed by someone she hasn't booked has **no in-app route**. It also
isn't one tap — the modal requires free text, because `reports.reason` is NOT NULL.

> **Corrected 24 Aug 2026, twice.**
>
> **1. The gate is "a session exists", not "a booking was accepted."** Report and
> block render for any session you are party to, including `pending`. The site
> says so in its own comment: *"being unable to message someone is not the same
> as being unable to report them."* Narrower than stated above, still untrue
> against the published claim.
>
> **2. A fourth gap that was never listed: the web has no model profile route
> at all.** `ChatThread.tsx:199` — *"a model's id here is an auth user id and
> there is no page for it yet."* So a stylist on the web cannot report a model
> from anywhere, on the side of the marketplace being actively recruited.
> Deferring it would relocate the gap rather than close it.
>
> **What is NOT the blocker:** `reports.session_id` is already nullable (`0004`
> re-added the FK as `ON DELETE SET NULL`), `gp_reports_insert` already permits
> any authenticated reporter with no session or relationship check, and
> `admin/app/reports/page.tsx` already null-guards `session_id` in all three
> places. No migration and no policy change is required — this is client work.
>
> **The constraint that IS real:** `trg_report_subjects` fills the NOT NULL
> `reported_email_hash` by looking up `public.users` from `reported_id`. A
> profile report must pass a **user id, never a `providers.id`** — otherwise it
> fails on a NOT NULL hash rather than on anything legible.

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

**4. ~~Copy fixes~~** — done 25 Aug. The one that mattered was
`StylistCard`'s `title="Identity verified"`, live on logged-out indexable pages:
it told a model that a stranger's identity had been checked against a document
when no document is requested, seen or kept. A model weighs that when deciding
whether to be alone with someone, which makes it a safety claim rather than
marketing copy — the rule set on the web ID-check wording, still being broken in
public. Also `/for-stylists` ("Every member completes identity verification"),
four strings in mobile `verify-payment.tsx`, the apply-gate line in
`subscribe.tsx`, and Settings' "Premium features coming soon! You'll be notified"
— which promised a tier that does not exist via a notification nothing sends.

Original scope: Mobile "identity verification" wording, `StylistCard` badge
title, Settings "Premium coming soon".

**5. Legal reconciliation — PART DONE 31 Aug.** The published sentence is no
longer false. `/delete-account` said the retained records "are the only
exception, and all of them are deleted after 6 years"; patch test results are a
fourth exception and are retained indefinitely, because `patch_tests` is
deliberately absent from `run_retention_purge` (`0007`: six years would
over-retain Article 9 health data, three might under-retain it, and a migration
comment is not where that gets decided). Privacy and the deletion page now both
say indefinite, and say plainly that the period has not been set and is being
advised on. Worse copy, true copy — the alternative was leaving it false until a
solicitor answers. Also corrected a stale warning in `legal.ts`'s own header
claiming deletion is blocked by `patch_tests`; `0007` fixed that and the
preflight entry went with it.

**~~Two halves remain.~~ Both closed 31 Aug.** (a) **The patch test copy is out.** Sections 6 and 7 described
patch test results in the present tense while nothing writes `patch_tests` — the
table is empty, the only surface is a checkbox whose value is never persisted.
Rather than decide the feature's future today, the copy was removed: a policy
describing a category of health data we do not hold is false regardless of what
we intend later. **It comes back with the mechanism, not ahead of it** — which is
the pattern this whole month has been spent unwinding.

The retention sentence corrected a week earlier went with it. Saying "patch test
results are kept indefinitely" was true of the table and false of reality; there
is nothing in it to keep.

**What that leaves, stated rather than closed.** `0007` still retains patch test
data indefinitely, and its reasoning still holds — six years would over-retain
Article 9 health data, three might under-retain it, and that is not a choice to
make from a migration comment. With the copy gone this is an **unused table with
an unresolved retention position, not a live gap**: no data, no way to create
any, and no published claim about it. It becomes a decision owed *before* the
feature ships. If patch tests are ever built, the retention period must be
settled and `run_retention_purge` updated **before the first row is written.**

(b) **The selfie-resubmit orphan is fixed.** Both clients now delete the prior
storage object before deleting the row, and `purge-selfies` gained a sweep for
unreferenced objects older than the cutoff — because the client fix depends on
every writer remembering, and it is the only thing that can reach the orphans
already in the bucket.

Original scope: Patch tests: either add to `run_retention_purge` (the
migration says one line) or correct the published claim. Same for the selfie
resubmit orphan. Plus the zero-purge audit row, so the purge stops being
unobservable when idle.

**6. ~~The webhook~~** — done 25 Aug, live and proven on real traffic 31 Aug:
Stripe reports 4 delivered and 0 failed, our panel independently reports the same
four and the same last event. Two facts recorded in `stripe-webhook.md` for
whoever debugs it next: Stripe's Shell is read-only in live mode so `stripe
trigger` can never reach a live endpoint, and the events that proved this were
real cancellations rather than a test anyone arranged — lucky rather than
designed.

Original note: built 25 Aug, NOT yet live. Full account in
`stripe-webhook.md`. Failed payment gives grace to period end and tells the user;
`customer.subscription.deleted` is what actually ends access. Every delivery is
recorded and the Revenue page opens with a "last event received" panel, because
an unregistered endpoint and a registered quiet one are otherwise identical.
Found and fixed on the way: `sync_subscription` wrote `active` for a Stripe
`past_due`, so read-time sync would have silently overwritten the webhook and
restarted the grace period on every app open.

Remaining: register the endpoint, set `STRIPE_WEBHOOK_SECRET`, send a test event.
Nothing is proven until then.

Original scope: the webhook, as its own scoped piece — the proper fix behind item 2, and
what makes "renews automatically each month" and the Settings billing date true.

**7. ~~Remaining record reconciliation~~** — done 2 Sep 2026.

## ⭐ THE FINDING: A CORRECT RECORD FAILED IDENTICALLY TO AN INCORRECT ONE

**This audit was scoped for records that are WRONG. The more expensive problem
turned out to be records that are RIGHT AND UNREAD.**

Both live in `mobile/notes.md`, three lines apart:

| Line | Claim | Status | What it cost |
|---|---|---|---|
| :51 | `subscription_status` is `none/trialling/active/cancelled/cancelling`; **`'none'` NOT `'free'`** | **Correct since July** | Two migrations, three failed webhook events, a split-state repair |
| :52 | "No Stripe webhook handler exists" | **Wrong since 25 Aug** | Reinforced a false mental model of how subscription state settles |

One was right and never reached the decision. One was wrong and was trusted
immediately. **The outcomes were the same**, because a record only has value at
the moment someone reads it, and neither of these was read at that moment.

That reframes what a drift table is for. Keeping every line true is necessary and
is not sufficient: a repository of true statements nobody can find when it counts
performs exactly like a repository of false ones. The fix is not more accurate
notes — it is putting the fact where the decision happens, which is why the
subscription vocabulary is now in `CLAUDE.md` (read at the start of every session)
rather than only in `mobile/notes.md` (read when someone thinks to).

---

Every row of the drift table was re-derived against the current code rather than
trusted; the table was itself a fortnight old, which is the joke this item exists
to stop being funny.

**The detail behind the finding.** `mobile/notes.md` has documented, since July,
that `users.subscription_status` is constrained to
`none | trialling | active | cancelled | cancelling` and that the value is
**`'none'` and NOT `'free'`** — naming the exact bug, and noting it had already
broken one cancel attempt silently.

On 31 Aug that question cost migration `0023` (which probed the live constraint to
discover it), `0024` (which corrected `0023`), three failed
`customer.subscription.deleted` events and a split-state repair. Both migration
headers state the answer "was not in this repo". **It was.** The search covered
`supabase/migrations/` and the schema snapshot and never went near
`mobile/notes.md`.

**A record that is correct and unread fails exactly like one that is wrong: it
does not reach the decision.** And it sat three lines above "No Stripe webhook
handler exists" — a claim that was wrong and was trusted. Same file, same screen,
opposite failures.

The migration headers are left as written. They are applied artefacts and their
checksums are the ledger; editing them to look wiser after the fact is precisely
what the checksum exists to prevent. The correction lives here and in
`mobile/notes.md`.

**What was actually still wrong, and is now fixed:**

| Record | Said | Actually |
|---|---|---|
| `mobile/notes.md` ×2 | "No Stripe webhook exists", "fine for now" | Live since 25 Aug, proven 31 Aug. "Fine for now" was not: three subs billed for a month unseen |
| `mobile/notes.md` | "There are no migration files" | 0000–0025, checksummed, all applied |
| `web-phase-2-plan.md:3` | "SCOPING. Nothing built." | Slices 1–3 shipped |
| `web-slice-3-progress.md:20` | "0000–0019 applied" | 0000–0025 — wrong for the second time |
| `web-slice-3-progress.md` | "`migration-status.mjs` has NOT been run" | Run 2 Sep: 25 applied, no drift |
| `mobile-treatments-orphan-bug.md` ×2 | `0012`/`0013` "not applied yet" | Applied 10 and 19 Aug |
| `0005:446` | Admin tile "STILL TO DO" | Built; below the footer, so no checksum drift |
| `legal.ts:804` | App-scope privacy "STILL OUTSTANDING" | Closed 8 Aug — contradicted by the same file in two other places |
| `cavy-handover.md:178` | P5/P6 "remain OPEN / not started" | Same file marks both DONE seventeen lines above |
| `cavy-handover.md:72` | "run `teardown.mjs` before going live" | True but not sufficient: it matches `@seed.guineapig.invalid` only, so the hand-made test accounts are out of its reach by design |

**Already fixed earlier and confirmed still correct:** `CLAUDE.md` (Stripe LIVE,
company number, palette, Cloudinary), `site/README.md` (Vercel live 7 Aug).

**Added to `CLAUDE.md`:** the subscription status vocabulary and the rule that
`apply_subscription_state` is the only supported write path — not because it was
undocumented, but because it was documented somewhere nobody looked.

**9. Link model names to `/model/[id]`** — NEW, 25 Aug. The only link to the new
model profile anywhere on the site is in `ChatThread`; the stylist dashboard
renders applicant names as plain text while stylist names elsewhere are links. So
a stylist reaches a model's profile only for a model they already share a session
with. Nearly moot today — every model a stylist sees arrives via an application,
which is a session — and not moot at all once stylist-side model discovery ships,
which is exactly when the no-session stylist-to-model case begins to exist. An
item rather than a note, because notes do not get done.

**10. The Safety control's findability, on both clients** — NEW, 25 Aug. Micky
could not find it on a stylist profile the day it was built; it was `text-muted`
grey, quieter than the "Verified" badge beside it, and wrapped below the name at
narrow widths. Restyled where it was noticed. That is the wrong shape of fix for
this control: discoverability IS the feature, and the surfaces nobody happened to
open have had no such test. Wanted: a deliberate pass over every surface offering
report/block on both clients — mobile chat, mobile model and provider profiles,
web chat, web stylist and model profiles — checked at 375px as well as desktop.

**11. ~~Pre-launch: the six treatment pages must not be empty~~** — diagnosed
2 Sep 2026, and the cause changes the action.

## The SEO pages are not empty for want of stylists

`/hair-models` and the other five render zero cards. **That is not an inventory
problem.** `public_stylists` (`supabase/public-web-views.sql:74`) has a content
bar, and it is in the VIEW rather than the client, so nothing on the site can
work around it:

```sql
where p.is_published is true
  and coalesce(btrim(p.name), '') <> ''
  and length(btrim(coalesce(p.bio, ''))) >= 40     -- <- this one
  and cardinality(cats.categories) >= 1
  and not exists (... seed accounts ...)
```

There are two published stylists. **Micky B's bio is 13 characters.** So the
pages are empty because the bar excludes the stylists we have, not because there
are none.

**Those two states need different actions and must not be confused:**

| Reading | Action |
|---|---|
| "Empty because no stylists" | Recruit. Weeks of work, nothing to do today |
| **"Empty because the bar excludes the stylists we have"** | **One real stylist writing a longer bio populates the SEO engine.** Minutes of work |

The bar is right and should stay. Its comment says why: a new domain publishing
dozens of near-empty profiles is the thin/doorway pattern that earns a site-wide
manual action from Google. A shopfront reaches the open web once it is actually a
shopfront. The 40 characters are a deliberate quality gate, not an accident — and
`0016` already established that the same number must NOT be used as a publish
requirement, because unpublishing a working stylist over a short bio is a
different and worse decision.

## The check, before launch

Run this rather than looking at the pages — it says WHICH bar each stylist fails,
which is the difference between a five-minute fix and a recruitment problem:

```sql
select p.name,
       p.is_published,
       length(btrim(coalesce(p.bio, '')))                as bio_len,
       (select count(*) from public.provider_treatments t
         where t.provider_id = p.id)                     as treatments,
       case
         when p.is_published is not true                          then 'not published'
         when coalesce(btrim(p.name), '') = ''                    then 'no name'
         when length(btrim(coalesce(p.bio, ''))) < 40             then 'bio under 40 chars'
         when not exists (select 1 from public.provider_treatments t
                           where t.provider_id = p.id)            then 'no treatments'
         else 'LISTED'
       end                                               as blocker
from public.providers p
order by blocker, p.name;
```

**Passes when:** at least one row per treatment category reads `LISTED`, and each
of the six pages renders at least one card.

**Also unverified on live data:** the `is_verified` tick's tooltip now reads
"Photo checked — a person compared their selfie to their profile photo. Not an ID
document check." **It has never been seen rendering**, because no card has ever
displayed. Confirm the wording on a real page before launch — it is on
logged-out, indexable pages and it is a safety claim.

**Original note:** — NEW, 25 Aug.
`/hair-models` and the other five render zero stylist cards today. That is
expected and not a bug — `public_stylists` needs a published stylist with a
40-character bio and there are two published stylists in total — but these pages
are the whole SEO plan, and "the SEO pages are empty" is exactly the thing that
looks fine right up until launch day. An explicit check with a named owner, not
a note: before launch, each of the six must render at least one real stylist, and
the verified tick's new "Photo checked" tooltip must be seen rendering — it has
never been observed on live data because no card has ever displayed it.

**9 + 10. ~~Findability~~** — done 2 Sep 2026, as one pass. Full rule in
`docs/safety-surface.md`.

**These were the inverse of every other finding this month.** Everything else was
a claim with no mechanism behind it. This was a mechanism with no route to it —
and on a safety surface, unreachable and absent are the same thing to the person
who needs it.

Report and block existed on three surfaces per client. The web had **one** route
to a model's profile: inside a chat thread, which is the one place the controls
already worked. So item 3 had added a control to a page almost nobody could
reach.

Four changes, in order:

1. **`/sessions` and `/dashboard` link model names.** `sessions.ts` returned
   `otherPartyId: isModel ? provider_id : null`.
2. **The conversation-list avatar is now a link.** The row links to the thread and
   anchors cannot nest — which is *why* it never linked — so the avatar became a
   sibling link inside a shared flex row. This matters more than it sounds: the
   conversation list is where someone goes when a person is bothering them, and
   until now the only route to report them ran through opening the conversation
   they were trying to get away from.
3. **Mobile shows a labelled pill**, not three dots.
4. **The word is written down** so the next surface inherits it.

### The null was neither a stub nor a privacy decision

Constraint 1 asked. The answer is in commit `2e39ca1` (9 Aug 2026):

> "Only stylists link through: the other-party id for a model is an auth user id
> and there is no page for it."

**Correct when written.** There was no `/model/[id]` then. It stopped being true
on 24 Aug when that route shipped, and nothing connected the two, so for nine days
a stylist saw every model's name as dead text with a profile one route away. The
same stale reason sat in `dashboard.ts` as `providerId: null, // no profile route
yet`.

**The reason was recorded in the right place for a reviewer and the wrong place
for a maintainer.** A commit message is read once, at review. The ternary is read
every time. Both reasons now live beside the code, which is the same correction
item 7 reached from the other direction — there, a true fact in
`mobile/notes.md` never reached the decision either.

### Why `accessibilityLabel` was not enough

All three mobile surfaces already had `accessibilityLabel="Safety options"` on a
bare `ellipsis` — roseDark on one profile, **white over a banner photograph** on
another, `ellipsis-vertical` in chat.

**A screen-reader user could find the control. Nobody else could.** An
accessibility label is announced to assistive technology and rendered to no one:
it made the control reachable for a minority, invisible to everyone else, and
read in code review as though labelling had been handled. It is kept — the
visible label is an addition, not a replacement.

### Two of my own errors, kept as findings

**I reported that mobile's stylist profile had no safety control. It had one.** I
grepped for `SafetyMenu`, the *web* component; mobile's is `SafetySheet`. **I
proved the absence of a string and reported the absence of a feature** — the same
error as everything else this month, aimed at a search instead of a check. The
check was one file-read away.

**I reported a broken link on `/sessions`.** There wasn't one: `otherPartyId` is
null for stylists, so it rendered a span. Unreachable, not broken — and worse in
one way, because a 404 would at least have been visible.

**12. Stylist banners cannot be set — NEW, 2 Sep 2026.** `providers.banner_url`
is READ in four places — `mobile/provider/[id].tsx`, `site/lib/queries/stylist.ts`,
`site/lib/supabase-public.ts` — and **written nowhere**. There is no upload in
mobile `edit-shop`, none in the web shop editor, none in admin, and no bucket for
it: the four are `profile-pics`, `model-photos`, `portfolio-photos`,
`verification-selfies`.

So no stylist can have a banner, and the Cavy placeholder is the only thing that
can ever render. Same family as the rest of this audit — a field two clients
render with nothing behind it — except this one is a missing feature rather than
a false claim, since nothing published promises a banner.

**A consequence worth naming: the banner scrim added on 2 Sep has never
executed.** It renders only when `banner_url` is set, so it is an untested branch
by construction — the same shape as the orphan sweep before it was forced to run
against a moved cutoff. It becomes testable when banners become possible, and not
before. Testing contrast against a photograph today would be testing a state the
product cannot reach.

**8. ~~Revocation of verification~~ — MECHANISM done 2 Sep 2026, surface is
item 14.** `0026` (enum label) + `0027` (mechanism) + `0028` (wording). Proven on
live data inside a rolled-back transaction: `moderation_actions` took the first
row it has ever held — `revoke_verification`, a reason, `Micky B.`, and a
non-null `target_email_hash`, the NOT NULL and `trg_moderation_subject` working
together on the first write.

**Closed as "the mechanism exists and is correct", not as "an admin can revoke
someone".** There is no revoke button. Until item 14 ships, revocation is
reachable only by an admin running SQL — better than the hand-typed `UPDATE` it
replaces, and not the same as shipped.

Block B is the one that mattered most: `is_published` went false after a HAND
EDIT clearing `is_verified`, not just through the RPC. That is the invariant
`enforce_publish_requires_verified` has always sounded like it enforced and never
could, being on `providers` while `is_verified` lives on `users`.

**A finding that changed what this item meant:** nothing had ever written
`moderation_actions`. Every reference in the repo is schema, triggers, retention,
RLS, deletion handling or documentation; the admin console writes `notifications`,
`suspensions` and `admin_audit_log` instead. So the table is append-only by
trigger, indexed, carries a ban-evasion hash, survives account deletion by
design, is purged at six years, and is **named in the published deletion policy**
— and until 2 Sep it had never held a row the product created. Revocation is its
first writer.

---

**13. Cancellation notifications — NEW, 2 Sep 2026. The careful wording went to
the rare case and the common one is bare.**

The revocation notice was drafted, reviewed and revised. Then the rows beneath it
in the same query read:

> **Booking cancelled** — Your upcoming treatment has been cancelled.

No actor, no reason, no route, no apology. And that is the one models will
actually receive, because revocation will be rare.

**What the sweep actually found is sharper than "the wording is thin".**
`session_cancelled` has exactly **two** writers in the whole product, and both
are the block cascade (`mobile/src/lib/report.ts:200`, `site/lib/report.ts:181`).
There is no stylist-cancels-a-booking path at all — a stylist can *decline* a
pending application, and nothing anywhere sets an accepted booking to
`cancelled`.

But `enforce_session_status_transition` **permits** it: either participant may
move a session to `cancelled`. So cancellation is a legal transition with no
interface and no notification design — and "I need to cancel" is inevitable
before launch. Whoever builds that button will inherit the block cascade's bare
line unless the wording is designed first.

Three things need words, and they are different events:

| Event | Today | Needed |
|---|---|---|
| Block cascade cancels a booking | "Your upcoming treatment has been cancelled." | Must NOT mention blocking — that is deliberate and must survive any rewrite |
| A stylist cancels an accepted booking | **Nothing. The path does not exist** | Wording designed with the button, not after |
| A model cancels | **Nothing. The path does not exist** | Does the stylist get told? Currently nobody would be |

The block-cascade constraint is the trap: its silence about *why* is correct, so
"add a reason" is exactly the wrong instruction to give this one. The three cases
need three answers, not one template.

---

**14. Admin revoke UI — NEW, 2 Sep 2026.** `0027` ships the mechanism; nothing
calls it. Needs a control on the admin verification/provider view that takes a
reason (≥10 characters, enforced server-side already), shows what will happen
before it happens — how many bookings will be cancelled, and that it cannot be
undone by re-approving alone — and reports the count afterwards.

Until it exists, the reason-length validation and the admin gate are only
exercised by SQL, which is not how an admin will hit them.

**Original scope:** — NEW, found 24 Aug. `is_verified` is set to
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

---
---

# CLOSING SUMMARY — 2 September 2026

**Items 1–11 are closed. Items 12, 13 and 14 are open and every one of them was
found BY the audit rather than listed at its start.** That is the honest measure
of it: the list it ended with is not the list it began with.

## What the audit was scoped to find, and what it actually found

It was scoped for **records that were wrong** — a drift table of stale statements.
Two other categories turned out to be larger.

**Claims with no mechanism behind them.** Eleven, by the end: Founding Provider,
the IP clause, "we publish your shop for you", the ID-check wording, the 90-day
selfie promise, "cancel at any time", "report anyone in one tap", "we look at
these first", patch-test retention, the £2.99 price default, and a banner four
render sites read that nothing can write. Each was a sentence or a column that
described something the product did not do.

**Mechanisms with no route to them — the inverse, and it only showed up late.**
Report and block existed on three surfaces per client while the web had exactly
one route to a model's profile. `moderation_actions` had triggers, indexes, a
ban-evasion hash, a retention policy and a published promise, and no writer.
Cancellation is a permitted transition with no interface. On a safety surface,
unreachable and absent are the same thing to the person who needs it.

## The pattern under all of it

**A success signal that does not depend on the thing it claims to prove.**

* `cron.job_run_details` recorded dispatch and was read as completion, for weeks
* a `dryRun` flag that defaulted to destructive when its JSON failed to parse
* `sync_subscription` returning `repaired: true` for a write that could not
  succeed, because it never checked the error
* `billedButNoRow: 0` answering a narrower question than the one it was used for,
  while three people were being billed
* a `NOT NULL` constraint asserting a state the product contradicted, so the
  selfie purge could never complete
* an `accessibilityLabel` that made a control findable for screen-reader users
  and invisible to everyone else, while reading in review as though labelling was
  handled
* five verify blocks that could not run, or ran and proved something else — the
  last one defeated by the comment documenting the fix it was testing

The rules that came out of it live in `scripts/migration-status.mjs` (three, for
verify blocks), `docs/safety-surface.md` (one word, one shape, reachability) and
`CLAUDE.md` (the schema and vocabulary facts that were true in the repo and never
read).

## The one that was not a mistake at all

`mobile/notes.md` documented the `subscription_status` vocabulary correctly, in
July, including the specific warning that the value is `'none'` and not `'free'`.
Rediscovering it cost two migrations, three failed webhook events and a
split-state repair.

**A correct record that nobody reads fails exactly like an incorrect one.** It
sat three lines above a claim that was wrong and was trusted. That is why facts
moved to `CLAUDE.md` and to the code, rather than being written more carefully
where they already were.

## Two shapes worth naming, found at the very end

**A check that was correct for the cases present when it was written.** Not a bug
— it never fails. It quietly stops covering. Three instances here:

| Mechanism | Correct for | Silently excluded |
|---|---|---|
| `check-client-boundary.mjs` | Direct imports | Anything reached transitively |
| The notification-type allowlist | `admin_warning`, `admin_message` | Every type added after, including all three cancellation messages |
| `otherPartyId: isModel ? provider_id : null` | A world with no model profile route | The model profile route, from the day it shipped |

All three read as diligence. None of them raised anything. The tell is a list of
cases written by hand, and the question to ask it is: **what joins this list
later, and who adds it?**

**A content defect on one client is usually on the other for a different
reason.** The cancellation wording was unreadable on mobile — the row clamps the
body to two lines and nothing opened it — and unreadable on the web, where the
blank lines between paragraphs collapsed and four paragraphs became one block.
Same content, two unrelated causes, and only mobile was reported.

So: **when a content defect appears on one client, check the other before
concluding it is platform-specific.** The instinct is that a rendering bug
belongs to the platform that showed it. Here it belonged to the content, and the
platforms each failed it differently.

---

## What is open

| | Item | Blocking launch? |
|---|---|---|
| 12 | Stylist banners cannot be set — read in four places, written nowhere | No |
| 13 | Cancellation wording, and no cancel path exists at all | **Yes** — "I need to cancel" is inevitable |
| 14 | Admin revoke UI — `0027` ships the mechanism, nothing calls it | No, but revocation is SQL-only until then |

Carried in from before the audit, unchanged by it:

| Item | State |
|---|---|
| **IAP — Apple's #1 rejection risk** | **UNRESOLVED.** Stripe for a digital unlock consumed in-app. Decide before iOS submit; consider asking App Review directly |
| **Test-account teardown** | `teardown.mjs` reaches `@seed.guineapig.invalid` only, BY DESIGN. The hand-made accounts must be cleared separately |
| **Play Console CSAE declaration** | Recorded done; **the submitted wording has never been checked against what the product does** |
| `support@` / Resend sender | Not started; five templates never tested against a real inbox |
| Build-fails-on-lint | site **0 errors** and could be switched on today; admin 22; mobile 73 + 6 tsc |
| Mobile member-area layout | 2 of 12 routes checked at 375px |
| Admin approval at scale | One at a time; no bulk path |
| Founding-provider manual grant | No per-user grant exists; mobile signup sends no `signup_source` |

## Dated

* **8 October** — the diarised selfie-orphan check. The only unarranged end-to-end
  proof the purge job will ever get.
* **Before launch** — item 11's query must show at least one `LISTED` stylist per
  category, and the verified tick's "Photo checked" tooltip must be SEEN, since no
  card has ever rendered one.

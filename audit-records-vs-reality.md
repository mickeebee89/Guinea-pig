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
| ✅ Closed | Item 13 — cancellation, proven on device 4 Sep |
| ⬜ Open | Items 12, 14, 15, 16, 17, 18 and 19 |

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

**── CORRECTION, 8 Sep 2026: ITEM 27 WAS BROADER IN THE TELLING THAN IN THE
EVIDENCE ────────────────────────────────────────────────────────────────**

Recorded here as a correction rather than quietly edited into item 27, because
the wrong version was accepted and acted on.

**What was said:** that the audit trail was unreliable — stated as a property of
the admin console.

**What is true:** the false-entry defect existed on **one surface out of five**.
`app/users/page.tsx` logged unconditionally. `providers`, `reports` and
`verification` all check their write's error before logging, and
`providers/page.tsx:101` carries the comment *"Don't write an audit entry
claiming an action that didn't happen."* Someone had already found this and
fixed it in three places.

The 25 discarded-result sites were real and counted. The generalisation from
them was not.

**⚠️ THREE TIMES IN A WEEK, AND THE SHAPE IS THE SAME.** The other was item 19's
"admin 6", which was `moderation/page.tsx` measured while working in that file
and written up as the whole app; the real figure was 22 across ten files.

| | Measured | Reported as |
|---|---|---|
| Item 19 | One file's lint count | The app's lint count |
| Item 27 | One surface's logging defect | The console's audit trail |
| The admin lint rewrite | That it fixed a real race | That it satisfied the RULE by removing the synchronous setState |

**⚠️ MAKE THAT THREE, 8 Sep 2026.** `react-hooks/set-state-in-effect` flags any
call to a function it can see contains setState, wherever that setState sits —
proven by `mobile/src/app/(app)/verify-payment.tsx`, which has none synchronously
and is flagged anyway. And `admin/lib/useLoader.ts` passes the rule **even when
it calls `run` directly**, because `run` is a parameter and the analyser cannot
see into it.

**So the rule went quiet because the loader became opaque, not because the defect
was removed.** The race was real. The cancellation fix was real. The claim about
*why the rule stopped firing* was never checked.

**The rule was a prompt to look. The race was found by reading the sites it
pointed at.** Those are different things and only one of them was tested.

**This third instance is the hardest of the three to catch,** and Micky named
why: *"I approved admin's rewrite on a reason that wasn't the real one. The work
was right and the justification was wrong, which is harder to catch than a wrong
decision, because the outcome looks like vindication."*

A wrong decision announces itself. A right decision taken for a wrong reason does
not — and the reason is what gets reused on the next one.

Neither was a guess. Both were real measurements of something narrower than the
claim built on them, which is exactly what makes them convincing. **A finding is
only as wide as what was checked**, and the check has to be stated next to the
finding or the scope is lost in one retelling. See [[next-fact-not-next-theory]]
— same family, one step later: that one is about evidence that was never taken,
this one is about evidence that was taken and then over-read.

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

**15. NO TEXT IN THIS PRODUCT IS SCREENED BEFORE PUBLICATION — NEW, 7 Sep 2026.**

Found while scoping the status composer, and larger than that feature, so it is
its own item rather than folded into it.

**`banned_words` looks like moderation in the admin console and is not.** It is a
list an admin can edit, used by exactly one thing: a retrospective search in the
moderation tab that runs when somebody opens it, scans `.limit(500)` rows of
messages, reviews, bios and shop copy, and highlights matches. It screens
nothing, blocks nothing, and runs on nobody's schedule.

| Content | Before publication |
|---|---|
| Portfolio **images** | Real queue — `portfolio_items.moderation_status = 'pending'`, an admin approves |
| **Every kind of text** — bios, reviews, shop copy, messages | **Nothing.** Published instantly |

**The shape is the one this audit keeps finding:** a mechanism that reads as
coverage to the person looking at it. An admin who sees a banned-words list in
Settings reasonably concludes words are being screened. Same as
`accessibilityLabel` reading in code review as though labelling had been handled,
and the same as `enforce_publish_requires_verified` promising an invariant it
never enforced. In each case the thing exists, is named accurately for what it
does, and is read as doing more.

Not scoped here. The decision it needs is what to screen and when: a write-time
screen on messages is a different product question from one on a public bio, and
"screen everything" is how a filter gets switched off.

**16. Stylist status posts — the composer, and `status_posts` — NEW, 7 Sep 2026.**

`providers.status_text` and `status_expires_at` are read in four places — both
web dashboard feeds, the mobile shop page's pulsing status bar, and the
`public_stylists` view — and **written nowhere**. So "What's on near you" has been
empty since it shipped and always would have been. Third instance of a
render-site with no writer, after `banner_url` and `patch_tests`.

Building it as designed: `web-phase-1-handover.md:309-380` holds the full spec,
decided in August and deferred, not invented now.

### ⚠️ THE ONE STEP THAT CAN TAKE THE PUBLIC SITE DOWN

Written here BEFORE the work starts, because it is the only part of this that
breaks something already live.

`status_posts` supersedes `status_text`, and leaving both would recreate the
`location` / `location_text` split exactly. So `status_text` must be removed from
the `public_stylists` view — and **`create or replace view` cannot drop a
column.** It requires `drop view` + `create view`.

**A dropped view loses its grants.** `public_stylists` is granted to `anon`, and
anon is how every logged-out visitor and every search engine reads the public
site. Recreate the view without reissuing:

```sql
grant select on public.public_stylists to anon, authenticated;
```

…and the public pages return nothing to anyone not signed in.

**Corrected 7 Sep 2026: the blast radius is smaller than first written here.**
It said "every stylist page and the whole SEO surface". There is no public
stylist page — `/stylist/[id]` is behind auth and reads base tables, not this
view, and a public `/stylist/[slug]` is phase 2 and does not exist. The actual
readers are:

| Page | Reads via | ISR |
|---|---|---|
| `/` homepage | `FeaturedStylists`, `countByCategory` | `revalidate = 3600` |
| The six `/[treatment]` pages | `stylistsByCategory`, `countByCategory` | `revalidate = 900` |

Seven pages, one query path (`lib/stylists.ts`).

**It fails silently, and worse than "silently" suggests.** `lib/stylists.ts`
catches every failure — missing view, RLS refusal, network error — logs
`query failed, returning none` and returns `[]`. So the pages render 200 with
their empty state. **That is byte-for-byte what they render today** for an
unrelated reason (item 11's bio bar), so the broken state and the current
correct state are indistinguishable by looking.

**It is also not immediate.** These are statically generated with ISR, so a
cached page keeps serving correct content until its window lapses: up to 15
minutes for a treatment page, up to an hour for the homepage. A deploy
regenerates everything at build and makes it instant.

Full recovery procedure: `docs/public-view-recovery.md`.

Both statements go in the same migration, and the verify block reads
`information_schema.role_table_grants` for `anon` rather than trusting that the
grant line ran.

**17. `banned_words` HOLDS PLACEHOLDER TEST VALUES — NEW, 7 Sep 2026. A
DECISION, NOT A BUILD TASK.**

The live list is:

```json
["pretty", "hair", "make", "done"]
```

Four placeholders, and **"hair" flags almost every legitimate post a hair
stylist will ever write.** "Two spaces free Thursday for hair models" trips it.
So on today's data the `0032` auto-screen queues nearly everything and the
feature behaves as though review were manual-only — which is precisely the
outcome shipping the screen with the feature was meant to avoid.

**The mechanism is correct and the data makes it useless.** That is a distinct
failure from the ones this audit has been full of: nothing here is
mis-implemented, nothing claims something untrue, and no check is looking at the
wrong thing. It is a configuration value that was never meant to survive into
use, sitting in a table where nothing marks it as provisional.

**Needed before launch:** a real list, decided by Micky. Not a build task —
what counts as bannable in a hair-and-beauty marketplace is a judgement about
the product, and a wrong list is worse than a short one in both directions. Too
broad and every honest post queues; too narrow and the screen is decoration.

**⚠️ AND A TESTING TRAP THAT FOLLOWS FROM IT.** Anything the screen is tested
against today is being tested against a list built to match ordinary words. A
post that queues proves the trigger fires; it does NOT show the screen behaving
sensibly, because sensible behaviour cannot be observed against nonsense input.
Re-test after the real list lands — and treat any judgement about
false-positive rates made before then as untested.

**18. EVERY PUBLIC-SITE QUERY FAILURE LOOKS LIKE "NO DATA" — NEW, 7 Sep 2026.**

`site/lib/stylists.ts` wraps every read of `public_stylists`:

```
console.warn(`[${label}] query failed, returning none:`, error.message)
return []
```

A missing view, an RLS refusal, a revoked grant, a network blip and a genuinely
empty table all produce the identical outcome: **an empty array, a 200, and the
page's empty state.**

**This is not a `0034` problem — it is why `0034` would be invisible.** It is
also why any future outage on those seven pages is invisible. The two facts
compound: the catch makes every failure look like emptiness, and item 11 means
emptiness is currently the correct answer. There is no state of that page a
person could look at and learn anything from.

**The catch itself is defensible and was written deliberately** — its own
comment says a failure should not take a page down pre-launch, and that is
right. The gap is that it degrades identically for causes that are not
identical, and nothing distinguishes them afterwards. A `console.warn` in a
Vercel function log is not a signal anybody receives.

Worth fixing as: keep degrading, but make the two cases distinguishable — a
counter, a header, an admin tile, anything that answers "is this page empty
because there is nothing, or because something is broken". Not scoped here; the
answer is a product decision about where a signal should land.

**19. MOBILE HAS NO LINT GATE, AND MOBILE IS THE PRIMARY CLIENT — NEW,
7 Sep 2026.**

`site` fails the build at zero eslint errors and zero warnings.

**⚠️ THE ADMIN FIGURE IN THE ORIGINAL VERSION OF THIS ITEM WAS WRONG.** It said
**admin 6**. Six was `app/moderation/page.tsx` — one file, measured while
working on that file, and written up as the whole app. The real figure was
**22 errors and 5 warnings across ten files**, found on 7 Sep when the sweep
actually ran.

That is the same mistake as grepping for `SafetyMenu`, finding nothing, and
reporting that mobile had no safety control — **a measurement of a part reported
as a measurement of the whole.** The number was not a guess; it was a real
measurement of the wrong thing, which is what makes it convincing enough to
write down.

**✅ ADMIN CLOSED 7 Sep 2026 — 22 → 0, and the gate is on.**
`admin/package.json` now runs `eslint . --max-warnings=0 && tsc --noEmit` before
`next build`, matching `site`. What the sweep produced:

| Class | Count | Outcome |
|---|---|---|
| `react-hooks/static-components` | 6 | **A live silent data-loss bug.** Item 26 |
| `@typescript-eslint/no-explicit-any` | 6 | Row shapes named from the `select()` that produces them; surfaced a supabase-js / PostgREST disagreement about embed cardinality |
| `react-hooks/set-state-in-effect` | 9 | **Surfaced a real race.** See below |
| `react/no-unescaped-entities` | 1 | Style |
| `react-hooks/exhaustive-deps` | 5 warnings | Gone with the same rewrite |

**The nine were not cosmetic either, and that only became clear on inspection.**
Every one was `useEffect(() => { load() }, [filter])` with `setLoading(true)` as
the first line. The lint objects to the synchronous setState — which on its own
would not have been worth nine rewrites. But **none of the nine loaders cancelled
its previous request**, and five of them refetch on a filter change. Change the
reports filter twice quickly and the slower first response can land last: open
reports rendered under a "resolved" heading, on a moderation console. The screen
disagreeing with the data.

Fixed by `admin/lib/useLoader.ts`, written once rather than nine times: `loading`
is DERIVED ("the key I loaded is not the key I want"), so nothing sets it and the
effect body contains no setState at all; the loader is handed a `stale()` it must
call before writing; and a throw can no longer leave a page stuck on
"Loading…".

**Suppressing the rule was the alternative and was rejected.** Nine
`eslint-disable` lines would have kept the race, and "the artefact was a rule
rather than a check" is a failure this project has already named once.

**Mobile is what remains: 73 errors, 32 warnings, 6 tsc.** The count is the
reason the gate is not on, and the absent gate is the reason the count never
falls.

**The evidence that this is not theoretical.** In one session I wrote the same
defect three times — `Date.now()` called during render, where a re-render can
change the value under the reader mid-decision:

| Where | Caught by |
|---|---|
| Web cancel panel | `site` lint gate, before commit |
| Admin status queue | `admin` lint run, before commit |
| **Mobile `CancelSheet`** | **Chance.** I happened to run eslint by hand |

Two of three were caught by a mechanism. The third was caught because I looked.
On mobile there is nothing that would have stopped it.

**The reframing matters more than the habit.** "I keep making this mistake" is a
small statement. The real one is: **every class of thing lint catches is landing
in mobile unchecked** — impure calls during render, unescaped entities, unused
bindings, exhaustive-deps, and whatever the next rule catches. Mobile is
Android-first and the client most users will actually hold.

**✅ CLOSED 8 Sep 2026. ALL THREE APPS ARE GATED.**

| App | Gate | Runs on |
|---|---|---|
| `site` | `eslint . --max-warnings=0` + three custom checks | `next build` |
| `admin` | `eslint . --max-warnings=0 && tsc --noEmit` | `next build` |
| `mobile` | `eslint . --max-warnings=0 && tsc --noEmit` | `eas-build-post-install` |

Mobile went **73 errors, 32 warnings, 6 tsc → 0, 0, 0.** The route was the one
this item predicted: fix the count first, then wire the gate, because a gate
switched on over a failing codebase gets switched off again.

**Two are documented exceptions, not fixes** — `AppEntry`'s reset-on-sign-out
effect and Expo's own `use-color-scheme.web.ts`. Both carry an
`eslint-disable-next-line` **with the reasoning beside it**, and in the AppEntry
case an explicit note that the honest fix is a restructure and that it was NOT
hidden behind a ref, because a ref would leave the anti-pattern in place while
making it invisible. A clean report with a judgement inside it is worth more
than a clean report.

**What the gates actually produced on their first runs**, which is the argument
this item was making:

* `admin` — a live silent data-loss bug on the setting that gates publication
  (item 26). Nothing else would have found it.
* `mobile` — `<Stack style={...}>`, a prop React Navigation ignores, so a style
  had never applied to anything. **Found by tsc, not lint**, and it is a
  different argument: lint caught behaviour that would eventually have been
  noticed; tsc caught something that was never going to announce itself. It sat
  inside this item's own baseline number, counted rather than read.

**And the counter-example, kept deliberately:** the dead portfolio photo tap on
the stylist page — a haptic and nothing else — was found by a person tapping a
picture, in about a minute, and no static check would ever have found it. See
26/26b.

**20. A FILTERED FEED AND A BROKEN FEED LOOK IDENTICAL — NEW, 7 Sep 2026.**

Item 18 is the same defect on the public pages. This one is inside the signed-in
app, where the filters are deliberate and correct, which makes it harder rather
than easier.

`getStylistUpdates` drops a status post for any of three reasons, each of them
right:

| Filter | Why it exists |
|---|---|
| `blocked.has(p.user_id)` | You blocked them, or they blocked you |
| stylist absent from the `is_published = true` set | An unpublished shop is invisible; a status must not be a way round that |
| `distanceMiles > radiusMiles` | The distance pill the model chose |

All three produce the same screen: **"No stylists have posted an update right
now."** That sentence is a claim about the world. In every one of the three cases
it is false — someone did post, and we chose not to show it.

**The evidence.** On 7 Sep a post that was approved, unexpired, published and
within range did not appear. The cause was a `blocks` row left over from the
4 September cascade test, doing exactly what it was built to do. It took two
rounds of diagnosis, and the next step after that would have been to go looking
in RLS — for a feature that was working.

**The shape, which this project keeps meeting:** a success signal that does not
depend on the thing it claims to prove, and here its mirror — *a failure signal
that does not depend on there being a failure.* Empty is empty. The retention
tile, the cron rows and the SEO pages were all the same.

**✅ CLOSED 8 Sep 2026, ON BOTH CLIENTS.** The block case is named, and only the
block case — it is the only one the model can act on and the only one where
"nothing here" is actively misleading. The unpublished and distance cases stay
unexplained because the distance pill and the browse page already account for
them.

    web     getStylistUpdates returns hiddenByBlock: boolean
    mobile  the same, computed against the blocked provider ids

*"Nothing to show right now. You've blocked one or more stylists, so their
updates don't appear here."*

**A BOOLEAN, NOT A COUNT, AND THAT IS THE WHOLE DESIGN.** A count of one tells a
model who blocked exactly one stylist that that stylist posted today. That is
more than they need and more than this product should say, and it is the reason
the original note asked for wording that "needs no count and leaks nothing about
who".

**⚠️ AND A DETOUR WORTH RECORDING.** The mobile feed shipped a few hours earlier
with the section HIDDEN when empty — chosen on the grounds that a permanent empty
box at the top of a dashboard is noise. That is true and it was still wrong: it
made this item worse rather than neutral. A model who had blocked the stylists
posting nearby saw no section at all, which reads as *a feature that does not
exist* rather than *a feed that is filtered* — the same ambiguity one layer
further down.

Micky's second point on it is the one to keep: **the call was made unprompted.**
It was defensible, and it was exactly the kind of decision to put up rather than
absorb — in the same hour a much smaller question, about what a video thumbnail
should do, was brought to him. The wrong one was checked. Defensibility is what
makes an unprompted call hard to notice afterwards.

**21. MOBILE CAN READ STATUS POSTS AND CANNOT WRITE ONE — NEW, 7 Sep 2026.**

After the 0031–0034 repoints, the surfaces are:

| Surface | Reads | Writes |
|---|---|---|
| Web stylist dashboard — `StatusComposer` | yes | **yes — the only writer in the product** |
| Web model dashboard — "Stylist updates" | yes | — |
| Mobile stylist profile — `provider/[id].tsx` status bar | yes | — |
| Mobile, anywhere else | **no feed exists** | **no composer exists** |

So a stylist who only ever opens the app on their phone — which is the primary
client — cannot post an update at all, and will see other stylists' updates only
by opening a specific profile. There is no mobile equivalent of the feed, which
is why the 7 Sep rename and speech-bubble restyle landed on web only: there was
nothing on mobile to keep in step with.

This is the read-surface-with-no-writer pattern in its plainest form. Two pieces,
and they are separable: **(a)** a composer on `provider-dashboard.tsx`, which is
the one that unblocks mobile-only stylists and is the more valuable half; **(b)**
an updates feed on the mobile model home, which is a new surface rather than a
port.

**(a) CLOSED 7 Sep 2026.** `mobile/src/components/StatusComposer.tsx`, mounted on
`provider-dashboard.tsx` above Applications. Same shape as the web composer and
deliberately so: it enforces nothing — screening, link-stripping and the
moderation decision are all triggers from 0032 — and it reads back what the
database decided rather than reporting success. Writes go through `mustWrite`, so
an RLS refusal throws instead of resolving quietly. Haptics on post, clear and
failure. **Not yet run on a device.**

**(b) CLOSED 8 Sep 2026.** "Stylist updates" on the model home
(`src/app/(app)/index.tsx`), top of the page above upcoming treatments, capped at
five with a "Show all N" toggle. Before this a model could only see an update by
opening that stylist's profile — findable only by accident.

The join is against the visible provider set rather than `status_posts`, so an
unpublished or blocked stylist's post is dropped, matching the web feed exactly.
One update per stylist, newest wins — the reader-side half of the composer's
replace-not-stack rule. Rendered as messages: the avatar and name link to the
profile, the bubble does not. Hidden when empty, because at the top of a
dashboard a permanent empty box is noise and, unlike web, there is no distance
filter here whose absence needs explaining. Haptic on the toggle.

**ITEM 21 IS NOW CLOSED IN FULL.** status_posts has a writer and a reader on both
clients.

**22. THE NOTIFICATION DOT HAD NO WAY TO CLEAR — FOUND AND CLOSED 7 Sep 2026.**

Found while putting the bell in the web nav. `markAllNotificationsRead` had been
exported from `site/lib/queries/notifications.ts` since the page was written and
**called from nowhere** — so on web a notification was never marked read. The
list's unread marks were permanent, and a dot driven off that count would have
been lit for ever, which is a signal that stops meaning anything within a day.

Closed with a "Mark all read" button, matching what mobile already had. It is a
deliberate press rather than mark-on-view on purpose: Next prefetches routes on
hover and on viewport entry, and a prefetch runs the page's server component —
so marking read during render would clear notifications because a link scrolled
into view.

**The shape:** an exported function with no caller is the same class of thing as
a read surface with no writer (item 21) and a rule with no check. Nothing fails;
the feature is simply absent, and the code reads as though it is present.

**Extended 7 Sep 2026:** a per-row read control on both clients. "Mark all read"
alone was not enough on web, where only notifications carrying a `session_id`
are links — the rows with nowhere to go (a warning, a verification result, a
rejected status post) could not be marked read individually at all. On mobile
tapping a card marked it read AND navigated, so clearing an alert meant going
somewhere you had not asked to go.

**23. THE COMPOSER CALLED AN APPROVED POST LIVE — FOUND AND CLOSED
7 Sep 2026.**

**What broke, plainly:** a stylist whose shop was not published wrote an update,
and the composer told them it was live. It was not. No model could see it, and
nothing on the screen said so.

Both composers rendered *"Live now · disappears automatically after 48 hours"*
off `moderation_status === 'approved'`. **Approved is a moderation state.
Visible is something else.** Three things hide an approved post:

| Hides it | Expressed in |
|---|---|
| The shop is not published | `public_stylist_status` (0033) |
| It has expired | `public_stylist_status` (0033) |
| A block between the two people | Neither — it is per-viewer, not a property of the post |

The composer knew about none of them.

**The mechanism was right; only the confirmation was wrong.** Proven by
evidence, not argument: posting from an unpublished shop produced a post no
model could see — correct, and exactly what 0033's `is_published` clause is for
— and after verifying the same account in admin, a second post appeared in the
model feed. Same shape as items 18, 20 and 22, and worse than any of them,
because here the person is told the thing they wanted has happened.

**The fix reads the state; it does not recompute it.** `isLive` comes from a
lookup in `public_stylist_status` by primary key. A TypeScript copy of that rule
would have diverged the first time the view changed — and would have been wrong
on the day it was written, because the view carries a fourth clause nobody
writing a composer would think of: the seed-account `.invalid` guard. The check
fails closed: if the lookup errors, the post is not called live.

**And it says what is true rather than what is wrong.** An unpublished stylist
has done nothing incorrect, so there is no error state. They see *"Posted —
it'll go out once your shop is live"*, linking to the setup panel, which already
knows which step is missing. When the post is approved, not live, and the shop
IS published, the wording stops guessing: it says the post is saved and not
showing yet, because the reason is one the view models and this file does not.

**Block remains deliberately unmentioned to the author.** It is per-viewer, and
telling a stylist that some particular person cannot see them is not something
this product should do.

**24. THE 48-HOUR CLOCK RUNS WHILE A POST CANNOT BE SEEN — LOGGED
7 Sep 2026, NOT FIXED.**

**Confirmed from the schema.** `status_posts.expires_at` is
`default now() + interval '48 hours'` (0031:120), stamped at INSERT and never
touched afterwards. Nothing about publication state moves it. So a stylist who
posts while their shop is unpublished and is verified two days later has an
update that expired without ever having been visible to anyone — and the
composer, since item 23, correctly told them it was saved and waiting the whole
time.

**Shape of a fix.** Either stamp `expires_at` when a post first becomes visible
rather than when it is written — which needs a trigger on
`providers.is_published` and is not a small change — or leave it and say so in
the composer, which is a sentence. Neither is scoped here.

**24b. “A POST DOES NOT REPUBLISH WHEN THE SHOP GOES LIVE” — REPORTED
7 Sep, CLOSED SAME DAY. NOT A DEFECT.**

Kept as its own entry rather than folded into 24, because they are different
claims and only one of them is true.

**Reported:** an update written while the shop was unpublished stayed invisible
after the account was verified. **Contradicted by the code** —
`public_stylist_status` (0033) is a plain view, not a materialised one, so it is
evaluated at query time and a row becomes visible the instant `is_published`
flips, provided it is still approved and unexpired.

**Settled by one query**, run against provider `c42537d1` (Jojo B — not the id
first suggested, which was Micky B's, and the post in question was hers):

    9d430e20 · approved · unexpired true · is_published true · in_public_view TRUE

The post had republished. What was being looked at was a render that had not
been re-read.

**Why this entry exists at all.** It was logged as UNVERIFIED rather than as
fact, and that is the only reason a wrong entry is not now sitting in this file
permanently. Second time in one day: the same restraint on `0034` stopped
“nothing was written, the transaction aborted cleanly” becoming the record, when
the transaction had in fact committed in full. Both times the reporting error
was Micky's and the check that caught it was mine — which is the arrangement
working, not a fault on either side. See [[next-fact-not-next-theory]]: an
account of what happened is evidence about a person's screen, not about the
system, and durability raises the bar.

**26. ADMIN SETTINGS SILENTLY DISCARDED UNSAVED EDITS — FOUND AND FIXED
7 Sep 2026. FOUND ONLY BECAUSE LINT WAS TURNED ON.**

**What broke, plainly:** an admin pastes a banned-words list into Settings,
flips the Image Review toggle before saving, and the list is gone. No error, no
warning, nothing on screen. Just an empty box where the work was.

`Toggle`, `PriceField` and `BannedWords` were all declared **inside**
`SettingsPage`'s render body. A component created during render gets a new
function identity every render, so React does not re-render it — it unmounts
the old one and mounts a new one, and the new one's `useState` starts from its
initial value again.

`SettingsPage` re-renders whenever `settings`, `saving` or `foundingCount`
change. So every one of these threw away every unsaved edit in every other
field:

| Action | What it did |
|---|---|
| Flip either toggle | `setSettings` → all three fields remount, unsaved text lost |
| Press Save on any price field | `setSaving(key)` then `setSaving(null)` — twice over |
| The founding-provider count arriving after load | same |

**The stored value was never at risk.** The upsert closes over its own string,
so nothing in the database was ever wrong. It was the editing that was broken,
which is why it could sit there unnoticed.

**The list it loses matters.** Since 0032, `settings.banned_words` is not a
search-term list — it is a BEFORE INSERT trigger's input, and it gates
publication. Item 17 is the open work to give it real content, and this is the
control you would do that work in.

**Fixed** by moving all three to module scope and passing `settings` /
`saving` / a single `onSave` as props. No behaviour change beyond the bug.

**── WHY THIS IS ITEM 19'S ARGUMENT IN ONE EXAMPLE ─────────────────────**

Nothing else would have found this. It throws no error, logs nothing, writes no
wrong data, and produces no visible failure — only work quietly disappearing at
a moment when the person is looking at something else. It is not the kind of
thing a person finds by using the product, because the way you find it is by
losing something and not knowing you did.

It was found by `react-hooks/static-components`, on the first run of a lint gate
that had never been switched on for this app. **Item 19 says mobile is the
client with no net and no gate. This is what one turned-on gate produced on its
first run, in the smaller app.** Read the two together.

**26b. THE SAME SCREEN, FROM THE OTHER SIDE: A SAVE THAT SAID NOTHING — FOUND
AND FIXED 7 Sep 2026.**

Found by clicking through the console after the 26 fix. Item 26 was **silent
loss** — work disappeared and nothing said so. This is **silent success**: press
Save Banned Words and there is no spinner, no confirmation and no state change.
It works. You cannot tell. The only way to know is to reload the page and look.

Both leave the admin guessing, on the setting that gates publication.

**Three defects, and the third is the serious one.**

| | Before |
|---|---|
| Banned Words | No feedback of any kind — not even a disabled button |
| Price fields | A transient `…` on the button while `saving` was set, and nothing after. The sub-label reads from the typed value, so nothing visibly changed either way |
| **`saveSetting`** | **`await supabase.from('settings').upsert(...)` with the result discarded** |

The third means a **refused write reported success**. supabase-js does not
reject when the database refuses a write — it resolves with `{ error }` — so
nothing in this file could ever fail. `mobile/lib/db.ts` exists to prevent
exactly this and its lesson had not reached the admin console. Worse, the page
then called `updateLocal` regardless, so **a toggle showed a state the database
had refused**: the screen reporting the request rather than the outcome, which is
item 23 in a different room.

**Fixed:**

* `handleSave` returns `{ ok }` or `{ ok: false, error }`, and reflects into
  local state ONLY on success — so a refused toggle stays where it was and says
  why.
* One `useSave` hook gives every control the same four states: idle, saving,
  saved, failed. `saved` persists until the field is edited again rather than
  fading on a timer — a timer is a second thing that can be wrong, and "Saved"
  beside text you have since changed is a lie.
* Banned Words confirms with the **count**: *"Saved — 12 words now screened"*.
  "Saved" alone does not tell you the list was read the way you meant it, and
  this list is a trigger's input.

**Worth noting how it was found.** Not by lint — no rule fires on a button that
says nothing. It was found by a person using the console and noticing the
absence. That is the counterpart to item 26, which no person would have found
and a rule caught on its first run. Neither method would have found the other's
defect.

**✅ KEEP 26 AND 26b TOGETHER.** They are one screen, found two ways, and the
temptation is always to pick one:

| | Found by | Would the other method have found it? |
|---|---|---|
| **26** silent loss | `react-hooks/static-components`, first run of a new gate | **No.** It produces no error and no wrong data — you find it by losing something and not knowing |
| **26b** silent success | A person clicking Save and seeing nothing happen | **No.** No rule fires on a button that says nothing |

The argument is for both, not for whichever is cheaper.

**27. A REFUSED WRITE REPORTS SUCCESS — IN ALL THREE APPS. NEW, 8 Sep 2026.
25 SITES. NOT FIXED.**

supabase-js does not reject when the database refuses a write. It resolves with
`{ data: null, error }`. So this, which appears throughout the repo, cannot fail:

    await supabase.from('suspensions').insert({ ... })   // result discarded
    await logAction('ban', { ... })                      // recorded regardless

**This is not the two-places family.** There is exactly ONE solution and it was
written eleven months ago: `mobile/src/lib/db.ts`, whose header explains the
whole problem and gives `mustWrite` (throw on refusal) and `tryWrite` (log, never
throw — so "we don't care" is a decision in the code rather than an accident).

**It never travelled.** It exists in mobile only, is used in six mobile files,
and site and admin have no equivalent at all. The knowledge did travel —
`site/app/(app)/bookings/actions.ts:17` has a comment reading *"Mobile handles
this with mustWrite() and says exactly why"* — so someone read it, understood
it, and wrote a note instead of the helper. **Same problem, one solution, and it
didn't travel.**

**⚠️ THE WORST SITE IS THE MODERATION EVIDENCE TRAIL.**
`admin/app/users/page.tsx` `doAction()` runs warn, suspend, ban, reinstate,
verify, fraud-flag, waive and comp — **every one discarding its result** — and
then calls `logAction(action, ...)` unconditionally. So a suspension RLS refused
is written into `admin_audit_log` as having happened, and the list refreshes as
if it did.

`admin_audit_log` is retained for six years as moderation evidence (0005, 0006).
It can currently record a ban that never landed, and there is nothing in the row
to say so.

Compounding it: **`admin/lib/audit.ts` discards its own insert result**, so an
audit row that failed to write is also silent. The record of the action and the
action itself can each fail without a word.

**The 25 sites** (auth calls like `signOut` excluded — discarding those is fine):

| App | Sites | Notable |
|---|---|---|
| `admin` | 14 | `users/page.tsx` × 8 moderation actions; `lib/audit.ts`; `verification` × 2 notifications; `categories` × 2; `messages` × 1 |
| `mobile` | 9 | favourites × 4, portfolio deletes × 2, verify-payment delete, notification read, push token |
| `site` | 2 | `verify/actions.ts` delete, `availability.ts` notification fan-out |

Several are genuinely "don't care" — marking a notification read, saving a push
token. Those want `tryWrite`, not no check at all: the point is that the decision
is visible.

**Why this outranks the six swallowed READS found in mobile's lint sweep.** Those
six make a failed read look like empty data — bad, and item 18's shape. These 25
make a failed WRITE look like a completed one, on suspensions, bans, verification
and the audit log. **The six are a sample of a smaller problem; this is the set
of a larger one.**

**Shape of the fix:** lift `db.ts` to a place all three apps can use — there is
no workspace linkage, so that means three copies or a shared package, and that
choice is itself the decision. **Deliberately NOT decided yet:** three copies is
the two-places problem and a shared package is a build-system change, and
neither should be settled as a side effect of fixing one screen. Then convert
the remaining sites, choosing `mustWrite` or `tryWrite` at each one deliberately.

**✅ 2 of 25 CLOSED, 8 Sep 2026 — the moderation evidence trail.**
`admin/app/users/page.tsx` and `admin/lib/audit.ts`. Done with plain inline
checks and no new abstraction, precisely so the sharing question stays open.

**The fix was the ORDER, not error handling bolted around it.** The eight
branches of `doAction()` became one `perform()` that returns its write; the
result is checked; and only then is the audit row written. An action with no
matching branch now returns an error rather than falling through to a log entry
for something that never ran.

`logAction` returns `{ ok }` / `{ ok: false, error }`. The other 13 call sites
still ignore it — that is the remaining work, not something the function can
force.

**23 sites remain.**

**── A CATEGORY OF ITS OWN: KNOWLEDGE THAT TRAVELLED WITHOUT THE MECHANISM ──**

This is not the two-places family, where one rule ends up written twice and the
copies drift. Here there is **one** solution, it is **correct**, and it simply
did not move.

`site/app/(app)/bookings/actions.ts:17` carries a comment reading *"Mobile
handles this with mustWrite() and says exactly why"*. Somebody read `db.ts`,
understood it, judged it worth referencing — and wrote a note instead of the
helper. The understanding arrived; the enforcement did not.

That is the same failure as item 19's "the artefact was a rule rather than a
check", one level up: here the artefact was a *citation* of a check. Worth
watching for, because it looks like diligence.

**29. THE ACTION AND ITS AUDIT ROW ARE STILL NOT ATOMIC — NEW, 8 Sep 2026.
NOT FIXED. THE ANSWER IS DELIBERATE AND SHOULD BE CHALLENGED IF IT IS WRONG.**

Item 27's fix removed the false entry: no audit row is written unless the action
succeeded. It does not make the two writes one. If the suspension lands and the
audit insert then fails, there is a **gap** in the record — an action in force
with nothing saying who did it or why.

**What was chosen, and why.** The action stands and the admin is told, loudly,
to record it by hand. Rolling the action back was the alternative and is worse:
an unrecorded reversal on top of an unrecorded action is two gaps rather than
one, and the rollback can fail in exactly the same way. A gap that a person has
been told about is the least bad of the three states.

**What would actually fix it:** a `SECURITY DEFINER` function that writes the
suspension and the audit row in ONE transaction, so they cannot disagree — the
same argument this project already accepted for `apply_subscription_state`
(0023–0025), which exists so `users.subscription_status` and `subscriptions`
cannot drift apart. The precedent is set; this is the same shape.

**── SCOPE, 8 Sep 2026 ─────────────────────────────────────────**

**First, a correction to item 27's framing.** Surveying all fourteen `logAction`
call sites shows `app/providers`, `app/reports` and `app/verification` **already**
check their write's error before logging — `providers/page.tsx:101` even carries
the comment *"Don't write an audit entry claiming an action that didn't happen."*
So the **false-entry** defect was specific to `app/users/page.tsx`. The other
surfaces have the weaker problem: a **gap**, not a lie.

That narrows this item and is worth stating plainly, because item 27 implied the
false entry was everywhere and it was not.

**What remains is atomicity, and the surfaces divide into three groups.**

| Group | Surfaces | State today |
|---|---|---|
| **A — decision + evidence** | `users` (8 actions), `reports` (5), `providers` (4), `verification` (approve/reject), `moderation` (status-post approve/reject) | Error checked, order correct, **not atomic**: the action can land and the log fail |
| **B — write result discarded** | `categories` × 3, `settings`, `messages`, moderation image toggle + bulk-approve | Item 27's remaining work. Fix that first — atomicity on an unchecked write is meaningless |
| **C — already fine** | — | Nothing yet |

**Group A is this item. Group B is item 27.** Doing them in the other order
would wrap a transaction around a write nobody checks.

**⚠️ THE STRONGEST CASE IS `verification` APPROVE, AND IT IS WORSE THAN A PAIR.**
It is FIVE sequential writes: `users.is_verified`, `providers.is_published`,
`verification_requests.status`, a notification, then the audit row.

**→ THESE THREE SENTENCES MUST BE QUOTED IN THE MIGRATION HEADER, VERBATIM.**
They are already in the product, written by someone who understood the shape of
the problem exactly and mitigated it in copy because there was nowhere else to
put it:

    admin/app/verification/page.tsx:81
      "Couldn't verify this user: {err}\n\nNothing else was changed."

    admin/app/verification/page.tsx:87
      "The user was verified, but their shop could not be published: {err}
       \n\nThe request has been left pending — try again."

    admin/app/verification/page.tsx:97
      "This user is verified{ and published}, but the request could not be
       closed: {err}\n\nIt will still show as pending — approve it again to
       clear it."

Only the first describes a clean failure. The second and third describe states
where the system is **half-changed**, and they exist because the code cannot
prevent them. That is the design admitting in prose that it cannot be
consistent, and it is the argument for the migration in the plainest form
anyone is going to find. A fourth, on the reject path (`:136`), warns that the
user has NOT been notified.

This is the surface that most needs one transaction and the one where a naive
pair would move the seam rather than close it.

**The precedent is exact.** `apply_subscription_state` (0023–0025) exists so
`users.subscription_status` and `subscriptions` cannot disagree, and every caller
is forbidden from writing either table directly. Same argument, on a record kept
six years as the evidence for a ban.

**Proposed shape — one migration, five `SECURITY DEFINER` functions:**

    admin_act_on_user(p_user_id, p_action, p_reason, p_duration_days)
    admin_act_on_report(p_report_id, p_action, p_reason, p_duration_days)
    admin_act_on_provider(p_provider_id, p_action, p_reason)
    admin_decide_verification(p_request_id, p_decision, p_note)
    admin_decide_status_post(p_post_id, p_decision, p_note)

Each one: assert the caller is an admin (`is_admin()`, not a client claim), do
the state change, insert the `admin_audit_log` row, commit or roll back as one.
The client calls `supabase.rpc(...)` and gets a single error or a single success
— there is no partial state left for it to describe in an alert.

**✅ THREE DECISIONS, SETTLED 8 Sep 2026 — do not reopen these while writing it:**

1. **Notifications sit OUTSIDE the transaction.** They are a side effect, not
   evidence, and a failed notification must not roll back a ban. Fired after the
   function returns, with failure reported to the admin rather than silently
   logged — which is what `moderation`'s rejection notice already does.
2. **RLS forbids direct client writes to `suspensions` and `admin_audit_log`.**
   `apply_subscription_state`'s rule is *never write either table directly*, and
   the same rule applies here. A second migration, and the thing that makes the
   first one more than a convention.
3. **The toggles read and flip inside the function.** `flag`, `waive` and `comp`
   currently compute `!current` in the client from a row fetched earlier.
   **Same class as the `current_period_end` near-miss: computing from a value
   you read a moment ago is computing from a guess.** Inside the function the
   current value is read and flipped in the same transaction.

**Not scoped: the mobile and site equivalents.** They pair writes with
notifications rather than with audit rows, so they are item 27's problem, not
this one.

**Why the fall-out from the `users` rewrite is the better finding.** Collapsing
eight `if` branches into one `switch` forced an exhaustive case, and the default
now returns an error. Before, an action string added to a menu but not to the
branch chain would have fallen straight through to `logAction` and written an
audit row for something that never ran — a false entry through a door nobody was
watching, in the surface where a false entry matters most. It was not found by
looking for it; it was found because the rewrite made the missing case
impossible to leave implicit. **A structure that cannot omit a case beats a
review that has to notice one.**

**── ARE THE ROWS ALREADY IN admin_audit_log TRUSTWORTHY? ───────────────**

Unknown until checked. Probably none are false — one admin, who would have
noticed — but "probably none" is what was said about the subscriptions.

**⚠️ WHAT THESE QUERIES CAN AND CANNOT SHOW.** They compare the log against the
state NOW. A ban that was refused and later re-applied successfully looks
consistent, because the end state is right. So a clean result means *no
surviving disagreement*, not *no false entry was ever written*.

    -- BLOCK A: the latest state-changing action per user vs the state now.
    with acts as (
      select distinct on (target_user_id) target_user_id, action, created_at
      from public.admin_audit_log
      where action in ('suspend', 'ban', 'reinstate', 'verify')
        and target_user_id is not null
      order by target_user_id, created_at desc
    )
    select a.target_user_id, a.action, a.created_at,
           exists (select 1 from public.suspensions s
                    where s.user_id = a.target_user_id) as has_suspension,
           u.is_verified
    from acts a
    left join public.users u on u.id = a.target_user_id
    order by a.created_at desc;

    -- Read it as: suspend/ban -> has_suspension should be true.
    --             reinstate   -> has_suspension should be false.
    --             verify      -> is_verified should be true.
    -- Any row failing its expectation is a candidate false entry.

    -- BLOCK B: warnings. Every logged 'warn' should have delivered a
    -- notification, and this one does not depend on ordering.
    select
      (select count(*) from public.admin_audit_log where action = 'warn')     as warns_logged,
      (select count(*) from public.notifications where type = 'admin_warning') as warnings_delivered;

    -- warns_logged > warnings_delivered means a warning was recorded as sent
    -- and never reached anyone. (The reverse is fine: notifications can be
    -- created by other paths.)

    -- flag / waive / comp are TOGGLES, so the current value cannot be checked
    -- against a single log row. They are not covered by either block.

**28. THE REPO HAS NO CI. NEW, 8 Sep 2026. NOT FIXED.**

Every gate built so far runs only where somebody happens to trigger it:

| Gate | Runs when |
|---|---|
| `site` `npm run checks` | `next build` — so on a Vercel deploy, and locally if you remember |
| `admin` `npm run checks` | same, added 7 Sep |
| `mobile` | nothing yet; and mobile has no build step to hang one on, since builds go through `eas build` |

There is no `.github/workflows` directory. Nothing runs on push, nothing runs on
a pull request, and commits go direct to `main` — so the first thing that would
catch a bad commit is a deploy.

That is the same shape as everything else in this file: **a check that exists and
is not reached.** Items 9 and 10 were a findability pass over features; this is
findability for the checks themselves.

**✅ WIRED 8 Sep 2026 — AND IT IS A SIGNAL, NOT A GATE.**

`.github/workflows/{site,admin,mobile}.yml`, `ubuntu-latest`, each filtered to
its own directory, each running that app's own `npm run checks`.

**⚠️ READ THIS BEFORE RECORDING "CI IS WIRED" ANYWHERE ELSE.**

**These run AFTER the commit is on `main`.** Nothing in them can stop a bad
commit landing. They can only tell you one did. "CI is wired" and "commits are
checked" are different statements, and letting the first be read as the second
is precisely the class of wrong record this file exists to catch — see the
correction section, where the same shape has now happened three times.

**Branch protection requiring these checks is AVAILABLE AND NOT RECOMMENDED.**
It is what would make them a gate. It also requires pull requests, and
commit-direct-to-main is a considered choice for a solo project (`CLAUDE.md`).
Micky's reasoning, recorded because it is the reason rather than an omission:
*"requiring PRs to gate a check I'd see in a notification anyway changes how I
work to enforce something I'd already know."* Revisit if a second person ever
commits here.

**Three workflows, not one.** `on.push.paths` is a workflow-level filter, not a
job-level one, so a single workflow would either run all three apps on every
push or need a change-detection job that itself runs every time. The apps share
no code — separate `package.json`, separate lockfiles, no workspace linkage —
so per-app workflows mean a mobile-only commit runs only mobile, and each app
gets its own status rather than hiding behind another's failure.

**Cost is not a consideration:** the repo is public, and Actions is free and
unlimited on public repositories. That was checked before wiring rather than
after a month of runs.

**What is still true after this.** The build-time gates remain the only thing
that can actually stop something shipping:

| | Stops a bad commit landing | Stops a bad build shipping |
|---|---|---|
| GitHub Actions on push | **no** | no |
| `npm run checks` in `next build` / `eas-build-post-install` | no | **yes** |
| Branch protection (not enabled) | yes | no |

**25. THE REJECTION NOTE IS UNMEDIATED FREE TEXT — MITIGATED, NOT CLOSED,
7 Sep 2026.**

An admin types a reason into the queue and it reaches a stylist's notifications
verbatim, with nothing between the box and them. On 7 Sep one went out reading
*"cointained a banned word"* — a typo, in the only sentence a stylist gets about
why their update was refused.

**Mitigated:** rejecting now shows the admin the complete message as the stylist
will read it and asks them to confirm. The string is built once and reused for
the insert, so the preview cannot drift from what is sent. Same argument as the
image-review toggle's confirm: a one-way action gets a look at what it will do
first.

**Not closed, and the gap is real.** A preview is a second look by the same
person, and the same person wrote the typo. It also does not constrain content:
nothing stops a note naming the banned word, which the composer's placeholder
warns against and no mechanism enforces. This is tolerable while there is one
admin who knows the rules and would not survive a second. **Options when it
matters:** a short set of canned reasons with free text as the exception, which
is also the only version that could be translated or kept consistent; or a
second admin's approval on outbound text, which is heavier than this product
needs.

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

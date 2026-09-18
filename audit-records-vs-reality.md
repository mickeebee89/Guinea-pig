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

**⚠️ CORRECTED 14 Sep 2026 — the premise expired, the near-miss stands.** the webhook has been live since 25 Aug 2026 (function deployed 31 Aug; Stripe endpoint `cavy-subscriptions` ACTIVE, five events, signing secret set), and it writes `current_period_end` on every renewal. So
the column is no longer "written only at initial subscribe", and the naive fix
would no longer cut off paying subscribers for that reason. The near-miss is
still worth keeping: it was real, and the habit that caught it — trace what
writes a column rather than trust a record describing it — is what found this
correction too.

The original finding follows.

`legal.ts:218` promises "cancel at any time from within the app".

`mobile/src/app/(app)/subscribe.tsx:105` swallows a failed `confirm_subscription`
with the comment *"webhook will sync DB — proceed"*. **There is no webhook** —
the repo says so in three places. **[⚠️ 14 Sep 2026: FALSE SINCE 25 AUG. The webhook went live 25 Aug 2026,
the function was deployed 31 Aug, and the Stripe endpoint `cavy-subscriptions`
is ACTIVE on five events with its signing secret set. The swallow described
here was also fixed. See item 47.]** On that path Stripe bills £4.99/month for ever
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

> **⚠️ CLARIFIED 18 Sep 2026 — THE CAUSE STANDS; "EMPTY" NEEDED DEFINING.**
> A live check of `https://cavybeauty.com/hair-models` on 18 Sep showed a fully
> rendered marketing page, with *"Cavy hasn't launched yet — join the waitlist
> and we'll email you when stylists near you start looking"* where stylists
> would be. It was read as evidence that the pages are *not* empty in the way
> recorded here, and that the site-mode flag might be what hides stylists.
> **The code says otherwise. VERIFIED, `site/app/(public)/[treatment]/page.tsx`:**
>
> * The page never reads the flag. Lines 1–7 import no `IS_LIVE` and no
>   `PUBLIC_SITE_MODE`. The flag reaches this page only through the layout's
>   robots meta (`site/app/layout.tsx:42`), which does not change what renders.
> * **The waitlist line is the empty state.** It shows when the count is 0:
>   `{count > 0 ? … : 'Cavy hasn’t launched yet — …'}` (`:103-105`).
> * **The stylist cards are the other half of it.** They render only when
>   `{stylists.length > 0 && (` (`:124`).
> * Both numbers come from `public_stylists` and nothing else (`:51-54` →
>   `site/lib/stylists.ts:48-56` and `:63-78`, `.from('public_stylists')`, anon
>   client). There is no intermediate view or function.
>
> So what was seen live **is** the empty state this item describes: no cards,
> and the waitlist line standing in for them. "Render zero cards" was accurate.
> "Empty" means that, not a blank page. **Bio length, through the view's bar,
> is still what empties these pages.** The 18 Sep database check agrees: 3
> providers published, 0 rows in `public_stylists`, all 3 failing the
> 40-character bar.
>
> **Two things this adds:**
> 1. **The waitlist line is tied to the data, not to launch.** Every category
>    with no qualifying stylist will say *"Cavy hasn't launched yet"*, including
>    after launch. It is the same shape as item 46 (*"launching soon"* above a
>    working product), reached by a different route.
> 2. **One bio does not fill all six pages.** Each page filters on its own
>    category, `.contains('category_slugs', [dbSlug])` (`stylists.ts:53`), and
>    `/hair-models` filters on `hair` (`site/lib/site.ts:57-58`). Micky B's new
>    40+ character bio fills only the pages for categories he offers. Which
>    ones is not established. `select category_slugs from
>    public.public_stylists;` answers it, and returns slugs only.
>
> **Caching.** `export const revalidate = 900` (`page.tsx:9`) applies to the
> whole route, whichever branch renders. The pages are prerendered, and the
> 15 Sep build listed them as `● /[treatment]  15m  1y`. INFERRED from
> standard Next.js incremental regeneration, not observed: a data change shows
> after the 15-minute window has passed **and** a request has triggered the
> rebuild, with the next request after that seeing it. A change of the flag
> needs a redeploy, INFERRED from how Vercel applies environment variables.
> A redeploy re-prerenders all six, so **the flag cannot leave stale waitlist
> copy behind.** What can: a regeneration whose query fails. Item 18 says that
> returns `[]`, so a failure would be cached as the empty state for another
> 15 minutes.

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

**17. `banned_words` HAS NEVER HELD A REAL LIST — NEW, 7 Sep 2026. STILL OPEN
13 Sep 2026, WITH HALF OF IT FIXED. A DECISION, NOT A BUILD TASK.**

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

**── 13 Sep 2026: THE PLACEHOLDERS ARE GONE, AND THIS IS NOT CLOSED ─────**

`banned_words` now holds **two terms, profanity only**. Micky replaced the
placeholders at some point without recording it, because "hair" was blocking
almost every legitimate test post, and picked two obvious profanities to get
something real in there.

**His framing, and neither label offered fitted: it is TEST SCAFFOLDING.** Not
deliberate, not an oversight — the list has never been scoped against the three
categories the screen was designed for. So the item splits in two:

* **Fixed:** the reason the placeholders were a problem. Ordinary posts no
  longer queue, and the 12 Sep moderation exercise ran against a list that does
  not flag normal English.
* **Not fixed:** the reason this item exists. There is no real list.

**What that means in practice, which is worse than "a short list":**

    "message me on WhatsApp 07700 900123, cash only"

passes untouched and reaches every model in range. **The two categories carrying
the safety promise — steering people off-platform, and soliciting payment
off-platform — are entirely unscreened.** The screen catches two words.

**Mechanism correct, data makes it ineffective: the same failure type as when
the placeholders were found, still true with different values.** Swapping the
values changed WHICH posts get through, not whether the screen does anything
useful. That is the sentence to keep, because the obvious reading of "the
placeholders are gone" is that the problem went with them.

**⚠️ AND THE TESTING TRAP SURVIVED THE SWAP.** The 12 Sep exercise proved the
screen, the queue, the preview and the rejection notice work end to end. It
proved nothing about whether the screen catches what it should, because a
two-word list cannot demonstrate that. **A nearly-empty queue is not evidence
that nothing is getting through** — and it now looks exactly like a healthy one,
which the placeholder list at least never did.

**Still Micky's to write, and stated by him rather than inferred (13 Sep):**
*"Writing the real list is mine to do, not a build task."*

**── WHAT THE MECHANISM CAN AND CANNOT EXPRESS, READ 13 Sep ─────────**

The list's shape depends on the screen, so both function bodies were read
verbatim from `0032` (applied, unmodified — so the file IS the live definition).

**Websites are already handled, and NOT by the list.**
`strip_links_from_status_post()` runs FIRST and deletes them outright: markdown
targets, HTML tags, anything starting `http://`, `https://` or `www.`, and bare
domains. They never reach the screen, so website terms do not belong in the list.

**⚠️ BUT THE TLD LIST IS NARROW, AND A SHORTENER WALKS STRAIGHT THROUGH.** The
bare-domain pattern matches only:

    com | co.uk | uk | net | org | io | me | shop | store | link | xyz

**`bit.ly` survives.** So do `.app`, `.co`, `.social`, `.gg`, `.to`, `.page`. The
narrowness is deliberate — matching every dotted string would eat "3.30pm" and
prices — but a link shortener is the exact thing the strip exists to stop.
**Micky, 13 Sep: fix this FIRST.** It is in the mechanism rather than the data,
it is the cheaper half, and it is worth doing whether or not patterns ever land.

**Phone numbers and `insta: @me` are the real gap, and substring cannot reach
them.** `strpos` cannot express "eleven digits with optional spaces".

**⚠️ AND GOING REGEX WOULD OVERTURN A DECISION THAT HAS ALREADY BEEN VINDICATED.**
`screen_status_post`'s own comment records using `strpos` *"rather than a regex
so a stray metacharacter in the list cannot break it"* — and the ADVISORY copy in
`admin/app/moderation/page.tsx`, which does build a regex, once threw on a stray
`(` and left that tab silently empty. In the trigger it would be worse: the
pattern compiles at insert time, so a malformed entry makes the INSERT RAISE and
a stylist simply cannot post. That fails in the opposite direction from
everything else in `0032`.

**✅ SETTLED 13 Sep — TWO SETTINGS, NOT ONE.** `banned_words` stays exactly as it
is: substring, case-insensitive, unbreakable. A separate `banned_patterns` holds
regexes, **each one wrapped so a compile failure degrades to "no match, queue the
post" rather than raising.** Micky's reasoning, and it is the rule the whole of
`0032` is built on: *"fail-closed-but-loud is the rule; fail-closed-and-silent-
to-the-author isn't."* One list that is sometimes a pattern produces "everything
queues and nobody knows which entry did it".

**And one consequence that must land in the SAME migration:** the console's
advisory copy currently ESCAPES metacharacters. The moment patterns become real
it has to stop, or the two disagree about the same post — which `0032`'s own
comment forbids in as many words. Not a follow-up.

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

**✅ GROUP B CLOSED IN admin, 8 Sep 2026 — 6 more sites, and the list was
re-measured rather than trusted.**

The earlier scope named moderation's image toggle and bulk-approve as group B.
Re-grepping showed **both already check their errors**, and turned up two sites
the scope had missed. A list written once and reused is the item-19 shape, so
this one was rebuilt from a fresh grep before anything was touched.

| Site | What a refused write did |
|---|---|
| `messages` send | Cleared the form, flipped the "sent" confirmation and wrote an audit row. **On the one screen whose entire job is to send something to a person** |
| `categories` update / create / toggle | Closed the form and logged the change as done |
| `verification` approve → notify | User verified and never told |
| `verification` reject → notify | User rejected and never told |
| `Sidebar` signOut | Navigated to /login with a live admin session still open, on the console that can ban people |

The two verification notifications are **warnings, not rollbacks**: the decision
stands and only the message failed, which is the distinction an admin needs in
order to act. The others refuse and say nothing has changed.

**admin now has no discarded write results at all.** What remains of the original
25 is mobile 9 and site 2; the rest were re-counted as already checked.

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

**── FOR `admin_decide_verification`, READ 10 Sep ───────────────────────────────**

`publish_provider_if_eligible` is an `UPDATE … WHERE`, not a raise: an ineligible
provider is silently not published. **The function itself cannot fail the
transaction.** Micky's reading, and it is right as far as it goes.

**The question:** the `UPDATE` fires the `BEFORE UPDATE` triggers on `providers`,
and `trg_publish_requires_complete_profile` DOES raise (23514). Can a row pass the
function's `WHERE` — `provider_shop_is_publishable(p.id)` and `users.is_verified`
— and still fail a trigger?

**Micky's reading of the three bodies, 10 Sep (his summaries, not verbatim):** the
function and `enforce_publish_requires_complete_profile` test the same two things,
a name and at least one treatment with a category (the trigger's own comment says
there is deliberately no bio check — the 40-character bar is the public site
only), and `enforce_publish_requires_verified` is covered because the function's
`WHERE` already requires `is_verified`. So `publish_provider_if_eligible` cannot
roll an approval back; an ineligible provider is silently not published.

**⚠️ WITHDRAWN 10 Sep 2026 — there is no name-test divergence.** A lead was raised
here that the function tested `name <> ''` and the trigger `btrim(name) = ''`, so a
spaces-only or NULL name would be treated differently. The verbatim lines:

    provider_shop_is_publishable:               and coalesce(btrim(p.name), '') <> ''
    enforce_publish_requires_complete_profile:  if coalesce(btrim(new.name), '') = '' then ...

Identical. And providers by name state: NULL 14 (0 published, 3 verified), empty
8 (0 published, 6 verified), a name 7 (2 published, 2 verified), spaces-only 0.

**Where the lead came from, stated exactly because it was mis-attributed in both
directions.** The words `name <> ''` first appear in Micky's own summary of the
function (10 Sep); the claim that the difference came from Claude's summary is
not what the transcript shows. (Micky agreed, 10 Sep: *"I'm the one who introduced
the discrepancy."*) Claude then turned the gap between two summaries
into a lead, labelled it one, and asked for the lines. Two authors again. **A
difference between two summaries is evidence about the summaries.** The lead was
generated by the thing it was checking — the same shape as `0028`'s Block A
matching its own explanatory comment. Ask for the verbatim line before raising
it, not after.

**What the counts do show, for the approval work:** 9 of the 11 verified providers
have no name, so none of them can be published. "Verified and not published" is
the common case in this database, not an edge — which is why an approval must
say what happened to the shop.

**⚠️ FOUND WHILE WRITING 0039: the trigger chain cannot republish a reinstated
stylist.** From the live body of `publish_provider_if_eligible` (auto-publish only
where `first_published_at IS NULL`) and the repo copies of `revoke_verification`
and `unpublish_on_verification_lost` (0027), which unpublish without clearing it.
So revoke → resubmit → approve leaves the shop hidden under "rely on the chain",
while today's console, which publishes explicitly, does publish it. That reversed
the earlier plan: 0039 publishes explicitly where `provider_shop_is_publishable()`
passes (its ⟨D1⟩).

**Confirmed from the database, 10 Sep:** live `revoke_verification` does not assign
`first_published_at`; live `unpublish_on_verification_lost` sets `is_published =
false` only; live `tg_user_verified_maybe_publish` calls
`publish_provider_if_eligible` per provider. **Decisions ⟨D1⟩–⟨D4⟩ confirmed by
Micky, 10 Sep.**

**And it is not hypothetical.** Read the same evening:

    verified, shop hidden, published before        1
      of those, ready to publish now               1
    published, but first_published_at empty        0   (0016 lead: clear)
    pending requests from already-verified users   0
    pending requests in total                      1
    revocations ever recorded                      1

The one revocation is Micky's own test of `revoke_verification` on Jojo B, earlier
that night. **The test that proved the revocation mechanism is the most likely
source of the first live instance of this defect, and nobody noticed at the time.**

**✅ RESOLVED 10 Sep — IT IS JOJO B, AND HER SHOP NEVER CAME BACK.**

    shop Jojo B. · provider c42537d1-0b26-49b1-8770-a390b048ef9e
    is_verified true · is_published false · first_published_at 2026-09-07 14:31:05
    moderation: revoke_verification @ 07 Sep 19:56 · verification_requests: none

**✅ FIXED 11 Sep 2026 BY 0040, AND BY THE NORMAL PATH.** Read after applying:

    Jojo B. · is_published true · first_published_at 2026-09-11 16:26:38 · is_verified true

**The timestamp is the migration's own run**, which is what proves the mechanism
rather than the repair: 0040 cleared `first_published_at`, that fired
`trg_provider_maybe_publish`, and `publish_provider_if_eligible` applied the same
eligibility rules as every other publish in the product. No hand-written UPDATE
touched her row. The cause is fixed too — `unpublish_on_verification_lost` now
clears the column when it hides a shop, so every path benefits, including paths
nobody has found.

**Hidden 7 Sep 19:56 to 11 Sep 16:26.** Four days, by a test of the revocation
mechanism, found by reading rather than by anything failing.

**The first live instance of this defect was produced by the audit itself.** A
test of `revoke_verification` on 7 Sep left a real provider verified and hidden,
with no route back through auto-publish, and nothing surfaced it for three days.

**⚠️ CORRECTION — Micky's.** He reported that Jojo B was re-verified and her shop
came back. What he saw on 7 Sep was the composer message changing, and he reported
the shop reappearing from it. His words: *"I reported the second from the first."*

**⚠️ CORRECTION — Claude's, in the query that identified her.** Its
`admin_actions_24h` column only looked back 24 hours, because the revocation had
been described as "earlier tonight". It was 7 Sep. The null was then read as "never
re-verified through any console page", and that does not follow: a console verify
on 7, 8 or 9 Sep would not appear in it. **Seventh instance of a partial measurement
read as the whole.** What IS established about how `is_verified` became true again:

| Path | Status |
|---|---|
| verification page approve | **ruled out** — it needs a request row, and she has none; `revoke_verification` deleted the last one and nothing has been submitted since |
| mobile `verify-payment.tsx:119` | **ruled out** — it writes only for a non-provider with an approved request |
| users page / providers page Verify | **not ruled out** — the query window missed the period; all-time audit rows requested |
| hand edit (SQL editor, dashboard table editor) | not ruled out; leaves no audit row |
| her own session through the API | not ruled out — see below |

**⚠️ A LEAD, NOT A FINDING: a signed-in user may be able to set their own
`is_verified`.** `mobile/src/app/(app)/verify-payment.tsx:119` writes
`users.update({ is_verified: true })` from the user's own session, on the model
path, and the product depends on that write succeeding. The `users` policy
*"users can update own row"* allows any column of your own row, and no column
grant or guard trigger on `is_verified` was found in the repo. If the live database
matches, anyone can mark themselves identity-verified with one API call — and a
provider doing so is auto-published by the trigger chain. A rolled-back test as a
non-admin account was requested before this is recorded as anything more.

**Holds whatever that shows (Micky, 10 Sep): the two checks are duplicated and
nothing keeps them in step.** If one gains a condition the other lacks, the function
starts producing rows the trigger refuses, and the rollback risk appears for real.
0039 records this with a `comment on function` on each, so it sits where both live.

**Holds either way, and goes into the function:** an approval that does not publish
tells nobody. The shop stays hidden, the admin is not told, and the stylist is told
they are verified. `admin_decide_verification` must return whether it published,
and the console must say so.

**Also noted:** `first_published_at` makes auto-publish once-ever. A provider who
has ever been published will never be auto-published again by this path.

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

**── THE REPOINT, SURFACE BY SURFACE (11–12 Sep) ─────────────────**

One surface per commit, so a mistake in the calling convention shows up once
rather than five times. **No production console exists** — Vercel's project has
root `site/`, and `admin/` runs on localhost against the live database — so a
partly-repointed console is seen by one person.

| Surface | Commit | Exercised |
|---|---|---|
| `users` | `acda495` | verify on an unpublishable shop, suspend with no reason, a toggle, warn. One audit row per action, all `via admin_act_on_user` |
| `reports` | `fc1e19e` | suspensions replace rather than stack, closing records who and why, audit one-for-one |
| `providers` | `3e92b01` | 5 image rows removed with 5 URLs recorded, verify on an unpublishable shop, suspend twice leaving one row |
| `verification` | `f195b74` | approve on a shop that could and could not publish, each producing a different true message; a reject; all three carrying `reviewed_by_source = 'recorded'` |

**The helpers were lifted at the third copy** (`3e92b01`): `shopsNote` and
`humanError` went to `admin/lib/adminActions.ts` before `providers` became the
third page to hold them, with two surfaces still to come. The `rpc()` calls were
deliberately NOT lifted — each surface passes different parameters and reads
different keys, and a wrapper would put the contract one indirection away from
whoever checks it against the migration.

**What `verification` actually changed, beyond atomicity:** every approved
provider used to be told *"your verified badge and profile are now live"*. That
was false whenever the shop could not publish — the same untruth the console was
telling the ADMIN, aimed at the stylist, who has no queue to check it against.
The message is now built from `shops`. Two approvals on 12 Sep produced two
different and true messages for the first time.

**✅ ALL FOUR GUARDS NOW EXERCISED, 13 Sep — AND THE REASON THEY LOOKED
UNTESTABLE WAS WRONG.** Each was run in the scenario it was written for: the
report double-close and the verification second decision from a STALE TAB (open
the page twice, act in one, act again in the other), and the status-post expiry
by setting `expires_at` two minutes out and deciding after it passed. All three
refused. Five minutes in total.

**⚠️ CORRECTION — Claude's, and it propagated three times.** These were recorded
as "unreachable by clicking". That is true of a FRESH page and false of the case
they exist for — a stale tab is trivially reachable. The false half rode along
with the true half because they were welded into one phrase, and each retelling
cited the previous sentence rather than re-deriving it from what the guard
protects. Same shape as the `name <> ''` lead: a summary compared against
another summary. **The rule: when restating a claim about testability, derive it
from what the thing GUARDS, not from the last thing you wrote about it.**

*What was recorded before that, kept because the reasoning for holding B–E was
sound even though one premise was not:*

**⚠️ THREE PATHS WERE UNTESTED, AND UNTESTED IS NOT PASSING:**

* **The deleted-subject refusal.** All four open reports have living subjects, so
  the path where `admin_act_on_report` refuses `warn`/`suspend`/`ban` because the
  reported account is gone was never reached. That matters more than it looks:
  the repoint DELETED the client-side pre-check covering it, on the grounds that
  the function refuses more precisely. The reasoning is sound and it has not run.
* **The double-close guard.** Once a report closes the UI offers only View Chat,
  so ⟨D4⟩'s "this report is already dismissed" cannot be reached by clicking. It
  guards a stale tab or a direct API call, which is where the risk actually sits
  — but it means the row lock protects something the interface cannot show.
* **The second-decision guard on verification**, for the same reason: a decided
  request leaves the pending tab, so "this request is already approved" is
  unreachable by clicking. Both row locks exist for the stale-tab and direct-call
  cases, and both are recorded here as untested rather than left to look covered
  by a green run.

**Found by using the page rather than by any test, and fixed 12 Sep: the CHILD
SAFETY badge said the same thing about two different facts.** `isFlagged()` is
true either when a report IS a child-safety report, or when the person it is
about has EVER been the subject of one — the second being the half that matters,
and the reason the flag keys on `reported_email_hash` rather than a user id. Both
rendered one red "CHILD SAFETY" badge, so a spam report about someone with
history read as a child-safety report, and the badge is what an admin scans
before the reason line. Now `CHILD SAFETY` for its own kind and `CHILD-SAFETY
HISTORY` for the other — both red, both still sorted to the top, because the
priority was never wrong. Only the words were.

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

**✅ CLOSED 8 Sep 2026, AND IT EARNED ITS KEEP ON THE FIRST RUN.**

First push: `admin` green, `site` and `mobile` **red** — see item 30. Both had
passed on every machine they had ever run on. After the fixes, on `2e2bd5f`:
site green in 30s, mobile green in 1m 07s, and **admin did not re-run at all**
because the commit touched no file under `admin/`. The path filters work, which
was the reason for three workflows rather than one.

It remains a signal and not a gate. Everything above about branch protection
still stands.

**54. DELETING A SUBSCRIBER'S ACCOUNT PROBABLY LEAVES A FAILED WEBHOOK EVENT
AND DAYS OF STRIPE RETRIES — LOGGED 18 Sep 2026. MOSTLY INFERRED; THE SQL THAT
SETTLES IT IS BELOW.**

**VERIFIED, from the code:**
* `delete-account` cancels the Stripe subscription **immediately**
  (`supabase/functions/delete-account/index.ts:139-161`,
  `stripe.subscriptions.cancel`), and only after that runs
  `delete_account_data` (`:166`). That deletes `public.users`
  (`supabase/account-deletion-fix.sql:349`), and its comment says the delete
  cascades to `subscriptions` (`:346-348`). The Stripe customer is not deleted,
  and nothing in that file deletes it.
* When the webhook gets a subscription event for a customer it has no row for,
  `resolveUserId` falls back to the customer's `metadata.user_id`
  (`supabase/functions/stripe-webhook/index.ts:93-110`). That metadata survives,
  so it returns the deleted user's id. `writeState` then calls
  `apply_subscription_state` for that id, and it **throws** on any error
  (`:151`).
* A handler that throws records `'failed'` and returns 500 (`:436-445`). A
  redelivery of a `'failed'` event runs again rather than short-circuiting
  (`:289-294`).

**INFERRED — two steps that were not checked:**
1. That Stripe's `customer.subscription.deleted` usually arrives **after**
   `delete_account_data` commits. It is sent asynchronously, and the
   database work starts straight after the cancel call.
2. That `subscriptions.user_id` has a foreign key to `public.users`. No FK
   definition for either money table was found anywhere in the repo. The
   cascade comment implies one.

**If both hold:** the upsert fails with 23503, and every subscriber who deletes
their account leaves a `'failed'` event that Stripe retries for days. That shows
as a failure on the Revenue panel's `failures_7d`, which makes real failures
harder to spot. **No money moves** — the subscription is already cancelled.

**The case where money does move:** when the Stripe cancel fails
(`delete-account/index.ts:145-159`), the account is still deleted. Stripe keeps
billing, and every renewal fails the same way in the webhook. The only record
is one `billing_orphan_on_delete` row in `admin_audit_log`, and nothing watches
for it.

`seed/teardown.mjs:243` deletes `subscriptions` rows directly, with no Stripe
call. That is fine for seed accounts, which should have no live Stripe
subscription. Not checked.

**53. A STYLIST WHO PAYS £14.99 AND CLOSES THE TAB CAN BE CHARGED AGAIN —
FOUND 18 Sep 2026 BY READING. VERIFIED FROM CODE, NOT OBSERVED. NOT TESTED:
TESTING IT MEANS SPENDING REAL MONEY.**

**Plainly:** if someone pays the verification fee, passes the bank's 3-D Secure
check, and the tab closes before our server has recorded the payment, they come
back to a fresh "Pay £14.99" button. Nothing tells them they already paid.

**The mechanism:**
* `create_verification_intent` checks for an existing payment only by looking
  for a `verification_payments` row
  (`supabase/functions/stripe-payment/index.ts:103-105`). Otherwise it
  **always creates a new PaymentIntent** (`:107-113`).
* That row is written by `confirm_verification` and nothing else (`:215-248`).
  It only runs when the browser calls it after payment.
* The webhook handles no one-off payment event. It handles
  `customer.subscription.*` and `invoice.payment_*` (`stripe-webhook/index.ts:312-431`).
  A fee has no invoice, and anything else is filed `'ignored'` (`:433-434`).
* The retry that would record the first payment safely — re-confirming the
  **same** `paymentIntentId`, where the 23505 path turns a duplicate into a
  benign success — needs that id. It lived only in the closed tab's React state
  (`site/app/(app)/verify/FeePanel.tsx:21-35`).

**Also:** the first payment is then recorded only in Stripe. The admin Revenue
figures read Stripe charges directly (`stripe-payment/index.ts:390-431`), so
Revenue counts it while `verification_payments` does not. The two disagree by
exactly the payments this item is about.

**Not findable from our tables, by construction.** It is findable from Stripe's
side. Every fee intent carries `metadata: { user_id, type: 'verification' }`
(`:111`), so "succeeded fee intents with no matching row" is a Stripe query.
No such check exists. **0 known instances.** The sample is: nobody has looked.

**Correction to the 15 Sep handoff**, which was chat and is not in this file:
*"The fee retry is safe if the person comes back: re-confirming the same
paymentIntentId is treated as idempotent."* The mechanism is right. The
conclusion is wrong. **A person who comes back never re-confirms the same id —
they are issued a new one.**

**── 18 Sep 2026: THE CONSTRAINT, THE DEFAULTS, AND STRIPE'S OWN COUNT ──**

VERIFIED from pasted output: Micky's live queries and the Stripe live dashboard,
18 Sep.

**`public.verification_payments` constraints:** PRIMARY KEY (`id`); **UNIQUE
(`stripe_payment_id`), named `verification_payments_stripe_payment_id_key`**;
FOREIGN KEY (`user_id`) REFERENCES `users(id)` ON DELETE CASCADE; CHECK
`selfie_status in ('pending','passed','failed','locked','refunded')`.
**Indexes:** only the two unique indexes behind the primary key and that
constraint. **There is no index on `user_id`.** Every one of the six
existence checks listed on 18 Sep filters on `user_id`, so each is a full scan.
INFERRED impact: nothing at 3 rows.

**Column defaults:** `id gen_random_uuid()`, `currency_code 'GBP'`,
`selfie_status 'pending'`, `retry_count 0`, `created_at now()`.
`selfie_checked_at`, `payment_captured_at` and `locked_until` are nullable with
no default. `user_id`, `stripe_payment_id` and `amount` are NOT NULL with no
default.

**What that settles:**
* **The 23505 duplicate path is genuinely harmless.** The unique constraint
  exists live. Step 1 of the fix plan is already satisfied, and no migration is
  needed.
* **The foreign key points at `public.users`, not `auth.users`.** So a user id
  whose profile row has gone fails with 23503. That matters for any writer that
  learns the user id from somewhere other than a session, and the webhook will
  be one.
* **`supabase/functions/stripe-payment/db-setup.sql` is a fossil, not the
  schema.** It is the repo's only definition of this table, and it disagrees
  with the live table on nearly everything. It declares
  `stripe_payment_intent_id text not null unique`, a column called `currency`,
  and a foreign key to `auth.users` (`:12-19`). Live has `stripe_payment_id`,
  `currency_code`, a foreign key to `public.users`, and five columns the file
  never mentions. No migration defines the table. `mobile/notes.md:126` had the
  column names right.

**Stripe, live mode, every £14.99 payment ever:** exactly **3**, all
**Incomplete**, none captured, none refunded. Two are dated 19 Aug 2026 18:59,
one 14 Sep 2026 23:46.

**So no live £14.99 has ever been paid.** Nobody has lost money to this gap, and
no back-fill or repair of existing users is needed. "0 known instances" above is
now 0 **verified**, against Stripe's complete list rather than an absence of
looking.

INFERRED: the 14 Sep intent is from the web fee form being checked the night it
shipped (`4c97f11`, 14 Sep 23:13). The 19 Aug pair are from mobile. The three
13 Jul rows in our table predate live mode, as already recorded.

**A refund state was designed and never built.** `selfie_status` permits
`'refunded'`, and nothing anywhere sets it. The same is true of every other
non-default value in that column, and of `payment_captured_at`,
`selfie_checked_at`, `retry_count` and `locked_until`. That was VERIFIED by the
18 Sep search of every `.ts`, `.tsx`, `.mjs`, `.js`, `.sql` and `.md` file.

**The fix:** the webhook handles `payment_intent.succeeded`, as a backstop to
`confirm_verification` (written 18 Sep, see the commit that follows this one).
It is **not live until it is deployed and the event is added to the Stripe
endpoint.** Until both are done, the sentence above — *"The webhook handles no
one-off payment event"* — is still true of production.

**── 18 Sep 2026: THE WEBHOOK FIX IS LIVE ──**

VERIFIED from Micky's report, 18 Sep:
* `npx supabase functions deploy stripe-webhook --no-verify-jwt` succeeded
  at about 12:15.
* `payment_intent.succeeded` is subscribed on the live endpoint, which now
  listens to **6** events.
* The deployed file was read back, and the `payment_intent.succeeded` case is
  in what shipped (`37a6b08`).

**So the sentence above — "until both are done, 'The webhook handles no
one-off payment event' is still true of production" — has been false since 18
Sep.** It is kept as written. Not yet observed: no real `payment_intent.succeeded`
has reached the new handler. The first will be the first live £14.99 ever paid.

**── WHAT THE LIVE PAYLOAD SAYS. VERIFIED FROM PASTED OUTPUT, 18 Sep ──**

* **The endpoint's payload style is Snapshot, on API version
  `2026-05-27.dahlia`.**
* **The 14 Sep `customer.subscription.updated` payload has
  `current_period_end` at the top level of the subscription object**: value
  `1792016526`, which is 14 Oct 2026. So the subscription handlers' direct reads
  of `sub.current_period_start` and `sub.current_period_end`
  (`stripe-webhook/index.ts`, the `customer.subscription.*` case) are correct
  for this endpoint. That holds even though `invoice.subscription` did move in
  2025, which is what the `subscriptionIdFrom` shim handles.
* **`public.subscriptions` holds 13 rows.** Only the oldest, from 20 Jun 2026,
  has null period dates, and every row since has both set. One row is
  `active`, dated 14 Sep 2026.

**⚠️ WITHDRAWN: AN INFERENCE OF CLAUDE'S, MADE IN CHAT ON 18 Sep AND NEVER
WRITTEN HERE.** The final audit report said that from Stripe's 2025 API
versions onward, the period dates moved off the subscription object. It said
`customer.subscription.*` events on a newer endpoint *"would write status but
keep the old dates."* **The live payload shows the opposite for this
endpoint.** It was labelled inferred and low risk, and it was never checked
against a real payload until now. It is recorded here so it is not repeated as
a finding.

**52. WHAT THE LIVE DATABASE SAYS ABOUT ADMIN, PUBLISHING, ROLES AND VERCEL —
READ 15–18 Sep 2026. VERIFIED FROM OUTPUT MICKY PASTED, UNLESS MARKED.**

**`is_admin()`, live:**

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql
    STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
    select exists (select 1 from public.admins where user_id = auth.uid());
    $function$

**`public.admins`, live:** RLS enabled, not forced. One policy, `admins_read`:
SELECT, `authenticated`, `using is_admin()`, no WITH CHECK. **No INSERT, UPDATE
or DELETE policy.** `anon` and `authenticated` hold every table privilege, and
there are no triggers. Two rows: `admin@guineapigapp.co.uk` (`public.users.role
= 'model'`) and `micky.buckfield@gmail.com` (`role = 'provider'`).

A scan of every non-system function whose source mentions `admins` found one
besides `is_admin()`: `admin_act_on_report`, SECURITY DEFINER. It calls
`is_admin()` at its line 14 and only reads. **No function grants admin.** Admin
can only be granted by the service role or the SQL editor.

**So the thing `is_admin()` reads cannot be written by an end user.** That
answers §4's question. It also has the shape `0040:458-464` warned about on the
money tables: it is **protected by omission**. The grants are wide open, and
the only thing refusing a write is the absence of a policy that allows one.
There is no restrictive deny. A permissive ALL policy added later for some
convenience would make admin self-grantable, and nothing in the table would
object.

**── ⚠️ CORRECTION: WHERE `is_admin()` LIVES IN THE REPO ───────────────────**

In chat on 15 Sep, Claude said *"`is_admin()` is defined nowhere in
`supabase/`"*. Item 50 then recorded it as *"still not established either
way"*. **The first was wrong. The second was too cautious.**

* **The body is in the repo:** `supabase/schema-snapshot-2026-08-08.sql:46-50`.
  It is character-for-character the live body above.
* **No migration creates it.** `0039:118` and `0040:126` assert that it exists
  and refuse to run without it. Neither defines it.
* **`public.admins` is created by no file at all.** A search of the whole repo
  for `create table … admins` returned nothing.
* Why the search missed it: `grep "function public.is_admin"` is
  case-sensitive, and the snapshot spells it `FUNCTION`. That is the same
  failure as the `handle_new_auth_user` correction in item 50, in the other
  direction. There the thing was in a migration and was reported absent. Here
  it is in the snapshot only, and was reported absent from everything.

**So three objects this product depends on have the same status:**
`is_admin()`, `public.admins` and `on_auth_user_created`. Each exists live and
is recorded in the repo only by an 8 Aug snapshot, or not at all. No migration
would rebuild any of them.

**`provider_shop_is_publishable()`, live:**

    CREATE OR REPLACE FUNCTION public.provider_shop_is_publishable(p_provider_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $function$ select exists (select 1 from public.providers p
      where p.id = p_provider_id and coalesce(btrim(p.name), '') <> ''
        and exists (select 1 from public.provider_treatments pt
                    where pt.provider_id = p.id and pt.category is not null)); $function$

**Bio length is not part of publishability.** It agrees with `0016`'s header
and with `site/lib/queries/shop.ts:79-83`. **The planned 40-character bio rule
would not change which providers publish.**

**── ⚠️ BUT THE SIX /[treatment] PAGES DO DEPEND ON BIO LENGTH ─────────────**

The instruction this item was written from said adding a bio *"would not by
itself populate the six /[treatment] pages"*. **The repo contradicts that.**

* The pages don't ask about publishability. They read the `public_stylists`
  view: `site/app/(public)/[treatment]/page.tsx:51-54` →
  `site/lib/stylists.ts:48-56`.
* That view requires `length(btrim(coalesce(p.bio, ''))) >= 40`, as well as
  `is_published`, a name and a category. See
  `supabase/migrations/0034_public_stylists_without_status_text.sql:263-265`
  (an applied migration) and `supabase/public-web-views.sql:153`.
* Item 11 records that Micky B is published with a 13-character bio. For any
  published stylist with a categorised treatment, **a 40-character bio is the
  only thing between them and those pages.**

VERIFIED from the applied migration's text. **The live view definition was not
queried.** `select pg_get_viewdef('public.public_stylists'::regclass, true);`
settles it.

> **⚠️ CLARIFIED 18 Sep 2026 — see the note under item 11.** The live page shows
> the waitlist line rather than stylists. That is this section's empty state,
> not a sign the site-mode flag is involved: the page's content never reads
> the flag (`page.tsx:1-7`). The 18 Sep database check (3 published, 0 in
> `public_stylists`, all 3 below the bar) **confirms** this section's
> conclusion rather than correcting it. The one refinement: a 40-character bio
> fills only the pages for the stylist's own categories
> (`stylists.ts:53`), not all six.

**What the planned rule changes, then:** not publishing. It does change public
visibility, for anyone it makes write more. The 40 already exists once in
application code, as a display copy of the view's bar: `BIO_MIN_CHARS`,
`site/lib/queries/shop.ts:38`. The 15 Sep handoff said there were *"ZERO
definitions"*. That was wrong.

**Roles, live:** `users_role_check` permits `model`, `provider` and `both`.
`handle_new_auth_user` rejects anything but `model` or `provider`
(`0011:99-103`). Counts: 29 model, 29 provider, **0 both**.

**Is `both` a live role? Read-only answer: it is read everywhere and written
nowhere.**
* **Readers:** `mobile/src/app/(app)/settings.tsx:33, 217, 545-547`;
  `admin/app/users/page.tsx:32, 319, 358, 365`; `admin/app/page.tsx:96`. The
  `0040` guard's model permit is written to handle it (`0040:218-220`).
* **Writers, none:** the web signup type is `'model' | 'provider'`
  (`site/lib/signup.ts:30`) and mobile's is the same. The trigger rejects it.
  `0040` refuses self-changes to `role`. No function in `0035` or `0039` sets
  `role`.
* The only ways to produce a `both` account are the service role and the SQL
  editor.
* INFERRED: a fossil of a dual-role feature that was dropped at the write side
  and never at the read side. Not established from history.

**`moderation_actions`, live:** `trg_lock_moderation` BEFORE UPDATE OR DELETE
(`guard_moderation_actions`), and `trg_moderation_subject` BEFORE INSERT, both
enabled. **This confirms from the live database the append-only claim item 50
sourced from the snapshot.** One detail differs: the snapshot names the lock's
function `prevent_mutation()` (`schema-snapshot-2026-08-08.sql:440`). Live it
is `guard_moderation_actions`. So the snapshot is already stale on at least one
function name.

**Vercel project `cavy`:** six environment variables, **all scoped to
Production and Preview together**, including `PUBLIC_SITE_MODE`. **No Stripe
secret key is held at Vercel.** It holds only the publishable key. That agrees
with the repo: every use of `STRIPE_SECRET_KEY` is in `supabase/functions/`.
`site.yml:96` overrides `PUBLIC_SITE_MODE` to `preview` in CI.

**What `PUBLIC_SITE_MODE` controls — VERIFIED, all of it:**
`IS_LIVE = process.env.PUBLIC_SITE_MODE === 'live'` (`site/lib/site.ts:17`).
There are three branches, and all three are about indexing:
`app/layout.tsx:42` (`noindex, nofollow` meta), `app/robots.ts:7` (disallow
all) and `app/sitemap.ts:19` (empty sitemap). **Nothing else reads it** — no
query and no view (`public-web-views.sql:159` only mentions it in a comment).

**What differs between the two builds:**
* **A CI build** gets `preview`, so all three take the noindex branch.
* **A Vercel preview deploy** gets whatever Production has, because the
  variable is scoped to both.

Today they probably match. The production value is not part of this evidence;
names only were read. **The day Production is set to `live`, every preview
deploy is also `live`.** `site/lib/site.ts:15` says *"Vercel preview
deployments must never be 'live'."* The current scoping makes that rule false
at exactly the moment it starts to matter. INFERRED, not relied on: Vercel may
add its own noindex header to preview URLs. That has not been checked.

**51. NOTHING GATES `main`, AND "PRODUCTION WAS BLOCKED FOR FIVE WEEKS" WAS SIX
DAYS — RECORDED 18 Sep 2026. CORRECTS ITEM 45'S TITLE AND THE 15 Sep HANDOFF.**

**Branch protection: none. VERIFIED** — Micky, from
`github.com/mickeebee89/Guinea-pig/settings/branches`, 18 Sep. There are no
rules on `main`. Commits go straight to `main`, and nothing gates a merge.
Item 28 recorded protection as *"AVAILABLE AND NOT RECOMMENDED"* (line 1992),
and that is still the state.

**What follows from that:**
* **Neither `npm run checks` nor `npx next build` can block anything.** Both run
  in `site.yml` on push, after the commit is already on `main`. They are a
  signal, as items 28 and 45 say.
* **The only thing that stopped the duplicate-`let` commit reaching production
  was Vercel refusing to build it.** A failed Vercel build leaves the last good
  deployment serving. That fallback is what protected the live site. It also
  hid the problem: the site kept working, just on old code.
* **Nothing in the repo links Vercel deploys to GitHub Actions.** There is no
  `vercel.json` at the root or in `site/`, and no ignored-build command anywhere
  in the repo.
* **Vercel's failure emails were on, and one arrived.** A *"Production
  deployment failed for cavy"* email dated 8 Sep is in Micky's inbox. So
  failures were delivered, but nobody acted on it for six days.

**── THE REAL TIMELINE. VERIFIED FROM GIT ─────────────────────────────────**

| When | What | Source |
|---|---|---|
| 10 Aug 13:54 / 13:57 | `a18efe9` committed and pushed — the build production then served | `git show`; `origin/main` reflog |
| 10 Aug → 8 Sep | **No push at all.** Commits dated 14, 19, 24, 25, 31 Aug and 2, 3, 4, 7, 8 Sep sat on this machine | `origin/main` reflog; commit dates |
| 8 Sep 15:41 | `29d979d` (item 20) writes `let hiddenByBlock = false` twice | `d9d740a`'s message and diff |
| 8 Sep 20:36 and 21:00 | First pushes since 10 Aug (`7071e72`, `2e2bd5f`). Both Vercel builds fail | reflog; `d9d740a` says *"Vercel was red twice"* |
| 14 Sep 18:10 | `d9d740a` deletes the duplicate and is pushed. Production moves | reflog |

The reflog is this machine's record of when `origin/main` moved. It would not
show a push from anywhere else. It agrees with Micky's Vercel deployment list,
which showed nothing between 10 Aug and 8 Sep.

**So `cavybeauty.com` served the 10 August build for 35 days, for two different
reasons:**
* **29 days (10 Aug → 8 Sep): nothing had been pushed.** Production matched
  `origin/main` exactly. No system failed. Work sat unpushed.
* **6 days (8 Sep → 14 Sep): the duplicate `let` blocked every build.** This is
  the failure, and the one the email reported.

**Which record is wrong:**
* **Micky's notes — "builds were blocked from 8 Sep" — are right.** So is
  `d9d740a`'s message, *"blocked production since 8 September … served the 10
  August build"*.
* **The 15 Sep handoff is wrong.** It said *"production sat five weeks stale
  behind a duplicate `let` that no gate could see"*. Production was five weeks
  stale, but only six of those days were caused by the `let`.
* **Item 45's title is wrong in the same way.** It says *"THE FAILURE THAT
  BLOCKED PRODUCTION FOR FIVE WEEKS"*. Its body is right. A correction note is
  added under the title, with the original left visible.
* **The inference "five weeks implies early August" was the error.** It treated
  how old production was as how long it had been blocked.

**And Micky's framing needs the same split.** *"A noticing failure, not a
delivery failure"* is right for the six days. For the other 29, nothing was
there to notice. For anyone using the site, though, the result was the same:
the live site ran five weeks behind the repo, and no check tracks the gap
between what is committed and what is pushed.

**The 7 and 8 Aug failure emails are a separate event.** INFERRED: they are the
site's first deploys failing because the admin console's `proxy.ts` was being
compiled into the site build. `site/next.config.ts:9-15` says that *"is what
broke the first two deploys"*. The commits fit: `b84198c` and `43c156e` scoped
the build to `site/` on 7 Aug, and `2b8bca2` moved the admin console into
`admin/` at 20:16 that day. The reflog does not go back before 10 Aug, so push
times for 7–8 Aug are not established.

**50. THE `public.users` INSERT PATH IS UNGUARDED, AND NOTHING CAN REACH IT
TODAY — 0 EXPOSED ACCOUNTS ON 15 Sep 2026. OPEN AS A CONDITION, NOT A HOLE.
RECORDED 18 Sep 2026.**

Evidence below is VERIFIED from queries Micky ran against the live database on
15 Sep and pasted, or from files read in the repo (cited `file:line`). Anything
else is marked INFERRED.

**── ⚠️ SUPERSEDED: THE FIRST CONCLUSION, KEPT VISIBLE ─────────────────────**

The first reading of the policy and trigger evidence, 15 Sep, concluded:

> *"an authenticated user whose public.users row does not yet exist can insert it
> with any guarded column set, and the 0040 guard does not fire. Whether a row
> always exists before the user can reach PostgREST is unestablished."*

**The mechanism in that sentence is right. The exposure it implied is not.** It
was superseded the same day by the `auth.users` trigger evidence below: the
profile row is created in the same transaction as the auth user, so no session
exists before the row does. The sentence is kept because the mechanism it names
is still true and is what item 50 is about.

**── THE EVIDENCE (VERIFIED, pasted output, 15 Sep) ───────────────────────**

`public.users`:
* INSERT policy `users can insert own row`, `authenticated`, WITH CHECK
  `(auth.uid() = id)` and nothing else. Also in
  `supabase/schema-snapshot-2026-08-08-policies.sql:230`.
* UPDATE policy `users can update own row`, `(auth.uid() = id)`.
* **No DELETE policy.**
* Table grants: `anon` and `authenticated` both hold INSERT, UPDATE, DELETE,
  SELECT, TRUNCATE, REFERENCES, TRIGGER.
* Triggers: `trg_guard_users_protected_columns` **BEFORE UPDATE only**
  (`0040:283-285`); `trg_unpublish_on_verification_lost` AFTER UPDATE;
  `trg_user_verified_maybe_publish` AFTER UPDATE. **No INSERT trigger.**

`verification_requests`:
* `vr_user_policy` — ALL, `authenticated`, `(auth.uid() = user_id)` on USING
  and WITH CHECK.
* Restrictive `vr_selfie_path_matches_user` (`0019:186-192`).
* `trg_guard_verification_decision` BEFORE INSERT OR UPDATE (`0040:356-358`).
  **No DELETE trigger.**

`auth.users`:
* `on_auth_user_created`, AFTER INSERT, enabled (`tgenabled O`), calls
  `public.handle_new_auth_user()`, SECURITY DEFINER, `search_path public`.
* The function validates role (model | provider) and DOB (18+), inserts
  `public.users` with `id, email, role, first_name, last_name, last_initial,
  region, date_of_birth, terms_accepted_at, is_founding_provider`
  `on conflict (id) do nothing`, then a `providers` row for providers, then a
  `founding_providers` row on a grant — granted when role is provider and
  `raw_user_meta_data->>'signup_source'` is any non-empty string, under an
  advisory lock, while `count(founding_providers) < founding_provider_cap`.

Counts: auth users without a `public.users` row = **0**. `is_founding_provider`
true = 1. `founding_providers` rows = 1. Founding flag without a slot row = 0.
`founding_provider_cap` = 200.

**── THE CONCLUSION, AS WIDE AS THAT EVIDENCE ─────────────────────────────**

The INSERT policy checks only `auth.uid() = id`, and `0040`'s guard is
UPDATE-only, so a `public.users` INSERT carrying `is_verified`,
`subscription_status`, `provider_fee_waived`, `subscription_waived`,
`is_founding_provider`, `fraud_flagged` or `role` is refused by nothing. **But
the row is created inside the signup transaction**, so the only accounts that
could use it are auth users with no profile row — **0 of them on 15 Sep.**

**It reopens the moment any path deletes `public.users` and leaves
`auth.users`.** Three do; see question 3. The sample is one count on one day.

**── ⚠️ CORRECTION: "IN NO FILE UNDER supabase/" IS HALF WRONG ────────────**

The 15 Sep evidence stated `handle_new_auth_user` *"exists in the live database
and in no file under supabase/"*. Claude had said the same thing a turn earlier
about the function's absence. **Both wrong, and the second was Claude's.**

* **The FUNCTION is in version control.** `0011_founding_provider_grant.sql:83-181`
  defines exactly the body read from the live database: the role and DOB gates,
  `pg_advisory_xact_lock(hashtext('founding_provider_grant'))` (`:134`), the cap
  from settings (`:136-137`), `is_founding_provider` in the insert column list,
  the `founding_providers` slot row (`:176`). `0002:96` defines the version it
  replaced.
* **The TRIGGER is not.** `on_auth_user_created` appears only in
  `supabase/schema-snapshot-2026-08-08.sql:414-415`, which records state and is
  not applied. No migration creates it. So the function is versioned and the
  wiring that makes it run is not: drop the trigger and `0011` still reads as
  applied, with a matching checksum, while creating no profile rows at all.
* **It was noticed once and dropped.** `web-phase-1-handover.md:954` listed
  `on_auth_user_created` under "Missing triggers". Nothing carried it forward.

How Claude got it wrong: the searches were for `function public.is_admin` and
for trigger declarations `on auth.users`. The definition is
`create or replace function public.handle_new_auth_user()`, with the trigger
declared nowhere in `migrations/`, so neither search could find it and the
absence was reported as a fact. **The search was narrower than the claim**, the
oldest pattern in this file.

`is_admin()` is still not established either way. It was searched for by the
same narrow pattern and should be re-checked before anyone repeats "not in any
migration" about it.

> **⚠️ CORRECTED 18 Sep 2026 — see item 52.** Now established: `is_admin()`
> exists live, and its body is in the repo at
> `supabase/schema-snapshot-2026-08-08.sql:46-50`, identical to the live one.
> **No migration creates it**, and no file creates `public.admins`. The
> original search was case-sensitive and missed the snapshot's `FUNCTION`. It
> has the same status as `on_auth_user_created`: live, and recorded only in a
> snapshot.

**── THE SIX QUESTIONS, FROM THE REPO ─────────────────────────────────────**

**1. What assumes the trigger. VERIFIED, five places:** `mobile/notes.md:16`
(*"the primary row creator"*); `mobile/src/screens/auth/SignupScreen.tsx:107`
(its own checks are *"a BACKSTOP, not a replacement"*); `site/lib/signup.ts:6`
(the metadata shape exists for it); `seed/teardown.mjs:261` (reasons about its
`users_email_key` collision); `0003:14` (relies on its `on conflict (id) do
nothing`).

**2. `mobile/src/lib/ensureProfile.ts`. VERIFIED.**
* Upserts (`:44-53`) `id, email, role, first_name, last_name, last_initial,
  date_of_birth, region` with the user's own session, `onConflict: 'id'`,
  `ignoreDuplicates: true`.
* Runs on the first resolve after login.
* **A second writer of the trigger's row, and it knows it:** `:41-43` names the
  race and makes a trigger-created row a no-op. `:70-76` then UPDATEs
  `date_of_birth` when null.
* **The whole insert branch depends on the row NOT existing** (`:40`,
  `if (!existingUser)`). Its header (`:11-16`) says why it was written: an auth
  user who exists without a profile row. So the shipped client carries a live
  path whose precondition is the state counted at 0.
* **One guarded column is in it: `role`.** It writes `role: metaRole` from user
  metadata, which the user controls, on the INSERT path the guard cannot see.
  Today that branch only runs when the row is missing, so it reaches nobody.

**3. Paths that leave auth.users with no public.users. VERIFIED, three:**
* **`delete-account`, when the auth delete fails.** `delete_account_data` runs at
  `supabase/functions/delete-account/index.ts:166` and deletes the profile row
  (`supabase/account-deletion-fix.sql:349`). The auth delete is `:197`; on
  failure `:201` returns *"Your data was removed but the account could not be
  closed."* **The auth user is not banned and can still sign in** — with no
  profile row, which is exactly the precondition above.
* **`seed/teardown.mjs`, when the auth delete fails.** Deletes `public.users`
  first (`:267`, checked), then the auth user (`:277`); on failure it bans the
  account for `876000h` (`:288`). **Same state, deliberately defused.** Its own
  comment (`:282-283`) is the reason item 50 matters: *"signing in grants the
  `authenticated` role that RLS opens up."* Someone already reasoned about this
  exact shape for seed accounts. `delete-account` did not get the same treatment.
* **By hand.** `authenticated` has the DELETE grant but no DELETE policy, so RLS
  refuses it. Service role and the SQL editor bypass both.

The asymmetry underneath all three is on record at
`schema-snapshot-2026-08-08.sql:78`: the trigger inserts into `public.users`,
which has no FK back to `auth.users`, *"so deletion does NOT cascade the other
way."*

**4. `signup_source`. VERIFIED. Nothing checks it, and nothing could.**
* Set only at `site/lib/signup.ts:88-89`: `input.source?.trim()`, then
  `.slice(0, 120)`. Typed optional at `:38`.
* The grant tests `nullif(btrim(coalesce(...signup_source, '')), '')`
  (`0011:93`) and `v_role = 'provider' and v_source is not null` (`:133`).
  **Any non-empty string counts as a referral.** No allowlist, no signature, no
  referrer table.
* Mobile sends none (`0011:39-42`; `HANDOVER.md:70`), so no app signup
  qualifies.
* **INFERRED:** anyone signing up as a stylist on the web with any value in
  that field takes one of the 199 remaining slots. That is up to 199 × £14.99 =
  £2,983 of fee, with the cap as the only limit. Not tested — testing it means a
  real signup.

**5. Can deleting your own verification_requests rows unlock an old approval?
No. VERIFIED.**
* A revoke is recorded in **`moderation_actions`** (`0027:241`:
  `admin_id, target_user_id, action = 'revoke_verification', reason`).
  `0040:228-230` reads its `created_at` through `max()`.
* That table is **append-only**: `trg_lock_moderation BEFORE DELETE OR UPDATE`
  (`schema-snapshot-2026-08-08.sql:440`), raising *"moderation_actions is
  immutable"* (`account-deletion-fix.sql:250`). A member cannot remove it.
* Deleting your own requests deletes your own **approval**, which is the other
  half of the permit. That makes a claim harder, not easier.
* A revoke already deletes them anyway (`0027:202`). `0040:213-216` says the
  date check deliberately does not rely on that.

**One unchecked column. An observation, not a finding:** the permit compares
`coalesce(vr.reviewed_at, vr.created_at)`, and `created_at` is not among the
columns `guard_verification_decision` checks (`0040:310-313` checks `status`,
`reviewed_by`, `reviewed_by_source`, `reviewed_at`). A member can insert a
pending row with a `created_at` they chose. That only matters if an approval
can land with `reviewed_at` null. **Not established** — the read that would
settle it (the admin approve path) was not done.

> **✅ SETTLED 18 Sep 2026 — not reachable through the app.**
> `admin_decide_verification` sets `reviewed_at = now()` on every decision,
> approve or reject (`0039:614-621`). It is the only code in the repo that moves
> a request off `pending`: both clients only insert
> (`mobile/src/app/(app)/verify-payment.tsx:208`,
> `site/app/(app)/verify/actions.ts:113`), and `0040`'s guard refuses anything
> else from a member. So an approval made through the console always has a
> `reviewed_at`, and the permit's `coalesce` never falls back to a
> member-written `created_at`.
> **What is left:** rows approved **outside** that function — before the
> console repoint on 12 Sep (`f195b74`), or by hand in the SQL editor. Their
> count has not been checked. The query is `select count(*) from
> public.verification_requests where status = 'approved' and reviewed_at is
> null;`.

**6. Does the insert guard permit an already-approved decision? No.
VERIFIED.** `0040:308-320` raises `42501` on INSERT unless `status` is
`'pending'` and `reviewed_by`, `reviewed_by_source` and `reviewed_at` are all
null. It fires BEFORE INSERT OR UPDATE (`0040:356-358`). This is the interlock
`0040`'s header calls load-bearing.

**── WHAT IS OPEN ─────────────────────────────────────────────────────────**

No fix written. On request, not by oversight.

* The INSERT path has no guard. Safe today only because no qualifying account
  exists.
* `delete-account` can create a qualifying account and does not ban it.
  `teardown.mjs` does.
* `on_auth_user_created` is not in version control.
* `signup_source` is an unauthenticated free-text field that grants a waived fee.
* `created_at` on `verification_requests` is member-writable and read by a
  permit.
  *(18 Sep: only reachable through approvals made outside `admin_decide_verification` — see the settled note above.)*
* `0040`'s own header (`:47-56`) already names the fix that closes the first
  item as a side effect: the column-level GRANT. Because a GRANT covers INSERT
  as well as UPDATE, that stopgap-to-real-fix path was always wider than the
  trigger it replaces.

**49. A DEFAULT NOBODY CHOSE, MEETING A FLOW WE DID — FOUND 14 Sep 2026,
CLOSED THE SAME DAY BY TURNING THE DEFAULT OFF.**

**What happened.** The £14.99 fee form went live on the web and offered four
payment methods: **Card, Klarna, Revolut Pay, Amazon Pay.** The subscription form
offered Card only. Nobody enabled any of them. Stripe's dashboard defaults them
on for one-off payments, and Elements renders whatever the account permits; a
recurring mandate supports fewer, which is why the two forms differed.

> **⚠️ CORRECTED 18 Sep 2026 — the reason the two forms differed was wrong.**
> It was not that a recurring mandate supports fewer methods.
> `create_subscription` sets `payment_settings.payment_method_types: ['card']`
> explicitly (`supabase/functions/stripe-payment/index.ts:190`), while
> `create_verification_intent` sets `automatic_payment_methods: { enabled: true }`
> (`:112`), which hands the choice to the dashboard. **So the subscription was
> card-only because the code said so; the fee followed the dashboard default
> because the code said that.** The finding stands. The explanation was an
> inference, written before either line was read.

**So buy-now-pay-later on a verification fee was live for a few hours**, and a
stylist could have entered a BNPL agreement with a third party over £14.99.

**⚠️ AND IT WOULD HAVE TAKEN MONEY WITHOUT RECORDING IT.** The three extra
methods are redirect-based. `PayForm` calls:

    stripe.confirmPayment({ elements, redirect: 'if_required' })

with **no `confirmParams.return_url`**, because the flow was designed never to
leave the page — that property is why Elements was chosen over Checkout. A
redirect method needs a return URL, and even with one there is **no return
handler**: nothing on the way back calls `confirm_verification`. And
`verification_payments` is written by that action and nothing else — no webhook
event touches it, unlike subscriptions.

**Money moves, no row.** That is precisely the defect mobile's subscribe flow was
fixed for in August, reached by a route neither of us wrote.

**✅ FIXED 14 Sep by turning the three methods off in Stripe. Card only, live
mode.** Not by code: the flow is correct for the path it was built for, and
today's real payment proved that path end to end.

**── THE CATEGORY, WHICH IS MICKY'S AND IS NEW TO THIS FILE ───────────**

*"A default we didn't choose, interacting with a flow we did."*

Every other finding in this file came from something someone wrote — a wrong
line, a stale comment, a check too narrow, a claim wider than its evidence. This
one has no author. Two correct-in-isolation facts met: Stripe's sensible default
of offering more ways to pay, and a deliberate decision that our flow never
leaves the page.

**The mitigation is not code. It is knowing which defaults are live.** No test
would have caught this, because there was nothing wrong to catch until the two
met — and no amount of care in either half would have prevented it.

**⚠️ WHICH MAKES THE OBVIOUS QUESTION: WHAT ELSE IS ON BY DEFAULT?** Nobody has
inventoried this, and at least one other instance is already sitting unresolved:
the `npm warn allow-scripts` notice on `sharp` and `unrs-resolver`, flagged
13 Sep and carried since. Whether install scripts run is a default nobody in this
project has chosen either way, and `sharp` is in the build path via
`opengraph-image`.

Others worth a look, none checked yet: Supabase's project-level settings (JWT
expiry, email confirmations, rate limits), Vercel's build and function defaults,
Next.js's own (image optimisation hosts, caching), and whatever else Stripe has
on that nobody has read — radar rules, receipt emails, statement descriptors.

**Decided, not inherited:** if those three methods are ever wanted back, it is
the work described above — a `return_url`, a return-handler route reading the
PaymentIntent status, and a way to record a payment that settles minutes later
— and its own decision, not a toggle.

**48. PAIRED IMPLEMENTATIONS THAT NEVER MEET — THREE FOUND IN ONE DAY,
14 Sep 2026. THE THIRD IS LOGGED HERE. NOT FIXED.**

**The third instance, and the one that names the pattern.** `site/lib/queries/
dashboard.ts:261` computes `hasActiveSubscription` from

    supabase.from('subscriptions').select('id')
      .eq('user_id', userId).eq('status', 'active').maybeSingle()

while `site/lib/verification.ts` exports a function of the SAME NAME, in the same
`lib/`, that applies the date check, grants on `past_due`, and reconciles against
Stripe when the row cannot settle it.

**Three definitions of "subscribed" in one app:**

| Where | What it means |
|---|---|
| `verification.ts` `hasActiveSubscription` | `active`/`cancelling` AND period in future; `past_due` grants; asks Stripe when uncertain |
| `apply_subscription_state` (0023/0024) | the canonical vocabulary both writers share |
| `dashboard.ts:261` | `status = 'active'` only — excludes `cancelling`, ignores the date, ignores `past_due` |

A member who cancelled but is paid until the 30th is `cancelling`: the real gate
grants, the orphan denies. **It would be wrong in both directions.**

**✅ The only reason it is not a live defect: NOTHING CONSUMES IT.** Declared on
the interface at line 64, set at 261, read by no component, page or route. So it
is a query run on every model dashboard load and thrown away — the same
work-with-no-consumer shape as item 43's N+1 — plus a name collision sitting in
wait.

**⚠️ CLAUDE'S CORRECTION, SAME DAY.** This was first reported as *"a live
billing-gate defect on the surface we just deployed"* that *"outranks the Stripe
build"*, from reading six lines of a 400-line file. Both halves were wrong: the
query does filter on status, and nothing reads it. Micky asked for it to be
investigated rather than assumed, which is what turned a reordering of the work
into a ten-minute read.

**── THE PATTERN, WHICH IS MICKY'S ─────────────────────────────────**

*"Something about this codebase produces paired implementations that never
meet."* Three in one day:

1. **`site/lib/verification.ts`** — a comment insisting no webhook exists, forty
   lines above a comment reasoning correctly about what the webhook writes. One
   file, arguing both ways (item 47).
2. **Two buttons called Verify** — users page vs verification queue, different
   effects, and the first leaves a request pending for ever (item 42).
3. **Two `hasActiveSubscription`s** — this item.

**And the sharper half, which is what makes it actionable: in all three the
second copy is a FOSSIL OF A CORRECT IDEA.** `status === 'active'` is precisely
what `verification.ts` says the gate USED to be before the over-grant fix. The
duplicate is not a wrong idea someone invented — it is the right idea from an
earlier date, left in place while the original moved on. That is why they read as
plausible and why nobody notices: **a fossil looks exactly like the thing it is a
copy of, minus the last correction.**

**What would catch it:** searching for the NAME before reusing it, and — for the
gate specifically — having one exported definition that the dashboard imports
rather than recomputes. The fix here is to delete the orphan and, if the dashboard
ever needs the answer, call `getGateState`.

**Not fixed, deliberately:** it is dead code, so removing it is safe but not
urgent, and it is better removed in the same change that adds the web
subscription surface — where someone will otherwise be tempted to wire it up.

**47. A JUSTIFICATION THAT OUTLIVED ITS REASON — "THERE IS NO WEBHOOK" SURVIVED
IN NINE PLACES FOR THREE WEEKS AFTER THE WEBHOOK WENT LIVE. FOUND AND CORRECTED
14 Sep 2026.**

> **── 18 Sep 2026: THE SAME PATTERN, FOR THE FEE — AND ONE COPY THAT CANNOT BE
> CORRECTED ──**
>
> The webhook began recording the £14.99 fee on 18 Sep (item 53). That made a
> second family of sentences false: *"`verification_payments` is written ONLY
> by confirm_verification — no webhook event touches it"*.
>
> * **Corrected, with the original quoted:** `site/app/(app)/verify/actions.ts`,
>   the fee section's header, and `site/app/(app)/verify/FeePanel.tsx`, its
>   header comment.
> * **⚠️ NOT CORRECTABLE: `supabase/migrations/0040_guard_self_writable_gates.sql:31-32`**
>   says the fee is *"inserted only by stripe-payment/index.ts:231 under the
>   service role"*. That is above 0040's `MIGRATION FOOTER` (line 487), so the
>   checksum covers it. Editing it would make the ledger read DRIFTED. **It
>   stays, and this is where the record says so.** Anyone reading 0040 should
>   treat those two lines as true on 10 Sep and false from 18 Sep.
>
> **And this time the stale reason is still driving code.** `confirmFeePayment`
> returns `pending: false`, and that choice was argued from the "no webhook"
> premise. By `PayForm`'s own contract (`site/components/PayForm.tsx:39-41`),
> `false` means "will not finish on its own", which is now untrue. A failed
> confirm tells the person "Payment taken, not set up" when the webhook will in
> fact finish it. It is safe, because both messages say do not pay again, but
> it is more alarming than the truth. **This is item 47's sharper half, again:
> not a stale comment beside correct code, but code whose reason has gone.**
> Left as it is, on instruction. It needs a decision, not a comment.

**What it is, and it is a new shape for this file.** Not a stale record of a
FACT — a stale record of a REASON. The code was right; the reasoning printed
beside it was wrong; and anyone reading it concluded the webhook did not exist.
Which is exactly what Claude concluded on 14 Sep, from `subscribe.tsx:109`,
about ninety minutes before establishing the opposite.

**The truth, established from four sides:** the webhook went live 25 Aug 2026,
the function was deployed 31 Aug, the Stripe endpoint `cavy-subscriptions` is
ACTIVE on five events with a signing secret, and `stripe-webhook.md` records a
panel reading *"4 events in the last 7 days · last `invoice.payment_succeeded`"*.
It has processed real renewals. (This week shows 0 deliveries — because nobody
has subscribed since 8 Sep, not because it is idle. Those two facts were briefly
allowed to sit together as if they meant the same thing.)

**Where it survived — nine claims across six files:**

| File | What it asserted |
|---|---|
| `mobile/src/app/(app)/subscribe.tsx:109` | *"There is no webhook, and there never was"* |
| `supabase/functions/stripe-payment/index.ts:438` | the swallow, in the present tense |
| `supabase/functions/stripe-payment/index.ts:605` | `current_period_end` written only at initial subscribe |
| `site/lib/verification.ts:43` | the same, as the reason the gate asks Stripe |
| `subscription-state-reconcile.md:93, :104` | the same, twice |
| `mobile/cavy-handover.md:217` | *"no webhook exists"* |
| `audit-records-vs-reality.md:86, :95` | the same, twice |

**⚠️ AND FOUR OF THEM WERE LOAD-BEARING, NOT ASIDES.** They read: *"There is no
webhook, so `current_period_end` is written only by `confirm_subscription` at
initial subscribe. Stripe renews; our row does not move. Someone who subscribed
in January still shows a February end date in April while paying every month."*

**Every sentence after the first is now false.** The webhook's
`invoice.payment_succeeded` handler RETRIEVES the subscription — deliberately not
trusting the invoice period, *"because on a renewal the invoice line period and
the subscription period can differ by proration, and the gates read
current_period_end"* — and writes the fresh period through
`apply_subscription_state`'s `p_period_end`. Confirmed three ways: the handler,
the RPC signature in `0024`, and `stripe-webhook.md`'s own table. **The row moves
every month.**

**✅ ALL NINE CORRECTED 14 Sep.** Code comments rewritten to state what is true;
durable records given dated correction notes with the original kept visible, the
same treatment as items 37 and 41.

**⚠️ THE SHARPER HALF: THE CORRECTION WAS ALREADY IN THE REPO, IN THE FILE BEING
DISTRUSTED.** `mobile/notes.md:102` has read *"✅ ~~No Stripe webhook~~ — built and
live since 25 Aug 2026"* since the day it was built, and even records the cost of
the gap: *"three subscriptions billed for a month while our own table showed them
lapsed."*

Fifty lines above it sits `notes.md:52` — and BOTH `subscription-state-reconcile.md`
and the `stripe-payment` comment explain, carefully and correctly, why they were
right not to trust `notes.md:52`. **Two documents reasoned about the
unreliability of one line in a file, above a line in the same file that would
have settled the question.** The correction landed in one place and was consulted
in another.

**What generalises:** this file already had *a count is not a reading* and *the
record contained its own refutation*. This is the third in that family and the
most uncomfortable: **the record contained its own correction, and the people
citing that record cited the wrong line of it.** A correction is only worth what
its findability is worth, and "it is written down" says nothing about whether it
is written down where anyone will look.

**⚠️ ONE LIVE QUESTION THIS OPENS, LOGGED RATHER THAN ANSWERED.**
`hasActiveSubscription` (both clients) asks Stripe when its own row looks lapsed,
and the justification was that rows could not self-update. **They now can.** What
the reconcile still covers is genuinely narrower: an event Stripe never
delivered, one the webhook filed as `failed`, or a customer it could not
attribute to a user. Whether that justifies the same design, or whether the gate
should now trust the row and treat a Stripe call as the exception, is a real
decision about live billing — and it must not be settled by editing a comment,
which is how the old reasoning got there.

**46. THE HOMEPAGE SAYS "LAUNCHING SOON" ABOVE A WORKING PRODUCT — LOGGED
14 Sep 2026. NOT A DEFECT. NOT URGENT.**

The hero reads **"LAUNCHING SOON IN THE UK"**. The header, top right, offers
**Sign in** — which works, and lands on a dashboard. Both are true statements
about different things, on the same screen, to the same visitor.

**The mechanism is correct.** `PUBLIC_SITE_MODE=preview` was set when there was
nothing behind that sign-in, and `lib/site.ts` gates three things on it together:
`robots.ts` disallows everything, `sitemap.ts` returns `[]`, and the root layout
emits `noindex, nofollow`. All of that is still right — `public_stylists` has no
inventory worth indexing, and `site/README.md` gates the flip on inventory rather
than on the domain resolving.

**It is the shape this file keeps finding: a correct mechanism describing a
condition that moved.** The copy stopped being true at 20:14 on 14 Sep, when five
weeks of member area reached production in one deploy.

**Logged so the flip is ONE decision with both halves in it** — the value and the
words — rather than a value change that leaves the copy behind. The README's
condition for flipping (real published stylists clearing the content bar) is
unchanged and is still the right gate.

**45. THE CI CHECK COULD NOT SEE THE FAILURE THAT BLOCKED PRODUCTION FOR FIVE
WEEKS — FOUND 14 Sep 2026. ✅ FIXED THE SAME DAY.**

> **⚠️ CORRECTED 18 Sep 2026 — see item 51. "FOR FIVE WEEKS" IS WRONG.** The
> failure blocked production for **six days**, 8–14 Sep. Production was five
> weeks old because nothing was pushed between 10 Aug and 8 Sep, according to
> the `origin/main` reflog and Vercel's deployment list. The body below is
> right: *"Every Vercel build since errored"* counts from the 8 Sep commit. The
> title is left as written.

**What happened.** A duplicate `let hiddenByBlock = false` on consecutive lines of
`site/lib/queries/dashboard.ts`, written by an edit script on 8 Sep. Turbopack
refuses it. Every Vercel build since errored; `cavybeauty.com` served the 10
August build until 14 Sep. `/shop` returning 404 in production while `/dashboard`
redirected correctly was the tell that unravelled it.

**⚠️ GITHUB WAS GREEN THROUGHOUT, AND COULD NOT HAVE BEEN ANYTHING ELSE.**
`site.yml` ran `npm run checks` — `eslint --max-warnings=0` plus three custom
scripts that read source as TEXT. **None of them compiles.** A duplicate
declaration is a compiler error, so the workflow was not unlucky: it was
structurally incapable of seeing this class, and it reported success on a branch
that could not build.

**And `site` was the only one of the three apps exposed.** `admin` and `mobile`
both run `eslint . --max-warnings=0 && tsc --noEmit` — confirmed by reading their
`package.json`, not recalled. `site` omits `tsc` DELIBERATELY, and its README
gives the reason: *"Type errors are already build-blocking: `next build`
type-checks."* **True for a deploy. False for CI, which never built.** The one app
that delegated type-checking to its build is the one whose CI could not
type-check.

**Micky's framing, 14 Sep, and it is sharper than item 28's:** *a signal you watch
can hide a signal you don't, when the watched one is narrower than the thing it
appears to certify.* Item 28 warned that "CI is wired" must not be read as
"commits are checked". This is one layer deeper: the check ran, passed honestly,
and its green tick is what made two red Vercel builds easy to skip past.

**THE COST ARGUMENT DID NOT EXIST, WHICH IS HALF THE LESSON.** Measured before
deciding:

    npm run checks   15s   exit 0   does NOT catch it
    next build       30s   exit 0   catches it

I had been weighing "the expensive option" against a cheap one. The thing that
reproduces Vercel costs thirty seconds. **✅ `site.yml` now runs both as two named
steps** so the UI says which half failed, with `SUPABASE_URL` and
`SUPABASE_ANON_KEY` from repository Variables — `supabase-public.ts` throws at
import without them and the six treatment pages are statically generated — and
`PUBLIC_SITE_MODE` pinned to `preview`.

**Still true, and unchanged:** this remains a SIGNAL, not a gate. It runs after
the commit is on `main`. It would have told us on 8 Sep; it would not have
stopped the commit.

**44. A MODEL'S INSTAGRAM HANDLE IS SHOWN TO ANY SIGNED-IN STYLIST — FOUND
13 Sep 2026. MEMBERS-ONLY, NOT OPEN WEB. NOT FIXED.**

**What happens.** A model sets her Instagram handle on her own profile
(`mobile/src/app/(app)/model-profile.tsx:680`). It is then rendered to any
signed-in viewer of that profile as a tappable link to `instagram.com/<handle>`
(`mobile/src/app/(app)/model/[id].tsx:501`; also selected by
`site/lib/queries/model.ts:90`).

**Read from the database, 13 Sep:**

    public_profiles    id, first_name, last_initial, profile_pic_url, instagram_handle
    public_stylists    — no instagram_handle at all

    anon can select:   public_profiles           FALSE
                       public_stylists           true
                       public_stylist_status     true
                       public_categories         true
                       public_stylist_portfolio  false
                       public_stylist_reviews    false

**So it was never an open-web leak.** `public_profiles` is unreachable by `anon`
— the revoke from the §7 preflight held. Members-only, which is materially
smaller than scrapeable.

**⚠️ DIRECTION CORRECTION.** The decision was first written as *"remove
instagram_handle from stylist profiles"*. It is not on stylist profiles:
`public_stylists` does not carry the column and no code reads it for a provider.
The flow is **model → stylist**. Recorded as a correction rather than quietly
fixed, because the removal would otherwise have been the right change made for a
stated reason that was backwards — and the stated reason is what the next person
reads.

**And the corrected direction is the worse one** (Micky, 13 Sep): the stylist is
the party with a financial reason to move a booking off-platform, and the model
is the one handing over a contact route — before any booking, to a stranger she
has not met, on a platform whose safety argument is that contact stays inside it
until she chooses otherwise.

**⚠️ SCOPE — THREE PARTS, OR IT IS NOT DONE.** Removing the DISPLAY while leaving
the FIELD gives a column models keep filling that nothing renders: **a writer
with no reader**, the inversion of the read-with-no-writer family this file has
found four times.

  1. **The display** — `model/[id].tsx:501` and `site/lib/queries/model.ts`.
  2. **The setter** — `model-profile.tsx:680` and its input.
  3. **The column** out of `public_profiles`, and a decision on
     `users.instagram_handle` itself: dropped, or kept with a comment saying
     nothing reads it and why.

**Not settled here:** whether a model should have ANY way to publish a contact
route. That is the same question as the banned-words list's second category
(item 17), and the two answers have to agree — there is no point screening
status posts for handles while a profile field publishes one directly.

**43. THE USERS CONSOLE FIRES THREE COUNTING QUERIES PER ROW — MEASURED
13 Sep 2026. NOT FIXED.**

**What it does.** `admin/app/users/page.tsx` loads every user, then inside a
`Promise.all` over the rows counts, per user: `sessions`, `reports` and
`verification_payments`. Three round trips per row, on every load, before the
table renders.

**Measured in the browser rather than inferred from the code:**

    unfiltered /users    202 requests · 2.32s to finish · DOMContentLoaded 897ms
    ~58 accounts         verification_payments / sessions / reports, cycling in
                         threes, every one from fetch.ts:17

**⚠️ WHAT IS MEASURED, AND WHAT IS NOT.** The PATTERN is measured: the waterfall
shows 202 requests with the right names in the right repeating order, which is
the N+1 itself rather than arithmetic about it. **The causal share is not
measured.** 2.32s may have other contributors and they have not been isolated,
so "the page is slow because of this" is not yet established — only that this is
present, large, and the obvious candidate.

**The filtered comparison was not obtained.** Changing the role dropdown does not
trigger a navigation, so the network panel kept counting across loads: 292
requests and 27.93s cumulative, which measures nothing. Recorded as NOT OBTAINED
rather than read as a result, because a dirty number that points the right way is
still the thing this file keeps catching.

**Why it is worth fixing independent of the share:** it scales with the account
list. 58 accounts cost 202 requests; 500 would cost about 1,500, on the page an
admin opens to find somebody. The counts are also decorative in the common case
— they populate three columns nobody filters or sorts on.

**The fix, when it comes, is one round trip:** a single SQL function returning
`user_id, session_count, report_count, fee_paid` for the page's rows, the way
`report_subject_history` already does for the reports queue. Not atomicity, not
item 27 or 29 — this is the first performance item in the file, and it is a
different failure class from everything around it: nothing here is untrue,
nothing fails silently, and no check is looking at the wrong thing. It is simply
slow, and it gets slower in exactly the direction the product is meant to grow.

**Found by Micky using the console, not by any test** — like the CHILD SAFETY
badge and the two Verify buttons. Three of this file's findings in two days came
from someone operating the product rather than reading it.

**42. TWO BUTTONS CALLED VERIFY, ON TWO PAGES, DOING DIFFERENT THINGS — FOUND
12 Sep 2026. NOT FIXED.**

**What happened:** Micky went to approve a verification request, clicked
**Verify** on the USERS page instead of **Approve** in the verification queue,
and reported the result as a failure — nothing had moved. Nothing was broken. He
was on the other surface.

| Surface | Button | What it does | What it leaves |
|---|---|---|---|
| `admin/users` | **Verify** | sets `users.is_verified`, and since 0039 reports what happened to the shops | any pending verification request **still pending** |
| `admin/verification` | **Approve** | decides the REQUEST: verifies, publishes where eligible, closes the request with a reviewer | nothing outstanding |

**Both are correct in isolation, and that is the point.** The collision is the
word and the residue: the users-page button leaves a request sitting in the
queue for an account that is already verified, and nothing links the two
surfaces or says so. Approving that stale request later is harmless — it lands
in the `already_verified` branch — but only because 0039 added one.

**It took someone who wrote the console to hit it**, which is the part worth
recording. This is not a case of an unfamiliar user guessing wrong.

**Not fixed, and the fix is a naming decision rather than code:** either the
users-page action says what it is ("Mark verified" / "Verify identity without a
request"), or it offers to close any pending request at the same time, or the
queue is the only place verification can be granted. Third option is the
smallest product, first is the smallest change.

**41. ⚠️ CORRECTED 13 Sep 2026 — THE MISLEADING INSTRUCTION WAS IN SIX FILES,
ALL WRITTEN BY CLAUDE IN THIS SESSION, NOT IN FORTY. ✅ SWEPT AND CLOSED.**

**What is true.** The 34 files `0001`–`0034` never mention `--stamp` at all.
Their block names only the status report, and *"Apply, verify, THEN run this"* is
correct advice about that report. The six files that put `--stamp` inside a block
headed "LAST STEP, EVERY TIME" are `0035`–`0040` — every one written by Claude
between 10 and 11 Sep 2026, each copied forward from the last. `0000`, the
framework's own documentation, already described the intended flow: *"Write the
file, commit it, paste it into the SQL editor"*, with the checksum in the file
before it reaches the editor. **The framework was coherent the whole time.**

**So the sequence was:** Claude wrote the misleading block, copied it into six
files, followed it on `0040`, got a DRIFTED ledger, and recorded the framework as
the cause — in an item blaming forty files for a defect five days old and
entirely its own.

**⚠️ THREE THINGS MAKE THIS WORSE THAN AN ORDINARY WRONG CONCLUSION** (Micky,
13 Sep):

1. **The record contained its own refutation.** The original write-up says, in
   plain words, *"the other 38 were counted, not read."* It was correct, it was
   visible, and it was acted on anyway.
2. **Both files read were its own.** A sample of two that shared an author,
   generalised to forty. `git log` would have said so.
3. **The count did the work of evidence.** *"40 of 41 files carry that block"* is
   a TRUE sentence that sounds like a finding. Its accuracy is what made it
   persuasive, and 38 of the forty were never opened.

**THE RULE, IN THE FORM THE TRAP ACTUALLY TAKES: A COUNT IS NOT A READING.**
"40 of 41 files carry X" tells you about forty files only if you opened forty.
The trap is not carelessness — the count was accurate. It is that an accurate
count reads like evidence about the things counted, when it is only evidence
about how many of them there are.

**⚠️ AND THE HARD QUESTION, BECAUSE "ADD A CAVEAT" DEMONSTRABLY DID NOT WORK.**
The caveat was present, correct, and inert. Two things would have stopped it:

* **Naming the sample in the HEADLINE rather than the body.** The item was titled
  *"THE MIGRATION FOOTER TELLS YOU TO STAMP LAST"* — a claim about forty files.
  Had the title been forced to read *"two files I wrote tell you to stamp last"*,
  the overreach would have been visible where the item is read from, not buried
  four paragraphs down where it was.
* **Treating a cheap caveat as a TRIGGER, not a disclosure.** Closing this gap
  cost one command:

      grep -c -- "--stamp" supabase/migrations/*.sql

  It returns 6 of 41. **When the gap can be closed for the price of one command,
  writing it down as a limitation is not an acceptable substitute for closing
  it.** A caveat is for what cannot be checked now. This could.

**Ninth instance of the pattern, and the first where the unexamined majority was
innocent.** Every previous instance found a defect WIDER than the check that
found it. This one invented a defect in files that did not have it — the same
error running in the opposite direction.

**What was right, and is unchanged:** stamping after applying does produce a
DRIFTED ledger; `0040` was applied that way and needed a reconcile by hand; the
reversed order is proven by `0041` applying clean, with no drift and no
reconcile. The fix is real. The diagnosis of where the instruction came from was
not.

**✅ SWEPT 13 Sep 2026 — FOR A DIFFERENT REASON THAN THE ORIGINAL RECORDED.** The
older blocks are SILENT on stamping, not wrong about it, so a migration written
by copying the nearest file gets applied unstamped and its ledger row reads
DRIFTED for ever after. **Adding the missing step is the fix**; correcting a
misleading order never was, because outside those six files there was no
misleading order.

All 41 files carrying an instruction block now hold the same accurate one, and it
keeps what the old variants were right about — the status report, the `0009`
story (written, committed, never applied, found by eye), and the service-role key
— rather than deleting real content to make room for a correction about Claude's
own mistake.

**`0000` was deliberately NOT touched.** Its only mention of this sits in the file
header, ABOVE the `-- MIGRATION FOOTER` line, where the checksum covers it.
Editing it would have caused exactly the drift this item is about.

**Proof the sweep was safe, measured rather than asserted:** every body checksum
in the directory recomputed before and after — 42 files, none moved — then
confirmed independently by `migration-status.mjs` reading the database: 42
applied, nothing drifted. The tool computes those checksums its own way, which is
the point of checking with it rather than with the script that did the editing.

*The original write-up, kept as it was:*

**41. THE MIGRATION FOOTER TELLS YOU TO STAMP LAST, AND STAMPING LAST IS WHAT
MAKES THE LEDGER READ DRIFTED — FOUND 11 Sep 2026. NOT FIXED.**

**What happens:** apply a migration while its footer still says
`PENDING_CHECKSUM`, and that literal string is what the database records. Stamp
afterwards and the file holds a real checksum the ledger will never match.
`migration-status.mjs` then reports **DRIFTED — file changed since it was
applied**, which is the one status meaning "the repo looks authoritative and is
wrong". On 0040 it was false: the checksum covers everything ABOVE the footer and
stamping only rewrites the footer line, so the applied body and the committed body
were byte-identical. Verified by recomputing rather than by re-applying —
`858df98d…` from the working file, from the commit that was applied, and from the
stamp itself. Three ways, one answer.

**Where the instruction points the wrong way.** Every migration ends with:

    -- LAST STEP, EVERY TIME
    --   node scripts/migration-status.mjs --stamp
    --   node scripts/migration-status.mjs

It sits below the VERIFY section, so reading a file top to bottom means apply,
verify, then stamp. The tool says the opposite in the line it prints while
stamping: *"Commit, then paste into the SQL editor."*

**Scope, as narrow as the check:** 40 of the 41 migration files carry that block.
Two were read in full (0038, 0040) and neither says when to apply relative to
stamping. The other 38 were counted, not read.

**⚠️ CORRECTION — Claude's.** The 0040 handover said *"Apply 0040, then stamp
it"*, following the file's order rather than the tool's, and that is what put
`PENDING_CHECKSUM` into the ledger. The framework behaved exactly as written; the
writing pointed the wrong way and I repeated it.

**The reconcile, for this class only:** set the recorded checksum to the file's,
once the BODY is established as unchanged — which is the whole question, and is
answerable by recomputing. **Re-applying to fix a bookkeeping mismatch would run
the side effects twice**, which for 0040 means repeating the Jojo B repair and the
policy drops.

**Not fixed:** the block is in 40 files, and it sits BELOW the footer, so it can
be corrected without causing real drift — but it is a 40-file sweep and is logged
rather than done mid-flight. Same family as item 36: **an instruction, committed
and followed, that produces the failure it exists to prevent.**

**40. ANY SIGNED-IN USER COULD VERIFY THEMSELVES — THE IDENTITY GATE THE WHOLE
PLATFORM RESTS ON WAS WRITABLE BY THE PERSON IT CHECKS. FOUND 10 Sep 2026.
✅ CLOSED 11 Sep 2026 BY 0040. THE MOST SERIOUS FINDING IN THIS FILE.**

**Closed on evidence, 11 Sep — five blocks, and the two that could have gone
wrong quietly are B and the control in A:**

    A  all seven columns refuse a real change, and the self-approved insert refuses
    B  every legitimate path still works: own photo, coordinates, Instagram
       handle, submitting a request, deleting your own to resubmit — no false
       refusals, so "no convenience exceptions" cost nothing
    C  the permit and its boundary: a member claiming an ADMIN-approved
       verification succeeds; the same with the request rejected is refused
    D  Jojo B republished — see item 29
    E  three RESTRICTIVE denies per money table, alongside the SELECT policies

**⚠️ THE FIRST BLOCK A REPORTED TWO OF SEVEN AS STILL OPEN, AND WAS WRONG.**
`provider_fee_waived` and `fraud_flagged` came back writable. Neither was: the
block reused the probe that FOUND the hole, which wrote absolute values, and the
account already held both (`fee_waived=t`, `fraud=f` — printed by the corrected
block). Writing a column the value it already has changes nothing, so the trigger
had nothing to refuse.

**That is worth more than the bug it did not find.** The probe was written against
privileges and RLS, which do not look at VALUES — so writing a column its own
value still proves the column is in the caller's writable set, which is exactly
what it was for. The same text, reused against a trigger, measures nothing,
because a trigger compares old to new. **The test was valid before 0040 and
invalid after it, with its text unchanged: what it measured moved underneath it.**
Micky's framing, and it is the eighth instance of this file's oldest pattern.
The corrected block flips booleans with `not`, moves `subscription_status` and
`role` to values they cannot already hold, prints the BEFORE state, and carries a
no-op control asserting that writing an unchanged column is STILL permitted —
because a guard that refused that would break ordinary profile saves.

**Device check, 11 Sep — one of two, and the record says which.**

* **subscriptions read: CONFIRMED.** A comped account on mobile Settings shows
  "Complimentary" and no Cancel row — state resolving through the new RESTRICTIVE
  denies, and a correct ABSENCE rather than a blank or an error.
* **verification_payments read: NOT CONFIRMED.** Every account to hand is already
  verified, so the verify screen shows the verified state and the fee question
  sits behind it. Exercising it needs an unverified provider.

**Risk is low and that is not the same as having looked** (Micky, 11 Sep): Block B
proved `provider_fee_waived` is readable and the denies are write-only, so the
read path has no reason to have changed. Recorded as unconfirmed anyway, because
"probably fine" is what this file exists to stop being written down as fine.

**What remains, in the order Micky set it:** the console repoint to 0039's
functions, then `claim_model_verification()` with the `verify-payment.tsx:119`
line, then the column GRANT that makes 0040's triggers redundant. **0040 is a
stopgap and says so in both function comments.** It is not removed when the GRANT
lands; it simply stops mattering.

**Plainly:** a model is told a stylist's identity has been checked before she is
alone with a stranger in her home. Any account can set its own `users.is_verified`
to true with a single API call — no admin, no selfie, no request. The check the
safety promise rests on can be switched on by the person being checked.

**Proven, not reasoned — rolled back, 10 Sep:**

    is_admin = false · rows changed by the user themselves = 1 · is_verified false -> true

Run as the provider test account against its OWN row, as role `authenticated`.

**The cause.** `users` has two permissive UPDATE policies (schema snapshot
2026-08-08): *"admins update any user"* (`is_admin()`) and *"users can update own
row"* (`auth.uid() = id`). **The second has no column restriction, and RLS cannot
impose one** — column-level control in Postgres is a GRANT, not a policy. There is
no `revoke update (…)` on `users` and no guard trigger on `is_verified` anywhere in
the repo. So "update your own row" means every column of it.

**⚠️ Almost certainly not just `is_verified`.** The same policy governs every
column, so these are presumed writable by their owner and each is a real bypass —
being confirmed by probe before this is stated as fact:

| Column | What self-writing it grants |
|---|---|
| `is_verified` | the identity gate — confirmed |
| `subscription_status` | the £4.99/mo model features, free |
| `subscription_waived` | same, by the other door |
| `provider_fee_waived` | the £14.99 provider verification, free |
| `is_founding_provider` | Founding Provider status, unearned |
| `fraud_flagged` | a flagged account clears its own fraud flag |
| `role` | model/provider/both, self-assigned |

**And a provider who self-verifies is auto-published.** `is_verified` false→true
fires `trg_user_verified_maybe_publish` → `publish_provider_if_eligible`, so a
provider with a name and one treatment goes live on the open shop with no human
ever seeing them. The two feed each other.

**✅ ALL SEVEN CONFIRMED, 10 Sep, one rolled-back probe as the provider test
account:** `is_verified`, `is_founding_provider`, `provider_fee_waived`,
`subscription_waived`, `subscription_status`, `fraud_flagged` and `role` — every
one returned `1 row(s)`. Nothing is presumed any more.

**── THE SHAPE OF IT: THE MONEY IS SOUND, THE FLAGS ARE NOT ──**

Traced across all three apps and the edge functions, 10 Sep. Every gate is
**recorded** server-side and **read** from a self-writable flag:

| Gate | Where the evidence is written | What the gate actually reads |
|---|---|---|
| Provider £14.99 | `verification_payments`, inserted only by `stripe-payment/index.ts:231` with the service role — no client writes it | `paid \|\| is_founding_provider \|\| provider_fee_waived` (`verify-payment.tsx`) — two of the three self-writable |
| Model £4.99/mo | `subscriptions` + `users.subscription_status` via `apply_subscription_state` / the Stripe edge functions — no client writes either | `subscription_status`, `subscription_waived` — both self-writable |
| Identity | `verification_requests`, approved by an admin in the console | `users.is_verified` — self-writable |

**So the payment paths themselves are not the hole** — they were audited and fixed
in `7a898fb` (`security-lockdown-handover.md:123`), and a client cannot fake a
payment row. The hole is that **nothing reads the evidence; everything reads a
derived flag, and the flags are writable by the person they describe.** Fixing
Stripe would not have touched this, and no amount of care in the payment code
could.

**⚠️ AND THE APPROVAL ROW IS SELF-WRITABLE TOO — which changes the fix.**
`verification_requests` carries `vr_user_policy`: PERMISSIVE, **ALL commands**,
`auth.uid() = user_id` in both USING and WITH CHECK. `status` has **no CHECK
constraint** (constraints dump, 10 Sep: PK and FKs only). So a user can update
their own request to `status = 'approved'`, or insert one that way, and can write
`reviewed_by` and `reviewed_by_source` while they are at it.

**✅ PROBED 11 Sep. BOTH ROUTES WERE OPEN, AND THE SECOND WAS WORSE THAN ONE ROW.**
Inserting an already-`approved` row: **1 row**. Updating existing rows to
`approved` with `reviewed_by_source` filled so 0037's paired CHECK is satisfied:
**2 rows** — every request that account had, flipped in one statement. The route
that looked closed on 10 Sep was closed by a constraint written for provenance,
not for authorisation, and it stopped being a block the moment the forger filled
in the column it cares about. **A protection that works for a reason nobody chose
is not a protection; it is a coincidence with a deadline.**

**One result in that probe holds for the right reason:** the `settings` write
returned 0 rows against a key that exists (`founding_provider_limit`), refused by
`settings_write_admin`, an admin-only policy for ALL commands. A rule saying no,
rather than an accident.

So:

**No server-side re-check of "this user has an approved request" is worth
anything**, because the user wrote the row. That kills the obvious permit — the
one legitimate model self-write at `verify-payment.tsx:119` cannot be
distinguished from a forged one by any test the database can run on that row.
The consequence, and it is Micky's own question answered against the convenient
option: **the RPC belongs in the stopgap, not at step 3**, and the stopgap has to
guard `verification_requests` as well as `users`.

**── THE FIX HAS AN APP CHANGE IN IT, AND THAT IS THE WHOLE DIFFICULTY ──**

The right lockdown is column-level: `revoke update on public.users from
authenticated`, then `grant update (profile_pic_url, date_of_birth,
instagram_handle, latitude, longitude)` — the only columns a user's own session
legitimately writes (swept across all three apps, 10 Sep). But:

* **A GRANT is role-wide.** Revoking table UPDATE from `authenticated` also blocks
  the admin console, whose `is_verified`/`fraud_flagged`/`waive`/`comp` writes are
  ordinary `authenticated` updates gated only by the admin RLS policy. Those writes
  must move to the 0039 SECURITY DEFINER functions first — which is exactly why
  0039's RLS lockdown was scoped to AFTER the console is repointed. This is the
  same lockdown, now urgent, and reaching `users` as well as `suspensions` and
  `admin_audit_log`.
* **One legitimate client self-write of `is_verified` exists and must not break:**
  `mobile/src/app/(app)/verify-payment.tsx:119`, the model auto-verify after an
  approved request. It has to move into a SECURITY DEFINER RPC — e.g.
  `claim_model_verification()` that sets `is_verified` for `auth.uid()` only when
  that user is a model WITH an approved `verification_requests` row — or the column
  cannot be locked. This self-write being indistinguishable from the attack is why
  the hole was invisible: the product depends on the very write it must forbid.

**Sequence, once the probe fixes scope:**
  1. `claim_model_verification()` RPC; repoint verify-payment.tsx:119 to it.
  2. Repoint the admin console to 0039's functions (all five surfaces at once).
  3. THEN one migration: `revoke update on users`, grant back the five safe
     columns, and lock `suspensions` + `admin_audit_log` in the same file.

**⚠️ A same-day stopgap is possible if the window between now and step 3 is too
long:** a `BEFORE UPDATE` guard trigger on `users` that raises when a non-admin
changes any protected column on any row — permitting `is_admin()` (console) and
the one model case (own row, role model, an approved request exists). It puts
business logic in a trigger, which the column GRANT then makes redundant, but it
closes the hole without waiting for two app changes. Decision to be taken on the
probe result and on how soon steps 1–2 can land.

**How it was found:** not by anything failing. By reading `revoke_verification`'s
own aftermath — Jojo B verified-but-hidden — asking what set her `is_verified`
back, ruling the console verify page out, and testing whether a user could do it
themselves. The same reading pass that closed a three-day-old regression opened
the most serious finding in the file. **A promise with no mechanism does not throw;
neither does a gate anyone can open. Both are found only by looking.**

**39. PUSH HAS SEVEN POINTS WHERE IT CAN FAIL WITHOUT SAYING SO, SO "NO TOKEN"
CANNOT BE TOLD APART FROM "PUSH HAS NEVER WORKED" — LOGGED 10 Sep 2026. OPEN.**

**What prompted it.** The first push after the item 36 rotation returned
`200 {"sent":0}`. The response before it in `net._http_response` was the 03:15
selfie purge, so nothing had called `send-push` for about fifteen hours (03:15 to
18:29; described at the time as eighteen). Micky's question: genuinely quiet, or
push failing silently for longer than tonight — the difference between "no
users" and "push has never worked".

**What `{"sent":0}` can mean, read from `supabase/functions/send-push/index.ts`.**
Exactly two things: the recipient has no rows in `push_tokens`, **or the token
lookup failed** — its error is discarded and an empty result is treated as no
tokens. (Tokens that exist but are all dead return `{"sent":0,"pruned":N}`; verify
B's response had no `pruned`, so it is one of the two.) "No token registered for
that recipient" is therefore one of two readings, not yet established.

**And `sent` over-reports.** It counts every token Expo did not mark
`DeviceNotRegistered`, including tickets that came back as errors for any other
reason — missing FCM credentials among them. A `{"sent":1}` would not prove a
phone received anything.

**Five more on the phone.** `usePushRegistration(session?.user?.id)` runs in
`AppEntry` on every sign-in, so registration is wired. But `registerToken` in
`mobile/src/lib/push.ts` has five ways to do nothing, each indistinguishable from
success with nothing to do:

| # | Exit | What would land there |
|---|---|---|
| 1 | `if (!Device.isDevice) return` | an emulator |
| 2 | permission not granted → `return` | declined, including Android 13+ notification permission |
| 3 | `getExpoPushTokenAsync` throws → `catch { return }` | a build without the native module, broken FCM config |
| 4 | the `push_tokens` upsert result is discarded | an RLS refusal or a rejected row — already one of item 27's remaining mobile sites |
| 5 | `registerToken(userId).catch(() => {})` | anything else |

No log line, no state, nothing on screen. **A device that cannot receive pushes
looks exactly like a device that has none to receive** — the signature this file
keeps finding, on the one feature whose purpose is to reach someone who is not
looking at the app.

**⚠️ A lead, from the code and the policy as WRITTEN in `push-setup.sql` — the live
policy has not been read: one phone, several accounts.** The upsert is
`onConflict: 'token'`, and the policy is `for all using (user_id = auth.uid())`.
When the token row already belongs to the previously signed-in account, Postgres
checks the existing row against that policy and refuses the update with an error
— which exit 4 discards. The comment above the upsert says it *"moves it to the
current user"*; under that policy it cannot. `clearPushToken` on sign-out avoids
this only when it runs and its delete succeeds, and its failure is swallowed too.
If this holds, the token stays with whichever account registered it first, and
every other account signed in on that phone gets `{"sent":0}` — which is exactly
how test accounts get used.

**Two cautions on the quiet hours, before reading anything into them:**

* `pg_net` deletes old rows from `net._http_response` after `pg_net.ttl`. An empty
  stretch there is evidence of nothing firing only if rows from before the stretch
  survive. The 03:15 row did survive to 18:29; the setting is read, not assumed.
* `tg_message_push` skips when a session has no model or the recipient is the
  sender, so not every message calls `send-push`. `tg_notify_push` calls it for
  every notification.

**── 10 Sep, EVENING: BOTH `{"sent":0}` RESPONSES EXPLAINED ──**

* `push_tokens` holds 2 rows, both Android, both for `micky.buckfield@hotmail.co.uk`
  — the model test account, and the only account signed in on Micky's phone. The
  18:29 push went to "Mod" (a new message) and the 18:31 push to "Micky B stylist"
  (an application). **Neither recipient has a token, so `{"sent":0}` was the right
  answer both times.** That phone has shown Cavy notifications before and they are
  allowed in Android settings. Nothing here shows push broken.
* **The live policy is as written:** `push_tokens_own`, ALL to `authenticated`,
  using and check `user_id = auth.uid()`. So a second account on the same phone
  really cannot take over the token row, and exit 4 would swallow the refusal. A
  real mechanism — and not what happened tonight.

**⚠️ The quiet-hours question cannot be answered from `net._http_response` in
either direction.** Read 10 Sep: `pg_net.ttl` is `6 hours`; 2 rows kept
(18:29:49 to 18:31:57); 0 requests queued; 1 notification and 0 messages inserted
since the oldest kept row. But the 03:15 row was present when verify B ran at about
18:29 — fifteen hours old against a six-hour TTL — and gone by the later query. So
rows are not removed on a clock. During a quiet stretch the table can hold rows
older than the TTL, and after activity it holds none. "No push fired for eighteen
hours" was not supported by the table, and neither is "the TTL explains the gap".
`notifications` and `messages` can answer it; the response table cannot.

**Still open, unchanged by the above:** `send-push` discards the token-lookup error
and reports `{"sent":0}` either way; `sent` counts Expo acceptances, not
deliveries; the five exits on the phone; the shared-device refusal.

**Not fixed.** Which point is failing decides the fix — a declined permission is a
UI change, a throwing token fetch is a build or FCM problem, a refused upsert is a
policy change plus item 27's `mustWrite`, and `send-push`'s two are server-side —
so the data comes first. Requested 10 Sep: token rows per account, the live
`push_tokens` policies, `pg_net.ttl` and the retained window, response breakdown,
inserts in that window, and which account the 18:29 test went to.

**38. THE SITE'S SUPABASE SETTINGS EXIST UNDER TWO NAMES EACH — LOGGED
10 Sep 2026. NOT FIXED.**

Four variables for two things, in both environments:

| Thing | Server name | Browser name |
|---|---|---|
| Project URL | `SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| Public API key | `SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

**Locally the pattern is already contained.** `site/.env.local` writes each browser
name as a reference to the server name (`$SUPABASE_URL`, `$SUPABASE_ANON_KEY`), so
each pair has one real value and cannot drift.

**On Vercel it is not.** Vercel stores every variable as an independent value, and
the two copies already differ in FORMAT:

* production's `NEXT_PUBLIC_SUPABASE_ANON_KEY` is a **legacy JWT** (`eyJ…`);
* the key in `site/.env.local`, `admin/.env.local` and `mobile/.env` is a **new
  publishable key** (`sb_publishable_…`), byte-identical across all three.

Both FORMATS are accepted today: a JWT-keyed request returned `404` rather than
`401`, and a publishable-keyed request returned `406` rather than `401`.

**── VERCEL'S VARIABLE NAMES, READ 13 Sep ────────────────────────**

Five variables, Production and Preview, nothing for Development. `cavy` is the
only project on the account and no shared variables are linked.

    NEXT_PUBLIC_SUPABASE_URL        added Aug 9
    NEXT_PUBLIC_SUPABASE_ANON_KEY   added Aug 9
    SUPABASE_URL                    added Aug 7
    SUPABASE_ANON_KEY               added Aug 7
    PUBLIC_SITE_MODE                added Aug 7

**The twins are confirmed on Vercel, and the dates say how they got there.** The
server pair on 7 Aug, the browser pair on 9 Aug — two days apart. Micky's
reading: the `NEXT_PUBLIC_` pair was added when something needed browser access,
on top of a server pair that already existed, rather than four variables being
set up as two deliberate pairs. **That is how one-thing-two-names happens**, and
it is the mechanism the other five instances in this schema presumably share.

**`PUBLIC_SITE_MODE` exists**, so going live is a value change rather than a new
variable — which the member-area deploy depends on.

**✅ CLOSED 14 Sep 2026, FROM THE END PREDICTED.** Vercel's UNPREFIXED
`SUPABASE_ANON_KEY` was read at last: it also starts `eyJ`. So it is a clean
split rather than a mix — no app is running two generations at once:

    local (site, admin, mobile)   sb_publishable_
    shipped mobile binary         sb_publishable_  — EAS holds NO environment
                                  variables at all, so the build read mobile/.env
    production web (Vercel)       eyJ — BOTH the server and the browser variables

**One outlier, and it is the surface a stranger meets first.** Better than
feared in the way that matters: the shipped app agrees with local, so no store
release is involved. The fix, if wanted, is two Vercel values and a redeploy.

**And both generations are now known to work on the same code.** Commit
`1480009` built green on GitHub Actions (publishable keys, from repository
Variables) and green on Vercel (JWTs) — the first time both were exercised
against identical source instead of assumed equivalent. That is what the CI
change bought beyond catching compile errors.

**⚠️ AND WE BOTH RE-DERIVED A FOUR-DAY-OLD RECORD FROM SCRATCH.** The `eyJ` /
`sb_publishable_` split is written six lines above this, dated 10 Sep. On 14 Sep
Micky found it again while adding the GitHub variables and reported it as new;
Claude only caught it by re-reading the item rather than answering from memory.
**Same family as item 41, running the other way:** there the record held its own
refutation and was acted on anyway; here it held the finding and we found it
twice.

What IS new is the sharper reading, Micky's: **anything verified locally has been
verified against a different credential than production uses.** The original
framed this as a future risk conditional on Supabase retiring JWTs. As a present
fact about what local testing proves, it depends on Supabase doing nothing at
all.

**THREE FOLLOW-UPS, LOGGED RATHER THAN ANSWERED FROM MEMORY:**

1. **Should production move to publishable keys?** Two values and a redeploy.
   The argument for is that every other surface is already there; the argument
   against is that nothing is currently broken.
2. **Is the JWT generation deprecated, and on what timetable?** Needs Supabase's
   own documentation. Not answerable from recollection, and the answer decides
   whether (1) is housekeeping or a deadline.
3. ~~Is the shipped mobile app on a third generation?~~ **ANSWERED 14 Sep: no.**
   EAS holds no environment variables, so the binary took `mobile/.env` at build
   time — publishable, same as local.

*The original, kept:*

**⚠️ THE FORMAT GAP IS NARROWED, NOT CLOSED.** The values are sensitive-locked
in the dashboard. The `eyJ…` prefix seen through the Edit dialog proves the
project holds a JWT-SHAPED key; it does not prove it holds THIS project's key.
That can only close from the other end — a request made FROM production that
succeeds or returns 401 — which is a deploy-time check, not a dashboard one.
Micky made this distinction himself, 13 Sep, having earlier drawn the wider
conclusion from the same prefix.

**⚠️ AND ONE VARIABLE FINDING IS WITHDRAWN — Claude's, 13 Sep.** It was claimed
that `site/` reads a `SUPABASE_SECRET_KEY` which production has never had, and
that something had therefore been failing silently since August. **False.** All
three "call sites" are the same JSDoc example inside
`site/node_modules/@supabase/auth-js/` — a comment showing a library user how
they might pass a key. No code in `site/` reads that variable and nothing was
broken. Two Vercel dashboard checks were spent on it.

**How it was produced, because the shape is new to this file.** The grep listing
env var names had no `--exclude-dir=node_modules`, so it reached into 40,000
files nobody here wrote. **The same output announced its own contamination** —
`ICEBERG_TOKEN`, `TINYGLOBBY_DEBUG`, `BOOK_LANG`, `NODE_UNIQUE_ID` sat in the
same twenty lines — and the one plausible-looking name was picked out of it.
Plausibility did the filtering that `--exclude-dir` should have.

**It is the WIDE variant of this file's oldest pattern.** The other nine
instances were a check NARROWER than the claim drawn from it. This was a check
wider than the thing being examined, with the surplus mistaken for the subject.
Micky, 13 Sep: worth recording as a distinct variant rather than a tenth of the
same.

**And the framing made the wrong answer the appealing one to confirm:** "it
isn't there" was offered as *the more interesting answer*, which is the same
family as item 41's caveat — sitting in the record, correct, and inert. One
pointed at the wrong branch; the other failed to point at anything.

**So: three variable findings stand, not four** — the 18-character value that was
a reference, the four names for two things, and the `eyJ` prefix that proves
format and not key. Each needed the code and the dashboard put together; the
withdrawn fourth was in neither.

**⚠️ That does not establish that production's key works.** The JWT that
returned `404` was the same FORMAT as Vercel's, not shown to be the same KEY. So
"production's browser client is fine" is not established — it is probably true,
and it rests on a format match. The earlier conclusion that it was fine rested on
something weaker still (item 37). **The
consequence is conditional and specific:** if legacy JWT keys are ever switched off
for this project, production's browser-side chat and portfolio upload break, while
local development and both other apps keep working — so it would be noticed last
in exactly the place it matters most. Vercel's `SUPABASE_ANON_KEY` format was not
read.

**The sixth one-thing-two-names instance in this schema and its surroundings**,
after `location`/`location_text`, `location_lat`/`latitude` (item 31), `plan`, the
Stripe key case-twin, and `sessions`/`bookings`. This is the one hardest to notice,
because Vercel shows the four variables as four unrelated rows.

**37. ⚠️ WITHDRAWN 10 Sep 2026 — NOT A DEFECT. THE ORIGINAL WRITE-UP BELOW WAS
WRONG.**

**What is true:** `site/.env.local` contains
`NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY` — a **reference** to the other
variable, not a broken value. Next.js expands `$VAR` references in `.env` files
when it loads them (the expander ships in `@next/env`), so at runtime the browser
client receives the same valid publishable key the server uses. **The local site's
chat and portfolio upload work.** The line beside it is the same shape:
`NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL`.

**How that was established, not guessed:** the 18-character value's hash is
identical to the hash of the literal string `$SUPABASE_ANON_KEY`, which is exactly
18 characters.

**Where the 401 actually came from:** the PowerShell command read the line as text
and passed the literal `$SUPABASE_ANON_KEY` to curl as the API key. **Micky's first
hypothesis — that the extraction failed — was right**, not on line endings but on
not resolving the reference. The write-up below says both of his hypotheses were
ruled out. That was wrong.

**The error, and it is the same one again:** the check measured the TEXT in the
file — its format and its length — and not the VALUE the program resolves from
it, then wrote "not a key" into this file. A real measurement of the wrong thing.
**⚠️ THIS INSTANCE HAD TWO AUTHORS.** In the same round, working from the same
non-fact, Micky concluded *"production is fine; item 37 is local only"* — by
comparing Vercel's `eyJ…` key against the 18-character local value, which was
never a value at all. His note, recorded as he put it: both of us reasoned from the
same non-fact in the same round. The correction was found before either conclusion
was acted on.

**What survives is item 38**, which is about the twins themselves.

*The original write-up, kept as it was:*

**What breaks, plainly:** on a local dev server, the site's chat screen and
portfolio upload fail on every call they make to Supabase from the browser.
Everything the site does on the server works.

**The evidence**, read without printing any value:

| `site/.env.local` | Format | Length | Same as admin and mobile |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | publishable (`sb_publishable_…`) | 46 | **yes** — byte-identical hash |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **neither Supabase format** | **18** | no |

The 18-character value is not quoted, has no stray whitespace, and the file has
no CRLF line endings or byte-order mark. What the value is has not been
established — it matched none of a handful of common placeholder strings, and
this item does not guess.

**Why the site works at all:** the site reads `SUPABASE_ANON_KEY` in three places,
all server-side, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in exactly one —
`site/lib/supabase-browser.ts`, whose only importers are
`app/(app)/messages/[sessionId]/ChatThread.tsx` and
`app/(app)/portfolio/PortfolioManager.tsx`. Server-rendered pages and server
actions carry the valid key; only those two browser-side paths carry the broken
one.

**Production is a separate question.** Vercel holds its own copy of every
variable, so a broken local file says nothing about the deployed site until the
Vercel value has been read.

**How it was found, and whose error that was.** Micky hit `401 Invalid API key`
running an API test built from `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The command that
named that variable was mine: it was written after checking the file's variable
NAMES, without checking that the value under that name was a key. Micky's two
hypotheses — a line-ending problem in the extraction, or a stale key — were both
checked and are both ruled out.

**Not fixed:** the request was to find out which, not to change the file.

**36. THE PUSH SECRET WAS HARDCODED IN TWO FUNCTION BODIES — FOUND 10 Sep 2026.
✅ CLOSED 10 Sep 2026: ROTATED, MOVED TO VAULT, AND A PUSH RETURNED 200.
NO REAL USERS, SO NOTHING WAS TAKEN.**

*Title restored 10 Sep. Commit `08a2920` inserted item 37 using this item's title as
its anchor and did not put the title back, so from then until this edit item 36
began mid-sentence. No content was lost beyond the title.*

**Closed on evidence, not on the migration applying.** Rotation: new value generated
locally, stored in Vault as `push_hook_secret`, set as `PUSH_HOOK_SECRET` in the
edge function, 0038 applied. Then:

    verify A  tg_message_push  still_has_hex_literal false · reads_from_vault true · message_push
              tg_notify_push   still_has_hex_literal false · reads_from_vault true · notify_push
    verify B  364 · 200 · {"sent":0} · 18:29:49

Block A proves the definitions changed; only Block B proves the Vault copy and the
edge-function copy agree, which is why the item closed on B. What `{"sent":0}`
means is a separate question — item 39.

**⚠️ One more file still described the old arrangement.** `send-push`'s own
comment said the secret is "baked in literally" to both function bodies, and its
403 log hint told the reader to *"Re-run supabase/push-setup.sql with the current
value"* — the file now marked DO NOT RE-RUN, because re-running it overwrites the
live function bodies. Commit `611d1cb` was titled "the docs stop prescribing it";
the search behind that matched the re-paste instruction's wording, not every
description of where the secret lives. Found reading `send-push` for item 39, and
corrected in the file. **The log hint only changes when `send-push` is redeployed,
and that deploy must carry `--no-verify-jwt`**: there is no `supabase/config.toml`
to hold the setting, and without the flag the gateway starts demanding a JWT that
`pg_net` does not send, so every push would fail at the gateway.

**What did and did not happen.** All 58 accounts on the platform are Micky's own or
disposable test addresses, and Micky is the only person who has ever signed in.
There was no one to send a spoofed push to and no one who could have read the
secret. **This is not a breach and must not be recorded as one.** What follows
describes a capability that becomes real the day the first real user signs up —
which is the reason to fix it now.

**Why rotate when nothing was exposed — Micky's reasoning, recorded as the
reason:** a secret in a function body is a thing nobody remembers to change, and
the day a real user signs up it becomes reachable by them. That is the whole shape
of this audit: a mechanism that is fine until the conditions it assumed stop
holding. Here the assumed condition is "nobody but the owner is on the platform".

**What:** the `send-push` shared secret sits in plaintext inside the bodies of
**`tg_notify_push`** (AFTER INSERT on `notifications`) **and `tg_message_push`**.
The second was not in the trigger query that surfaced the first, because that
query did not include `messages`; the 8 Aug schema snapshot's header names both.

**⚠️ FOURTH INSTANCE OF THE PARTIAL-MEASUREMENT PATTERN.** The secret was found in
one function, and a second turned up only on follow-up — because the query that
found the first had a table list, and `messages` was not on it. A measurement of
part, reported as the whole: after "admin 6" (item 19), "the audit trail is
unreliable" (item 27), and "the rewrite fixed the rule" (item 19 again). **So the
sweep across every public function and cron job (issued 10 Sep) is the SCOPE of
this item, not a confirmation of the two already found.** If it finds a third,
this item grows.
**⚠️ WHO CAN READ IT IS NOT YET ESTABLISHED — AND THE FIRST VERSION OF THIS ITEM
SAID IT WAS.** It read: *"readable by any role with a SQL session … not through
the public API"*. The second half was asserted, not checked. The distinction it
glossed is the whole finding:

* **"An admin could read it"** — true today, and describes a platform with one
  operator.
* **"Any signed-in account could read it"** — describes what happens the moment
  the platform has users, and is the version that matters.

`pg_proc` is readable by `PUBLIC` in a stock Postgres, so the question is not
privilege but reach: whether an account can get a query to `pg_proc` through the
Data API. It has also been pasted into two transcripts.

**Established, 10 Sep 2026:**

* **Direct database access is Micky's alone** — his statement, and he is the only
  person who has ever signed in to anything.
* **`pg_proc` is not in the API's default schema.**
  `GET /rest/v1/pg_proc?select=proname&limit=1` → `404 PGRST205`,
  *"Could not find the table 'public.pg_proc' in the schema cache"*. The default
  schema is `public`, and `pg_proc` is not in it.

* **`pg_catalog` is not reachable through the API by any account, signed in or
  not.** `GET /rest/v1/pg_proc` with `Accept-Profile: pg_catalog` →
  `406 PGRST106`, *"Invalid schema: pg_catalog"*, hint *"Only the following schemas
  are exposed: public, graphql_public"*. The error names the exposed schemas, so
  this does not rest on inference. The exposed-schema list is the same for every
  role, so the answer holds for `anon` and `authenticated` alike.

**It took two requests, and the first did not settle it.** The 404 proved only that
`pg_proc` is not in `public`, because PostgREST searches another schema only when
a request names it in `Accept-Profile`. The item held off saying "never reachable"
until the second request; recording that because stopping at the first would have
been the fifth partial measurement in this file written down as the whole.

**So the actual exposure, stated once:** direct database access, which is Micky
alone, plus two transcripts. No real users, nothing taken, rotated regardless.

**Both functions confirmed from the database, 10 Sep, bodies read with the secret
blanked server-side:**

| Function | Fired by | What it sends |
|---|---|---|
| `tg_message_push` | `messages` → `message_push`, AFTER INSERT | resolves the recipient from `sessions` + `providers`, skips if the model is null or the recipient is the sender, builds the sender's name from `users`; `user_id`, `title` (sender name or "New message"), `body`, `data {type: new_message, session_id}` |
| `tg_notify_push` | `notifications` → `notify_push`, AFTER INSERT | `user_id`, `title`, `body`, `data {type, session_id} \|\| new.data` |

Both SECURITY DEFINER with `search_path public`, both `net.http_post` to
`send-push`, both with the header value hardcoded in the same shape. **Two
functions, one secret, one edge function.**

**⚠️ THE DOCS PRESCRIBED IT.** This is stronger than "the knowledge travelled
without the mechanism". Three committed files told the next person to put the secret
in the function bodies: `supabase/push-setup.sql` (*"replace every
REPLACE_WITH_PUSH_HOOK_SECRET below with the SAME value"*), `mobile/notes.md:133`
(*"the trigger bodies hold the literal — re-paste from the secret"*) and
`mobile/cavy-handover.md:208` (*"re-paste the secret into the trigger bodies"*). All
three were careful not to COMMIT the value, and all three instructed the pattern
that exposed it. Corrected 10 Sep alongside 0038; `push-setup.sql` also had the
expression swapped in both bodies so an accidental re-run cannot reintroduce it.

**And the header is the only gate.** `mobile/cavy-handover.md:206` records
`send-push` as *"Deployed `--no-verify-jwt`"* — so no JWT is checked at the gateway,
and the shared secret is the only thing standing between a caller and any user's
phone. Recorded from the handover, not from deployment config, which is not in the
repo.

**0038 written 10 Sep** — edits the live definitions in place, swapping only the
header expression for a Vault lookup; refuses to apply unless `push_hook_secret`
already exists, and unless each function's owner can read the Vault view. Item
closes when a push returns 200 after the rotation, not when the migration applies.

**Where the new secret lives — an existing pattern, not a new one.** Vault is
enabled (`supabase_vault 0.3.1`) and already in use: `cron_secret_purge_selfies`,
created 27 Jul, stored with `vault.create_secret(...)` and read inline in
`supabase/purge-selfies-cron.sql` as
`(select decrypted_secret from vault.decrypted_secrets where name = '...')`. 0038
follows it exactly for the push secret.
Micky's count: the second credential to escape that way.

**What a holder can do**, read from `supabase/functions/send-push/index.ts`: POST
`{ user_id, title, body, data }` with the header, and the function looks up that
user's push tokens with the service role and delivers through Expo. **Any text,
with any deep-link `data`, to any user's phone, arriving as Cavy.** The only
other thing needed is a user id, and those appear in app routes. With no real
users that capability reached no one; with real users it is an impersonation and
phishing channel, not a configuration tidy-up.

**Not in the public repo — checked, not assumed.** The prefix appears in no file
in the working tree and in no commit on any ref (`git log --all -S`, ids only).
The committed files, `supabase/push-setup.sql` and
`supabase/schema-snapshot-2026-08-08.sql`, carry the placeholder
`REPLACE_WITH_PUSH_HOOK_SECRET` and contain no long hex strings. The real value was
pasted into the database by hand.

**⚠️ A LATENT PATH TO GITHUB STILL EXISTS.** The snapshot's own instructions say to
regenerate it from the live database "whenever you need certainty". Regenerating it
without redacting, and committing the result, would publish the live secret in a
public repo. Moving the secret out of the function bodies closes that path too.

**The knowledge travelled; the mechanism did not.** The 8 Aug snapshot already
said, in its header, that both functions *"embed the send-push shared secret in
their bodies"*, and it carefully redacted the value from the file. So a month ago
someone knew the secret was in `pg_proc`, protected the file, and left the secret
where it was. Same category as `site/app/(app)/bookings/actions.ts` citing
`mustWrite` without using it: a correct note in place of a fix.

**Fix:** rotate the secret; store the new value in Supabase Vault; both functions
read it from `vault.decrypted_secrets` at call time (they are SECURITY DEFINER, so
they can), so the value never appears in a function body, a migration file, a
snapshot, or a transcript. `send-push` already fails closed if `PUSH_HOOK_SECRET`
is unset, which stays as it is.

**Order, and the one decision it needs:** changing `PUSH_HOOK_SECRET` makes the
exposed value useless at once, and makes every push fail until both functions send
the new one. `pg_net` requests are queued asynchronously, so notification and
message rows still insert — only the phone alert is lost for that window. With no
real users the outage window reaches no one, so closing it immediately costs
nothing. Micky is rotating.

**── ALSO DECIDED 10 Sep, RECORDED HERE ────────────────────────────────────────**

* **Item 34 applies to reports as well.** `actioned 3` — `no_reviewer 3`,
  `no_resolution 3`; `open 4`. Of the three decided: **attributable 2,
  conflicting_admins 1**, no anonymous rows, none missing an audit row. The two get
  a reconstructed reviewer with provenance on the same terms as 0037; the
  conflicting one stays NULL rather than guessed.
* **Item 29, all three decisions confirmed:** the report functions write
  `reports.reviewed_by` on every decision; `reports.resolution` gets the reason
  the admin types; and `admin_act_on_provider`'s remove-portfolio action deletes
  rows but NOT the storage objects — **those files are orphaned, logged here, and
  deliberately kept out of the migration** rather than half-handling storage
  inside a transaction.
* **Item 35: moderation moves to the dedicated admin.** Micky's reason, recorded
  as the reason: the problem is not which account is convenient, it is that the
  personal account holds a provider profile in the product it moderates. Still
  open on the same item: the dedicated admin also has an app account
  (`role model`), which the separation was meant to exclude.
* **The ledger reads 0034–0037 with no gaps**, 0035–0037 applied 10 Sep. The
  secret fix takes 0038; the four item-29 functions move to 0039.

**35. BREAK-GLASS BECAME THE NORMAL PATH BY DRIFT — LOGGED 10 Sep 2026.
NOT FIXED.**

The design, in CLAUDE.md: a dedicated console admin (`admin@guineapigapp.co.uk`)
as the primary, *never an app user*, so app-side changes cannot affect admin
login; and Micky B's personal account as break-glass backup.

The database, 10 Sep:

| | Meant to be | Verification decisions | Last sign-in | App account |
|---|---|---|---|---|
| `8788ed3d` dedicated admin | primary | **2 of 30**, all 26–27 Jul | 26 Jul | yes — `role model` |
| `ff06d568` Micky B | break-glass | **28 of 30** | 8 Sep | yes — `role provider` |

The dedicated account was used for two days and abandoned, not gone quiet. Every
identity check since 27 July was approved from the backup.

**Why it matters beyond tidiness.** The account that holds almost every moderation
decision is **also a stylist in the product it moderates** — a provider profile,
a shop, subject to the same reports and verification rules as the people it
approves. Separation between "the person operating the platform" and "a
participant in it" was the reason for having a dedicated account, and it does not
exist in practice. And the "never an app user" invariant the separation relied on
is false too: the dedicated account has an app profile, origin unknown.

**Not fixed, and not a code change.** The options are operational — move
moderation to the dedicated account and treat Micky B as genuinely break-glass;
or accept one admin and stop describing it as two — and they are Micky's to
choose. What changed today is that the record says what happens rather than what
was intended.

**Same family as the rest of this file:** a control whose description was correct
when written, and nothing that would notice when practice moved away from it.

 — CONFIRMED
10 Sep 2026. NOT FIXED.**

**Confirmed from the database, 10 Sep:** no trigger on `portfolio_items`, and
`pending 0 · approved 5 · rejected 0`. Nothing has ever been pending. The
Images queue has never received an image and cannot; the `image_review_enabled`
toggle governs nothing; and every stylist who uploads is told the photo appears
*"once it's been reviewed"*. **A published claim with no mechanism behind it.**

The investigation as it was written the day before, while the answer was still
unknown, is kept below unedited.

`portfolio_items.moderation_status` defaults to **`'approved'`**;
`status_posts.moderation_status` defaults to `'pending'`. Same column name, same
CHECK vocabulary, opposite defaults — one fails open, one fails closed.

**Confirmed from the code:** NEITHER upload path sets the column.

    site/app/(app)/portfolio/PortfolioManager.tsx:82   provider_id, media_url, media_type
    mobile/src/app/(app)/portfolio.tsx:226             provider_id, media_url, media_type, category_id

So the default decides, and the default is `'approved'`. Meanwhile
`admin/app/moderation/page.tsx` fills the Images tab with
`.eq('moderation_status', 'pending')`.

**If nothing else writes `'pending'`, then:**

* the Images queue is permanently empty, and has been;
* the `image_review_enabled` toggle governs nothing on the write path — its own
  confirm dialog offers to "immediately publish all N images waiting in the
  queue", a queue that cannot fill;
* and `PortfolioManager.tsx:89` tells the stylist *"It'll appear on your profile
  once it's been reviewed."* A published promise with no mechanism behind it,
  which is the category this whole audit opened with.

**⚠️ NOT ASSERTED, BECAUSE THE REPO CANNOT ANSWER IT.** `portfolio_items`
predates the migration framework — no migration creates it, and 0031 only
mentions it in a comment. A BEFORE INSERT trigger reading
`settings.image_review_enabled` could exist in the database, made by hand in the
dashboard, and no file here would show it. That is precisely the case where
reading migrations tells you what was intended rather than what is there.

    select tgname, pg_get_triggerdef(oid) as definition
    from pg_trigger
    where tgrelid = 'public.portfolio_items'::regclass
      and not tgisinternal;

    select count(*) filter (where moderation_status = 'pending')  as pending,
           count(*) filter (where moderation_status = 'approved') as approved,
           count(*) filter (where moderation_status = 'rejected') as rejected
    from public.portfolio_items;

No trigger AND zero `pending` rows ever = the queue has never worked. A trigger,
or any pending rows, and the defaults are merely inconsistent rather than
broken.

**33. `notifications.type` HAS NO CHECK CONSTRAINT — LOGGED 9 Sep 2026.**

Free text. A typo creates a new type silently, and every reader falls through to
a default rather than erroring.

**That is how the notification-type allowlist bug survived.** The allowlist was
correct for the types that existed when it was written; a new type joined the
table and inherited the fallback rather than tripping anything. With no
constraint there is no moment at which the system can notice.

A CHECK listing the live vocabulary would turn a silent typo into a refused
write. Not added here: it needs the current distinct values read first, because
a CHECK that omits a type already in the table fails on creation.

    select type, count(*) from public.notifications group by type order by 2 desc;

**34. ⚠️ NO IDENTITY CHECK ON THIS PLATFORM HAS A RECORDED REVIEWER —
CONFIRMED 10 Sep 2026. 0036 WRITTEN; CONSOLE CHANGE WAITS FOR IT.**

**The fact:** `verification_requests` — `reviewed_but_unattributed 25 ·
reviewed_total 25`. Every verification ever reviewed has no reviewer recorded.
Nobody can say who approved any identity check, and identity approval is the
decision that lets a stranger into someone's home. Micky's framing, and the right
one: this is a live evidence gap on the most consequential admin decision in the
product, and it outranks everything else outstanding because it is a fact rather
than a risk.

**── CORRECTION: THE ORIGINAL WRITE-UP BELOW HAD THE WRONG MECHANISM ──**

It said the column *"may be unwritable for the primary admin"* because it
references `public.users` and the console-only admin may have no app account.
That was a hypothesis, and the code disproves it as the cause:

    admin/app/verification/page.tsx:94   approve  → status, notes, reviewed_at
    admin/app/verification/page.tsx:140  reject   → status, notes, reviewed_at

**Neither update has ever included `reviewed_by`.** The column was not refused;
it was never asked for. Nothing failed and nothing logged, so no error could ever
have surfaced it — which is why it survived every other check this month. Note
the contrast: `admin/app/moderation/page.tsx` DOES write `reviewed_by`, for status
posts, the lower-stakes decision.

**The foreign key is still wrong** — it becomes the cause the moment the console
starts writing the column, and because `reviewed_by` sits in the same UPDATE as
`status`, an FK violation would fail the whole approval. Hence the order:

    1. 0036 — repoint verification_requests.reviewed_by at auth.users
    2. then the console change that writes it

**ON DELETE, and an inconsistency that is partly mine.** The two reviewer keys
already on `auth.users` disagree: `reports.reviewed_by` has no ON DELETE (NO
ACTION), and `status_posts.reviewed_by` is ON DELETE SET NULL — which 0031, written
in this session, chose. 0036 follows `reports` and `admin_audit_log.admin_id`:
deleting an admin must not erase who approved an identity check. Status posts
expire in 48 hours; that SET NULL is defensible there and inconsistent anyway.
Not changed.

**The 25 are not backfilled.** `admin_audit_log` may carry the attribution —
`logAction()` records `admin_id` and `details.request_id` for both decisions —
but it discarded its own insert errors until 8 Sep, and a re-approval writes a
second row. What can be recovered is a question for the data first, and any
backfilled reviewer is an inference, not a record, and has to say so.

**── SECOND CORRECTION, 10 Sep 2026: THE PREMISE WAS FALSE TOO ───────────────**

Both the 9 Sep write-up and 0036's header rested on CLAUDE.md's statement that the
dedicated console admin is *never an app user*, so it might have no
`public.users` row. Read from the database:

    8788ed3d  admin@guineapigapp.co.uk   role model     last sign-in 26 Jul  in admins
    ff06d568  micky.buckfield@gmail.com  role provider  last sign-in 8 Sep   in admins

**Both admins have app accounts.** Under the old foreign key, writing either id
would have succeeded. So 0036 was wrong about the mechanism twice over — the
column was never refused, and would not have been — and **right about the fix**:
`auth.users` is still the correct target, matches `reports.reviewed_by` and
`admin_audit_log.admin_id`, and holds for any future console-only admin.

**0036 is NOT edited to say so.** It is applied, and changing anything above its
footer would make it read DRIFTED against the ledger. The correction lives here,
in CLAUDE.md, and in a `comment on column` in the next migration — because 0036
also stored the false premise in the database itself, as the comment on
`verification_requests.reviewed_by`.

**0037 applied, 10 Sep:** `reconstructed 25 · recorded 0 · still_unattributed 0`,
split `ff06d568 23 · 8788ed3d 2`, matching the audit log exactly. The 30 logged
decisions reconcile: 30 distinct requests, no repeats, 5 for requests since
deleted by resubmission — the same path that orphans selfie objects.

**Console change shipped the same day:** approve and reject now write
`reviewed_by` and `reviewed_by_source = 'recorded'`, and refuse outright if the
acting admin's id cannot be read. Every display of a verification reviewer goes
through one component, `admin/components/ReviewerLine.tsx`, so the
"reconstructed — inferred" marker travels with the name to any screen that shows
one. **Before this change no screen in any app displayed a verification reviewer
at all**, so "wherever a reviewer appears" was vacuously true; routing through one
component is what makes it hold for the next one.

*The original write-up, from 9 Sep, is kept below as it was:*

`reports.reviewed_by` → `auth.users(id)`.
`verification_requests.reviewed_by` → `public.users(id)`.

Both record "which admin dealt with this", against two different tables. The
dedicated console admin is deliberately never an app user (CLAUDE.md), so it has
an `auth.users` row and may have no `public.users` row at all — which means
**`verification_requests.reviewed_by` may be unwritable for the primary admin**
and silently null for every request they handle.

`admin_audit_log.admin_id` → `auth.users`, which is the right choice for the
same reason. Worth checking whether any verification request reviewed by the
dedicated admin has a null `reviewed_by`:

    select count(*) filter (where reviewed_at is not null and reviewed_by is null)
             as reviewed_but_unattributed,
           count(*) filter (where reviewed_at is not null) as reviewed_total
    from public.verification_requests;

**31. `providers` HAS TWO COLUMNS FOR ONE COORDINATE PAIR — LOGGED
8 Sep 2026, NOT FIXED.**

Confirmed from `information_schema`, not from a file: `providers` carries
`location_lat` / `location_lng` (positions 7–8) **and** `latitude` / `longitude`
(positions 20–21). Both nullable, both `double precision`, no constraint tying
them together.

`site/lib/queries/dashboard.ts` already selects all four and coalesces, which is
the reader-side symptom of exactly this.

**The fifth instance of one thing with two columns**, after `location` /
`location_text` (same table, positions 6 and 14), `plan` on `subscriptions`, the
Stripe key case-twin, and `sessions` / `bookings`. That is now a pattern in this
schema rather than a series of accidents.

Not fixed here and deliberately not in 0035: consolidating a column pair means
finding every reader across three apps, and a migration that renames or drops
one while a client still reads it is the failure mode this project has already
paid for. Its own item, when someone has the appetite.

**30. A CHECK THAT HAS ONLY EVER RUN WHERE ITS INPUTS WERE ALREADY SATISFIED IS
NOT A CHECK THAT PASSES — IT IS A CHECK NOBODY HAS RUN.**

*Found by CI's first run, 8 Sep 2026. This is the headline of this file.*

`admin` passed. `site` and `mobile` failed on `npm run checks`, not on
`npm ci` — and both passed in the working tree. Something generated and
gitignored was satisfying them, and **locally-satisfied had been treated as
passing** for as long as either gate has existed.

**⚠️ MOBILE IS THE SERIOUS ONE, AND IT IS NOT REALLY A CI PROBLEM.**
`mobile/tsconfig.json` includes `expo-env.d.ts` and `.expo/types/**`. Both are
gitignored — Expo generates the first on `expo start` and its own header says to
keep it out of git. On a clean checkout neither exists, `expo/types` is never
referenced, `declare module '*.css'` is therefore absent, and the side-effect
import of `src/global.css` fails: **TS2307, exit 2.**

`eas-build-post-install` runs that same script in exactly that kind of clean
environment. **The mobile build gate wired that morning would have failed on its
first real build.** It had never passed anywhere but a tree that already held the
generated files. CI found it before a build did, which is the whole argument for
item 28 arriving as evidence rather than as a claim.

Fixed by committing the one line that matters, `src/types/expo.d.ts`:
`/// <reference types="expo/types" />`.

**⚠️ AND THE FIRST ATTEMPT AT THAT FIX WAS ITSELF GITIGNORED.** It was called
`src/types/expo-env.d.ts`. `mobile/.gitignore` line 14 is `expo-env.d.ts` with no
leading slash, which git matches as a **basename at any depth** — so the fix was
silently not committed and the next fresh clone failed identically. Found by
re-cloning, not by looking at the working tree. Same lesson twice in an hour.

**SITE — FIXED, CAUSE NOT KNOWN, AND RECORDED THAT WAY.**
`app/opengraph-image.tsx` carried an inline
`// eslint-disable-next-line @next/next/no-img-element`. On the Linux runner the
rule did not fire, so the directive was **unused** — which is a warning, which
`--max-warnings=0` turns into a failure.

**It was not reproduced here.** A fresh clone on this machine still fires the
rule, so the difference is the environment (Windows/Node 24 vs Linux/Node 22) and
no Linux runner was available to bisect it. That is written into
`site/eslint.config.mjs` as an open question rather than dressed up as a
diagnosis.

The fix does not depend on the answer: the suppression moved from an inline
directive to a **config-level rule override** for the OG image routes, and a
config override is never reported as an unused directive. It is also correct on
the merits — next/og is not a browser and cannot use `next/image`.

**⚠️ STILL UNVERIFIED ON LINUX.** All three now pass `npm ci && npm run checks`
from a fresh clone on this machine. The next CI run is what proves site.

**── TWO THINGS TO KEEP ALONGSIDE THE HEADLINE ───────────────────────**

**1. A FIX THAT IS NOT IN THE REPO IS INDISTINGUISHABLE FROM A FIX THAT DID NOT
WORK.** `src/types/expo-env.d.ts` was written, verified in the working tree, and
never committed — `.gitignore` matched its basename at any depth. Only
re-cloning caught it. **`.gitignore` patterns without a leading slash match a
basename anywhere in the tree, and this will happen again**: check
`git check-ignore -v <path>` when a new file is meant to be committed and the
symptom does not move.

**2. SITE IS FIXED WITHOUT BEING UNDERSTOOD, AND THE RECORD MUST NOT SETTLE.**
The directive is *used* on Windows/Node 24 and was *unused* on Linux/Node 22.
The config override is correct either way, which is why it was chosen — but
**the green run on `2e2bd5f` proves the symptom is gone, not that anyone knows
why the environments disagreed.** Do not let this shorten to "fixed" in a later
retelling; that is the item-19/27 shape, and it has already happened three times
in this file.

**The shape, and it is the one this file keeps recording.** `npm run checks` was
green on every machine it had touched, and both greens were an artefact of the
machine.

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

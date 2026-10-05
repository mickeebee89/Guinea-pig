# Cavy — where things stand

_Current picture, **3 October 2026**. **This file says where we are; it is not a
record of how we got here.** For that, see `audit-records-vs-reality.md` and the
per-item write-ups it links._

_Read `CLAUDE.md` first — it holds the durable stuff (stack, identifiers, schema
truths, how Micky works). This file holds only what changes._

---

## The state

Three apps against one Supabase project. **`site/` (the web app) is where the
work is.** `mobile/` and `admin/` were parked mid-launch on 6 Aug 2026 and are
maintained, not advanced — though the last fortnight touched all three, because
most of what the audit found spanned them.

Web slices 1–3 are shipped: member area, chat, the shop editor, browse, the ID
check, report/block, and cancellation. Since then: the apply flow, account
deletion, a model's own profile, postcodes and distance filtering, favourites,
and name changes. **The site is live on Vercel and has been the live product
since 14 Sep.**

**Migrations `0000`–`0077` are applied**, `0009` superseded and must never be
run. **`0078` is written and NOT applied** (see *In flight* below). The ledger is the authority, not this line — which said `0030` until
24 Sep, twenty-six migrations out of date:

```bash
$env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'; node scripts/migration-status.mjs
```

**A three-week audit closed on 4 Sep** with fourteen items. **It did not stay
closed** — it is at **147** and still finding things, because each fix walks a
journey and journeys keep ending somewhere nobody had looked. Everything below
is what it has left.

---

## ⚠️ In flight, 5 October 2026 — read this before starting anything

### ✅ ITEM 144 IS CLOSED — 0085 applied and verified, 5 Oct 2026

`authenticated` and `anon` can no longer write a `notifications` row at all, by
policy and by grant. Six stages; 0077–0085 spans nine migration files and seven
of them are 144's. Fifteen client-side notification inserts became zero.

⚠⚠ **The last blocker was not technical.** 0077 deferred the approval notice
"until 0078"; 0078 became stage B; the promise pointed at a file about something
else and held stage F up for a week, while the work itself took one migration.

### ⚠⚠ THE TOP TWO OPEN ITEMS NOW — BOTH LIVE, BOTH ON SHIPPED CODE

**Item 148 — a model may be able to INSERT a confirmed booking with no consent
record.** Written up 5 Oct 2026. Six repo reads say nothing on the INSERT path
checks `status`, and **0049's own Block C already proved a member can direct-
insert a session with a caller-supplied status and no consent row** — so only
the string `'accepted'` is unverified. If it works it fabricates an appointment
in a stylist's diary she never accepted, with a six-year legal record missing
that **cannot be backfilled**. One rolled-back block settles it.

⚠️ **The number was in use for days with nothing behind it.** 148 did not exist
in the audit record — the numbering ran 147 → 149 — while being referred to as
the largest open thing. Item 155's class, reversed: a *finding* prioritised by a
number that was never allocated.

**Item 157 — a member can mark their own photo as reviewed**, taking it out of
moderation. Confirmed, not merely suspected. Apple Guideline 1.2 / Play UGC. Its
fix is item 156's second half (the `users`/`providers` column grants), whose
plan is written and whose precondition is met, but which still needs four reads
— the sharpest being **which `is_verified` the shop page and the badge actually
read**.

### How 144 was closed, kept because the sequencing is the reusable part

It could not be closed by tightening the policy, because **every client-side
notification insert was cross-user**. So it went in stages, each additive and
safely applicable alone, with the policy last:

| stage | what | state |
|---|---|---|
| A | fold notifications into the RPC that already decided — `create_session_with_consent`, `admin_decide_verification` (reject), `admin_decide_status_post` | ✅ **0077 applied, clients deployed** |
| B | `transition_session` + `notify_session_transition` for accept / decline / complete | ✅ **0078 applied + verified, client half deployed (7 sites → 1 RPC)** |
| C | `invite_model` — **three** sites, not two | ✅ **0081 applied + verified** |
| D | `notify_as_admin` for the free-form admin message | ✅ **0081 applied; 0082 added it to all three email lists** |
| E | the verification **approval** notice — `admin/app/verification/page.tsx:207` | ✅ **0083 applied + verified, 5 Oct** |
| F | tighten the INSERT policy | **0085 WRITTEN, NOT APPLIED. ⚠️ Applying it makes B irreversible** |

⚠️ **TWO ENTRIES IN THIS TABLE USED TO SAY SOMETHING ELSE, AND THE CORRECTIONS
ARE THE USEFUL PART.**

* **`notify_chat_counterparty` was never needed.** It was listed under C because
  the plan was written from an inventory taken **before stage B shipped**; stage
  B's client half had already replaced that site's status update and its
  notification together. *A plan that is not re-measured describes the product
  as it was when the plan was written.*
* **Old stage E — `mobile/…/provider-dashboard.tsx:789` — was not a fourth
  category.** Reading it showed `handleInvite` writing `stylist_invite`, which
  made it stage C's third site. The letter E was then free, and the approval
  notice took it.

### ✅ STAGE F'S PRECONDITION IS MET, MEASURED ON 5 Oct 2026

**No client in any of the three apps inserts a `notifications` row.** Every
remaining `from('notifications')` in `admin/`, `site/` and `mobile/` is a
`.select()` or an `.update()`. Searched for `from('notifications')`, the
double-quoted and template-literal spellings, and raw `into notifications`.

**One inserter remains and it cannot be affected:**
`supabase/functions/stripe-webhook/index.ts:177` writes `payment_failed` using
`SUPABASE_SERVICE_ROLE_KEY`, and service_role bypasses RLS.

⚠️ **AND IN EVERY CASE THE TELLING MOVED RATHER THAN BEING DELETED** — checked,
because "nobody inserts any more" is also what a silently removed notification
looks like, which is the exact failure this whole item exists to prevent.

⚠️ **WHAT HELD F UP WAS NOT TECHNICAL.** 0077 deferred the approval notice
"until 0078"; 0078 became stage B; the promise pointed at a file about something
else. **Item 155's first instance was the thing blocking stage F for a week**,
while the work itself took one migration.

**The 20-table revoke is done** — 0084, applied and verified 5 Oct 2026.

⚠⚠ **WHAT APPLYING 0085 COSTS, STATED BEFORE IT IS APPLIED.** Until now a
Vercel revert restored a working product, because the old client's direct
inserts still passed the policy. After 0085 they do not. **A revert past stage
B's client half will stop accept, decline and complete from telling anyone
anything.** That is why F went last.

Its verify has a bounds section as well as a lock section (item 164): a direct
insert as `authenticated` must be refused, AND `notify_as_admin` called *as
`authenticated`* must still write — same role, both directions. Calling a DEFINER
function as the owner would prove the function and not the path, and the path is
what 0085 changes.

~~**Stage B's deploy order is the opposite of stage A's.** 0078 is inert —
nothing calls it until the clients deploy — so applying it is free. The risk is
all in the client deploy, and if it is wrong **no booking can be accepted,
declined or completed.** Rollback is a Vercel revert, and that only works while
stage F has not run.~~ *Done 4 Oct 2026 and verified end to end; kept because
the rollback sentence is still true and still the reason F goes last.*

⚠️ **0083's deploy order was stage A's, not stage B's, and the two are
opposite.** The migration had to be applied BEFORE the admin deploy: in that gap
both the RPC and the console write, so a member is told twice — visible and
self-correcting. The other order tells them **zero** times, silently. That is
why 0083 was committed only after its verify passed, since pushing is what
deploys the console.

⚠️ **Stage B's client half must add a `transition_session` case to
`site/lib/demo/rpc.ts`.** `demoRpc`'s default throws, so without it accept and
decline break in demo mode — which is where the promo videos are recorded.

### Waiting on Micky

* **Apply `0078`** (checksum `0a2849e2…`), then its PREFLIGHT and verify blocks.
* **Three rolled-back test blocks for item 147**, supplied in chat 3 Oct. They
  settle whether either participant can rewrite a booking's `date`,
  `start_time`, `price_pence` and `provider_id` in a plain UPDATE. ⚠️ A refusal
  mentioning *overlap* on the date or provider tests is
  `trg_reject_overlapping_session`, **not** an actor guard — inconclusive, not a
  pass. `price_pence` is the clean signal, since no trigger covers it.

### Item 147 — inferred, not yet tested

`authenticated` **and** `anon` hold table-wide UPDATE on all 26 columns of
`public.sessions`. The only narrowing is the `participants can update sessions`
policy. `trg_enforce_session_status` is `BEFORE UPDATE OF status`, so it never
fires on an update that leaves status alone.

**The inventory is done and it is unambiguous: all eight client UPDATE sites set
exactly one column, `status`.** So the fix is
`grant update (status) on public.sessions to authenticated` plus revoking
`anon` — which is behaviour-neutral, since no UPDATE policy names anon, making
it latent rather than live. Not written yet: the tests decide the wording, and
0070's comment about *"the row can never say it did not happen without saying
who said so"* gets corrected in the same migration, because
`not_held_provider_at` is writable without touching status.

### Recording promo videos

`site-demo-label` on port 3100 (`.claude/launch.json`), with `DEMO_MODE=1` and
`DEMO_LABEL=1`. **Restart the server before every take** — the demo store is
in-memory and mutates across runs, so a second recording starts from the first
one's end state. `notify_favourites_of_availability` has no demo case since
0075, so the "new times" notification no longer appears in demo; the flow still
works because the caller catches it.

---

## ⚠️ Split 24 Sep 2026: these were one list and they are not one thing

The old heading was **"Blocking launch — five, all decisions or chores"**, and
it mixed two unrelated gates. **Two of the five could not block the web launch
at any point**, because they are Apple and Google requirements — so the heading
overstated what stood in the way of the thing that actually shipped.

And the web **launched on 14 Sep**. Nothing below blocks a launch any more.
What is left is a **live product with gaps**, which is a different and in one
case worse thing: a gap in something nobody has yet is a to-do, and a gap in
something that is serving traffic is happening now.

---

## Blocking a store submission

Neither of these has ever blocked the web. Both stop a mobile build going out.
**See also "Before the app is submitted" below**, which holds the engineering
work; these two are decisions and paperwork.

| | What | What it needs |
|---|---|---|
| **IAP** | Stripe pays for an in-app digital unlock. Apple's #1 rejection risk | **A decision.** Consider asking App Review directly |
| **CSAE wording** | Play declaration recorded done; the **submitted text** has never been read against what the product does | A check, ~20 minutes. It is a child-safety declaration to a platform |
| **Play CSAE contact** | Still needs updating by hand after the support-address move (21 Sep) | A Play Console edit. Was buried in the Sender domain row below, which is web work |

---

## The live web product — what is still missing from it

**No missing features.** Each needs a call or an afternoon. But read the
worst-first list in the audit record before picking one: the order here is
historical, not by harm.

| | What | What it needs |
|---|---|---|
| **Teardown** | ✅ **Done 21 Sep 2026 (audit item 64):** 58 hand-made accounts deleted by `scripts/delete-test-accounts.mjs`; 5 logins remain, the keep-list. ~~`teardown.mjs` matches `@seed.guineapig.invalid` and refuses any other suffix, by design~~ | ~~The hand-made accounts (`@acoxs.com`, `@bevriz.com`, gmail, hotmail) cleared **separately**~~ *(done 21 Sep)* |
| **Listing bar** | Six SEO treatment pages render zero stylists | **One real stylist with a 40-character bio.** Not an inventory problem — see item 11 for the query that says which bar each stylist fails |
| **Sender domain** | ✅ **Moved 20 Sep 2026:** sending as `no-reply@cavybeauty.com`, name "Cavy", verified by a real signup email. Templates now use `token_hash` links, so they work on any device. **Still open:** 3 of the 5 templates untested against a real inbox (magic link, invite, change email). ✅ Support address moved to `support@cavybeauty.com` on 21 Sep 2026 in both apps, the legal documents, `stripe-payment` and the template source (audit item 62); the Play Console child-safety contact **has moved to "Blocking a store submission" above**, since it is a Play Console edit rather than web work. ~~and support addresses in both apps still read `support@guineapigapp.co.uk`~~ *(superseded 21 Sep)*. ~~Still `no-reply@guineapigapp.co.uk`; five auth templates never tested against a real inbox~~ *(superseded 20 Sep; audit item 62)* | One test send each for the remaining three; deploy `stripe-payment`. ~~update the Play Console CSAE contact~~ *(moved to the submission list)*. ~~Moving the support address is a separate decision~~ *(done 21 Sep)* |

---

## Not blocking

- **Banners cannot be set.** `providers.banner_url` is read in four places,
  written in none, with no bucket. The scrim added on 2 Sep has therefore never
  executed — untested by construction until banners exist.
- **No text is screened before publication (item 15).** `banned_words` is an
  admin-initiated retrospective search over 500 rows, not a filter. Portfolio
  images have a real pre-publication queue; bios, reviews, shop copy and
  messages publish instantly. It reads as moderation in the admin console and
  is not.
- **Stylist status posts (item 16).** `providers.status_text` is read in four
  places and written nowhere, so "What's on near you" has been empty since it
  shipped. Building `status_posts` as designed in
  `web-phase-1-handover.md:309-380`. **Read the grant trap in audit item 16
  before touching `public_stylists`** — it is the only step that can take the
  public site down, and it fails silently.
- **Admin revoke UI.** `revoke_verification` is proven; nothing calls it, so
  revocation is SQL-only.
- **Mobile member-area layout** — 2 of 12 routes checked at 375px.
- **Admin approval at scale** — one at a time, no bulk path.
- **Founding-provider grant** — no per-user grant; mobile signup sends no
  `signup_source`, so no app signup can qualify.
- **Lint gates — mobile has no net (item 19).** `site` fails the build at zero
  errors and zero warnings, and caught a real bug within the hour. `admin` (6)
  and `mobile` (73 + 6 tsc) are not wired. In one session the same defect was
  written three times; the two in gated apps were caught by the gate, the
  mobile one by chance. Every class of thing lint catches is landing in mobile
  unchecked, and mobile is the primary client.

---

## Before the app is submitted

**Not the general backlog.** These are gated on preparing a mobile build, and
the general list is things that might never be scheduled. **Read this section
when a submission is being prepared — that is the whole point of it existing
separately.**

Mobile is unreleased and the web covers both roles, so none of this is urgent
today. All of it is wrong to ship.

⚠️ **IAP and the CSAE wording are NOT repeated here.** Both are submission-gated
and both are already under **Blocking launch** above, where they have been
since before this section existed. One item, one home — a checklist kept in two
places is a checklist that disagrees with itself, which is the failure this
whole audit started from.

| | What | Why it waits, and why it cannot be forgotten |
|---|---|---|
| ★ **A model has no bookings list** | `/(app)/sessions` is stylist-only; her whole view of her own bookings is a dashboard of three capped queries — 5 upcoming, 10 pending, completed, and no cancelled booking anywhere. **A missing screen, not a missing filter** | **A whole journey missing on one client**, the same shape as the apply gap. The web has had `/bookings` for both roles since 2 Sep. Audit item 113 |
| **Instagram handle** | Mobile accepts anything in `instagram_handle` and **turns it into a link** — `https://instagram.com/<value>` — so a stored email address goes to Instagram in the URL path. The web was fixed 24 Sep | Audit item 103. Harmless while nobody uses the app; the moment it ships it is a live disclosure |
| **Favourite heart fails silently** | No error handling on the insert or the delete, so a filled heart can sit over a row that does not exist — she believes she will be told about new times and never hears | Audit item 95 |
| **Cancelled bookings** | ✅ Stylist half fixed 24 Sep (item 109). **Untested on device** | Needs `npx expo start -c --dev-client` and a real cancelled booking |
| **Lint** | mobile is at 73 errors + 6 tsc; site is at 0 and gated | A build that cannot be linted cannot be trusted to be reviewed |
| **Member-area layout** | 2 of 12 routes checked at 375px. The three named as riskiest — `/availability`, the chat composer over the keyboard, the portfolio `<dialog>` on iOS — are all unchecked | |

---

## Dated

- **8 October** — the selfie-orphan check. A scheduled task fires, and the check
  is written into `selfie-retention-never-worked.md`. It is the only end-to-end
  proof the purge job will ever get that nobody arranged, so if it passes
  unobserved it proves nothing.
- **Before launch** — the verified tick's "Photo checked" tooltip has never been
  *seen*, because no stylist card has ever rendered. It is a safety claim on
  logged-out, indexable pages.

---

## Where the detail lives

| File | What |
|---|---|
| `audit-records-vs-reality.md` | The audit, all fourteen items, and its closing summary |
| `docs/safety-surface.md` | Report, block and cancel: one word, one shape, both clients. **Read before adding a screen where one user sees another** |
| `scripts/migration-status.mjs` | The ledger, and the three rules for writing a VERIFY block |
| `stripe-webhook.md` | Billing reconcile and the webhook |
| `selfie-retention-never-worked.md` | Retention, the orphan sweep, the October check |
| `report-and-block-without-a-booking.md` | The safety reporting route |
| `subscription-state-reconcile.md` | Subscription state, and the three accounts that were billing unseen |
| `mobile/cavy-handover.md` | Mobile's parked launch state. **History — not current** |
| ↑ **Before the app is submitted** (above) | The mobile-gated list. **Read it when preparing a build**, not when looking for something to do |

---

## Two habits worth keeping

**Check the other client.** A content defect reported on one is often present on
the other for a different reason. The cancellation wording was unreadable on
mobile (clamped) and on web (blank lines collapsed) — same content, two
unrelated causes, one reported.

**Distrust a check that was written when fewer cases existed.** Three separate
mechanisms here were correct for what was present and silently excluded
everything added later: the `(public)` boundary walk, the notification-type
allowlist, and the profile-route ternary. They do not fail — they quietly stop
covering.

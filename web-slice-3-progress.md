# Cavy Web — slices 2 and 3, working record

_Written 10 Aug 2026. Supersedes the scratch plan at `~/.claude/plans/`, which is
NOT version controlled — anything that mattered has been copied here._

---

## Where things stand

**Slice 1 — auth.** Shipped and verified end to end: sign up, confirm, sign in,
sign out, forgot-password, reset.

**Slice 2 — member area.** Complete. Bookings, messages with realtime chat,
notifications, stylist profiles, role-specific dashboards, availability editing,
portfolio with video upload, settings with the blocked list, browse.

**Slice 3 — booking.** Step 1 done (the apply gate, read-only). Steps 2 and 3
were reordered and are also done — see below.

**Migrations 0000–0011 applied, except 0009**, which is `SUPERSEDED BY 0010` and
**must never be run** — its header explains why in detail. `migration-status.mjs`
reports the whole set clean as of 10 Aug.

---

## The requirement that reshaped slice 3

**Nothing on the web may require the app.** Every "in the Cavy app for now"
notice is a defect with a deadline. Seven existed, found by grep rather than
memory. Two are closed — and an **eighth** turned up on 14 Aug that grep could
never have found, because the web has no notice for it and no page to put one
on: a stylist cannot find models at all. Grep finds admissions, not absences.

| Sends you to the app | Where | State |
|---|---|---|
| ~~Unblock someone~~ | chat, stylist profile | **done** — `/settings` |
| ~~Set your location~~ | feed distance notice | **done** — points at `/browse` |
| ~~Editing shop & treatments~~ | stylist dashboard | **done** — `/shop` |
| Finding models to invite | stylist side | **8th — was never on this list.** `stylist-model-discovery.md` |
| Membership | dashboard gate | Stripe |
| ID check | dashboard gate, setup panel | selfie capture |
| Applying for a session | dashboard, stylist page | apply flow |
| Leaving a review | dashboard | reviews |
| Portfolio | (never was one) | `/portfolio` already existed — the dashboard
  note claimed otherwise and was wrong |

### Order, as revised

1. ~~Apply gate, read-only~~ — done
2. ~~Blocked list~~ — pulled forward. It was the only one of the seven that was
   *actively harmful* rather than merely incomplete: a web-only user could block
   someone and not undo it. A control you cannot reverse is one people hesitate
   to use, and the point of blocking being easy is that someone uneasy about a
   stranger acts immediately rather than talking themselves out of it.
3. ~~Browse~~ — done, **deliberately without distance**. Geocoding is a new
   external dependency and in a Bromley/Dartford launch, seeing stylists at all
   matters more than 5-vs-20 miles.
4. ~~Stylist setup path~~ — pieces 1–3 done and verified in a browser; piece 4
   unblocked, its policy hardening closed by `0019`
5. Selfie capture in the browser ← current, nothing left blocking it
6. Stripe / membership
7. Apply flow — depends on 5 and 6
8. Reviews

---

## Stylist setup path — the four pieces

Signup → shop details → treatments → selfie → published.

1. ~~**Setup panel**~~ — `components/StylistSetup.tsx`. On the dashboard while
   unpublished, and always at the top of `/shop`. Four steps: details,
   treatments, the fee, the ID check. **Publishing is shown as an outcome, never
   a button** — `enforce_publish_requires_verified` refuses an unverified
   publish, so a switch would be a control the database overrules.
2. ~~**Shop details**~~ — `/shop`, writes `name`, `bio`, `location_text`.
   Writes `location_text` only. Browse still READS the dead `location` column so
   nobody who filled it in long ago becomes unfindable; writing both would keep
   it alive forever and guarantee the two disagree.
3. ~~**Treatments**~~ — `/shop`, validated against `treatment_categories`
   (active only, server-side) and written to `provider_treatments`.
4. **Selfie upload** — blocked, see below.

### Treatments is a DIFF, and that is the whole point

`mobile/.../edit-shop.tsx:115` deletes every `provider_treatments` row and
re-inserts the selection, minting new uuids each save. Those uuids are not
private to that table: **`availability.active_treatments` is a `uuid[]` of them
and `sessions.treatment_id` points at one.** So on mobile, re-saving Edit Shop
silently detaches every slot's treatment list and leaves existing bookings
pointing at rows that no longer exist — the stylist changed nothing and their
week emptied out.

The web action inserts only genuine additions and deletes only genuine
removals, so a category you keep keeps its id. Removals go one at a time so a
refusal can name the treatment — a row a booking still references may be
undeletable, and "couldn't save" would have the stylist retrying forever
without knowing which chip is the problem.

**Mobile still has the bug.** Same file also ignores `delError` (line 115,
assigned and never thrown), so a refused delete followed by a successful insert
duplicates rows silently.

**Mobile is now fixed** — `edit-shop.tsx` saves a diff, and the rule lives in
the database as of migration `0012`. Full account in
`mobile-treatments-orphan-bug.md`.

### ✅ Piece 4 is UNBLOCKED — and the policy is weaker than its name

Answered 10 Aug against the live `pg_policies`. The relevant row:

```
users upload own verification selfie | INSERT | {authenticated}
  with_check: (bucket_id = 'verification-selfies'::text)
```

So an upload works and piece 4 is a straight port of
`verify-payment.tsx:155-193` (key `${userId}/selfie-${Date.now()}.jpg`,
`image/jpeg`, then insert `{user_id, selfie_url: up.path, status:'pending'}`).

**But it does not enforce "own", despite being called that.** Compare its two
siblings, both of which do:

```
model photos upload     … AND ((storage.foldername(name))[1] = auth.uid()::text)
portfolio photos upload … AND ((storage.foldername(name))[1] = auth.uid()::text)
```

Any authenticated user may therefore write to **any path** in the selfie bucket,
including under someone else's uuid prefix. On its own that is untidy rather
than dangerous — there is no user-facing SELECT (only `admins read verification
selfies`) so the bucket cannot be listed, and no UPDATE policy so nothing can be
overwritten.

The reason it still matters: **`vr_user_policy` is `FOR ALL`, so a user writes
their own `verification_requests.selfie_url` freely.** Point that column at a
path belonging to someone else and the admin reviews *their* selfie while
approving *your* account. Exploiting it needs a path you cannot list and cannot
guess (it carries a millisecond timestamp), so this is a hardening item, not an
incident — but "the ID check reviewed the wrong person's face" is the failure it
leads to, so it should not sit unwritten.

**✅ Closed by `0019`** (applied 14 Aug, verified on a device: selfie submitted
and approved). Note it took TWO policies, not the obvious one — tightening the
storage path stops someone uploading into another user's folder, but does
nothing about pointing `selfie_url` at a path already there, and the reviewer
opens whatever the row names. The second is a RESTRICTIVE policy tying
`selfie_url` to the row's own `user_id`, keyed to `user_id` rather than
`auth.uid()` so admin approvals still work.

### ⚠ A human is still in the chain

The last step is **admin approval**, which sets `is_verified` and
`is_published` (`admin/app/verification/page.tsx:87`). That is correct — a person
should look at an ID check — but "signup → published with no app" still ends at a
manual approval. For a cohort of thirty students that is thirty approvals, and
that is worth knowing before a demo rather than during one.

---

## Decisions that will otherwise be re-litigated

### Founding Provider was a published promise with no mechanism

`/for-stylists` and Terms §5 both promise "the free early-stylist account".
`users.is_founding_provider` was read in four places and **written by nothing**.
A cohort signing up via a course leader's link would have hit a £14.99 fee the
site said they would not pay.

Migration `0011` grants it inside `handle_new_auth_user`: role provider, a
`signup_source` present, and room under `settings.founding_provider_cap` (200).
**This is why Stripe is NOT on the critical path for the cohort** — founding
status settles the fee without payment.

> ⚠️ **That sentence was false in the app until 14 Aug.**
> `verify-payment.tsx` computed `feeCovered` (paid OR founding OR waived) and
> then decided on `paid` alone, so a Founding Provider was shown "Pay £14.99"
> and could not reach the selfie at all. The grant worked; the one screen that
> spends it ignored it.
>
> Found only because a test account was reset to unverified — that screen never
> has to decide for an account an admin already verified, so the fault sat
> behind a state nobody had occupied. Fixed by setting `feeSettled` from
> `feeCovered`. **Re-test this before any cohort onboards**, because it is the
> difference between thirty free accounts and thirty £14.99 walls.

Two limits: mobile signup sends no `signup_source`, so app signups never
qualify; and there is **no manual grant path**, so someone who types the URL
rather than following the link needs an `UPDATE` by hand. An admin toggle is the
obvious next piece.

### The ID check must be described modestly — a rule, not a one-off

The check is a person looking at a selfie holding a handwritten note beside a
profile photo. It establishes that a real person made the effort and that the
photo is not lifted from elsewhere. **It is not identity verification** — no
document is requested, seen or kept.

Copy previously said "confirms you are who you say you are" and "keeps the people
you meet accountable". Both corrected 10 Aug in the dashboard gate and twice in
the privacy policy.

**Why it is a rule:** a model weighs this when deciding whether to be alone with
a stranger. Someone who believes identity was checked against a document accepts
a risk they would not otherwise accept, on the strength of our wording.
Overclaiming transfers real risk onto the person least able to price it. Say less
than is true, never more.

### Consent records hold less, on purpose

`0010` stopped collecting IP and device info and made `session_consents` fully
immutable. The full reasoning is in that file under **"READ THIS BEFORE ADDING
THEM BACK"**. Short version: `content_hash` answers the contested question and an
IP does not, plus Art. 5(1)(c).

### Demo inventory — no re-seeding

`public_stylists` returns zero rows and the feed is empty. **Do not solve this by
seeding fake stylists.** The teardown existed because seeded accounts nearly got
indexed and shipped with a committed password. Demo data outlives the demo.

Instead: for a college, **the cohort are the stylists**, so the demo surface is
the stylist dashboard and needs no inventory. To show the loop, use two real
accounts. For volume before launch, onboard real early stylists — which is what
the Founding Provider offer is for.

### Browse matches `location_text` OR `location`

`location` is the dead legacy column. A stylist who has not re-saved since the
split has their area **only** there, and being unfindable is worse than reading a
column we would rather retire. **Whoever finally drops `location` must fix
`lib/queries/browse.ts` first.**

---

## Constraints for when distance lands

* **Ask on engagement, not on load.** A declined geolocation prompt is close to
  permanent — Chrome makes it hard for a normal user to undo, so asking at the
  wrong moment loses distance for that person for good.
* **Never write a location the user did not choose.** App-set coordinates exist
  (`micky.buckfield@hotmail.co.uk` has them); browser geolocation must not
  silently overwrite one.
* **The manual box is the real path, not the backup.** Plenty decline on
  principle, and a postcode is more accurate than a browser fix anyway.

---

## Still open

**For a solicitor** — all flagged in the files themselves:

* Article 9, in `site/content/legal.ts` §7: patch-test results are health data
  (not arguable); hair type and skin tone may indicate ethnicity (arguable, and
  the core search mechanic); whether the verification selfie is biometric.
* Patch-test retention period — deliberately unset in `0007`, because personal
  injury is 3 years from knowledge, not the 6 used elsewhere.
* The collect-neither decision in `0010`.

**Engineering**

* ~~`verification-selfies` INSERT policy~~ — **closed by `0019`** (applied
  14 Aug, verified on a device: selfie submitted and approved). It tightened the
  storage path to the uploader AND added a RESTRICTIVE policy tying
  `verification_requests.selfie_url` to the row's own `user_id` — the storage
  half alone would not have closed it, because the reviewer opens whatever path
  the row names. **Piece 4 is now clear to build.**
* ~~`site` eslint is broken~~ — fixed: it was the `FlatCompat` bridge against
  eslint-config-next 16's native flat configs. **`admin`'s config works but its
  lint runs nowhere** (`build` is a bare `next build`) and it has 22 errors
  nobody has seen. Open decision: should either app's build fail on lint?
* **Mobile has 15 pre-existing `tsc --noEmit` errors** in `_layout.tsx`,
  `leave-review.tsx` and `sessions.tsx`. Same shape as the eslint finding — a
  check nobody runs.

* **Six published+verified providers have no name** (`paxegi5365@acoxs.com`,
  `pinihe5553@bevriz.com`, `kabayix638@acoxs.com`, `kenado1974@bevriz.com`,
  `lekap67940@acoxs.com`, and one bare uuid). Found 10 Aug in a list of 29
  provider rows.

  **`public_stylists` excludes them** on its content bar, so the open web is
  safe. **`/browse` does not** — `lib/queries/browse.ts:60` filters on
  `is_published` alone and renders `name ?? 'Stylist'`, so they show in the
  signed-in member area as cards labelled "Stylist", today.

  Cause: admin approval sets `is_verified` and `is_published` with no
  completeness check (`admin/app/verification/page.tsx:80,87`), and
  `enforce_publish_requires_verified` only checks verification. Mobile's
  `togglePublished` DOES require a treatment — but admin approve writes
  `providers` directly and bypasses it, so the one path with a check is the one
  path approval never takes. **A cohort walks into this**: nothing enforces step
  order, so a student can submit a selfie before writing any shop details and be
  published empty.

* **Teardown pass for provider rows — parked until slice 3 is done.** Same
  discipline as the session teardown: fails loudly on partial rather than
  half-deleting. 29 provider rows for one real stylist is mostly cruft. NB it
  must not try to delete `reports` (append-only, refused by design) and must
  delete `public.users` before the auth user, per `0003`.
* **`/shop` is unverified in a browser.** It builds, typechecks, passes both
  guards, and correctly redirects to sign-in when signed out — but no stylist
  account has been signed in to look at it. `providers` row, treatment chips and
  the setup panel are all untested against real data.
* **Mobile layout of the member area is unverified.** Only "no horizontal
  overflow on public pages" was confirmed. Riskiest: `/availability` (seven
  columns of `<time>` inputs), the chat composer above a keyboard, and the
  portfolio `<dialog>` on iOS Safari.
* `support@cavybeauty.com` — one line in `site/lib/site.ts` when the mailbox
  exists.
* `PUBLIC_SITE_MODE=live` — gated on real stylist inventory.
* Vercel needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  set (done 10 Aug); local `.env.local` uses dotenv expansion, which Vercel does
  not do.

---

## Two guards worth not removing

**`scripts/check-client-boundary.mjs`** follows the import graph from every
`(public)` entry point. It was rewritten on 10 Aug after being caught passing
with a violation one level down in a shared component — it had only ever checked
direct imports, and every `(public)` page imports from `site/components/`.

**`scripts/check-route-coverage.mjs`** asserts every `(app)` route has a
`proxy.ts` matcher entry. A missing entry costs a stale token — the user is
signed out early, somewhere else, with nothing connecting the two. It caught
`/availability` for real.

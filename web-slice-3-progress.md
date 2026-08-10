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
memory. Two are closed:

| Sends you to the app | Where | State |
|---|---|---|
| ~~Unblock someone~~ | chat, stylist profile | **done** — `/settings` |
| ~~Set your location~~ | feed distance notice | **done** — points at `/browse` |
| Membership | dashboard gate | Stripe |
| ID check | dashboard gate | selfie capture |
| Applying for a session | dashboard, stylist page | apply flow |
| Leaving a review | dashboard | reviews |
| Editing shop & treatments | stylist dashboard | **next** |

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
4. **Stylist setup path** ← current
5. Stripe / membership
6. Selfie capture in the browser
7. Apply flow — depends on 5 and 6
8. Reviews

---

## Stylist setup path — the four pieces

Signup → shop details → treatments → selfie → published.

1. **Setup panel on the stylist dashboard** — the ordered steps, what each is
   for, what "Not published" means. Stylist equivalent of the model gate.
2. **Shop details** — name, bio, location on `providers`.
3. **Treatments** — add/remove against `treatment_categories`, writing
   `provider_treatments`.
4. **Selfie upload** — file to the private `verification-selfies` bucket, then a
   `verification_requests` row.

### ⚠ Unverified, and it decides whether piece 4 is possible

**`verification-selfies` is a PRIVATE bucket and there may be no INSERT policy
letting a user upload their own.** Mobile does it, so something permits it, but
the path has not been read. Check before building piece 4 — being wrong about a
storage policy has already happened once this week.

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

* `verification-selfies` INSERT policy — unverified, blocks setup-path piece 4.
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

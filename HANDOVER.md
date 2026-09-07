# Cavy — where things stand

_Current picture, 7 September 2026. **This file says where we are; it is not a
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
check, report/block, and cancellation. The site is live on Vercel.

**Migrations `0000`–`0030` are applied**, `0009` superseded and must never be
run. The ledger is the authority, not this line:

```bash
$env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'; node scripts/migration-status.mjs
```

**A three-week audit closed on 4 Sep.** Fourteen items; the last five it found by
looking rather than by being listed. Everything below is what it left.

---

## Blocking launch — five, all decisions or chores

**No missing features.** Nothing here needs designing or building; each needs a
call or an afternoon.

| | What | What it needs |
|---|---|---|
| **IAP** | Stripe pays for an in-app digital unlock. Apple's #1 rejection risk | **A decision**, before iOS submit. Consider asking App Review directly |
| **Teardown** | `teardown.mjs` matches `@seed.guineapig.invalid` and refuses any other suffix, by design | The hand-made accounts (`@acoxs.com`, `@bevriz.com`, gmail, hotmail) cleared **separately** |
| **CSAE wording** | Play declaration recorded done; the **submitted text** has never been read against what the product does | A check, ~20 minutes |
| **Listing bar** | Six SEO treatment pages render zero stylists | **One real stylist with a 40-character bio.** Not an inventory problem — see item 11 for the query that says which bar each stylist fails |
| **Sender domain** | Still `no-reply@guineapigapp.co.uk`; five auth templates never tested against a real inbox | The Resend move, and one test send each |

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
- **Lint gates.** `site` fails the build at zero errors and zero warnings, and
  caught a real bug within the hour. `admin` (22) and `mobile` (73 + 6 tsc) are
  not wired and are not at zero.

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

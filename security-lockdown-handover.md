# Security lockdown — handover (RLS + Storage)

_Last updated 2026-07-25. Self-contained so a fresh Claude Code session can pick up cold. Read
alongside `CLAUDE.md` (project context). Both workstreams below are DONE + COMMITTED._

---

## TL;DR — status

| Workstream | Status | Commit |
|---|---|---|
| **RLS lockdown** (13 exposed tables) | ✅ DONE + COMMITTED | `d8b08cc` |
| **Storage lockdown** (model-photos bucket → private + signed URLs) | ✅ DONE + COMMITTED | `b145a65` |
| **Session-status guard + review integrity** | ✅ DONE + COMMITTED | `3154b70` |
| **Suspend/ban enforcement** | ✅ DONE + COMMITTED | `8fa3446` |
| **Payment ownership check** | ✅ CODE COMMITTED — ⚠️ **NEEDS DEPLOY** | `7a898fb` |
| **Availability day/slot desync (#46 + #58)** | ✅ DONE + COMMITTED | `71b08bb` |

All verified end-to-end (anon probe / SQL exploit simulation / on-device). Scripts live in
`supabase/*.sql`.

⚠️ **ONE OUTSTANDING ACTION:** the payment fix is committed but NOT live until someone runs
`npx supabase functions deploy stripe-payment` from the repo root, then re-tests a real subscribe
with card 4242 4242 4242 4242 (12/34, 123).

---

## How to verify exposure (read-only anon probe)

The publishable/anon key is PUBLIC and safe to use. Probe as an unauthenticated client:

```bash
BASE="https://ptluekkhiopowuyvkgnd.supabase.co/rest/v1"
KEY="sb_publishable_g-YDwagWoZBMvrBoZPQmYQ_VXfWZ40T"
curl -s -w "\nHTTP %{http_code}\n" "$BASE/<table>?select=*&limit=3" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# Storage object — public bucket serves it; private bucket returns 400 "Bucket not found":
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://ptluekkhiopowuyvkgnd.supabase.co/storage/v1/object/public/<bucket>/<path>"
```

Interpretation: `HTTP 200 []` on a NON-empty table = RLS protecting it. `200` with rows = LEAK.
Anon write returning `401 / 42501 "violates row-level security policy"` = write locked.
Storage bogus-path returning "Bucket not found" = PRIVATE; "Object not found" = PUBLIC.

**Key lesson:** the Supabase dashboard "RLS Disabled" badge MISLED us — it did not match
`pg_class.relrowsecurity`. Always confirm with the catalog, not the badge:
```sql
select c.relname, c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;
```

---

## Workstream 1 — RLS lockdown (DONE, `d8b08cc`)

**Finding:** Supabase grants anon + authenticated the full privilege set by default, so RLS is the
only lock. 13 tables had policies but RLS was never enabled (dormant) → anon could read/write/truncate.
The sensitive core (users, sessions, subscriptions, verification_payments, admins, messages, providers,
blocks, etc.) was ALREADY rls-on and correct (verified via `pg_class` + anon probe). Untouched.

**Locked (all verified anon→`[]`, anon insert→42501):** availability, portfolio_items,
portfolio_categories, favourites, model_photos, model_photo_categories (fixed an over-permissive
`{public}` SELECT policy), treatment_categories, settings, admin_audit_log, suspensions,
founding_providers, treatments, provider_availability.

Defaults: browse/lookup → `authenticated` read; owner-scoped writes; admin-only for
settings/audit/suspensions/founding_providers; deny-all for legacy treatments/provider_availability.
Full SQL: `supabase/rls-lockdown.sql`.

---

## Workstream 2 — Storage lockdown (DONE, `b145a65`)

**The exposure (closed):** RLS locked the `model_photos` TABLE, but the FILES were in a PUBLIC bucket
served via `getPublicUrl` — anyone with a URL loaded a model's booking photo, no login. An anon curl
returned a real photo.

**Fix:** `model-photos` bucket → PRIVATE; app serves short-lived (1-hour) SIGNED URLs. The DB now
stores the object PATH; `mobile/src/lib/photoUrls.ts` mints signed URLs at render time (tolerant of
legacy full-URL rows; cached by path so `<Image>` URIs stay stable).

**Buckets (confirmed via storage.buckets):**
| bucket | state | notes |
|---|---|---|
| model-photos | PRIVATE (now) | migrated this workstream |
| verification-selfies | private | already correct — untouched |
| portfolio-photos | public | OUT OF SCOPE (flagged — see follow-ups) |
| profile-pics | public | OUT OF SCOPE (flagged — see follow-ups) |

**Code (shipped):** read sites sign before render — `model/[id].tsx` (stylist view; thumb + enlarged),
`model-profile.tsx` (owner gallery), `apply-session.tsx` (library picker). Write sites store `up.path`
(model_photos.photo_url + sessions.photo_urls). `ExistingPhoto` type carries `{ id, path, photoUrl }`.

**SQL (`supabase/storage-lockdown.sql`):** added the one missing `storage.objects` SELECT policy
(`model photos read`, authenticated, `bucket_id='model-photos'`) — INSERT/DELETE already existed,
owner-scoped, no UPDATE needed; backfilled stored URLs → paths; flipped the bucket private.

**Verified:** anon GET of a real object → 400 (bogus-path "Bucket not found" confirms the flag,
cache-proof). Device pass — owner gallery, uploads, stylist cross-view, apply picker all load via
signed URLs. verification-selfies still private. `delete-account` uses the SERVICE ROLE → unaffected.
NB: previously-cached public URLs may serve from the CDN until they expire — harmless (the app never
uses the public path; no NEW anon read succeeds).

---

## Workstream 3 — Integrity fixes (DONE)

- **Session-status guard (`3154b70`, `supabase/session-status-guard.sql`).** The `sessions` UPDATE
  policy let any participant PATCH `status` freely — a model could self-accept an application or
  self-complete a booking (which then unlocked a fabricated review). RLS WITH CHECK can't see the
  old→new transition, so this is a BEFORE UPDATE trigger: accepted/declined/completed = provider
  only; cancelled = either participant (block-driven); completed/declined/cancelled are terminal;
  service role (no JWT) and admins bypass. Verified: model self-complete now fails with 42501.
- **Review integrity (same commit, `supabase/review-integrity.sql`).** reviews INSERT now requires
  the session to be `completed` (meaningful only because the trigger above makes that status
  trustworthy), plus a unique index on (session_id, reviewer_id) — duplicate reviews were prevented
  only client-side, so rating inflation was possible via repeated API inserts.
- **Suspend/ban enforcement (`8fa3446`, `supabase/suspension-enforcement.sql`).** Bans were recorded
  but never acted on. DB: `is_suspended(uuid)` + RESTRICTIVE policies on sessions/messages/reviews
  INSERT and providers UPDATE; `my_suspension()` RPC so a user can read their OWN status without
  opening the admin-only table. App: `SuspensionGate` wraps `(app)/_layout` — one choke point for
  every authenticated screen — showing reason, end date, appeal contact, sign out. The lookup FAILS
  OPEN so an error can't lock out a legitimate user (the DB policies are the real control).
- **Payment ownership (`7a898fb`).** `confirm_subscription` retrieved the subscription by the
  caller-supplied id, checked only that it was active, then marked THE CALLER subscribed — one paid
  `sub_...` could be replayed by any number of accounts for free subscriptions. Now resolves the
  customer FROM the subscription (never the body) and requires `customer.metadata.user_id` to equal
  the JWT user. Other money paths audited and clean. **STILL NEEDS DEPLOY.**
- **Availability day/slot desync (`71b08bb`) — closed BOTH #46 and #58.** Treatments lived in two
  places: `dayTreatments[date]` (the chips the stylist edits) and `daySlots[…].treatmentIds` (what
  the save actually writes). `toggleTreatment` only updated the first, so they drifted — the day
  showed Hair while the DB was written with Nails, and days could be stored with NO treatments
  (which the model's booking screen reads as "any treatment goes"). Diagnosed by logging the payload
  against a DB read-back. Also fixed: the upsert was `ignoreDuplicates:true` (DO NOTHING) so
  slot-level treatment edits silently no-op'd; `is_taken` is now omitted so re-saving can't un-book
  a slot; unresolvable slugs are logged; the empty-treatment guard explains itself.
  NB the model-side fallback at `apply-session.tsx:284` STAYS — it's the safety net for genuinely
  stale/orphaned treatment IDs.

**Data tidy still worth running** — pre-existing slots stored with no treatments (the fix prevents
NEW ones; these need re-saving in the app, which now works):
```sql
select date, start_time, end_time from availability
where provider_id = '49d40aae-a830-41d1-bca8-0fbdb2695455'
  and (active_treatments is null or active_treatments = '[]'::jsonb)
  and date >= current_date order by date, start_time;
```

## Parked follow-ups (NOT started — tracked in Claude Code TaskList)

- **#52 — POST-LAUNCH: tighten model-photos signing.** Narrow the storage SELECT policy + the
  model_photos TABLE read from any-authenticated to "a stylist in an active booking with that model".
- **#53 — stylist can't view a model's application photos.** Investigated → build option (a). Intent is
  explicit: `apply-session.tsx:56` = "Share photos to help the stylist prepare (optional)" — the stylist
  was always meant to see them. Half-built: model uploads to `sessions.photo_urls`, but
  `provider-dashboard.tsx:372` pending query omits `photo_urls` and `ApplicationCard` (:1281) shows the
  note only. BUILD: add `photo_urls` to the pending query + SessionCard type + enrich; render signed
  thumbnails on the card near the note (sign via `signModelPhotos` — paths in the private bucket);
  tap-to-enlarge reusing the `model/[id].tsx` viewer pattern + haptic.
- **DROP legacy tables** `treatments`, `provider_availability`, `verification_attempts` once confirmed
  unused (all currently deny-all under RLS, so they're inert).
- **Public buckets** `portfolio-photos` + `profile-pics` — decide separately if they should be private.
- **Deep-dive backlog:** payment webhook robustness, booking cancel/reschedule, Google closed-testing
  gate, store-listing forms, UGC pre-filter + encryption-declaration compliance items, fresh EAS build
  (needed for icon/splash + all this session's JS).

_(The other RLS-dump findings — session-status guard, review integrity, suspend/ban enforcement —
were all built today; see Workstream 3 above.)_

---

## Key identifiers (see CLAUDE.md for the full list)
- Supabase project `ptluekkhiopowuyvkgnd`. URL `https://ptluekkhiopowuyvkgnd.supabase.co`.
- Anon/publishable key (PUBLIC, safe for probes): `sb_publishable_g-YDwagWoZBMvrBoZPQmYQ_VXfWZ40T`.
- Repo root `C:\Users\micky\Documents\Guinea-pig` (admin/Next.js). Mobile in `mobile\`.
- Run mobile: `cd mobile` then `npx expo start -c --dev-client`.
- Deploy edge fn: from repo ROOT, `npx supabase functions deploy <name>`.
- Model test acct user_id `b0df9c2f-02c5-4fef-afb0-9b184c3b9130` (has model_photos rows — good for testing).
- Micky B provider: `providers.id` `49d40aae-a830-41d1-bca8-0fbdb2695455`.

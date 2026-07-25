# Security lockdown — handover (RLS + Storage)

_Last updated 2026-07-25. Self-contained so a fresh Claude Code session can pick up cold. Read
alongside `CLAUDE.md` (project context). Both workstreams below are DONE + COMMITTED._

---

## TL;DR — status

| Workstream | Status | Commit |
|---|---|---|
| **RLS lockdown** (13 exposed tables) | ✅ DONE + COMMITTED | `d8b08cc` |
| **Storage lockdown** (model-photos bucket → private + signed URLs) | ✅ DONE + COMMITTED | `b145a65` |

Both verified end-to-end (anon probe + on-device). Scripts: `supabase/rls-lockdown.sql`,
`supabase/storage-lockdown.sql`. Nothing outstanding on either — remaining items are the PARKED
FOLLOW-UPS listed at the bottom.

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

## Parked follow-ups (NOT started — tracked in Claude Code TaskList)

- **#46 — empty-slot booking bug.** A model can be shown ALL treatments as bookable on an availability
  day where the stylist ticked NONE (fallback at `apply-session.tsx:284` returns all treatments when a
  slot's `active_treatments` is empty). Fix: require ≥1 treatment to save a slot in `availability.tsx`
  (+haptic on fail); on treatment-delete strip the ID from every slot. The fallback STAYS (safety net
  for genuinely-stale/orphaned IDs).
- **#52 — POST-LAUNCH: tighten model-photos signing.** Narrow the storage SELECT policy + the
  model_photos TABLE read from any-authenticated to "a stylist in an active booking with that model".
- **#53 — stylist can't view a model's application photos.** Investigated → build option (a). Intent is
  explicit: `apply-session.tsx:56` = "Share photos to help the stylist prepare (optional)" — the stylist
  was always meant to see them. Half-built: model uploads to `sessions.photo_urls`, but
  `provider-dashboard.tsx:372` pending query omits `photo_urls` and `ApplicationCard` (:1281) shows the
  note only. BUILD: add `photo_urls` to the pending query + SessionCard type + enrich; render signed
  thumbnails on the card near the note (sign via `signModelPhotos` — paths in the private bucket);
  tap-to-enlarge reusing the `model/[id].tsx` viewer pattern + haptic.
- **RLS-dump findings (separate tasks):**
  - `sessions` UPDATE policy has no status guard → a participant can PATCH `status` freely
    (self-accept/self-complete). Needs a status-transition guard.
  - `reviews` INSERT checks participant but not that the session is completed.
  - Suspend/ban ENFORCEMENT — locking `suspensions` stops tampering, but the app still doesn't ACT on
    a suspension.
  - DROP legacy tables `treatments`, `provider_availability`, `verification_attempts` once confirmed unused.
- **Public buckets** `portfolio-photos` + `profile-pics` — decide separately if they should be private.
- **Deep-dive backlog:** payment webhook robustness, booking cancel/reschedule, Google closed-testing
  gate, store-listing forms, fresh EAS build (needed for icon/splash + all this session's JS).

---

## Key identifiers (see CLAUDE.md for the full list)
- Supabase project `ptluekkhiopowuyvkgnd`. URL `https://ptluekkhiopowuyvkgnd.supabase.co`.
- Anon/publishable key (PUBLIC, safe for probes): `sb_publishable_g-YDwagWoZBMvrBoZPQmYQ_VXfWZ40T`.
- Repo root `C:\Users\micky\Documents\Guinea-pig` (admin/Next.js). Mobile in `mobile\`.
- Run mobile: `cd mobile` then `npx expo start -c --dev-client`.
- Deploy edge fn: from repo ROOT, `npx supabase functions deploy <name>`.
- Model test acct user_id `b0df9c2f-02c5-4fef-afb0-9b184c3b9130` (has model_photos rows — good for testing).
- Micky B provider: `providers.id` `49d40aae-a830-41d1-bca8-0fbdb2695455`.

# Cavy Web — Phase 1

> **Status: phase 1 engineering CLOSED, 7 August 2026.**
> `cavybeauty.com` is live and deliberately **not indexed**. The only remaining switch is
> `PUBLIC_SITE_MODE=live`, which is gated on real stylist inventory, not on anything left to
> build.
>
> **Read §11 first** — it is the authoritative status table and the list of what is actually
> left. Everything before it is the working plan as it was decided, kept because the reasoning
> matters more than the conclusions: several sections record a decision being *changed* after
> evidence contradicted the first answer, and those reversals are the useful part.
>
> **§13 holds the phase-2 blockers**, headed by the two `delete-account` questions — the only
> content blocker left on a store-submission surface.
>
> Operational detail for running and deploying the site lives in `site/README.md`, not here.

## Context

Cavy is a two-sided beauty marketplace (stylists offering discounted treatments ↔ models
acting as practice clients). Mobile + admin are **paused mid-launch** while web is built
(`mobile/cavy-handover.md:12`). There is no public web presence on the new brand domain,
and the app is pre-launch: Stripe is in TEST mode, seed data is still in the database, and
there is almost no real stylist inventory yet.

Phase 1 delivers three things on `cavybeauty.com`: a **conversion shell** (capture waitlist
signups from both sides), **legal pages** (a store-submission requirement, currently served
off-repo on the old domain), and the **SEO engine** — location × treatment landing pages
built to rank for "hair models manchester"-shaped queries before inventory exists.

Public, unauthenticated, read-only. No auth, no payments, no model data.

**Explicitly out of scope this phase:** auth redirect URLs. `guineapigapp.co.uk/auth/reset`
and `/auth/confirmed` stay exactly where they are, untouched — that is a separately
sequenced migration.

### Scope — `site/` only

The phone apps stay paused. **No mobile code is built or modified this phase.**

| Deferred | Why | What still gets built |
|---|---|---|
| **Status posts** (old step 8) | The public view reads `status_posts`, which is app-side. No table, no composer, no `public_stylist_status`, no moderation-queue tab. | `/stylist/[slug]` ships with the status block **present but rendering nothing on empty**. `providers.status_text` / `status_expires_at` untouched; `public_stylists` **keeps** `status_text`, so no drop/create and no grant reissue this phase. |
| **Portfolio display + video** | Blocker is **consent (§8), not code** — items depict models' faces and no per-item consent exists. Do not grant, do not build the consent flow. | `public_stylist_portfolio` written and ungranted, with `media_type` and `null::text as poster_url`. Grid present, rendering nothing on empty. |

Both are built so enabling them later is **a grant plus a revalidate — never a page rewrite**.
The portfolio grid is designed for mixed media from the start: poster frame, play affordance,
and no layout shift between image and video tiles.

### Definition of done

`cavybeauty.com` serving legal pages canonically with the 301s in place · waitlist capturing
both roles · national treatment pages indexed · city pages in tranche · stylist profiles live.

---

## 1. Host decision — confirmed

**Primary: apex `https://cavybeauty.com`. `www` 301s to apex.**

Reasoning:
1. The domain is on **Cloudflare Registrar** (`mobile/cavy-handover.md:227`). Cloudflare does
   CNAME flattening at the apex, which removes the only real technical argument for `www`
   (the RFC prohibition on apex CNAMEs).
2. The existing `guineapigapp.co.uk` already treats apex as primary — it is listed first in
   the waitlist function's CORS allowlist (`supabase/functions/waitlist-signup/index.ts:24`).
   Staying consistent avoids a second convention.
3. Shorter and cleaner for a consumer beauty brand — app store listings, Instagram bio, print.
4. The cookie-isolation argument for `www` does not apply: Supabase SSR cookies are set
   host-only (no `Domain` attribute), so they do not leak to `admin.cavybeauty.com` from the
   apex anyway. Phase 1 is cookieless regardless.

Implementation: add both hostnames to the Vercel project, set apex as primary, let Vercel
issue the 308 for `www`. Enforce a single canonical origin in `metadataBase`.

---

## 2. Architecture

**A new, separate Next.js App Router app at `site/`, its own Vercel project.**

Non-negotiable reason: `proxy.ts` at the repo root is a real Next 16 proxy (the renamed
`middleware` convention) whose matcher is a **catch-all with no allowlist**:

```ts
matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)']
```

It redirects any request without an authenticated `is_admin()` session to `/login`. Adding
marketing routes to the existing `app/` tree — **including under a route group**, since route
groups do not appear in the URL — would redirect every public visitor and Googlebot to a
login page. A separate app directory with its own build is the only clean isolation.

`mobile/` is the working precedent for a sibling app: self-contained, own `package.json`, own
`node_modules`, no workspace linkage. Three gotchas that follow from that:

- Root `tsconfig.json` has `include: ["**/*.ts", "**/*.tsx"]` with only `node_modules`
  excluded. **Add `site` to the root `exclude`** or the admin app's TS program swallows it.
- `.gitignore` anchors `/node_modules` and `/.next` with a leading slash. **Add `site/node_modules`
  and `site/.next`.**
- **CORRECTED 7 Aug 2026: there is no Vercel account and no existing project.** The admin
  console has never been deployed — it has only ever run locally via `npm run dev`. An earlier
  note here inferred "dashboard-configured with Root Directory `/`" from the absence of
  `vercel.json`; that inference was wrong. Consequences: only **one** Vercel project is created
  (the site, Root Directory `site`), and the Ignored Build Step is needed on that project alone.
  It is still worth setting, so pushes touching only `mobile/`, `seed/` or `supabase/` do not
  burn a build.
- **Hobby plan caveats** (signing up 7 Aug 2026): the Vercel Firewall/WAF is Pro-only, so
  `site/lib/rateLimit.ts` is the *only* control on `/api/waitlist` rather than a second layer —
  Cloudflare rate-limiting is the free alternative, and the DNS is already there. Separately,
  Hobby is licensed for non-commercial use and Cavy charges for subscriptions and verification;
  enforcement means the site goes down, so worth resolving before the real domain points at it.

**Do not reuse `lib/supabase.ts`.** It exports `createBrowserClient` from `@supabase/ssr`,
which is cookie/session-bound. Cookie access makes routes implicitly dynamic and opts them
out of static rendering — fatal for this app. `site/` gets a plain `createClient` from
`@supabase/supabase-js` with `auth: { persistSession: false, autoRefreshToken: false }`.

Name the env var **`SUPABASE_ANON_KEY`, without the `NEXT_PUBLIC_` prefix**. The key is public
and this is not a security boundary — it is a forcing function. Without the prefix the key is
unreachable from Client Components, so it becomes impossible to accidentally write a
client-side query that bypasses the ISR cache and breaks SEO for that content.

---

## 3. Route tree

Provider profiles are **conversion surfaces**. The ranking engine is location × treatment.

```
/                              Home — dual CTA (stylist / model), waitlist
/for-stylists                  Stylist acquisition
/for-models                    Model acquisition
/how-it-works                  Explainer

── SEO ENGINE ──────────────────────────────────────────────
/[treatment]                   6 national pages
                               /hair-models  /makeup-models  /lash-models
                               /brow-models  /nail-models    /spray-tan-models
/[treatment]/[city]            6 × N local pages
                               /hair-models/manchester

── CONVERSION SURFACES ─────────────────────────────────────
/stylists                      Directory hub
/stylist/[slug]                Stylist profile

── LEGAL (canonical here after the 301) ────────────────────
/terms  /privacy  /community

── INFRASTRUCTURE ──────────────────────────────────────────
/sitemap.xml   /robots.txt   /opengraph-image
/api/waitlist                 Route Handler proxy → waitlist-signup edge fn
```

### Route-tree notes

**Treatment slugs are an explicit map in `site/`, not derived from the DB.** The DB slugs
would give `/lashes-models` and `/brows-models`, which read badly. Hardcode:

| `treatment_categories.name` | URL slug |
|---|---|
| Hair | `hair-models` |
| Makeup | `makeup-models` |
| Lashes | `lash-models` |
| Brows | `brow-models` |
| Nails | `nail-models` |
| Spray Tan | `spray-tan-models` |

**Root-level dynamic segments are safe here** because Next App Router matches static segments
before dynamic ones — `app/terms/page.tsx` wins over `app/[treatment]/page.tsx`. Set
`dynamicParams = false` on `[treatment]` so only the six known slugs resolve and everything
else 404s properly.

**City list is curated in code, not derived from data** (see §5 for why). Launch tranche —
8 cities where supply is most likely: `manchester, birmingham, leeds, glasgow, liverpool,
bristol, london, nottingham`. That is 6 national + 48 local = 54 pages. Expand in tranches.

> ⚠️ **Doorway-page risk.** 6 × N templated pages on a brand-new domain with near-zero
> inventory is the pattern Google penalises site-wide. Mitigations: start at 8 cities not 30;
> each page carries genuinely distinct copy and a live local stylist count; and city pages stay
> `noindex` until the page has real content. National treatment pages index first.
>
> **Status posts help here, but only on `/stylist/[slug]`.** They are genuinely unique,
> stylist-authored, regularly-changing text — the strongest anti-thin-content signal available
> and a real reason for a crawler to return. They do **not** appear on `/[treatment]/[city]`,
> so they do nothing for the doorway risk on the location pages; that risk is still managed by
> the tranche approach above. And because posts expire after 48h, a page can revert to thin at
> any time — which is exactly why the §6 content bar is **not** relaxed on the strength of them.

---

## 4. Data each page needs

All reads go through new `public_*` views (§6), anon key, Server Components only.

| Route | Data | Source | `revalidate` |
|---|---|---|---|
| `/` | Static copy; 3–6 featured stylists (name, avatar, location, categories, rating) | `public_stylists` limit 6 | 3600 |
| `/for-stylists` | Static copy only. Founding-provider scarcity line. | — | static |
| `/for-models` | Static copy only. | — | static |
| `/how-it-works` | Static copy — reuse the cost/expectation prose verbatim from `mobile/src/app/(app)/provider/[id].tsx:483-490` | — | static |
| `/[treatment]` | Category name + copy; national stylist count; up to 12 stylists for that category | `public_categories`, `public_stylists?category_slugs=cs.{x}` | 900 |
| `/[treatment]/[city]` | As above filtered to city; local count; waitlist CTA | `public_stylists` + `location_slug` filter | 900 |
| `/stylists` | Paginated directory: slug, name, location, categories, rating, review_count, is_verified, avatar | `public_stylists` | 900 |
| `/stylist/[slug]` | name, bio, location, categories, is_verified, rating, review_count, `has_open_slots`, avatar, banner, `status_text`. **Status block + portfolio grid render present-but-empty this phase** (see Scope). | `public_stylists?short_id=eq.` | 600 |
| `/terms` `/privacy` `/community` | MDX in-repo. No DB. | — | static |
| `/sitemap.xml` | slug + last_modified for all stylists; all treatment and city routes | `public_stylists` | 3600 |

**Not on any public page:** `latitude`, `longitude`, `user_id`, `is_published`, `shop_handle`,
portfolio images, review text, the availability slot list, and every model-side table.
**The model-side status feed is authenticated and distance-filtered and stays that way** — this
phase and later. The public web gets a stylist's own posts on their own page, nothing else. No
aggregated, cross-stylist or location-filtered feed of status posts is ever exposed publicly;
that would be a live map of who is free where.

**Availability is a boolean only** (`has_open_slots`), per your decision. Publishing a lone
worker's exact free times at a physical location is a safety exposure, and the boolean is the
part that actually converts.

---

## 5. The location problem (blocks the SEO engine)

Location × treatment is the ranking engine, but **there is no reliable location taxonomy**:

- `providers.location_text` is free text — the column `edit-shop.tsx:106` and `seed.mjs:287`
  actually write, and that browse + admin read.
- `providers.location` is a **second, legacy column** that nothing writes any more but that
  `mobile/src/app/(app)/provider/[id].tsx:151,396` still reads — so the mobile shop page shows
  a blank location for every stylist who has saved via edit-shop. **Pre-existing live bug**,
  logged below, not fixed here.
- No postcode, no address, no PostGIS. `latitude`/`longitude` exist but are off limits publicly.

**Phase 1 approach — no migration, no geocoding:**

1. The view exposes both `location` (display, coalescing the two columns) and
   `location_slug` (normalised via `slugify`).
2. City pages match with PostgREST `location_slug=like.*manchester*`, tolerating
   "Manchester, UK" → `manchester-uk`.
3. **City pages exist and rank regardless of whether any stylist matches.** Pre-launch, the
   page's job is to capture the search intent and convert to waitlist — not to list inventory.
   Empty-state copy does the work.

Data debt to clear before city pages can be trusted at scale (phase 2): a real `city` column
or FK, backfilled from lat/lng by reverse geocode, with the free-text field retired.

---

## 6. Exposure layer — explicit-column views

**The `anon` role can read nothing today.** Every RLS policy in `supabase/*.sql` is
`to authenticated`, deliberately (`supabase/rls-lockdown.sql:24-25`,
`supabase/model-attributes-read.sql:24`, `CLAUDE.md:53`). This is net-new SQL.

**Approach: explicit-column `public_*` views granted to `anon`. Not `to anon` RLS policies.**

RLS is row-level and has no column dimension — a `to anon` policy on `providers` would publish
`latitude`, `longitude`, `user_id` and every future column. A view is column-explicit by
construction: the private columns are not filtered out, they do not exist in the object.
Nothing on any base table changes, so the mobile app and admin console cannot be affected, and
rollback is five `drop view`s.

Views default to `security_invoker = false`, so they run as owner and bypass RLS on the base
tables. **That is deliberate** — it lets the view join on `providers.user_id` without exposing
it. The Supabase linter will flag `security_definer_view`; that warning is expected here.

**Corollary that must not be forgotten:** Supabase's default privileges auto-grant SELECT on
new views in `public` to `anon`. Grant + definer = full exposure with no policy involved. So
every view carries an explicit `revoke` before its `grant`, and no helper view containing
lat/lng or model data may ever be created in `public`.

Views to create:

| View | Granted to anon? | Contents |
|---|---|---|
| `public_categories` | ✅ | active treatment categories |
| `public_stylists` | ✅ | id, computed `slug`, `short_id`, name, bio, `location`, `location_slug`, region, avatar, banner, is_verified, level, status_text, categories[], category_slugs[], computed rating + review_count, `has_open_slots`, last_modified |
| `public_stylist_status` | ⏸ **not this phase** | deferred with the app-side table — see Scope and §6a |
| `public_stylist_portfolio` | ❌ **written, ungranted** | id, provider_id, media_url, `media_type`, `null::text as poster_url`, category_name — requires `moderation_status = 'approved'` |
| `public_stylist_reviews` | ❌ **written, ungranted** | rating, comment, tags, created_at — **no reviewer identity at all** |

Key decisions inside `public_stylists`:

- **URL key is a view-computed `slugify(name)-<8 hex of id>`, not `shop_handle`.**
  `shop_handle` is client-generated as `first-lastinitial`, has no uniqueness check, cannot be
  edited, is inconsistent between real and seed data, and publishes a real first name as the
  canonical URL. The computed slug needs no unique index and no app change. Resolve on
  `short_id`, `permanentRedirect` if the slug drifted.
- **Rating reads `providers.rating` / `review_count` — corrected 2026-08-07.** The plan
  originally computed the aggregate because no trigger appeared in the repo. `pg_trigger` shows
  `trg_recompute_provider_rating` on `public.reviews` (AFTER INSERT OR DELETE OR UPDATE), so the
  denormalised columns *are* maintained and the view reads them. Still emit `AggregateRating`
  only when `review_count >= 1` — `ratingValue: 0` invalidates the page's rich result.
- **No `last_modified` column, and no `lastModified` in the sitemap.** `providers.created_at`
  does not exist (confirmed by probe), so there is no base timestamp; the only candidate is
  `max(reviews.created_at)`, which is `NULL` for nearly every stylist. An always-`now()` lastmod
  trains Google to ignore the field, which is worse than omitting it.
- **Content bar in the `WHERE`:** published AND non-empty name AND `length(bio) >= 40` AND
  ≥1 category. Thin stylist pages never reach the index in the first place.
  **Status posts do not count toward this bar and do not relax it** — they expire after 48h,
  the bio does not. A page must stand up on its permanent content alone.
- Kill switch: `revoke select on public.public_stylists from anon;` takes the entire public
  data surface offline in one statement, no deploy.

`notify pgrst, 'reload schema';` is mandatory after the DDL or the endpoints 404 until restart.

### 6a. Status posts — ⏸ DEFERRED, design recorded

**Not built this phase.** The public view reads `status_posts`, which is app-side, and the phone
apps are paused. No table, no composer, no `public_stylist_status`, no moderation-queue tab.
`providers.status_text` / `status_expires_at` stay untouched and `public_stylists` keeps
`status_text`, so there is **no drop/create and no grant reissue this phase**.

What `site/` does build: `/stylist/[slug]` carries the status block, rendering nothing while the
query returns empty — so enabling it later is a grant plus a revalidate, not a page rewrite.

Everything below is the recorded design for when the app-side work resumes.

<details><summary>Deferred design</summary>

Depends on `status_posts`
(`provider_id, body, created_at, expires_at default now() + interval '48 hours', moderation_status`).

**`status_posts` supersedes `providers.status_text` / `status_expires_at` — decided, deferred.**
Those columns already implement a single, self-expiring stylist status, rendered on the mobile
shop page with a pulsing dot and an "Expires in 3h" label
(`mobile/src/app/(app)/provider/[id].tsx:47-48`). Leaving both live long-term would recreate the
`location` vs `location_text` split exactly. When it lands it is **one change**:

1. Migrate existing non-expired `status_text` values into `status_posts`.
2. Update `mobile/src/app/(app)/provider/[id].tsx` to read the new table.
3. Drop `status_text` and `status_expires_at` from `providers`.
4. **Remove `status_text` from `public_stylists` in the same change.** This forces a
   `drop view` + `create view` rather than `create or replace` — replace cannot drop a column —
   so the `grant` must be reissued afterwards or the public site goes dark. The one place in
   the plan where the grant is not preserved automatically.

**`moderation_status text not null default 'pending'`** — fail-closed, so nothing reaches the
open web without explicit approval. Matches the existing `portfolio_items` convention, so the
admin queue at `app/moderation/page.tsx` gains a tab rather than a new concept.

**The banned-word auto-screen ships with step 8, not after.** A 48h expiry against manual
review latency would otherwise make an approved-12h-late post worthless. On write: screen the
body against the wordlist, promote clean posts to `approved` immediately, queue the rest.
Reuse the existing bio wordlist concept from `app/moderation/page.tsx` — extract it to a shared
module rather than copying it, so there is one list to maintain. The `pending` default still
does the safety work: it is what the row holds until the screen has run, and what a flagged
post keeps until a human clears it.

**Post bodies are plain text.** Links stripped at write time — no `rel="ugc"`, no markdown, no
autolinking, no HTML. **Enforced server-side**, not only in the dashboard composer: a composer
check is trivially bypassed by hitting PostgREST directly with the author's own token. Strip in
a `BEFORE INSERT OR UPDATE` trigger on `status_posts` so the guarantee holds regardless of
client. The public page then renders the body as text with no parsing step at all, which also
removes the injection surface entirely.

RLS on the new table is app-side work: `authenticated` policies, owner-scoped writes. The
distance-filtered model feed reads it under `authenticated`; the public view is separate and
additionally requires `approved` + unexpired.

**`last_modified` must stay monotonic — `max(created_at)` over ALL rows for the provider, with
no status and no expiry filter.**

```sql
greatest(p.created_at, agg.last_review_at, posts.last_post_at)
  -- posts.last_post_at = max(created_at)  -- UNFILTERED. No moderation_status, no expires_at.
```

Any filter breaks it. Expiry is the obvious one — posts age out and the max drops. But
`moderation_status = 'approved'` fails the same way and less visibly: a takedown flips a row
out of the filter, the max falls back to an older post, and `lastmod` moves *backwards* — the
exact corruption the rule exists to prevent, triggered by precisely the event where you most
want Google to recrawl. **Visibility gating belongs in `public_stylist_status` alone**;
`last_modified` only answers "when did anything about this provider last change".

Index: `create index on status_posts (provider_id, created_at desc);` — unfiltered, matching the
aggregate. A second partial index on `moderation_status = 'approved'` serves the visible-posts
read.

`revalidate` on `/stylist/[slug]` stays **600**, unchanged. Consequence: a post can remain
visible for up to 10 minutes past `expires_at`, and a newly approved post can take up to 10
minutes to appear. Both are acceptable at a 48h lifetime. On-demand revalidation (phase 2)
removes the lag if it ever matters.

</details>

### 6b. Portfolio — ⏸ DEFERRED, built forward-compatible

**`public_stylist_portfolio` is written this phase and stays ungranted.** The blocker is
**consent (§8), not code**: items depict models' faces and no per-item consent exists. Do not
grant it, and do not build the consent flow this phase.

Write the view now with `media_type` and `poster_url` so enabling display *and* video later is
a grant, not a rewrite. `media_type` already exists on `portfolio_items`. **`poster_url` does
not** — select `null::text as poster_url` as a placeholder. `create or replace view` can add
trailing columns and can swap a placeholder for a real column of the same type, but cannot
drop, reorder or retype existing ones. So the placeholder is genuinely forward-compatible and
needs no base-table change in this read-only project.

**The grid ships too, rendering nothing while the query returns empty** — and it is designed
for mixed media from the start, because retrofitting video into an image-only grid is the
rewrite this is meant to avoid:

- Fixed aspect-ratio tiles so an image and a video tile occupy identical space — **no layout
  shift** when video appears later, and no CLS penalty on an indexed page.
- Poster frame is the tile image for video (`poster_url`), with `media_url` only loaded on
  interaction.
- A play affordance rendered from `media_type`, not from a URL extension sniff.
- `<video>` gets `preload="none"` and `playsInline`; never autoplay on a page we want indexed.

---

## 7. Preflight — ✅ DONE 2026-08-07, both leaks confirmed and closed

Fix applied: `revoke execute … from public, anon` on all 8 anon-callable functions,
`revoke select on public.public_profiles from public, anon`, and
`alter default privileges in schema public revoke execute on functions from anon` to stop it
recurring. **Verified from outside with the anon key — all 9 now return `401 / 42501`.**
`authenticated` retained its explicit grant throughout, so the paused apps are unaffected.

**`confirm_patch_test` — investigated, no incident.** Its `UPDATE` is scoped
`and model_id = auth.uid()`; for anon `auth.uid()` is NULL, so zero rows match and it raises.
Anon-callable but never anon-exploitable — it failed closed, and the identical exception for
valid and invalid ids means it was not even an existence oracle. No patch test could have been
confirmed by a stranger. The revoke stands as defence in depth.

(Also learned: the column is `patch_tests.model_id`, not `model_user_id`, plus
`model_confirmed_at`.)

Trigger functions were deliberately left out of the revoke (see §7c).

---

## 7 (original diagnostics, retained for the record)

Two suspected **live** anon leaks, unrelated to this project, found while planning. Fix and
regression-test these first; do not let them ride along with the marketing work.

**7a. CONFIRMED LIVE — every `SECURITY DEFINER` function is anon-executable.** Probed
2026-08-07 with the public anon key: `rpc/nearby_models` returned **28 model records**
(`first_name, last_initial, profile_pic_url, is_verified, distance_mi, hair_colour, hair_type,
hair_length, skin_tone`).

`distance_mi` is computed against **caller-supplied** coordinates, so varying `p_lat`/`p_lng`
across a few calls trilaterates each model's real location. With `instagram_handle` from 7b
that is a stalking vector, not merely a data leak.

**The cause is not a missing `revoke … from public`.** `pg_proc.proacl` shows every function
carrying `{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
service_role=X/postgres}` — `anon` holds an **explicit** grant, from Supabase's
`alter default privileges … grant all on functions to … anon …`. Therefore:

- **`revoke … from public` alone is ineffective** — it clears only the `=X/postgres` entry and
  leaves `anon=X/postgres` live. The revoke must name `anon`.
- **Revoking is safe for the apps:** `authenticated=X/postgres` is independent of both and
  survives untouched. Confirmed from the ACL, not assumed.
- Fixing the **default privilege** matters as much as the revokes, or the next function
  created in the SQL editor reopens it.

Callable (non-trigger) functions found live, **8 of which the repo does not document**:
`nearby_models`, `is_suspended(uid uuid)` (note: `uid`, not `p_user_id`), `my_suspension`,
`is_admin`, `has_open_availability(p_provider_id uuid)`, plus three absent from `supabase/*.sql`
entirely — `taken_slots(p_provider_id, p_date)` (exposes booked slots),
`has_valid_patch_test(p_model, p_provider, p_category)` (health-adjacent oracle), and
**`confirm_patch_test(p_test_id uuid)` — a definer WRITE reachable by anon**. Patch tests are
the allergy check before dye; inspect `prosrc` before anything else.

**7b. CONFIRMED LIVE — `public_profiles` is anon-readable.** Probed 2026-08-07: returns rows to
the anon key. Definition (captured from `pg_views`; it was in no repo file):

```sql
SELECT id, first_name, last_initial, profile_pic_url, instagram_handle FROM users;
```

**No `WHERE` clause**, definer semantics, explicit `anon` grant — so it publishes every row of
`users`, models included, `instagram_handle` and all. It is also the **only** view in `public`,
so there is no third definer-view leak.

Fix is `revoke select … from public, anon` — **not** `security_invoker = true`. The view exists
precisely to serve cross-user reads that `users` RLS blocks, so flipping it to invoker would
break the mobile app (`sessions.tsx:130`, the reviewer names on `provider/[id].tsx`).
`authenticated` keeps its grant.

Verify both, plus capture the **uncommitted live `providers` policy** (there is no
`supabase/migrations/` dir — the "published-or-own" policy exists only in the live DB):

```sql
-- capture the only copy of the live policies
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public' order by tablename, policyname;

-- 7a: anything with anon_can_execute AND security_definer is a live RLS bypass
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' order by anon_can_execute desc, p.prosecdef desc;

-- 7b: for VIEWS, a true here means fully exposed — no policy involved
select c.relname, c.relkind, c.reloptions,
       has_table_privilege('anon','public.'||quote_ident(c.relname),'select') as anon_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','v') order by c.relkind, anon_select desc;

-- view definitions (public_profiles included) are not in the repo
select viewname, definition from pg_views where schemaname='public';
```

Also confirm before writing the DDL: does `providers.created_at` exist (drives `lastmod`), and
what is `has_open_availability`'s exact signature.

---

## 8. Consent flags — where they would live (noted, not built)

Both ungranted views need a consent basis before they can be granted. Recording the design now
so the later change is small; **no flow is built this phase**.

> **Revised 2026-08-07 — a consent subsystem already exists; do not add boolean columns.**
> `consent_documents (id, version, body, created_at, is_active)` holds versioned consent text,
> and `session_consents (id, session_id, user_id, consent_document_id)` records who accepted
> which version for which session. Both are write-locked by `prevent_mutation` triggers, so
> acceptance records are immutable. Neither is in `supabase/*.sql`.
>
> So the mechanism is **document versioning, not per-item flags**: publish a new
> `consent_documents` version whose body covers public web display, and the existing
> `ConsentGate` captures acceptance into `session_consents` as it already does. The public view
> then joins through to require acceptance of a version at or above the public-display one.
>
> This preserves the "no retroactive publication" guarantee more robustly than a boolean
> default: existing `session_consents` rows point at older document versions that never
> mentioned public display, so they simply do not qualify. Nothing to backfill, nothing to
> mis-default.

**Portfolio.** Consent belongs to the **model depicted in the photo**, not the stylist who
uploaded it. Requires: acceptance of a public-display consent version via `session_consents`,
**plus** a stylist-side opt-in (`providers.portfolio_public_opt_in`, which does not yet exist),
**plus** the existing `moderation_status = 'approved'`. Open question to resolve when this is
built: `portfolio_items` has no `session_id`, so the link from an image back to the consenting
model's session is not currently expressible — that join has to be established first.

**Reviews.** Consent belongs to the **review author** (a model). Same mechanism: a
public-display consent version, accepted at or before the review. Every existing review was
written with no notice of public display, so none qualifies retroactively — which is the
intended outcome.

Both also need the privacy policy updated before the grant — the current one almost certainly
does not cover republishing user-authored content to the open web.

**Status posts need no consent flag.** The stylist authors them about their own business and
publishes them from their own dashboard, so consent is structural rather than recorded — there
is no third party in the content. The only requirement is that the terms say so: covered by the
same clause as §9 step 5, not a separate mechanism. Moderation, not consent, is the control
here (§6a).

---

## 9. Legal pages

`cavybeauty.com` becomes canonical. `guineapigapp.co.uk` **301s only** `/terms`, `/privacy`,
`/community`. The shipped mobile app hardcodes those URLs in
`mobile/src/app/(app)/settings.tsx:53-55`, `subscribe.tsx:23`, `verify-payment.tsx:27` and
`screens/auth/SignupScreen.tsx:21-22` — following the redirect means **no app release is needed**.

`/auth/reset` and `/auth/confirmed` on the old domain are **not touched**.

Steps:
1. Retrieve the live prose from `guineapigapp.co.uk/{terms,privacy,community}` and commit it to
   `site/content/` as MDX. This is currently the only copy and it is not in version control.
2. Preserve verbatim: the **CSAE clause** (Play child-safety requirement — must stay publicly
   accessible), **ICO registration ZC196530**, and the trading-name line *"Cavy is a trading
   name of Guinea Pig App Ltd, registered in England & Wales, company no. [NUMBER]."*
   — `[NUMBER]` is still an unfilled placeholder.
3. Terms **§9** is linked from the refund/cancellation copy on both paid screens; keep the
   anchor stable.
4. Apply the three path-scoped 301s at the old host.
5. Fold in the drafted `privacy-admin-access-clause.md` (still unpublished), and add a clause
   covering **public display of stylist profiles and stylist-authored status posts** — the
   current policy covers neither. One clause, both surfaces. This is the clause §8 defers the
   portfolio and review grants against, so drafting it once unblocks all three.

---

## 10. Waitlist

Do **not** call the edge function from the browser. `supabase/functions/waitlist-signup/index.ts:22-25`
allowlists only the two `guineapigapp.co.uk` origins, and it does not reject others — it just
omits the `Access-Control-Allow-Origin` header. From `cavybeauty.com` that means **the row is
still inserted server-side while the user sees a network error**, and they retry.

Instead: `site/app/api/waitlist/route.ts` proxies the POST server-side. Server-to-server sends
no `Origin` header, so CORS never applies, no function redeploy is needed, and it gives a place
to rate-limit. Preserve the existing contract: `first_name`, `email`, `role`
(`'stylist' | 'model'`), `consent: true` required, optional `city` / `social_handle`, and the
`company` honeypot.

---

## 11. Sequencing — ✅ PHASE 1 ENGINEERING CLOSED, 7 Aug 2026

Everything still open is a business decision, not a build task.

| # | | Status |
|---|---|---|
| 1 | Preflight + anon leak fixes (§7) | ✅ Shipped first, own change. Both suspected leaks were real, confirmed live and closed; re-verified externally. |
| 2 | Exposure DDL (§6) | ✅ Applied. `public_stylists` + `public_categories` granted; portfolio and reviews written, ungranted. Private columns verified **absent** (`400 42703`), not merely filtered. |
| 3 | `site/` scaffold + Vercel project | ✅ Live at `cavy-one.vercel.app`. Hobby, Root Directory `site`, one project only. |
| 4 | Conversion shell + legal + `/api/waitlist` | ✅ Homepage, `/for-stylists`, `/for-models`, `/how-it-works`, four legal pages. Waitlist verified end-to-end into the admin dashboard. |
| 5 | SEO engine | ✅ Six national treatment pages, distinct copy each. City pages built but **not routed** — held deliberately. |
| 6 | Seed teardown | ✅ Run. 7 of 9 deleted; 2 blocked by an FK and **banned** (`banned_until = infinity`), sign-in refused — verified. Their app data and files are gone; `public_stylists` returns 0 rows. |
| 7 | `PUBLIC_SITE_MODE=live` | ⏸ **Deferred — gated on inventory.** |

**Done but not originally planned:**

- **Admin console moved out of the repo root into `admin/`.** The root was not a neutral place
  for an app: Next resolves convention files relative to the build root, so `proxy.ts` — the
  catch-all auth gate — was being compiled into the *site's* build. Two Vercel deploys failed on
  it, and only because `@supabase/ssr` isn't a site dependency. Had it resolved, the public site
  would have shipped behind a login wall. The workarounds went with the cause:
  `outputFileTracingRoot`, the tsconfig excludes, the per-app `.gitignore` entries. Stale root
  `app.json`/`eas.json` deleted at the same time.
- **Public seed-password exposure closed.** `seed.mjs` hardcoded a working password in a public
  repo while two seeded accounts survived teardown. Signing in would have granted the
  `authenticated` role — which RLS opens to model attributes, Instagram handles, provider
  coordinates and `nearby_models`. Password is now generated per run; the accounts are banned.
- Rate limiting on `/api/waitlist`; branded 404 and error boundary; OG card; six security
  headers.

**Deferred to a later phase** — recorded so the sequencing stays explicit:

- **Status posts** (§6a) — resumes with the phone apps.

  **Step one is adopting `supabase/migrations/`** — decided 8 Aug 2026, deliberately *not* done
  as a standalone task. The status-posts work brings real new schema (a table, a trigger, a
  view, a grant, a column migration), so the workflow gets exercised on live work rather than
  established in the abstract and then quietly abandoned.

  Two constraints on that design, both from Micky, both non-negotiable:

  1. **It must fit write-file-then-paste-into-the-SQL-editor.** A CLI-only flow will not be
     adopted. The migration file is written and committed *first*, then pasted. A process that
     fights how the work actually happens will be bypassed, and a bypassed process is worse
     than no process — it produces a record that looks authoritative and is wrong.
  2. **"Did this run?" must have an answer that is not memory.** Recorded state that can be
     queried, not a convention someone is trusted to follow. This is the constraint that rules
     most designs out: a naming convention or a checklist is exactly what already failed and
     produced 89 undocumented policies.

  Propose the setup at the start of that work, not before.

  Then the status-posts work itself: server-side link-strip trigger + banned-word auto-screen;
  migrate `status_text` → `status_posts`; repoint `provider/[id].tsx`; drop the old columns;
  `drop`/`create` `public_stylists` without `status_text` and **reissue the grant**; add the
  unfiltered `last_post_at` term; create and grant `public_stylist_status`; extend the admin
  queue; surface the latest 3.
- **Portfolio display + video** (§6b) — a `grant` once the §8 consent basis exists. The grid
  and view are already built for it.

### ✅ CONSENT CAPTURE — LIVE AND VERIFIED, 8 Aug 2026

Migrations 0000 and 0001 applied. First real `session_consents` row written:
**v2, hash `e3173ccd…`, bound to session `19c47ffa…`** — the first evidence in this project's
history that anyone agreed to anything before a treatment.

**Slot-race behaviour tested, not asserted** (constraint 4). Booking a slot already held by an
active session, through `create_session_with_consent`:

| | |
|---|---|
| `SQLSTATE` | **23505** — `apply-session.tsx`'s "That time was just booked" branch fires unchanged |
| sessions added | **0** |
| consents added | **0** |

The last row is the one that matters: the failed booking left **no orphaned consent record**.
That is the atomicity guarantee demonstrated rather than claimed — if it had returned 1, the RPC
would be recording consent for bookings that never happened.

### The chain — 8 Aug 2026, and the most reusable thing in this document

The task was **website copy**: resolve a contradiction between "deletion within 30 days" and a
90-day selfie retention. One paragraph. Verifying it before writing produced four layers:

1. **The 30/90 contradiction** — the stated task. Two published commitments that could not both
   be true.
2. **Verifying what deletion actually did found `delete-account` broken.** It attempted to
   DELETE from two append-only tables, swallowed the failure, and then failed on the auth
   delete — *after* wiping messages, reviews, notifications and all four storage buckets. A user
   who had ever booked could not delete their account, and each attempt stripped more of it.
3. **Fixing that found consent was never recorded.** `session_consents` was empty and nothing in
   the app wrote it. `ConsentGate` displayed terms, called `onAccept()` and persisted nothing —
   so the carve-out about "keeping a record that you consented" described something that did not
   exist.
4. **Wiring that up found the risk disclosure had never been shown to anyone.** An active
   `consent_documents` v1 had existed since 9 June carrying the disclosure that providers are
   learners who may not be qualified, that treatments carry risks, and a medical-suitability
   tick. Nothing ever rendered it. The screen showed softer house rules instead. **Nobody
   booking a treatment had ever been told, at the point of consent, that the person performing
   it might be unqualified.**

Every layer came from the same refusal: **do not publish a claim without checking it is true.**
The copy could have been written in five minutes at step 1. It would have been a false statement
in a privacy notice, sitting on top of a broken deletion flow, describing a consent record that
did not exist, while the document that mattered stayed invisible.

The individual fixes matter less than that. A claim you have not verified is not a claim, it is
a guess with a confident tone — and each of these was one honest check away from being found.

Two counterweights worth keeping with it, because the same session produced both:

- **Four wrong hypotheses about the teardown failure**, each reached by reading the FK catalogue
  and reasoning about what *could* block a delete. Running the delete and reading the error
  named it in one step. Reproduce the failure; do not theorise about it.
- **The deletion bug was latent, not active** — `session_consents` was empty, so nothing had hit
  it. It was reported as live before that was checked. The same discipline applies to the
  severity of a finding as to the finding itself.

### Principles carried out of this phase

Each of these was learned the expensive way here, not imported from a style guide.

1. **If a comment is the only thing making something safe, it isn't.**
   `seed/seed.mjs` carried `const PASSWORD = 'SeedDemo!2026' // demo accounts only; all removed
   by teardown`. That comment was doing security work, and nothing verified it. The moment
   teardown failed on 2 of 9 accounts, the claim became false and no machine noticed — leaving
   sign-in-able accounts with a password committed to a public repository. The fix is not a
   better comment or a checklist; it is **removing the need for the claim**. A password
   generated per run cannot outlive the cleanup that was supposed to remove it.

2. **A partial success must exit non-zero.** `teardown.mjs` printed a WARNING and exited 0, so
   the 7 Aug run reported success to the shell while leaving two accounts behind. Now
   `process.exitCode = 1` on any account it could not fully delete. Verified for real: missing
   key → 1, non-reserved suffix guard → 1, partial teardown → 1, clean teardown → 0.

3. **Verify from outside, not from the value you just wrote.** `banned_until = 'infinity'` in a
   `select` is not proof; attempting the sign-in with the leaked password is. Same for the RLS
   work — `400 42703` proves a column is *absent from the object*, which an empty result never
   would.

4. **Fail toward the safe direction.** The Ignored Build Step exits non-zero (build) when the
   previous SHA is empty or missing, never skipping on uncertainty. `PUBLIC_SITE_MODE` treats
   any value other than exactly `live` as noindex, so a typo cannot accidentally publish.

5. **Two copies of one config is a bug with a delay on it.** `providers.location` vs
   `location_text` — one written by everything, one still read by the mobile shop page, and a
   blank location on every profile. The stale root `app.json`/`eas.json` were the same shape
   and were deleted before they cost anything.

6. **A build failure can be the last line of defence.** The site's first two deploys failed
   compiling the admin auth gate into the public site, and only because `@supabase/ssr` was not
   a site dependency. The obvious "fix" — adding it — would have shipped a login wall in front
   of every public page. When a build breaks in a way you did not expect, understand it before
   making it pass.

### Domain + 301s — ✅ DONE 7 Aug 2026

**`cavybeauty.com` is live.** Apex primary (200, no redirect), `www` 308s to it, `http` 308s to
`https`. Verified against the real origin: six security headers, `robots.txt` disallowing,
`sitemap.xml` with zero URLs, `noindex, nofollow, nocache`, `/login` 404 (no admin gate), all
four legal pages 200 with the Terms `id="9"` anchor intact.

**The OG-card gap is closed.** `og:image` pointed at `cavybeauty.com` while the site was only on
`.vercel.app`, so shared links rendered without a preview. It now fetches 200 `image/png`.

**All three legal 301s are live** as Cloudflare Redirect Rules on the old zone —
`/terms`, `/privacy`, `/community` → the same path on `cavybeauty.com`. Verified as genuine
`301`s (not 302), path preserved, each landing on a 200 with the right `<h1>`. The shipped
mobile app's hardcoded links follow them, so no app release was needed.

**`/auth/reset` and `/auth/confirmed` remain 200 with no redirect** — confirmed. Password reset
in the shipped app is unaffected. Nothing else on the old zone was caught.

> ⚠️ **`guineapigapp.co.uk/delete-account` was not in the three-path scope and still returns
> 200.** It is the Apple 5.1.1(v) surface, and the old copy is the one that still carries the
> unfilled drafting placeholders — "[Confirm the full list before launch.]" and "[Confirm your
> timeframe.]" — publicly visible. Two account-deletion pages are now live: the old one with
> placeholders, the new one without. A fourth redirect rule closes it; nothing in the mobile app
> links to that URL directly, so no app release is required. The underlying open questions stay
> on the phase-2 blocker list regardless.

### What is actually left

1. **`PUBLIC_SITE_MODE=live`** — the only remaining switch, and it is **not** an engineering
   task. Gated on real stylists clearing the content bar in `public_stylists` (published,
   40+ character bio, ≥1 category). `public_stylists` returns zero rows today, so flipping now
   would submit a sitemap of empty pages from a new domain.
2. **Optional:** the fourth 301 for `/delete-account`, per the note above.

**Known and logged, not blocking:** the Hobby plan is licensed for non-commercial use, and the
Vercel Firewall is Pro-only — so `site/lib/rateLimit.ts` is the *only* control on
`/api/waitlist` rather than a second layer (Cloudflare rate limiting is the free alternative,
and the DNS is already there). The app-scope privacy policy and the two `delete-account`
drafting placeholders remain phase-2 blockers.

**Indexing switch:** one env var on the Vercel project. `preview` → `robots.ts` disallows all,
`sitemap.ts` returns `[]`, root layout emits `noindex, nofollow`. Vercel preview deployments are
`preview` unconditionally.

> **The live flip is gated on INVENTORY, not on the domain resolving or the seed being gone.**
> Seed teardown (done 7 Aug 2026) is a *necessary* condition — it guarantees no demo stylist can
> be indexed — but not a sufficient one. `public_stylists` currently returns **zero rows**, so
> going live now would submit a sitemap of empty pages from a brand-new domain. That is a
> thin-content signal, it is slow to undo, and it would be spent on the one asset whose value
> depends on being trusted early. Flip only when real stylists clear the content bar
> (published, 40+ char bio, ≥1 category). The legal 301s are **not** gated on this — they are a
> store-submission dependency and ship as soon as the domain resolves.

---

## 12. Verification

- **Anon `curl` positive:** `public_stylists` and `public_categories` return rows;
  category and `location_slug` filters work. *(PowerShell: use `curl.exe`, not `curl`.)*
- **Anon `curl` negative:** `?select=latitude`, `longitude`, `user_id`, `is_published`,
  `shop_handle` each return **400 `42703 column does not exist`** — a stronger proof than an
  empty result, because the column is absent from the object rather than filtered from it.
- **Every base table still `[]`:** `providers`, `users`, `public_profiles`, `model_attributes`,
  `model_photos`, `reviews`, `sessions`, `messages`, `availability`, `portfolio_items`, …
- **RPCs rejected:** `rpc/nearby_models`, `is_suspended`, `my_suspension` → `42501`.
- **Ungranted views rejected:** `public_stylist_portfolio`, `public_stylist_reviews` → permission denied.
- **Present-but-empty blocks:** `/stylist/[slug]` renders cleanly with **no** status section and
  **no** portfolio grid visible when both queries return empty — no stray headings, no empty
  containers holding vertical space, no layout shift. Confirm in the initial HTML, not just the
  browser.
- **Row-count parity:** anon `Prefer: count=exact` on `public_stylists` matches the same
  `WHERE` run as `postgres`, and is strictly less than `count(*) from providers`.
- **Regression:** full two-role device pass (model + stylist) and a full admin-console pass —
  mandatory after the §7 `revoke`s, which do change live behaviour.
- **SEO:** `curl` a stylist page and a city page and confirm the content is in the **initial
  HTML**, not injected client-side. Validate JSON-LD in Google's Rich Results Test. Confirm
  `/robots.txt` and `/sitemap.xml` respond correctly in both `preview` and `live` modes.
- **Redirects:** `curl -I https://www.cavybeauty.com` → 308 to apex;
  `curl -I https://guineapigapp.co.uk/terms` → 301 to `cavybeauty.com/terms`;
  `curl -I https://guineapigapp.co.uk/auth/reset` → **200, unchanged**.

---

## 13. Open items

- **Palette: `mobile/src/constants/Colors.ts` is canonical — decided.** (`rose #DB4B86`,
  `roseDark #C23A71`, `softPink #FFE3EF`, `cream #FFF7FA`, `warmDark #2B2531`, `border #F6E1EA`,
  `muted #6E6675`.) It is live, token-driven and matches the product users download. `site/`
  mirrors it into a Tailwind v4 `@theme` block. The two stale sets — `CLAUDE.md:45` prose
  (`#F45D9E`/`#A8862E`) and the admin app's inline hexes (`#C8788A`/`#8C4A58`) — are wrong;
  **correct `CLAUDE.md` in a separate change**, leave the admin app alone.
- **No illustration or photography assets exist.** `mobile/assets/images/` holds 7 files: the
  guinea-pig logo, app icon, splash, favicon and 3 Android icon layers. No SVGs, no marketing
  imagery. The app's visual interest comes from CSS decoration plus emoji. A marketing site
  needs commissioned artwork — this cannot be dressed from the repo.
- **Fonts:** Fredoka (display/wordmark) + Quicksand (everything else). Dancing Script is loaded
  but unused; Nunito is not in the repo at all despite `CLAUDE.md` listing it.
- **Pre-existing bug, not fixed here:** `mobile/src/app/(app)/provider/[id].tsx:151` selects the
  dead `location` column instead of `location_text`, blanking the location on every mobile shop
  page. One-word fix, worth its own change.
- **~~Missing rating trigger~~ — CORRECTED. `providers.rating` IS maintained.**
  The original claim here ("nothing maintains `providers.rating`") was drawn from the repo and
  was wrong. `trg_recompute_provider_rating` is attached to `public.reviews`
  (`AFTER INSERT OR DELETE OR UPDATE`, calling `recompute_provider_rating()`) — confirmed from
  `pg_trigger` on 2026-08-07. `public_stylists` reads the denormalised columns accordingly.
  Neither the function nor the trigger appears in any repo file; see the schema-drift item below,
  of which this was the first symptom.
- **`providers.created_at` does not exist** (nor `updated_at`) — confirmed by probe. So
  `last_modified` has no base timestamp and **`lastModified` is omitted from the sitemap
  entirely** this phase. An always-`now()` lastmod trains Google to ignore the field.
- **🔴 SCHEMA DRIFT — `supabase/` documents roughly a third of the live schema, and reads like
  it documents all of it.** Measured 2026-08-07:

  | | In `supabase/*.sql` | Live | Missing |
  |---|---|---|---|
  | Functions | 7 | 18 | **11** |
  | Triggers | 4 | 11 | **7** |
  | Views | 4 (all written for the website) | 5 | `public_profiles` |
  | RLS policies | some | all | the live `providers` "published-or-own" policy exists in no file |
  | Tables | — | — | `consent_documents`, `session_consents`, `patch_tests`, `moderation_actions` appear nowhere |

  Missing functions: `confirm_patch_test`, `enforce_publish_requires_verified`,
  `handle_new_auth_user`, `has_open_availability`, `has_valid_patch_test`, `is_admin`,
  `prevent_mutation`, `recompute_provider_rating`, `set_consent_hash`, `set_patch_test_expiry`,
  `taken_slots`.
  Missing triggers: `on_auth_user_created`, `trg_consent_hash`, `trg_lock_moderation`,
  `trg_patch_test_expiry`, `trg_publish_requires_verified`, `trg_recompute_provider_rating`,
  `trg_lock_consents`.

  This has already cost real time three times in one session: the rating trigger above
  (designed an aggregate that was unnecessary), `patch_tests` (blocked the seed teardown from a
  table `teardown.mjs` had never heard of), and `spray_tan` vs `spray-tan` (a slug guessed from
  the repo that would have matched zero stylists silently).

  **Treat `supabase/` as partial notes, never as truth.** `pg_proc`, `pg_policies`, `pg_views`
  and `pg_trigger` are truth. Closing this is a phase-2 task — dump the live DDL and commit it,
  ideally adopting `supabase/migrations/` so it cannot drift again.
- `next.config.ts` `images.remotePatterns` must whitelist `ptluekkhiopowuyvkgnd.supabase.co`
  or every avatar and banner 400s at runtime.
- **Company number resolved: `17272796`.** Registered address 75 Aintree Road, Chatham, Kent,
  ME5 8PQ. Retrieved from the live Terms §1 on 2026-08-07. `CLAUDE.md`'s `[NUMBER]` placeholder
  can be filled in a separate change.
- **🔴 The live privacy policy does not cover the app, and says so explicitly** — "It does not
  yet cover the app, because the app hasn't launched — that policy is coming." It documents six
  waitlist fields only: no identity selfies (special-category), messages, photos, location or
  payment records. Yet `settings.tsx:55` and `SignupScreen.tsx:22` link to it as the app's
  privacy policy and signup requires agreeing to it. Store-compliance blocker, and 301'ing it
  onto `cavybeauty.com` would make it Cavy's official policy. Must be resolved before §9.
- **The legal pages are branded "Guinea Pig" throughout, not Cavy.** The rebrand never reached
  them. `CLAUDE.md` mandates "Cavy is a trading name of Guinea Pig App Ltd…". Reconciling this
  is an edit to legal text, not a transcription.
- **A fourth legal page exists** — "Request account deletion", linked in the live footer. It is
  the Apple 5.1.1(v) surface and was missing from the §3 route tree. Now built at
  `/delete-account`.
- **🔴 The live delete-account page has unfilled drafting placeholders in public:**
  "[Confirm the full list before launch.]" and "[Confirm your timeframe.]" — on the exact page
  Apple checks for Guideline 5.1.1(v). They are **not** reproduced on the new site; those two
  sentences are reduced to what is actually known. The specifics still need confirming.

### Blocker list (accumulated during build)

**Gates phase 1 (the web build):**

1. Seed teardown — `node seed/teardown.mjs` (existing blocker #75). Must run before
   `PUBLIC_SITE_MODE=live`, or Google indexes fake stylists.

### ✅ ACCOUNT DELETION — FIXED AND DEPLOYED, 8 Aug 2026

`account-deletion-fix.sql` applied and `delete-account` redeployed. Verified live: FKs severed
(0 remaining), 4 identity columns present, both retention guards and both insert-time identity
triggers in place, and `delete_account_data` exists and correctly refuses `anon`.

The bug was latent rather than active — `session_consents` is empty, so nothing had triggered
it yet. It is fixed before the first consent row exists rather than after.

Seed teardown is also now genuinely complete: 0 seeded accounts remain. The cause of the 7 Aug
partial failure was `sessions.model_user_id`, confirmed by running the delete and reading the
error. Four prior hypotheses — session_consents, patch_tests, malformed auth rows,
`admin_audit_log.admin_id` — were all wrong, each reached by reading the FK catalogue instead
of reproducing the failure. `teardown.mjs` now clears the cohort's shared rows before deleting
any account, which was the actual defect.

### 🔴 TOP OF PHASE 2 — CONSENT IS NOT BEING RECORDED

**`ConsentGate.tsx` persists nothing.** 226 lines, exports `ConsentGate({ onAccept })`, and
contains no reference to `supabase`, `insert`, `from(` or `consent`. Nothing anywhere in
`mobile/src`, `admin/` or `supabase/functions` writes `session_consents`. The table is empty.

So the app shows a consent screen before a treatment and keeps no evidence that anyone agreed.
`CLAUDE.md` lists a consent/EULA as a store requirement with a per-application `ConsentGate`;
the gate exists as UI only.

The database side is complete and working — table, immutability guard, content hashing,
insert-time identity, retention rules. What is missing is one insert on accept.

**This gates the deletion wording.** The agreed carve-out says "we keep a record that you
consented to a treatment"; today that describes something that does not exist. Either the gate
is wired up, or the consent sentence comes out of the deletion page. Nothing gets published
until that is decided.

### The delete-account clauses — now answerable

All of this concerns **`cavybeauty.com/delete-account`**, the page Apple checks for Guideline
5.1.1(v). The placeholders are no longer *displayed* — the old copy carrying them now 301s to
the new page, which states only what is known — but the questions behind them are unanswered.

Full context recorded here so it does not have to be rediscovered.

---

**① THE 30-DAY / 90-DAY CONTRADICTION — answer this first, it constrains ② and ③**

Two published commitments cannot both be true as written.

| Where | Exact current wording |
|---|---|
| **`site/content/legal.ts`** → `DELETE_ACCOUNT`, clause **"How long it takes"** — live at `cavybeauty.com/delete-account` | "We aim to complete deletion within 30 days. Some records may be retained where the law requires." |
| **`privacy-admin-access-clause.md`** (repo root, drafted, **not yet published**) | A **90-day retention** commitment for identity-verification selfies. |

A user reading the deletion page is told everything is gone within 30 days. The privacy draft
says one category of their data — a **photograph of their face**, which is special-category
biometric data under UK GDPR — is kept for 90. "Some records may be retained where the law
requires" does not cover it, because a 90-day selfie retention is *our* operational choice, not
a legal requirement.

**Three ways out, pick one:**
1. Name the exception explicitly on the deletion page — "everything within 30 days, except
   identity-verification photographs which are held for up to 90 days and then automatically
   deleted." Most honest, and it makes the retention a feature rather than a discrepancy.
2. Shorten selfie retention to fit inside 30 days and drop the 90-day sentence entirely.
3. Lengthen the stated deletion window to 90 days. Worst of the three — it makes the whole
   promise weaker to fix one exception.

**Prerequisite before publishing *any* 90-day figure:** `privacy-admin-access-clause.md:70`
carries `⚠️ DO NOT publish the 90-day sentence until the purge job exists (task #73)`. The job
now exists — `supabase/functions/purge-selfies/index.ts` and `supabase/purge-selfies-cron.sql` —
**but the cron SQL still contains the literal placeholder `<YOUR-RANDOM-CRON-SECRET>`**, so it
may never have been run with a real value. Confirm with `select jobname, schedule, active from
cron.job;` before relying on it. A stated retention period that nothing enforces is worse than
saying nothing, which is exactly what that warning was about.

---

**② Clause "What gets deleted"**

Live text on the old page was:
> Your profile, messages, bookings and personal details. **[Confirm the full list before launch.]**

Current text on the new page: the same sentence, placeholder removed. Nothing was invented.

**What has to be decided:** the real enumeration of what the `delete-account` edge function
actually removes. Three complications make this harder than reading the function once:

- **`public.users` has no FK to `auth.users`** (`CLAUDE.md`). Deleting the auth user does **not**
  cascade — `public.users` must be deleted explicitly, and the CASCADE children hang off *that*.
  So "we delete your account" and "we delete your data" are two different operations.
- **Some records are immutable by design and survive deletion.** `session_consents` and
  `moderation_actions` both carry `prevent_mutation` triggers on `BEFORE DELETE`. That is
  deliberate — they are consent and moderation evidence — but it means a blanket "everything is
  deleted" would be **false**. The page has to say what is retained and why. This is a UK GDPR
  disclosure question, not a copy question.
- **`teardown.mjs` deletes from 21 tables and still failed** on foreign keys from tables it did
  not know about (`patch_tests`, and the two above). The `delete-account` function was written
  against the same partial picture and probably has the same blind spots. Worth auditing it
  against `pg_constraint` rather than against the repo, which is out of date.
- **Storage is separate from rows:** `verification-selfies`, `profile-pics`, `model-photos`,
  `portfolio-photos`. Deleting a row does not delete the object.

---

**③ Clause "How long it takes"**

Live text on the old page was:
> We aim to complete deletion within 30 days. **[Confirm your timeframe.]** Some records may be
> retained where the law requires.

Current text on the new page: the same, placeholder removed.

**What has to be decided:** whether 30 days is the real figure, and — once ① is settled — which
records are named as exceptions and on what basis. The "where the law requires" clause currently
does no work, because nothing has been identified as legally mandated retention; the selfie case
is an operational choice and the immutable consent/moderation records in ② are a design choice.
Both need naming rather than hiding behind that phrase.

---

**Phase 2 — the rest. Logged, does NOT gate the web build.** No app submission happens this phase.

2. Stripe TEST → LIVE.
3. **App-scope privacy policy.** The live notice covers the waitlist only and says so, while the
   shipped app links to it as its privacy policy and gates signup on agreeing to it.
4. **delete-account specifics** — the two drafting placeholders removed from the new page.
   Deleting the placeholder did not settle the question:
   - *"What gets deleted"* — live text: "Your profile, messages, bookings and personal details.
     **[Confirm the full list before launch.]**" Needs the real enumeration of what the
     `delete-account` edge function actually removes. Non-trivial: `CLAUDE.md` records that
     `public.users` has **no FK to `auth.users`**, so deleting the auth user does not cascade —
     `public.users` must be deleted explicitly, and CASCADE children hang off *that*. The
     honest list depends on what the function really does.
   - *"How long it takes"* — live text: "We aim to complete deletion within 30 days.
     **[Confirm your timeframe.]** Some records may be retained where the law requires."
     Needs a real timeframe and a statement of which records are retained and why. Note the
     related 90-day verification-selfie retention commitment in
     `privacy-admin-access-clause.md`, which carries its own "do not publish until the purge job
     exists" warning.
5. Company number now known (`17272796`); `CLAUDE.md`'s `[NUMBER]` placeholder still to update.
- **Cloudinary is named but unused.** `CLAUDE.md:33` and `README.md:26` list it as the media
  provider, but no code in the repo calls it — every image path goes through Supabase Storage.
  Portfolio video transcoding (Revision B) would be the **first actual Cloudinary integration**,
  which makes it a new vendor dependency rather than a config change. When that lands it also
  adds a second `remotePatterns` host for poster frames.
- **Phase 2 — per-post takedown revalidation.** Today a takedown waits out the 600s ISR window,
  and the `revoke` kill switch is whole-surface-only. Accepted for now. The fix is the same
  on-demand revalidation machinery already earmarked in §6a: a Supabase Database Webhook on
  `status_posts` UPDATE → `POST /api/revalidate` (shared secret) → `revalidateTag('stylist:'+id)`,
  which also lets `revalidate` rise from 600 and cuts background regeneration. Ships after the
  site is up, not with it.

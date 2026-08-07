-- ===========================================================================
-- public-web-views.sql — the read surface for cavybeauty.com (anon, no login).
--
-- Run in the Supabase SQL editor as postgres. Creates FOUR views and touches
-- no existing table, policy, grant or function.
--
-- WHY VIEWS AND NOT `to anon` RLS POLICIES
--   RLS is row-level and has no column dimension, so a `to anon` policy on
--   providers would publish latitude/longitude/user_id and every column added
--   later. These views are column-explicit: the private columns are not
--   filtered out, they do not exist in the object. Nothing on any base table
--   changes, so the mobile app and the admin console cannot be affected, and
--   rollback is four `drop view`s.
--
-- WHY security_invoker IS LEFT OFF (the default)
--   Postgres 15+ views default to security_invoker = false, so these run as
--   their owner (postgres) and bypass RLS on the base tables. That is
--   DELIBERATE: the WHERE clause here is the security boundary, and it lets
--   the view read providers.user_id to join reviews WITHOUT publishing it.
--   The Supabase linter will flag `security_definer_view`; expected and
--   accepted. Do NOT "fix" it — security_invoker = true would make every view
--   return zero rows, because anon has no policy on any base table.
--
--   COROLLARY: Supabase's default privileges auto-grant SELECT on new views in
--   `public` to anon. Grant + definer = full exposure with no policy involved.
--   That is exactly how public_profiles leaked (see the 2026-08-07 preflight).
--   So: never create a helper view here containing lat/lng, user_id or model
--   data, and every view below carries an explicit REVOKE before its GRANT.
--
-- NO HELPER FUNCTIONS ON PURPOSE
--   An earlier draft used a slugify() helper and called has_open_availability()
--   inside the view. Both are removed. anon has no EXECUTE on either (the
--   2026-08-07 lockdown), and whether a non-invoker view's *function* calls are
--   privilege-checked against the view owner or the caller is not clearly
--   specified — unlike table access, which definitively follows the owner.
--   Betting the entire public site on that ambiguity is not worth saving a few
--   lines, so the slug expression is inlined and availability is a plain EXISTS.
--
-- SCHEMA FACTS VERIFIED LIVE 2026-08-07 (the repo is NOT authoritative):
--   * providers has NO created_at and NO updated_at  -> no last_modified column
--     here, and no <lastmod> in the sitemap.
--   * trg_recompute_provider_rating IS attached to public.reviews, so
--     providers.rating / review_count are maintained -> read them, don't
--     recompute.
--   * portfolio_items HAS moderation_status; it has NO poster_url.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Categories — the six treatment types, for the /[treatment] landing pages.
-- ---------------------------------------------------------------------------
create or replace view public.public_categories
with (security_barrier = true) as
select tc.slug,
       tc.name,
       tc.icon_name,
       tc.colour_hex,
       tc.sort_order
from public.treatment_categories tc
where tc.is_active is true;


-- ---------------------------------------------------------------------------
-- 2. Stylists — the directory and the profile page.
--
-- EXCLUDED ON PURPOSE, never add these: latitude, longitude, user_id,
-- is_published, shop_handle.
--   * lat/lng — publishing a lone worker's coordinates is a safety exposure.
--   * user_id — an auth.users id; joins reviews internally, never leaves here.
--   * shop_handle — client-generated as "first-lastinitial", not unique, not
--     editable, and a real first name. Not fit to be a URL key (see `slug`).
-- ---------------------------------------------------------------------------
create or replace view public.public_stylists
with (security_barrier = true) as
select
  p.id,

  -- URL key: readable name + 8 hex of the id. Collision-proof with no unique
  -- index and no app change. If a stylist renames their shop the slug changes,
  -- so the page resolves on short_id and 301s to the canonical slug.
  coalesce(
    nullif(btrim(regexp_replace(lower(btrim(coalesce(p.name, ''))), '[^a-z0-9]+', '-', 'g'), '-'), ''),
    'stylist'
  ) || '-' || left(replace(p.id::text, '-', ''), 8)                     as slug,
  left(replace(p.id::text, '-', ''), 8)                                 as short_id,

  p.name,
  p.bio,
  p.region,

  -- location_text is what edit-shop.tsx and seed.mjs actually write, and what
  -- browse + admin read. providers.location is legacy — nothing has written it
  -- since edit-shop shipped, yet provider/[id].tsx still reads it, which is why
  -- the mobile shop page shows a blank location. Prefer the live column, fall
  -- back to the legacy one, expose ONE column. No migration needed.
  nullif(btrim(coalesce(nullif(btrim(p.location_text), ''), p.location, '')), '')  as location,

  -- Normalised for /[treatment]/[city] matching. Free text means "Manchester,
  -- UK" becomes manchester-uk, so the site matches with LIKE, not equality.
  nullif(btrim(regexp_replace(
    lower(btrim(coalesce(nullif(btrim(p.location_text), ''), p.location, ''))),
    '[^a-z0-9]+', '-', 'g'), '-'), '')                                  as location_slug,

  p.profile_pic_url,
  p.banner_url,
  p.is_verified,
  p.level,

  -- Ephemeral stylist status. Kept as-is this phase; status_posts supersedes it
  -- later, which is the one change that will need a drop/create + re-grant.
  case when p.status_expires_at is null or p.status_expires_at > now()
       then nullif(btrim(coalesce(p.status_text, '')), '') end          as status_text,

  cats.categories,
  cats.category_slugs,

  -- Maintained by trg_recompute_provider_rating on public.reviews.
  -- NULL (not 0) when there are no reviews — the site must emit AggregateRating
  -- only when review_count >= 1, because ratingValue: 0 invalidates the page's
  -- rich result entirely.
  nullif(p.rating, 0)                                                   as rating,
  coalesce(p.review_count, 0)                                           as review_count,

  -- Coarse conversion signal only. The slot LIST is deliberately not published.
  -- Plain EXISTS rather than has_open_availability() — see the header note.
  -- Coarser than the RPC (a booked slot still counts as availability), which is
  -- acceptable for a boolean "worth enquiring" hint.
  exists (
    select 1 from public.availability a
    where a.provider_id = p.id and a.date >= current_date
  )                                                                     as has_open_slots

from public.providers p
cross join lateral (
  select
    coalesce(array_agg(distinct pt.category order by pt.category)
             filter (where pt.category is not null), array[]::text[])   as categories,
    coalesce(array_agg(distinct tc.slug order by tc.slug)
             filter (where tc.slug is not null), array[]::text[])       as category_slugs
  from public.provider_treatments pt
  left join public.treatment_categories tc
         on lower(btrim(tc.name)) = lower(btrim(pt.category))
        and tc.is_active is true
  where pt.provider_id = p.id
) cats
where p.is_published is true

  -- CONTENT BAR. A brand-new domain publishing dozens of near-empty profiles is
  -- the thin/doorway pattern that earns a site-wide manual action. A shopfront
  -- reaches the open web only once it is actually a shopfront.
  and coalesce(btrim(p.name), '') <> ''
  and length(btrim(coalesce(p.bio, ''))) >= 40
  and cardinality(cats.categories) >= 1

  -- Seed data is still live (launch blocker #75). Seeded accounts use the
  -- reserved .invalid TLD, which no real user can ever hold, so this is
  -- self-removing once teardown runs. Belt and braces alongside the site's
  -- PUBLIC_SITE_MODE flag.
  and not exists (
    select 1 from public.users u
    where u.id = p.user_id and u.email like '%@seed.guineapig.invalid'
  );


-- ---------------------------------------------------------------------------
-- 3. Portfolio — WRITTEN BUT NOT GRANTED.
--
-- The blocker is consent, not code: these are photographs of models' faces, and
-- consent belongs to the model depicted, not the stylist who uploaded them.
-- The project has a consent subsystem (consent_documents + session_consents)
-- but portfolio_items has no session_id, so the image cannot yet be linked back
-- to the consenting session. Written now purely so enabling it later is a
-- GRANT, not a rewrite.
--
-- poster_url does not exist on portfolio_items. The placeholder keeps the
-- column position stable: `create or replace view` can swap a null::text
-- placeholder for a real text column, but cannot drop, reorder or retype.
-- ---------------------------------------------------------------------------
create or replace view public.public_stylist_portfolio
with (security_barrier = true) as
select pi.id,
       pi.provider_id,
       pi.media_url,
       pi.media_type,
       null::text          as poster_url,
       pc.name             as category_name,
       pi.created_at
from public.portfolio_items pi
join public.providers p on p.id = pi.provider_id
left join public.portfolio_categories pc on pc.id = pi.category_id
where p.is_published is true
  and pi.media_url is not null
  and pi.moderation_status = 'approved';


-- ---------------------------------------------------------------------------
-- 4. Reviews — WRITTEN BUT NOT GRANTED.
--
-- Reviewer identity is absent by construction: no reviewer_id, no name, no
-- avatar, no session_id. Reviewers are models, and model data is not published.
-- Joining on providers.user_id also guarantees reviews written ABOUT models can
-- never appear here, whatever the reviewee_id happens to be.
--
-- Ungranted because `comment` is free text authored by a model inside a
-- logged-in app; republishing it to the open web needs a consent document
-- version that says so.
-- ---------------------------------------------------------------------------
create or replace view public.public_stylist_reviews
with (security_barrier = true) as
select rv.id,
       p.id              as provider_id,
       rv.overall_rating as rating,
       rv.comment,
       rv.tags,
       rv.created_at
from public.reviews rv
join public.providers p on p.user_id = rv.reviewee_id
where p.is_published is true
  and rv.overall_rating is not null;


-- ---------------------------------------------------------------------------
-- 5. Grants. This block IS the entire public data contract.
--
-- The REVOKE first is not ceremonial: Supabase's default privileges will have
-- already granted SELECT to anon on each view the moment it was created.
-- ---------------------------------------------------------------------------
revoke all on public.public_categories        from public, anon, authenticated;
revoke all on public.public_stylists          from public, anon, authenticated;
revoke all on public.public_stylist_portfolio from public, anon, authenticated;
revoke all on public.public_stylist_reviews   from public, anon, authenticated;

grant select on public.public_categories to anon, authenticated;
grant select on public.public_stylists   to anon, authenticated;

-- Gated on the §8 consent work. Uncomment ONLY when a public-display consent
-- document version exists and acceptance can be joined through:
-- grant select on public.public_stylist_portfolio to anon, authenticated;
-- grant select on public.public_stylist_reviews   to anon, authenticated;

-- KILL SWITCH — takes the whole public data surface offline in one statement,
-- instantly, with no deploy:
--   revoke select on public.public_stylists from anon;


-- ---------------------------------------------------------------------------
-- 6. Indexes the views depend on.
-- ---------------------------------------------------------------------------
create index if not exists provider_treatments_provider_id_idx
  on public.provider_treatments (provider_id);
create index if not exists portfolio_items_provider_id_idx
  on public.portfolio_items (provider_id);
create index if not exists availability_provider_date_idx
  on public.availability (provider_id, date);
create index if not exists reviews_reviewee_id_idx
  on public.reviews (reviewee_id);

commit;

-- ---------------------------------------------------------------------------
-- 7. MANDATORY. PostgREST caches the schema; without this the new endpoints
--    404 until the next restart.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ===========================================================================
-- POST-RUN CHECK — the views must be owned by postgres, or they return nothing.
--
--   select relname, relowner::regrole, relkind
--   from pg_class where relname like 'public\_%' and relkind = 'v';
--
-- ROLLBACK
--   begin;
--   revoke all on public.public_categories, public.public_stylists,
--                 public.public_stylist_portfolio, public.public_stylist_reviews
--          from anon, authenticated;
--   drop view if exists public.public_stylist_reviews;
--   drop view if exists public.public_stylist_portfolio;
--   drop view if exists public.public_stylists;
--   drop view if exists public.public_categories;
--   commit;
--   notify pgrst, 'reload schema';
-- ===========================================================================

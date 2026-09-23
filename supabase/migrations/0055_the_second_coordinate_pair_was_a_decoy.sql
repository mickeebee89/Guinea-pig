-- ===========================================================================
-- 0055_the_second_coordinate_pair_was_a_decoy
--
-- providers.location_lat / location_lng go. Audit item 90. Decision: Micky,
-- 23 Sep 2026, off a query over all five live accounts.
--
-- ⚠️⚠️ DO NOT APPLY THIS UNTIL THE SITE DEPLOY FROM 0054 HAS LANDED. ⚠️⚠️
--
-- This is the only migration in this pair with an ordering hazard, and it is
-- a real one. Until 23 Sep the updates feed selected these two columns by
-- name (dashboard.ts:464). **PostgREST fails the WHOLE select when one named
-- column is missing** — it does not skip it — and `getStylistUpdates` is not
-- wrapped in a try/catch, so the model dashboard would throw rather than
-- degrade. Applying this against the old build takes the dashboard down for
-- every model until the new one is serving.
--
-- Check before you run it: cavybeauty.com/api/version should report the
-- commit that carries 0054's site changes.
--
-- ── WHY THEY ARE GOING ──────────────────────────────────────────────────
-- providers has carried TWO coordinate pairs: latitude/longitude, which the
-- app writes, and location_lat/location_lng, which nothing writes. The feed
-- read the second as a fallback — `p.latitude ?? p.location_lat` — with the
-- comment "prefer whichever is populated rather than picking one and showing
-- nothing for half the rows".
--
-- That reasoning was sound and the premise was false. VERIFIED 23 Sep, across
-- every live account: prov_has_legacy_coords is false on all five. Nothing
-- has ever populated them outside site/lib/demo/fixtures.ts, which is an
-- in-memory stub for screenshots and touches no database.
--
-- So it was not a fallback. It was a second place to look that could never
-- hold anything, and it made every reader of that query believe the schema
-- was more complicated than it is. Exactly the shape of the four other
-- duplications this audit has found: location/location_text,
-- provider_treatments.price, model_attributes' nine *_custom columns, and
-- users.region.
--
-- ⚠️ IRREVERSIBLE IN THE SENSE THAT MATTERS. Re-adding the columns is one
-- line; the data is not recoverable. That is why the ASSERT below re-checks
-- they are empty at apply time rather than trusting the 23 Sep query — if
-- something has written them since, this stops.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare
  v_stray integer;
begin
  if to_regclass('public.providers') is null then
    raise exception '0055: public.providers is missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'providers' and column_name = 'location_lat'
  ) then
    raise exception '0055: providers.location_lat is already gone. Read the ledger before applying.';
  end if;

  -- users.postcode is 0054's column. If it is missing, this pair is being
  -- applied out of order and the site deploy this depends on cannot have
  -- happened either.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'postcode'
  ) then
    raise exception '0055: users.postcode is missing. Apply 0054 first, and deploy the site.';
  end if;

  -- The 23 Sep query said empty. This says empty NOW. A migration that
  -- destroys data on the strength of a query run hours earlier is not one.
  select count(*) into v_stray
  from public.providers
  where location_lat is not null or location_lng is not null;
  if v_stray > 0 then
    raise exception
      '0055: % provider row(s) now have location_lat/location_lng set. They were empty on 23 Sep, '
      'so something has written them since. Find out what before dropping them.', v_stray;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE DROP
-- ---------------------------------------------------------------------------
alter table public.providers drop column location_lat;
alter table public.providers drop column location_lng;

comment on column public.providers.latitude is
  'Where this shop is. Written from device GPS by the app (provider-dashboard.tsx) and from a '
  'postcode lookup by the website (set_my_postcode, 0054). THE ONLY COORDINATE PAIR ON THIS TABLE '
  'since 0055 — location_lat/location_lng were a second pair that nothing ever wrote, read as a '
  'fallback that could never fire. NULL means this stylist has not been placed, and every distance '
  'filter on both clients excludes her deliberately: being unable to prove someone is near is not '
  'proof that they are. Never published — excluded by name in public-web-views.sql.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0055', 'the_second_coordinate_pair_was_a_decoy', '98b88867ba962248a762bb413e37cbed974f98e33a2686584a9e504a95ac2049');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   Last step of the 0054 pair. Order, in full:
--     1. Apply 0054.
--     2. node scripts/gen-supabase-types.mjs
--     3. npm run verify --prefix site, push, WAIT FOR VERCEL.
--     4. Apply this.
--     5. node scripts/gen-supabase-types.mjs again — the dropped columns are
--        still in the types until it runs. Nothing reads them, so this is
--        tidiness rather than a fix, but a types file that describes a column
--        the database does not have is the exact thing item 84 exists to stop.
--     6. Block A below.
-- ===========================================================================
--
-- ── BLOCK A — they are gone, and the live one still holds what it held ────
--
--   Read-only. Nothing to roll back.
--
--   select
--     (select count(*) from information_schema.columns
--       where table_schema = 'public' and table_name = 'providers'
--         and column_name in ('location_lat','location_lng'))        as dead_columns_left,
--     (select count(*) from public.providers)                        as providers_total,
--     (select count(*) from public.providers where latitude is not null) as providers_placed;
--
--   dead_columns_left must be 0.
--   providers_placed must be at least 2 — ff06d568 (Chatham) and 517c2853
--   (Medway) both had coordinates before this ran, and nothing here touches
--   them. If it has dropped, the wrong columns went.
-- ===========================================================================

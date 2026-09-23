-- ===========================================================================
-- 0054_a_postcode_places_you
--
-- The web can finally say where someone is. Audit item 90. Decision: Micky,
-- 23 Sep 2026 — a postcode box, looked up server-side, not the browser's
-- location API.
--
-- ⚠️ Apply 0053 first. 0055 follows this one, but NOT until the site is
-- deployed — see DEPLOY at the foot of this file.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────
-- Nothing in site/ has ever written a coordinate. `users.latitude/longitude`
-- and `providers.latitude/longitude` are written in exactly two places, both
-- in the app: mobile index.tsx:218 and provider-dashboard.tsx:588. So a
-- member who signs up on the website and never installs the app has no
-- coordinate, permanently, and two things follow:
--
--   * A WEB-ONLY STYLIST IS INVISIBLE TO DISTANCE. Mobile's browse drops any
--     stylist it cannot place the moment a radius is chosen — correctly, and
--     deliberately (index.tsx:454: "If we can't place a stylist, a radius
--     can't include them"). She has paid £14.99, passed the ID check and
--     published, and she vanishes from the app's main discovery path.
--   * A WEB-ONLY MODEL'S UPDATES FEED IS EMPTY BY CONSTRUCTION. The default
--     radius is 20 miles, every distance is null, and the filter removes
--     every row — under a note that says filtering is off.
--
-- Neither is a bug in one screen. Both are the same missing column value.
--
-- ── WHY A POSTCODE AND NOT THE BROWSER'S LOCATION API ───────────────────
-- A postcode needs no permission prompt, works on a desktop, and is more
-- precise than a browser's IP-derived fix. It is also legible: she can read
-- back what she typed and correct it, which a coordinate she never sees is
-- not. The lookup is postcodes.io — ONS open data, no key, UK-only, and its
-- licence does not restrict storing the result (Google's Geocoding terms do,
-- which rules it out for a value we keep).
--
-- ⚠️ THE LOOKUP IS SERVER-SIDE AND THAT IS NOT INCIDENTAL. Privacy §11 says
-- "Our fonts are served from this site rather than a third party, so loading
-- a page doesn't share your IP address with anyone else." A browser-side
-- lookup would send the member's IP to postcodes.io and make that false.
-- From a server action, our address goes and hers does not.
--
-- ── WHAT IS STORED, AND THE DECISION BEHIND IT ──────────────────────────
-- The FULL postcode, not just the outward code. Micky, 23 Sep: the coordinate
-- is the sensitive part and it is stored either way, so keeping the postcode
-- barely changes what a breach reveals — while a wrong placement she cannot
-- see is exactly the silent failure this work exists to fix. She must be able
-- to read back what she typed.
--
-- Condition attached to that decision, and honoured here: it is never shown
-- to anyone but her, and it goes on public-web-views.sql's exclusion list in
-- the same change, beside latitude and longitude.
--
-- ⚠️ IT IS NOT ROUNDED, AND THE EARLIER DRAFT THAT ROUNDED IT WAS WRONG.
-- An earlier plan stored the coordinate to 3 decimal places (~110 m) to keep
-- it away from a doorstep. That protects nothing once the full postcode sits
-- in the next column: a postcode IS the finer identifier. Rounding would have
-- cost accuracy and bought a feeling.
--
-- ── ONE HOME FOR THE POSTCODE, TWO FOR THE COORDINATE ───────────────────
-- users.postcode is the only copy. The coordinate is mirrored onto providers
-- for a stylist, because that is the row the stylist-facing queries read
-- (dashboard.ts:464, mobile index.tsx:262) — the same two writes mobile
-- already does. set_my_postcode() below is what keeps them from disagreeing.
--
-- ── ⚠️ THE DEAD PAIR IS DROPPED IN 0055, NOT HERE, AND THE SPLIT IS THE POINT
-- providers carries a SECOND coordinate pair, location_lat/location_lng, read
-- as a fallback in dashboard.ts:519 and written by nothing but the demo
-- fixtures. Micky's query over all five live accounts, 23 Sep: false on every
-- row. So it is not a fallback, it is a decoy, and it goes.
--
-- But it cannot go in THIS migration, and the reason is worth reading before
-- anyone tidies the two back into one:
--
--   * Dropping it needs the live site to have stopped naming it FIRST.
--     PostgREST fails the WHOLE select when one column is missing, so the
--     updates feed would not degrade — it would throw, and the model
--     dashboard would 500 until the deploy landed.
--   * But the site cannot BUILD until the generated types know about
--     set_my_postcode, and those types are generated from the live database,
--     which means this migration has to be applied FIRST.
--
-- Those two orders contradict each other, so they are two migrations.
-- **0054 is purely additive and safe to apply against the build that is live
-- right now.** 0055 removes the dead pair once the new build is serving.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
--
-- The coordinate columns predate the migration ledger, so their type is
-- recorded in no file in this repo. Rather than assume it, this checks it —
-- set_my_postcode() assigns double precision into them, and that only works
-- if they are a numeric type.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  if to_regclass('public.users') is null or to_regclass('public.providers') is null then
    raise exception '0054: public.users or public.providers is missing.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'postcode'
  ) then
    raise exception '0054: users.postcode already exists. Read it before applying.';
  end if;

  select string_agg(format('%s.%s is %s', table_name, column_name, data_type), ', ')
    into v_bad
  from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'users'     and column_name in ('latitude','longitude'))
      or (table_name = 'providers' and column_name in ('latitude','longitude')))
    and data_type not in ('double precision', 'numeric', 'real');
  if v_bad is not null then
    raise exception '0054: a coordinate column is not numeric (%). Stopping.', v_bad;
  end if;

  -- 0040's guard is what makes it safe for a member to write their own row at
  -- all. If it is missing, this is not the schema this was written against.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_guard_users_protected_columns' and not tgisinternal
  ) then
    raise exception '0054: trg_guard_users_protected_columns is missing. Apply 0040 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE COLUMN
--
-- Canonical form, as postcodes.io returns it: upper case, one space, e.g.
-- "BR1 2AB". The CHECK is a shape guard, not a validator — postcodes.io has
-- already decided the postcode is real, and a regex that tried to re-decide
-- that would eventually refuse a valid one.
--
-- ⚠️ MEMBER-WRITABLE, AND IT HAS TO STAY THAT WAY. 0040's guard is a DENYLIST
-- (is_verified, subscription_status, the two fee waivers, fraud_flagged,
-- role), so a new column is member-writable by default and nothing needed
-- changing there. But that function's own comment records its intended
-- replacement: a column-level GRANT of exactly "profile_pic_url,
-- date_of_birth, instagram_handle, latitude, longitude". **postcode must join
-- that list when it lands**, or setting your own postcode stops working with
-- no error anyone would connect to the cause.
--
-- That comment is NOT edited here, on purpose. Doing so would mean
-- reproducing a function comment from a repo file rather than from the
-- database, which is the mistake that cost two rewrites on 23 Sep. It is
-- recorded here instead, where the column is.
-- ---------------------------------------------------------------------------
alter table public.users
  add column postcode text
  constraint users_postcode_shape check (postcode is null or postcode ~ '^[A-Z0-9]{2,4} [0-9][A-Z]{2}$');

comment on column public.users.postcode is
  'The postcode this member gave on the website, canonical form ("BR1 2AB"), looked up through '
  'postcodes.io to fill latitude/longitude. NULL means they have never set one — which is every '
  'account that has only ever used the app, where the coordinate comes from device GPS instead. '
  'NEVER SHOWN TO ANOTHER MEMBER: excluded by name in public-web-views.sql, and public_profiles '
  'selects explicit columns that do not include it. Member-writable through set_my_postcode(); see '
  '0054''s note about 0040''s future column-level GRANT. 0054, audit item 90.';

-- ---------------------------------------------------------------------------
-- 2. SETTING IT, IN ONE TRANSACTION
--
-- Two tables have to agree: users.postcode with users.latitude/longitude, and
-- providers.latitude/longitude for a stylist. Written as two client calls they
-- can half-succeed, and a stylist whose postcode says Chatham while her
-- provider row still holds last year's GPS is placed somewhere she is not —
-- silently, which is the whole class of failure this migration exists to end.
-- A function body is one transaction, so this cannot half-happen.
--
-- ⚠️ SECURITY INVOKER, DELIBERATELY. A DEFINER function would have to
-- re-implement "only your own rows" in its body. As an invoker it inherits the
-- policies instead: "users can update own row", "providers can update own
-- row", and the RESTRICTIVE providers_not_suspended — so a suspended stylist
-- is refused by the same rule that refuses her everywhere else, for free.
--
-- ⚠️ ALL THREE ARGUMENTS DEFAULT TO NULL, AND THAT IS A TYPE DECISION AS WELL
-- AS A SQL ONE. `supabase gen types` marks an argument WITHOUT a SQL default
-- as required AND non-nullable, and cannot express "nullable" at all — the
-- same limitation p_note hit on create_session_with_consent (item 84). Without
-- defaults, clearing a postcode (three nulls) could not be written in
-- TypeScript without a cast. With them, clearing is `rpc('set_my_postcode',
-- {})` and every argument stays honestly typed.
--
-- Clearing has to work as well as setting. Privacy treats location as
-- consent-based and withdrawable at any time, and a withdrawal that required
-- getting a valid postcode past the lookup first would not be one.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_postcode(
  p_postcode text             default null,
  p_lat      double precision default null,
  p_lng      double precision default null
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'You need to be signed in to set your postcode.' using errcode = '42501';
  end if;

  -- Either all three arrive or none do. A postcode with no coordinate is a
  -- string that looks like it is working, and a coordinate with no postcode
  -- cannot be read back or corrected by the person it describes.
  if (p_postcode is null) <> (p_lat is null) or (p_lat is null) <> (p_lng is null) then
    raise exception 'set_my_postcode: give a postcode and both coordinates, or all three null.'
      using errcode = '22023';
  end if;

  update public.users
     set postcode = p_postcode, latitude = p_lat, longitude = p_lng
   where id = v_me;

  if not found then
    raise exception 'set_my_postcode: no profile row for this account.' using errcode = 'P0002';
  end if;

  -- The stylist mirror. A no-op for a model by the WHERE clause rather than by
  -- a role test: 'both' accounts have a provider row and need it updated too,
  -- and reading the role to decide would be a second thing to keep in step.
  update public.providers
     set latitude = p_lat, longitude = p_lng
   where user_id = v_me;
end $$;

comment on function public.set_my_postcode(text, double precision, double precision) is
  'Set or clear the caller''s postcode and the coordinate derived from it, across users and '
  'providers in one transaction. The coordinate must come from a postcodes.io lookup done '
  'server-side (site/lib/postcode.ts) — this function does not and cannot check that the '
  'coordinate matches the postcode. Invoker rights on purpose: RLS is what confines it to your own '
  'rows and what refuses a suspended stylist. 0054, audit item 90.';

revoke execute on function public.set_my_postcode(text, double precision, double precision) from public, anon;
grant  execute on function public.set_my_postcode(text, double precision, double precision) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0054', 'a_postcode_places_you', '83c5b8e146eff8317c544f85ff3ca8b548f966feb7904b1038331f39661f8010');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY — THE ORDER IS PART OF THE CHANGE
--
-- This migration is PURELY ADDITIVE. Applying it against the build that is
-- live right now breaks nothing: the running site simply does not know the
-- new column or the new function exist.
--
--   1. Apply this migration.
--   2. node scripts/gen-supabase-types.mjs
--      site/ is type-checked now, and the postcode action calls
--      set_my_postcode — which is not in the types until this runs, so
--      `npm run build` fails until it does. That is the right order, not a
--      workaround.
--   3. npm run verify --prefix site, then push. Wait for the Vercel deploy.
--   4. Blocks A to C below.
--   5. THEN apply 0055, which drops the dead coordinate pair. Not before the
--      deploy in step 3 — see 0055's own header for what happens if it is.
--
--   Mobile needs NO change and NO rebuild. Its radius filter already excludes
--   stylists it cannot place, which was correct before this and stays correct
--   after — the population it excludes just shrinks to people who have not set
--   a postcode yet.
-- ===========================================================================
--
-- ── BLOCK A — the column and its shape guard. Rolls back ─────────────────
--
--   do $$
--   declare
--     v_user uuid;
--     v_good text; v_lower text; v_nospace text; v_cleared text;
--   begin
--     select id into v_user from public.users limit 1;
--
--     update public.users set postcode = 'BR1 2AB' where id = v_user;
--     v_good := 'accepted (correct)';
--
--     begin
--       update public.users set postcode = 'br1 2ab' where id = v_user;
--       v_lower := 'ACCEPTED <-- WRONG, lower case should not pass';
--     exception when check_violation then v_lower := 'refused (correct)';
--     end;
--
--     begin
--       update public.users set postcode = 'BR12AB' where id = v_user;
--       v_nospace := 'ACCEPTED <-- WRONG, the space is part of the canonical form';
--     exception when check_violation then v_nospace := 'refused (correct)';
--     end;
--
--     update public.users set postcode = null where id = v_user;
--     v_cleared := 'accepted (correct — clearing must always work)';
--
--     raise exception E'ROLLED BACK ON PURPOSE.\nBR1 2AB: %\nbr1 2ab: %\nBR12AB: %\nnull: %',
--       v_good, v_lower, v_nospace, v_cleared;
--   end $$;
--
-- ── BLOCK B — set_my_postcode as a real member, through RLS. Rolls back ───
--
--   ⚠️ Run this in the Supabase SQL editor. `set local role authenticated`
--   plus the JWT claim is what makes RLS and 0040's guard apply — as the owner
--   they do not, and this block would prove nothing.
--
--   do $$
--   declare
--     v_me uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';   -- the model test account
--     v_pc text; v_lat double precision; v_half text; v_cleared_pc text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     perform public.set_my_postcode('BR1 2AB', 51.4059, 0.0148);
--     select postcode, latitude into v_pc, v_lat from public.users where id = v_me;
--
--     begin
--       perform public.set_my_postcode('BR1 2AB', null, null);
--       v_half := 'ACCEPTED <-- WRONG, a postcode with no coordinate must be refused';
--     exception when others then v_half := 'refused (correct): ' || sqlerrm;
--     end;
--
--     perform public.set_my_postcode();
--     select coalesce(postcode, '(null)') into v_cleared_pc from public.users where id = v_me;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\npostcode written: %  (must be BR1 2AB)\nlatitude written: %  (must be 51.4059)\npostcode with no coordinate: %\nafter clearing with no arguments: %  (must be (null))',
--       coalesce(v_pc, '(null)'), coalesce(v_lat::text, '(null)'), v_half, v_cleared_pc;
--   end $$;
--
-- ── BLOCK C — the stylist mirror, which is the whole reason for the function
--
--   Uses the provider test account 517c2853-50bb-4e8f-87fe-d79311bc37c0.
--   ⚠️ READ THE TWO COORDINATES. They must be equal. The entire reason this is
--   one function rather than two client calls is that they can disagree.
--
--   do $$
--   declare
--     v_me uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_user_lat double precision; v_prov_lat double precision; v_pc text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     perform public.set_my_postcode('ME4 4TZ', 51.3890, 0.5240);
--
--     select latitude into v_user_lat from public.users where id = v_me;
--     select latitude into v_prov_lat from public.providers where user_id = v_me;
--     select coalesce(postcode, '(null)') into v_pc from public.users where id = v_me;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nusers.latitude:     %\nproviders.latitude: %  (must be the SAME number)\npostcode read back: %',
--       coalesce(v_user_lat::text, '(null)'), coalesce(v_prov_lat::text, '(null)'), v_pc;
--   end $$;
--
-- ── WHAT NONE OF THESE PROVE ─────────────────────────────────────────────
-- That the coordinate is where the postcode actually is. Nothing in the
-- database can check that — set_my_postcode takes the lookup's word for it,
-- and the lookup is the only thing standing between a typo and a stylist
-- placed in the wrong county. That is why the postcode is stored and read back
-- to her on the page: she is the check.
-- ===========================================================================

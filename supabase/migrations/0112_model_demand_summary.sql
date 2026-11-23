-- ===========================================================================
-- 0112_model_demand_summary
--
-- Adds ONE read-only aggregate function and grants EXECUTE on it. It creates
-- no table, alters no table, and reads nothing it does not count.
--
-- ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
-- A stylist signs up, publishes nothing, lands on the dashboard and sees an
-- empty screen. Seven did exactly that and never came back. The platform is
-- not empty — 85 models have signed up — but no surface on the website says
-- so, because the only one that could (`nearby_models`) is revoked.
--
-- This answers "is anyone here?" with a number, and nothing else.
--
-- ⚠️⚠️ THIS IS NOT MODEL BROWSE, AND IT MUST NEVER GROW INTO ONE.
-- A directory was the obvious build and is the wrong one, for a reason that
-- is about the product and not about privacy appetite: **a stylist cannot
-- contact a model at all.** The sessions RLS policy "model can create session"
-- requires `auth.uid() = model_user_id`, and a message needs a session that
-- already exists, so there is no provider-initiated path anywhere in the
-- system. A directory would publish 85 people's names, photographs and
-- physical attributes to power a button that does not exist.
--
-- So: no id, no name, no initial, no photo, no attribute, no postcode, no
-- coordinate, no row per person. Counts and an area letter. If a future change
-- needs more than that, it needs a different function and a fresh argument,
-- not a column added here.
--
-- ⚠️ 0097 STANDS. This does not touch `nearby_models`, its body, or its grant.
-- `authenticated` still cannot execute it and that is deliberate — see 0097's
-- header for the argument, which was made once and should not be re-litigated
-- by a later file quietly widening a different door.
--
-- ── THE THRESHOLD, AND WHY 3 ──────────────────────────────────────────────
-- An area bucket is suppressed below 3 members. "1 model in CT1" is close to
-- naming somebody: a stylist who knows one model in Canterbury has just been
-- told which of her acquaintances is on the platform, and the account she is
-- on cost nothing to create. 3 is the smallest bucket where the statement is
-- about a place rather than a person.
--
-- ⚠️ THE SUPPRESSION IS MOST OF THE ANSWER TODAY, NOT AN EDGE CASE. Measured
-- 22 Nov 2026 against the live data: of 56 models who can be placed at all,
-- only **15 sit in an area that clears the threshold** (SE 7, E 4, W 4). The
-- other 41 are in buckets of 1 or 2, and 29 further models have no location of
-- any kind. Whoever renders this must say so out loud rather than presenting
-- three areas as if they were the whole picture — a list shortened in silence
-- and a short list look identical, which is the lesson `lib/distance.ts`
-- already carries about `unplaceableHidden`.
--
-- ── WHY POSTCODE AREA, AND NOT THE TWO OBVIOUS ALTERNATIVES ───────────────
-- Measured on the same data, with the same threshold:
--
--   `users.region`   ALL 85 models hold the single value 'UK'. One bucket.
--                    It would render as "56 models in UK", which tells a
--                    stylist in Glasgow precisely nothing.
--   outward code     'SE16' rather than 'SE'. Exactly ONE bucket survives the
--                    threshold (W4, with 3). The panel would name one area and
--                    suppress fifty.
--   admin_district   Two survive (Southwark 4, Hounslow 3), covering 7 people.
--   AREA (letters)   Three survive, covering 15. The best of them, and still
--                    thin, which is why the renderer has to be honest.
--
-- The area is also the coarsest of the three, which is the right direction for
-- a bucket that is being published to strangers.
--
-- ── WHAT THE DISTANCE IS, AND WHAT IT IS NOT ──────────────────────────────
-- Each surviving bucket reports the distance from the caller to the bucket's
-- CENTROID — the mean coordinate of the 3+ members in it. It is not the
-- distance to the nearest model, which would be one individual's location
-- wearing an aggregate's clothes.
--
-- Null coordinates in, null distance out. The caller orders by it nulls-last,
-- exactly as `nearby_models` does, so a stylist we cannot place still gets the
-- list rather than an empty screen.
--
-- ── WHO MAY CALL IT ───────────────────────────────────────────────────────
-- `authenticated`, with no role check, and that is deliberate. A role gate
-- would be theatre: `users.role` is self-selected at a free signup, so any
-- caller who wanted the numbers could have them by picking 'provider' on the
-- way in. The protection here is that THE FUNCTION RETURNS NOTHING WORTH
-- GATING — not that the door is locked.
--
-- ⚠️ SECURITY DEFINER IS REQUIRED, not decorative: `public.users` is behind
-- RLS and a stylist cannot read model rows directly. The function counts them
-- and returns no row to its caller.
--
-- ⚠️ SUSPENDED ACCOUNTS ARE COUNTED, deliberately. "Signed up" is what the
-- panel claims and suspension does not undo a signup. It is 0 either way today
-- (checked 22 Nov 2026); the note is here so the number is not later assumed
-- to be filtered.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if to_regclass('public.users') is null then
    raise exception '0112: public.users is missing. Nothing changed.';
  end if;

  -- The four columns the body reads. Named individually so a failure says
  -- which one, rather than erroring inside the function body later.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='users' and column_name='postcode') then
    raise exception '0112: users.postcode is missing; the area bucket is built from it.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='users' and column_name='latitude')
     or not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='users' and column_name='longitude') then
    raise exception '0112: users.latitude/longitude are missing; the centroid needs them.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='users' and column_name='role') then
    raise exception '0112: users.role is missing.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The function.
-- ---------------------------------------------------------------------------
create or replace function public.model_demand_summary(
  p_lat double precision default null,
  p_lng double precision default null
)
returns table (
  models_total          integer,  -- every model account, placed or not
  models_placed         integer,  -- those with a usable coordinate
  models_in_named_areas integer,  -- those inside a bucket that cleared the threshold
  areas                 jsonb     -- [{ area, count, distanceMi }], nearest first
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with placed as (
    select
      -- The AREA, not the outward district: 'SE', never 'SE16'. The regex
      -- takes the leading letters only, so a malformed postcode yields null
      -- and drops out at the `where` below rather than inventing a bucket.
      substring(upper(btrim(u.postcode)) from '^[A-Z]+') as area,
      u.latitude,
      u.longitude
    from public.users u
    where u.role = 'model'
      and u.latitude  is not null
      and u.longitude is not null
      and u.postcode  is not null
      and btrim(u.postcode) <> ''
  ),
  bucket as (
    select
      p.area,
      count(*)::int   as n,
      avg(p.latitude)  as lat,   -- the centroid. Never an individual.
      avg(p.longitude) as lng
    from placed p
    where p.area is not null and p.area <> ''
    group by p.area
    -- ⚠️ THE THRESHOLD. Below this a bucket is about a person, not a place.
    having count(*) >= 3
  ),
  ranked as (
    select
      b.area,
      b.n,
      case
        when p_lat is null or p_lng is null then null::double precision
        else 3959 * acos(
          greatest(-1.0, least(1.0,
            cos(radians(p_lat)) * cos(radians(b.lat)) *
            cos(radians(b.lng) - radians(p_lng)) +
            sin(radians(p_lat)) * sin(radians(b.lat))
          ))
        )
      end as distance_mi
    from bucket b
  )
  select
    (select count(*)::int from public.users where role = 'model'),
    (select count(*)::int from placed),
    (select coalesce(sum(n), 0)::int from bucket),
    coalesce(
      (select jsonb_agg(
                jsonb_build_object('area', r.area, 'count', r.n, 'distanceMi', r.distance_mi)
                order by r.distance_mi asc nulls last, r.n desc, r.area
              )
         from ranked r),
      '[]'::jsonb
    );
$function$;

-- ---------------------------------------------------------------------------
-- 2. Who may call it.
-- ---------------------------------------------------------------------------
grant execute on function public.model_demand_summary(double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  r         record;
  v_n       int;
  v_min     int;
  v_leak    text;
begin
  -- (a) Exactly one function of this name. Two overloads answering one
  --     question is the shape that put model_may_apply on two signatures.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'model_demand_summary';
  if v_n <> 1 then
    raise exception '0112: expected exactly 1 model_demand_summary, found %. Rolled back.', v_n;
  end if;

  -- (b) It must be SECURITY DEFINER, or it returns zero to every stylist and
  --     the panel reads as an empty platform — the exact thing it exists to
  --     disprove, failing silently.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'model_demand_summary' and p.prosecdef
  ) then
    raise exception '0112: model_demand_summary is not SECURITY DEFINER. Rolled back.';
  end if;

  -- (c) authenticated can call it.
  if not has_function_privilege('authenticated',
       'public.model_demand_summary(double precision, double precision)', 'EXECUTE') then
    raise exception '0112: authenticated cannot execute model_demand_summary. Rolled back.';
  end if;

  -- (d) ⚠️⚠️ 0097 IS UNTOUCHED. This file must not have widened the door it
  --     deliberately left shut.
  if has_function_privilege('authenticated',
       'public.nearby_models(double precision, double precision, double precision)', 'EXECUTE') then
    raise exception '0112: authenticated can execute nearby_models — 0097 revoked that and this '
      'migration must not restore it. Rolled back.';
  end if;

  -- (e) ⚠️ THE THRESHOLD HOLDS ON THE REAL DATA. Not "the SQL says >= 3" —
  --     the smallest bucket actually returned.
  select min((a->>'count')::int) into v_min
    from public.model_demand_summary() s,
         lateral jsonb_array_elements(s.areas) a;
  if v_min is not null and v_min < 3 then
    raise exception '0112: an area bucket of % was returned; the threshold is 3. Rolled back.', v_min;
  end if;

  -- (f) ⚠️ NOTHING IDENTIFYING CAME BACK. The keys are fixed, so a column
  --     added later without re-reading this header trips here.
  select string_agg(distinct k, ', ') into v_leak
    from public.model_demand_summary() s,
         lateral jsonb_array_elements(s.areas) a,
         lateral jsonb_object_keys(a) k
   where k not in ('area', 'count', 'distanceMi');
  if v_leak is not null then
    raise exception '0112: unexpected key(s) in an area row: %. This function returns counts '
      'only. Rolled back.', v_leak;
  end if;

  select * into r from public.model_demand_summary();
  raise notice '0112: % models total, % placed, % inside a named area across % area(s). '
    'The gap between placed and named is suppressed by the threshold and must be stated '
    'wherever this is rendered.',
    r.models_total, r.models_placed, r.models_in_named_areas, jsonb_array_length(r.areas);
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0112', 'model_demand_summary', 'f838933aa915ac9da839040e956c1090790bbcf808996a8161229c65bccb1a18');

commit;

notify pgrst, 'reload schema';

-- ⚠️ WHAT THE VERIFY BLOCK ABOVE DOES NOT PROVE: that the panel reading this
-- is honest about the suppressed remainder. That is a rendering property and
-- no migration can assert it. The thing to look at is whether a stylist with
-- no coordinates of her own still sees the areas listed — distance null, order
-- falling back to size — rather than an empty list.
--
-- ⚠️ TO UNDO: `drop function public.model_demand_summary(double precision,
-- double precision);` and delete the '0112' row. Nothing else was changed, so
-- there is nothing else to put back.

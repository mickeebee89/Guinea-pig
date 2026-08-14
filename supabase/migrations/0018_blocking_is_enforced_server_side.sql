-- ===========================================================================
-- 0018_blocking_is_enforced_server_side
--
-- Blocking someone now actually hides them. Until this, it hid them from one
-- list on one screen.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHAT BREAKS FOR A USER TODAY ──────────────────────────────────────────
-- A model blocks a stylist. The stylist can still open that model's profile —
-- photo gallery, attributes, bio, reviews, Instagram handle — by navigating
-- straight to it. The block removed them from a list and nothing else.
--
-- nearby_models is SECURITY DEFINER, so it bypasses RLS and returns blocked
-- users like anyone else. The ONLY exclusion is in JavaScript, at
-- mobile/src/app/(app)/provider-dashboard.tsx:1273:
--
--     const filtered = nearbyModels.filter(m => {
--       if (blockedIds.has(m.id)) return false
--
-- and `/(app)/model/[id]` performs no check at all. model_attributes and
-- model_photos are both `for select to authenticated using (true)`.
--
-- ── WHY THIS IS WORSE THAN AN ORDINARY BUG ────────────────────────────────
-- web-slice-3-progress.md pulled the blocked list forward in slice 3 for a
-- reason that applies here word for word:
--
--   "A control you cannot reverse is one people hesitate to use, and the point
--    of blocking being easy is that someone uneasy about a stranger acts
--    immediately rather than talking themselves out of it."
--
-- A control that does not do what its name says fails the same way. Someone who
-- blocks a stranger believes they can no longer be looked at. They can. The gap
-- between what the user believes and what is true is the whole harm, and it
-- lands on the person who already felt unsafe enough to press the button.
--
-- Apple Guideline 1.2 and Play's UGC policy both require blocking to work. This
-- is also a store-compliance item, not only a safety one.
--
-- ── WHERE THE RULE GOES ───────────────────────────────────────────────────
-- In the database, for the same reason as 0012 and 0016: three clients can read
-- these tables and a rule copied into three clients is one client away from
-- being wrong again. The web's own stylist browse already filters server-side
-- (getBlockedIds in lib/queries/browse.ts), so mobile is the odd one out and a
-- future web model-browse would have had to re-solve it.
--
-- ── WHAT IS DELIBERATELY *NOT* BLOCKED ────────────────────────────────────
-- public_profiles is untouched. It supplies the counterparty's name and photo
-- on sessions, chat and notifications. Blocking someone you already have a
-- booking with must not blank their name out of that booking — you still need
-- to know whose appointment it is in order to cancel it, and a nameless row is
-- worse for the blocker than a named one.
--
-- Blocking hides DISCOVERY, not history. That is the line.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0018') then
    raise exception 'Migration 0018 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE, per 0014.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0018', 'block rows', count(*)::text from public.blocks;

insert into public.migration_findings (version, item, value)
select '0018', 'distinct users involved in a block',
       count(*)::text from (
         select blocker_id as u from public.blocks
         union
         select blocked_id from public.blocks
       ) x;

insert into public.migration_findings (version, item, value)
select '0018', 'model_photos rows belonging to someone in a block', count(*)::text
from public.model_photos mp
where exists (
  select 1 from public.blocks b
  where b.blocker_id = mp.user_id or b.blocked_id = mp.user_id
);

-- ---------------------------------------------------------------------------
-- ASSERT, per 0014.
--
-- The policies below depend on is_admin(). If it is missing they would evaluate
-- to an error at read time and take model photos down for EVERYONE — a worse
-- outage than the bug being fixed.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_admin()') is null
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0018 needs is_admin() and it does not exist. The restrictive policies would '
      'error at read time and hide every model photo. Re-run with: '
      'set local cavy.migration_override = ''yes'';';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. One definition of "these two have blocked each other".
--
--    Mutual by design: either direction counts, matching the app's rule.
--
--    SECURITY DEFINER so a policy can consult blocks without recursing into
--    that table's own RLS — same pattern as is_admin() and is_suspended().
--    a <> b so a row can never hide itself from its owner.
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_pair(a uuid, b uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select a is not null and b is not null and a <> b and exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$function$;

-- ---------------------------------------------------------------------------
-- 2. Discovery stops returning blocked users.
--
--    Body is the live one from nearby-models-any.sql, unchanged except for the
--    block predicate. auth.uid() is readable inside a SECURITY DEFINER function
--    and is the CALLER, not the owner — that is what makes this work.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_models(
  p_lat       double precision DEFAULT NULL::double precision,
  p_lng       double precision DEFAULT NULL::double precision,
  p_radius_mi double precision DEFAULT NULL::double precision
)
 RETURNS TABLE(id uuid, first_name text, last_initial text, profile_pic_url text, is_verified boolean, distance_mi double precision, hair_colour text, hair_type text, hair_length text, skin_tone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $function$
  select
    u.id, u.first_name, u.last_initial, u.profile_pic_url, u.is_verified,
    dist.d as distance_mi,
    ma.hair_colour, ma.hair_type, ma.hair_length, ma.skin_tone
  from public.users u
  left join public.model_attributes ma on ma.user_id = u.id
  cross join lateral (
    select case
      when p_lat is null or p_lng is null
        or u.latitude is null or u.longitude is null
      then null::double precision
      else 3959 * acos(
        greatest(-1.0, least(1.0,
          cos(radians(p_lat)) * cos(radians(u.latitude)) *
          cos(radians(u.longitude) - radians(p_lng)) +
          sin(radians(p_lat)) * sin(radians(u.latitude))
        ))
      )
    end as d
  ) dist
  where u.role = 'model'
    and (
      p_radius_mi is null
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
    -- NEW: never surface someone either party has blocked.
    and not public.is_blocked_pair(auth.uid(), u.id)
  order by dist.d asc nulls last, u.created_at desc nulls last, u.id
  limit 200;
$function$;

grant execute on function public.nearby_models(double precision, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The profile itself, for anyone who navigates straight to it.
--
--    RESTRICTIVE, so it ANDs with the existing permissive policies rather than
--    replacing them — the `using (true)` reads stay, narrowed by this.
--
--    Three escapes, each load-bearing:
--      user_id = auth.uid()  a user must always see their own row. This is what
--                            keeps model-profile.tsx (the model's own editor)
--                            and apply-session.tsx working.
--      is_admin()            moderation reads bios and photos to action reports.
--                            A blocked admin who cannot see the evidence cannot
--                            do the job the block exists to support.
--      not blocked           everyone else.
-- ---------------------------------------------------------------------------
drop policy if exists model_attributes_hide_blocked on public.model_attributes;
create policy model_attributes_hide_blocked
  on public.model_attributes as restrictive for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or not public.is_blocked_pair(auth.uid(), user_id)
  );

drop policy if exists model_photos_hide_blocked on public.model_photos;
create policy model_photos_hide_blocked
  on public.model_photos as restrictive for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or not public.is_blocked_pair(auth.uid(), user_id)
  );

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0018', 'blocking_is_enforced_server_side', '46eb7ec3b41e34dba5d976c5547e8b0d914ebd1b0619721b3c0fd8761653c65c');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — the numbers this migration recorded ────────────────────────
--
--   select item, value from public.migration_findings
--   where version = '0018' order by id;
--
-- ── BLOCK B — the policies are RESTRICTIVE, not permissive ──────────────
--
--   A permissive one here would GRANT access rather than narrow it, which is
--   the opposite of the intent and would look identical in a casual glance.
--
--   select tablename, policyname, permissive, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and policyname in ('model_attributes_hide_blocked', 'model_photos_hide_blocked');
--
--   Expect permissive = 'RESTRICTIVE' on both rows.
--
-- ── BLOCK C — a blocked pair cannot see each other. Rolls itself back. ───
--
--   Runs as the SQL editor (service role), which bypasses RLS, so this checks
--   the FUNCTION rather than the policy. The policy is checked in the app.
--
--   begin;
--     select public.is_blocked_pair(b.blocker_id, b.blocked_id) as should_be_true,
--            public.is_blocked_pair(b.blocked_id, b.blocker_id) as also_true_either_way,
--            public.is_blocked_pair(b.blocker_id, b.blocker_id) as self_must_be_false
--     from public.blocks b limit 1;
--   rollback;
--
--   If there are no block rows, make one, check, and roll back.
--
-- ── BLOCK D — THE REAL PROOF IS IN THE APP ──────────────────────────────
--
--   Two accounts, one blocks the other, then as the blocker:
--     1. the blocked user is gone from Nearby models
--     2. opening /(app)/model/<their id> directly shows no photos or attributes
--     3. an existing booking between them STILL shows their name — blocking
--        hides discovery, not history. If that name has vanished, this
--        migration reached further than it should have.
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

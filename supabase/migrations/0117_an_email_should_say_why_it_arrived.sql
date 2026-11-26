-- ===========================================================================
-- 0117_an_email_should_say_why_it_arrived
--
-- Two corrections to 0116, three days old.
--
--   1. A notice is only sent for a shop somebody can actually open. The
--      publication gate moves from the distance arm to the whole audience.
--   2. Every notice records WHY it was sent, so the email can say so.
--
-- ── 1. THE FAVOURITES ARM NEEDED THE GATE TOO ─────────────────────────────
-- 0116 gated distance on `is_published AND provider_shop_is_publishable` and
-- deliberately left the favourites arm open, reasoning that a favourite is a
-- model ASKING to be told and the bar for honouring a request is lower than
-- the bar for approaching a stranger.
--
-- ⚠️ THAT REASONING WAS ABOUT THE WRONG THING. It is sound as an argument for
-- not WITHHOLDING a notice from someone who asked. It is not an argument for
-- sending her to a page that says the shop is closed. `/stylist/<id>` for an
-- unpublished shop renders "<name> isn't taking new bookings at the moment"
-- and HIDES THE AVAILABILITY SECTION ENTIRELY (site/app/(app)/stylist/[id]
-- /page.tsx, the `!isPublished && !isOwner && !isAdmin` branch and the
-- `(isPublished || isOwner || isAdmin)` guard on the availability section).
--
-- So the email would list five bookable times, each with a treatment and a
-- price, under a button whose destination shows none of them. An email that
-- names things it cannot deliver is worse than no email, and it is the exact
-- shape of item 143 — a body promising something the row could not reach.
--
-- ⚠️ MEASURED BEFORE CHANGING IT: ZERO REAL INSTANCES. Favourites on
-- unpublished shops, read 26 Nov 2026: Micky B's own shop (already excluded,
-- the owner is never in her own audience) and one row created by hand for the
-- 0116 live test. Nobody loses a notice they are getting today. Reachable in
-- production as publish → model favourites → unpublish → post times, which is
-- why it is closed now rather than when it first bites.
--
-- ⚠️ AND IT MAKES THE RULE ONE RULE. After this, "a notice was sent" implies
-- "there is a public page listing those slots", with no arm of the union
-- exempt. The gate also leaves the distance lateral, where it was: two copies
-- of a condition is how the two arms disagreed in the first place.
--
-- ── 2. WHY THE EMAIL ARRIVED ──────────────────────────────────────────────
-- The footer says "You're getting this because you have a Cavy account",
-- which is true of every email Cavy sends and therefore explains none of them.
-- For a notice about a stylist a model has never heard of, that is the
-- sentence that gets mail marked as spam: no reason given, an unfamiliar name
-- in the subject.
--
-- ⚠️ AND THE REASON IS NOT THE SAME FOR EVERY RECIPIENT, which is why it is a
-- column of the row rather than a sentence in the template. The audience is a
-- UNION. "This stylist works near you" is false for a favouriter who lives
-- further away — measured: Taty Tint's one favouriter is OUTSIDE the ten
-- miles and is in the audience anyway, which is the case that would have been
-- told something untrue about her own location.
--
-- So `data.reason` is 'favourite' or 'nearby', and send-email picks the
-- sentence. ⚠️ FAVOURITE WINS WHEN BOTH ARE TRUE: it is a thing she did,
-- and "you saved this stylist" is a better answer to "why am I being emailed"
-- than anything we inferred.
--
-- ⚠️ NOTHING ABOUT WHERE SHE IS GOES IN THE ROW. 'nearby' is the reason, not
-- a distance; `distance_mi` is not computed, not stored and not sent. The
-- email says the stylist works near her and stops there.
--
-- ── ORDER OF APPLICATION: EITHER WAY ROUND ────────────────────────────────
-- Unlike 0116, this does not have to land before or after the send-email
-- deploy. The new copy reads `data.reason` and falls back to the old sentence
-- when it is absent, which covers the 82 rows written before 0116 and
-- anything written between this migration and the deploy.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0116') then
    raise exception '0117 needs 0116 applied first.';
  end if;

  if to_regprocedure('public.availability_notice_audience(uuid)') is null
     or to_regprocedure('public.notify_models_of_availability(uuid[])') is null then
    raise exception '0117: 0116''s functions are missing. Both are replaced below; read the '
      'header before running this.';
  end if;

  if to_regprocedure('public.provider_shop_is_publishable(uuid)') is null then
    raise exception '0117: provider_shop_is_publishable(uuid) is missing, and it is half of '
      'the gate being hoisted.';
  end if;

  if to_regclass('public.availability_notices') is null then
    raise exception '0117: public.availability_notices is missing.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The audience, with ONE publication gate covering both arms.
-- ---------------------------------------------------------------------------
-- Replaces 0116's version. Everything else about it is unchanged: still
-- STABLE, still SECURITY DEFINER, still revoked from everyone because "who
-- lives near this shop" names a member's neighbours, still one row per user by
-- structure rather than by `distinct`, still ten miles in one place.
create or replace function public.availability_notice_audience(p_provider_id uuid)
returns table (model_user_id uuid, by_favourite boolean, by_distance boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select u.id, f.fav, d.near
    from public.providers p
    cross join public.users u
    cross join lateral (
      select exists (
        select 1 from public.favourites fv
         where fv.provider_id = p.id and fv.user_id = u.id
      ) as fav
    ) f
    cross join lateral (
      select (
        -- ⚠️ THE PUBLICATION TEST HAS LEFT THIS LATERAL. It is in the WHERE
        -- clause below now, covering both arms. Leaving a copy here would be
        -- two places to keep in step, which is how the arms came to disagree.
        -- What is left is the geometry and nothing else.
        u.role = 'model'
        and p.latitude is not null and p.longitude is not null
        and u.latitude is not null and u.longitude is not null
        -- Ten miles. Same great-circle expression as nearby_models and
        -- invitable_models, clamped because acos(1.0000000000000002) is a
        -- 22003 rather than a rounding error.
        and 3959 * acos(greatest(-1.0, least(1.0,
              cos(radians(p.latitude)) * cos(radians(u.latitude)) *
              cos(radians(u.longitude) - radians(p.longitude)) +
              sin(radians(p.latitude)) * sin(radians(u.latitude))
            ))) <= 10
      ) as near
    ) d
   where p.id = p_provider_id
     -- ⚠️⚠️ BOTH ARMS, AS OF 0117. A notice leads to /stylist/<id>, and that
     -- page shows no availability at all for an unpublished shop — so a notice
     -- about one would list times under a button that reaches none of them.
     -- `is_published` alone is not enough: it is a column anyone's code can
     -- set, while provider_shop_is_publishable is the predicate the publish
     -- path itself uses. Both, the same pair invitable_models requires.
     and p.is_published is true
     and public.provider_shop_is_publishable(p.id)
     and u.id <> p.user_id
     and (f.fav or d.near)
     and not public.is_suspended(u.id)
     and not public.is_blocked_pair(p.user_id, u.id);
$function$;

comment on function public.availability_notice_audience(uuid) is
  'Who should be told that this shop posted times (0116, gate widened 0117): '
  'favourited OR within 10 miles, and in BOTH cases only for a published, '
  'publishable shop — an unpublished one has no page showing those slots. '
  'Never the owner, the suspended, or either side of a block. ⚠️ NOT GRANTED '
  'to anyone: it would name a member''s neighbours.';

-- ⚠️ THE REVOKE IS REPEATED BECAUSE create or replace DOES NOT RESET GRANTS —
-- but if this function is ever DROPPED and recreated, Supabase's default
-- privileges hand EXECUTE to anon and authenticated again. Idempotent, and
-- cheaper than finding out the other way.
revoke all on function public.availability_notice_audience(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The notice, now recording why it was sent.
-- ---------------------------------------------------------------------------
-- Replaces 0116's version. The ONLY change is `data.reason`; the slot list,
-- the cap, the price rendering, the four bookability filters, the ON CONFLICT
-- debounce and the auth.uid()-derived provider are all identical, and the
-- header of 0116 is still the explanation for every one of them.
create or replace function public.notify_models_of_availability(p_slot_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_list_cap constant integer := 5;

  v_provider_id uuid;
  v_name        text;
  v_total       integer;
  v_list        text;
  v_body        text;
  v_count       integer;
begin
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider_id, v_name
    from public.providers p
   where p.user_id = auth.uid();

  if v_provider_id is null then
    return 0;
  end if;

  with contention as (
    select * from public.slot_contention(v_provider_id)
  ),
  open_slots as (
    select a.id, a.date, a.start_time, a.price_pence, a.active_treatments
      from public.availability a
      left join contention c on c.availability_id = a.id
     where a.provider_id = v_provider_id
       and (p_slot_ids is null or a.id = any (p_slot_ids))
       and a.is_taken is not true
       and coalesce(c.contested, false) is false
       and coalesce(array_length(a.active_treatments, 1), 0) > 0
       and ((a.date + a.start_time) at time zone 'Europe/London') > now()
  ),
  described as (
    select row_number() over (order by s.date, s.start_time, s.id) as rn,
           to_char(s.date, 'Dy FMDD Mon')
           || ', ' || to_char(s.start_time, 'FMHH12:MIam')
           || ' — ' || t.label
           || case
                when s.price_pence is null       then ''
                when s.price_pence = 0           then ', Free'
                when s.price_pence % 100 = 0     then ', £' || (s.price_pence / 100)::text
                else ', £' || to_char(s.price_pence / 100.0, 'FM999990.00')
              end as line
      from open_slots s
      cross join lateral (
        select coalesce(
                 string_agg(
                   coalesce(nullif(btrim(pt.name), ''), nullif(btrim(pt.category), '')),
                   ', ' order by pt.name),
                 'An appointment') as label
          from public.provider_treatments pt
         where pt.id = any (s.active_treatments)
      ) t
  )
  select count(*)::integer,
         string_agg(d.line, E'\n' order by d.rn) filter (where d.rn <= c_list_cap)
    into v_total, v_list
    from described d;

  if coalesce(v_total, 0) = 0 then
    return 0;
  end if;

  v_body := v_list;
  if v_total > c_list_cap then
    v_body := v_body || E'\n' || 'and ' || (v_total - c_list_cap)::text || ' more.';
  end if;

  -- ⚠️ `as materialized` IS LOAD-BEARING, NOT DECORATION. `aud` is now read
  -- TWICE in one statement — once by the ON CONFLICT and once to recover each
  -- recipient's reason — and since PostgreSQL 12 a plain CTE referenced more
  -- than once may be inlined and evaluated more than once. The function is
  -- STABLE and the snapshot is fixed, so the rows would agree either way; this
  -- makes "evaluated once" a property of the statement rather than something
  -- that happens to be true, and saves a second pass over users.
  with aud as materialized (
    select * from public.availability_notice_audience(v_provider_id)
  ),
  claimed as (
    insert into public.availability_notices (provider_id, model_user_id)
    select v_provider_id, a.model_user_id from aud a
    on conflict on constraint availability_notices_one_per_day do nothing
    returning model_user_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select c.model_user_id,
         'new_availability',
         'New times at ' || v_name,
         v_body,
         jsonb_build_object(
           'provider_id', v_provider_id,
           -- ⚠️ WHY SHE IS BEING EMAILED, AND IT DIFFERS PER RECIPIENT. The
           -- audience is a union, so a single sentence in the email template
           -- would be false for one arm or the other: Taty Tint's favouriter
           -- lives OUTSIDE ten miles and is in the audience anyway.
           --
           -- ⚠️ FAVOURITE WINS WHEN BOTH ARE TRUE. It is something she did, and
           -- her own action is a better answer than anything we inferred.
           --
           -- ⚠️ THE REASON, NOT THE DISTANCE. No figure, no postcode, no
           -- coordinate — nothing derived from where she is beyond the one word
           -- that explains the email. send-email renders it as a sentence.
           'reason', case when a.by_favourite then 'favourite' else 'nearby' end)
    from claimed c
    join aud a on a.model_user_id = c.model_user_id;

  get diagnostics v_count = row_count;

  delete from public.availability_notices where notified_on < current_date - 30;

  return v_count;
end
$function$;

comment on function public.notify_models_of_availability(uuid[]) is
  'Writes one new_availability notification per model in '
  'availability_notice_audience() for the CALLING stylist, at most one per '
  'model per London day. Body lists each bookable slot: treatment, day and '
  'time, price, £0 as "Free", capped at 5 with "and N more." `data` carries '
  'provider_id and reason (favourite|nearby, 0117) — the reason, never a '
  'distance. Returns how many were written.';

-- create or replace keeps the grant; restated so a drop-and-recreate cannot
-- silently leave no stylist able to send a notice.
grant execute on function public.notify_models_of_availability(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def       text;
  v_pid       uuid;
  v_puser     uuid;
  v_model     uuid;
  v_inserted  integer;
  v_aud       integer;
  v_best      integer := 0;
  v_favs      integer;
  v_withheld  integer;
  r           record;
begin
  -- (a) ⚠️⚠️ AN UNPUBLISHED SHOP WITH A FAVOURITER REACHES NOBODY, exercised
  --     against real foreign keys rather than asserted from the function's
  --     text. This is the whole point of the migration: the old version
  --     returned that favouriter, and a grep for "is_published" would have
  --     passed on the old version too, because it was in the lateral.
  select p.id, p.user_id into v_pid, v_puser
    from public.providers p
   where p.is_published is not true
   order by p.id
   limit 1;
  -- ⚠️ SUSPENDED AND BLOCKED ARE BOTH EXCLUDED HERE, OR THE CHECK PASSES FOR
  --    THE WRONG REASON. The audience function drops a suspended model and
  --    either side of a block as well, so picking one of those would give an
  --    audience of 0 whatever the publication gate did — a check that cannot
  --    fail, dressed up as one that exercises something.
  select u.id into v_model
    from public.users u
   where u.role = 'model' and u.id <> coalesce(v_puser, u.id)
     and not public.is_suspended(u.id)
     and not public.is_blocked_pair(v_puser, u.id)
   limit 1;

  if v_pid is null or v_model is null then
    raise notice '0117: no unpublished provider and/or no model available, so the widened '
      'gate was NOT exercised. The function is replaced; that it withholds is untested.';
  else
    insert into public.favourites (user_id, provider_id)
    values (v_model, v_pid)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;

    select count(*)::integer into v_aud
      from public.availability_notice_audience(v_pid);

    -- ⚠️ REMOVED BEFORE ANYTHING IS ASSERTED, and only if this block created
    --    it. A pre-existing favourite is somebody's real row and is not this
    --    migration's to delete.
    if v_inserted = 1 then
      delete from public.favourites where user_id = v_model and provider_id = v_pid;
    end if;

    if v_aud <> 0 then
      raise exception '0117: an UNPUBLISHED shop with a favouriter still has an audience of '
        '%. The publication gate did not reach the favourites arm, so a notice would still '
        'list times under a button that shows none. Rolled back.', v_aud;
    end if;
  end if;

  -- (b) And published shops have NOT lost their audience. A gate that closed
  --     everything would pass (a) perfectly.
  for r in
    select p.id, coalesce(p.name, '(no name)') as name
      from public.providers p where p.is_published is true
     order by p.name nulls last
  loop
    select count(*)::integer into v_aud
      from public.availability_notice_audience(r.id);
    raise notice '0117: % — audience %.', r.name, v_aud;
    if v_aud > v_best then v_best := v_aud; end if;
  end loop;

  select count(*)::integer into v_favs from public.favourites;
  if v_best <= v_favs then
    raise exception '0117: the largest audience across published shops is %, no more than the '
      '% row(s) in favourites. The hoisted gate has closed the distance arm as well. '
      'Rolled back.', v_best, v_favs;
  end if;

  -- (c) ⚠️ A GREP, AND SAID TO BE ONE. The notifier cannot be exercised from a
  --     migration: it derives its stylist from auth.uid() and there is no JWT
  --     here, so it returns 0 whoever calls it. This checks only that the
  --     'reason' key is in the body that was just installed — it does NOT
  --     prove the value is right, or that both branches are reachable. That
  --     needs a live call from a signed-in stylist, which is the test run
  --     straight after this is applied.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_models_of_availability';
  if v_def is null or v_def not like '%''reason''%' then
    raise exception '0117: notify_models_of_availability does not build a ''reason'' key, so '
      'the email cannot say why it arrived. Rolled back.';
  end if;
  if v_def not like '%as materialized%' then
    raise exception '0117: the audience CTE is not MATERIALIZED, and it is now read twice in '
      'one statement. Rolled back.';
  end if;

  -- (d) The audience reader must still be shut. It is re-created above, and a
  --     drop-and-recreate would have handed EXECUTE back to authenticated.
  if has_function_privilege('authenticated',
       'public.availability_notice_audience(uuid)', 'EXECUTE') then
    raise exception '0117: authenticated CAN execute availability_notice_audience, which '
      'would let any member list who lives near any shop. Rolled back.';
  end if;
  if not has_function_privilege('authenticated',
       'public.notify_models_of_availability(uuid[])', 'EXECUTE') then
    raise exception '0117: authenticated cannot execute notify_models_of_availability, so no '
      'stylist can send a notice at all. Rolled back.';
  end if;

  -- (e) ⚠️ WHAT THIS COSTS, MEASURED RATHER THAN ASSUMED TO BE NOTHING: how
  --     many favouriters of unpublished shops stop being notified. The header
  --     says zero real instances; this prints the number the database actually
  --     holds at the moment it runs, so a surprise shows up here instead of in
  --     somebody's expectations.
  select count(*)::integer into v_withheld
    from public.favourites f
    join public.providers p on p.id = f.provider_id
   where p.is_published is not true
     and f.user_id <> p.user_id;
  raise notice '0117: % favouriter(s) of unpublished shops will no longer be notified '
    '(the owner is excluded either way).', v_withheld;

  raise notice '0117: the publication gate covers both arms, and every notice now records '
    'why it was sent. ⚠️ DEPLOY send-email for the footer sentence; until then the footer '
    'falls back to the old wording, which is wrong but not false.';
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0117', 'an_email_should_say_why_it_arrived', 'da05ae1ffb6d4961c1efc0cfd73ba030691148f155d1f02d1d170ba4315cb19b');

commit;

notify pgrst, 'reload schema';

-- ⚠️ TO UNDO: both function bodies are in 0116 in full — restore them from
-- there and delete the '0117' row. Restoring the audience function re-opens the
-- favourites arm to unpublished shops; restoring the notifier stops `reason`
-- being written, at which point send-email falls back to the old footer
-- sentence on its own, so the deploy does not have to be rolled back with it.

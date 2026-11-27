-- 0118_a_both_account_is_a_model_too.sql
--
-- WHAT THIS CHANGES
-- Five functions test `role = 'model'` and nothing else. site/lib/roles.ts has
-- said since it was written that isModel(role) = role === 'model' || role ===
-- 'both', and 0090's own verify block used `u.role in ('model','both')`. The
-- narrow predicate was copied from nearby_models into invitable_models and
-- then into availability_notice_audience, so three generations of a mistake
-- now disagree with the application.
--
-- WHAT IT IS WORTH TODAY, MEASURED RATHER THAN ASSUMED
--   select role, count(*) from public.users group by role;
--     model 89, provider 21, both 1.
-- The one `both` account is micky.buckfield@hotmail.co.uk, the model test
-- account. So this fixes NOTHING a real member can see today. It is preventive,
-- and the thing it prevents is specific: the first stylist who also signs up to
-- model becomes invisible to the invite directory, to browse-by-distance, and
-- to every new-availability email, silently, with no error anywhere.
--
-- ⚠️ IT DOES CHANGE TODAY'S NUMBERS. The test account is placed, so it will
-- now enter the audience of any published shop within ten miles of it. That is
-- the fix working, not a side effect — but the audience counts recorded on
-- 27 Nov (Taty Tint 21, Nhi 15, Nadia 11, Flowers 9, Amal 2, Your Skin Club 2,
-- Petra 1, Mayera 1, SimpliciTee 0) are the before, and the verify block
-- prints the after so the two can be compared rather than trusted.
--
-- ⚠️ TWO FUNCTIONS WERE ON THE LIST AND ARE DELIBERATELY NOT TOUCHED.
-- verification_approval_body and notify_verification_approved test
-- `p_role = 'model'` — a PARAMETER naming which announcement to make, not the
-- users column. A `both` account holds a shop, so falling through to the
-- shop-publication branch is already the right behaviour for it. Widening
-- those would send a profile-only message to somebody with a shop to publish.
-- The list of seven was wider than the evidence for it.
--
-- ALSO HERE: "New times at Nadia" reads wrong, because four of the nine
-- published shops are a person's name. "with" is right for both shapes.
-- The string lives in one place — this function builds the title and
-- notifications is closed to direct INSERT (notifications_insert_denied,
-- 0101), so no other writer can produce this type. send-email reads the row's
-- title through, so nothing has to be redeployed for the wording to change;
-- its comment still quotes the old string and is now stale, which is a comment
-- and not behaviour.
--
-- GRANTS ARE NOT TOUCHED. 0097 settled nearby_models' grant and nothing here
-- reopens it. `create or replace` keeps the existing grants.

begin;

-- Guard: every function this replaces must exist with the signature expected,
-- and the predicate being widened must actually be present. If a previous
-- migration already fixed one of these, replacing it from here would silently
-- revert that fix.
do $guard$
declare
  v_missing text[];
begin
  if to_regprocedure('public.availability_notice_audience(uuid)') is null
    then v_missing := v_missing || 'availability_notice_audience(uuid)'; end if;
  if to_regprocedure('public.invitable_models(double precision,double precision,double precision)') is null
    then v_missing := v_missing || 'invitable_models(float8,float8,float8)'; end if;
  if to_regprocedure('public.invite_model(uuid,text)') is null
    then v_missing := v_missing || 'invite_model(uuid,text)'; end if;
  if to_regprocedure('public.model_demand_summary(double precision,double precision)') is null
    then v_missing := v_missing || 'model_demand_summary(float8,float8)'; end if;
  if to_regprocedure('public.nearby_models(double precision,double precision,double precision)') is null
    then v_missing := v_missing || 'nearby_models(float8,float8,float8)'; end if;
  if to_regprocedure('public.notify_models_of_availability(uuid[])') is null
    then v_missing := v_missing || 'notify_models_of_availability(uuid[])'; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception '0118: expected functions are absent: %', array_to_string(v_missing, ', ');
  end if;

  -- The predicate must still be narrow in all five, or this is replacing
  -- something it has not read.
  if (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('availability_notice_audience','invitable_models',
                          'invite_model','model_demand_summary','nearby_models')
        and pg_get_functiondef(p.oid) like '%role = ''model''%') <> 5 then
    raise exception '0118: one of the five no longer carries the narrow predicate — read them before replacing them';
  end if;
end
$guard$;

create or replace function public.availability_notice_audience(p_provider_id uuid)
  returns table(model_user_id uuid, by_favourite boolean, by_distance boolean)
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $fn$
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
        --
        -- ⚠️ 0118: `in ('model','both')`, not `= 'model'`. A stylist who also
        -- signs up to model is a model here. site/lib/roles.ts has always
        -- said so.
        u.role in ('model','both')
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
$fn$;

create or replace function public.invitable_models(
  p_lat double precision default null::double precision,
  p_lng double precision default null::double precision,
  p_radius_mi double precision default null::double precision)
  returns table(id uuid, first_name text, last_initial text, profile_pic_url text,
                distance_mi double precision, hair_colour text, hair_type text,
                hair_length text, hair_condition text, skin_tone text, skin_type text,
                eye_colour text, eye_shape text, nail_condition text, bio text)
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $fn$
  with me as (
    select p.id
    from public.providers p
    where p.user_id = auth.uid()
      and p.is_published is true
      and public.provider_shop_is_publishable(p.id)
    limit 1
  )
  select
    u.id, u.first_name, u.last_initial, u.profile_pic_url,
    dist.d as distance_mi,
    ma.hair_colour, ma.hair_type, ma.hair_length, ma.hair_condition,
    ma.skin_tone, ma.skin_type, ma.eye_colour, ma.eye_shape,
    ma.nail_condition, ma.bio
  from me
  cross join public.users u
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
  -- ⚠️ 0118: a `both` account is invitable. It was not, which meant the first
  -- stylist to also sign up as a model would have been missing from this
  -- directory with nothing to show that she had been excluded.
  where u.role in ('model','both')
    and u.discoverable is true
    and u.id <> auth.uid()
    and (
      p_radius_mi is null
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
    and not public.is_blocked_pair(auth.uid(), u.id)
    and not public.is_suspended(u.id)
    and not exists (
      select 1 from public.invites i
      where i.provider_id = me.id
        and i.model_user_id = u.id
        and (
          i.status = 'declined'
          or i.sent_on = ((now() at time zone 'Europe/London')::date)
        )
    )
  order by dist.d asc nulls last, u.created_at desc nulls last, u.id
  limit 200;
$fn$;

create or replace function public.invite_model(
  p_model_user_id uuid, p_message text default null::text)
  returns public.invites
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_provider uuid;
  v_name     text;
  v_msg      text := nullif(btrim(coalesce(p_message, '')), '');
  v_row      public.invites;
  v_screen   text;
begin
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider, v_name
    from public.providers p
   where p.user_id = auth.uid()
     and p.is_published is true
     and public.provider_shop_is_publishable(p.id);

  if v_provider is null then
    raise exception 'invite_model: your shop has to be published before you can invite anyone'
      using errcode = '42501';
  end if;

  if p_model_user_id is null or p_model_user_id = auth.uid() then
    raise exception 'invite_model: that is your own account'
      using errcode = '22023';
  end if;

  if v_msg is not null and char_length(v_msg) > 500 then
    raise exception 'invite_model: that message is too long'
      using errcode = '22001';
  end if;

  -- ⚠️ 0118: must agree with invitable_models exactly. If this were narrower
  -- than the directory, a stylist could see a name, press the button, and be
  -- told the member "cannot be invited" — the worst shape of the bug, because
  -- it looks like a refusal about that person.
  if not exists (
    select 1 from public.users u
    where u.id = p_model_user_id
      and u.role in ('model','both')
      and u.discoverable is true
  ) then
    raise exception 'invite_model: that member cannot be invited'
      using errcode = '42501';
  end if;

  if public.is_blocked_pair(auth.uid(), p_model_user_id) then
    raise exception 'invite_model: that member cannot be invited'
      using errcode = '42501';
  end if;

  if public.is_suspended(p_model_user_id) then
    raise exception 'invite_model: that member cannot be invited'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.invites i
    where i.provider_id = v_provider
      and i.model_user_id = p_model_user_id
      and i.status = 'declined'
  ) then
    raise exception 'invite_model: that member declined an earlier invite'
      using errcode = '23P01';
  end if;

  if v_msg is not null then
    v_screen := public.banned_words_check(v_msg);
    if v_screen is distinct from 'clean' then
      if v_screen = 'unscreenable' then
        raise exception 'invite_model: messages cannot be checked right now, so nothing was sent'
          using errcode = '55000';
      end if;
      raise exception 'invite_model: that message cannot be sent'
        using errcode = '23514';
    end if;
  end if;

  begin
    insert into public.invites (provider_id, model_user_id, message)
    values (v_provider, p_model_user_id, v_msg)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'invite_model: you have already invited this member today'
      using errcode = '23505';
  end;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_model_user_id,
    'stylist_invite',
    v_name || ' would like to invite you for an appointment',
    'Open their shop to see what they do and when they are free.',
    jsonb_build_object(
      'provider_id', v_provider,
      'invite_id',   v_row.id,
      'message',     v_msg
    )
  );

  return v_row;
end
$fn$;

create or replace function public.model_demand_summary(
  p_lat double precision default null::double precision,
  p_lng double precision default null::double precision)
  returns table(models_total integer, models_placed integer,
                models_in_named_areas integer, areas jsonb)
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $fn$
  with placed as (
    select
      substring(upper(btrim(u.postcode)) from '^[A-Z]+') as area,
      u.latitude,
      u.longitude
    from public.users u
    -- ⚠️ 0118: both occurrences widened. The total below counted from a
    -- different predicate than the buckets would have, had only one been
    -- changed — a counts panel that disagrees with itself.
    where u.role in ('model','both')
      and u.latitude  is not null
      and u.longitude is not null
      and u.postcode  is not null
      and btrim(u.postcode) <> ''
  ),
  bucket as (
    select
      p.area,
      count(*)::int   as n,
      avg(p.latitude)  as lat,
      avg(p.longitude) as lng
    from placed p
    where p.area is not null and p.area <> ''
    group by p.area
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
    (select count(*)::int from public.users where role in ('model','both')),
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
$fn$;

create or replace function public.nearby_models(
  p_lat double precision default null::double precision,
  p_lng double precision default null::double precision,
  p_radius_mi double precision default null::double precision)
  returns table(id uuid, first_name text, last_initial text, profile_pic_url text,
                is_verified boolean, distance_mi double precision,
                hair_colour text, hair_type text, hair_length text, skin_tone text)
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $fn$
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
  -- ⚠️ 0118: this is where the narrow predicate was first written and then
  -- copied twice. Widened at the source.
  where u.role in ('model','both')
    and (
      p_radius_mi is null
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
    -- never surface someone either party has blocked.
    and not public.is_blocked_pair(auth.uid(), u.id)
  order by dist.d asc nulls last, u.created_at desc nulls last, u.id
  limit 200;
$fn$;

-- ── "New times WITH Nadia" ──────────────────────────────────────────────────
-- Only the title line changes. Everything else is 0117 verbatim, reproduced
-- because `create or replace` of a plpgsql function has no smaller unit.
create or replace function public.notify_models_of_availability(
  p_slot_ids uuid[] default null::uuid[])
  returns integer
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $fn$
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

  -- ⚠️ `as materialized` IS LOAD-BEARING, NOT DECORATION. `aud` is read TWICE
  -- in one statement — once by the ON CONFLICT and once to recover each
  -- recipient's reason — and since PostgreSQL 12 a plain CTE referenced more
  -- than once may be inlined and evaluated more than once.
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
         -- ⚠️ 0118: "with", not "at". Four of the nine published shops are a
         -- person's name — "New times at Nadia" reads as a place. "with" is
         -- right for a salon name and a person's name both. Our words still
         -- come first, which is what stops a crafted shop name from making the
         -- subject line read as a message from us.
         'New times with ' || v_name,
         v_body,
         jsonb_build_object(
           'provider_id', v_provider_id,
           -- ⚠️ WHY SHE IS BEING EMAILED, AND IT DIFFERS PER RECIPIENT. The
           -- audience is a union, so a single sentence in the email template
           -- would be false for one arm or the other.
           -- ⚠️ FAVOURITE WINS WHEN BOTH ARE TRUE. It is something she did.
           -- ⚠️ THE REASON, NOT THE DISTANCE. No figure, no postcode, no
           -- coordinate. send-email renders it as a sentence.
           'reason', case when a.by_favourite then 'favourite' else 'nearby' end)
    from claimed c
    join aud a on a.model_user_id = c.model_user_id;

  get diagnostics v_count = row_count;

  delete from public.availability_notices where notified_on < current_date - 30;

  return v_count;
end
$fn$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Exercises rather than describes: it calls the functions and reads what the
-- database actually does with a `both` account.
do $verify$
declare
  v_both    uuid;
  v_narrow  int;
  v_title   text;
  v_seen    boolean;
  v_rec     record;
begin
  -- 1. Nothing narrow is left in the five.
  select count(*) into v_narrow
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('availability_notice_audience','invitable_models',
                       'invite_model','model_demand_summary','nearby_models')
     and pg_get_functiondef(p.oid) like '%role = ''model''%';
  if v_narrow <> 0 then
    raise exception '0118 verify: % of the five still test role = ''model''', v_narrow;
  end if;

  -- 2. The title says "with".
  select pg_get_functiondef(p.oid) into v_title
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_models_of_availability';
  -- ⚠️ THE TITLE EXPRESSION, NOT THE WORDS. The first draft of this check
  -- searched for the bare strings and failed on its own comment two hundred
  -- lines up, which mentions the old wording in order to explain the change.
  -- The thing that matters is the concatenation that builds the row.
  if v_title not like '%''New times with '' || v_name%' then
    raise exception '0118 verify: the title is not built from ''New times with ''';
  end if;
  if v_title like '%''New times at '' || v_name%' then
    raise exception '0118 verify: the old title expression survives';
  end if;

  -- 3. The `both` account is now reachable by distance. Proved by calling the
  --    audience function for a real published shop, not by re-reading the SQL.
  select id into v_both from public.users where role = 'both' limit 1;
  if v_both is null then
    raise notice '0118 verify: no `both` account exists, so arm 3 is untestable today';
  else
    v_seen := false;
    for v_rec in
      select p.id, p.name from public.providers p where p.is_published is true
    loop
      if exists (select 1 from public.availability_notice_audience(v_rec.id) a
                  where a.model_user_id = v_both) then
        v_seen := true;
        raise notice '0118 verify: the `both` account is in %''s audience', v_rec.name;
      end if;
    end loop;
    if not v_seen then
      raise notice '0118 verify: the `both` account is in no audience — correct if it favourites nobody and is over ten miles from all nine';
    end if;
  end if;

  -- 4. The counts panel agrees with itself.
  if (select models_total from public.model_demand_summary())
     <> (select count(*)::int from public.users where role in ('model','both')) then
    raise exception '0118 verify: model_demand_summary total disagrees with the table';
  end if;

  -- 5. The after, printed for comparison with the before in the header.
  for v_rec in
    select p.name, (select count(*) from public.availability_notice_audience(p.id)) as n
      from public.providers p where p.is_published is true order by 2 desc, 1
  loop
    raise notice '0118 audience after: % = %', v_rec.name, v_rec.n;
  end loop;
end
$verify$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum, applied_by)
values ('0118', 'a_both_account_is_a_model_too',
        'f45ef00c20b5aaa69fa18f3e88690e426273e4bdebacaa347eb262de9dd31a42', 'claude-opus-5');

commit;

-- ===========================================================================
-- 0114_one_invite_a_day_not_one_ever
--
-- Replaces the one-invite-per-pair-forever rule from 0113 with one invite per
-- stylist per model PER DAY, and makes a decline final.
--
-- ⚠️⚠️ RETRACTION: 0113 ARGUED FOR "ONE EVER" AT LENGTH, AND THAT WAS NOT THE
-- DECISION IT WAS IMPLEMENTING.
-- ===========================================================================
-- 0113's header says: "'One invite per stylist per model, ever.' Not one per
-- day. The old path could send eight to the same person, and did." It built a
-- `unique (provider_id, model_user_id)` to enforce it and a verify block that
-- fails if the constraint is missing.
--
-- The intent behind it was narrower: STOP A BURST, not end the conversation.
-- A stylist should be able to follow up — "still free on Tuesday?" — the way
-- anyone would. One ever turns a single unanswered message into a permanent
-- silence, and most invites WILL go unanswered: there is no Accept button in
-- this product, because applying is the acceptance, so a model's options are
-- apply, decline, or ignore.
--
-- ⚠️ 0113 IS NOT EDITED. It is applied and its checksum is registered; editing
-- it would make `migration-status.mjs` report DRIFTED, which is the one state
-- that tooling exists to catch. So the correction lives here, as 0113's own
-- correction of 0112 lives in 0113. Anyone reading 0113's "one ever" argument
-- should read this file next.
--
-- ⚠️ NOTHING IS STRANDED. `public.invites` held ZERO rows when this was
-- written, so no stylist loses an invite they had already spent and no model
-- gains one she had already refused.
--
-- ── WHAT REPLACES IT ──────────────────────────────────────────────────────
--
--   1. ONE PER DAY, STRUCTURALLY. `sent_on` is a GENERATED column holding the
--      British calendar date of `created_at`, and the unique constraint moves
--      to (provider_id, model_user_id, sent_on). It is still a constraint and
--      not a check in application code: the second invite today cannot exist
--      even if every caller is wrong.
--
--      ⚠️ Europe/London, NOT UTC, because "a day" means the stylist's day.
--      `timezone(text, timestamptz)` is IMMUTABLE (checked in pg_proc, not
--      assumed), which is the only reason this can be a generated column at
--      all. The stored value is computed once at insert; a later tzdata
--      update will not retrospectively move a row into a different day, and
--      for a bucket on recent timestamps that is harmless.
--
--   2. A DECLINE IS FINAL. Once a model has declined ANY invite from a
--      stylist, that stylist cannot send another — not tomorrow, not ever.
--      This is the half that makes the daily rule safe: without it, Decline
--      would be a snooze button and a model would have no way to make it
--      stop. It is the only control on that page that is purely hers.
--
-- ⚠️ SILENCE IS NOT A STOP, AND THAT IS A KNOWN COST. A model who ignores
-- invites can be invited daily, indefinitely, and her only ways out are to
-- decline, to block, or to turn off `discoverable`. A cap on unanswered
-- invites was considered and deliberately not taken — recorded here so that
-- if invite volume ever becomes a complaint, the decision is findable rather
-- than re-derived. The three exits above all exist and all work today.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0113') then
    raise exception '0114 needs 0113 applied first.';
  end if;

  if to_regclass('public.invites') is null then
    raise exception '0114: public.invites is missing. It is created by 0113.';
  end if;

  -- The rule being replaced. If it is already gone, something else changed
  -- this table and this file should be re-read before it runs.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invites'::regclass and conname = 'invites_one_per_pair'
  ) then
    raise exception '0114: invites_one_per_pair is not present. 0113 created it and this '
      'migration replaces it; if it is gone, read the header before running this.';
  end if;

  -- ⚠️ THE THING THAT MAKES THIS SAFE. Stated as a guard rather than trusted:
  -- a non-empty table would mean stylists have already spent invites under
  -- the old rule, and relaxing it would hand some of them a second one.
  if exists (select 1 from public.invites) then
    raise exception '0114: public.invites is not empty (% row(s)). The header assumes zero and '
      'the relaxation has not been thought through for existing rows. Nothing changed.',
      (select count(*) from public.invites);
  end if;

  if to_regprocedure('public.invite_model(uuid, text)') is null then
    raise exception '0114: invite_model(uuid, text) is missing. It is created by 0113.';
  end if;
  if to_regprocedure('public.invitable_models(double precision, double precision, double precision)') is null then
    raise exception '0114: invitable_models is missing. It is created by 0113.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The day bucket, and the rule that rests on it.
-- ---------------------------------------------------------------------------
alter table public.invites
  add column if not exists sent_on date
  generated always as (((created_at at time zone 'Europe/London'))::date) stored;

comment on column public.invites.sent_on is
  'British calendar date of created_at, generated. The one-per-day unique '
  'constraint is built on it (0114). Generated rather than written so it '
  'cannot disagree with created_at.';

alter table public.invites drop constraint invites_one_per_pair;

alter table public.invites
  add constraint invites_one_per_day unique (provider_id, model_user_id, sent_on);

comment on table public.invites is
  'Stylist-to-model invites (0113), at most one per pair PER DAY since 0114, '
  'and none at all after the model declines one. status is sent|declined — '
  'there is no accepted, because applying IS the acceptance.';

-- ---------------------------------------------------------------------------
-- 2. Sending one.
-- ---------------------------------------------------------------------------
-- Identical to 0113's apart from the decline gate and the unique_violation
-- wording. Repeated in full rather than patched, because a function is
-- replaced wholesale and a reader needs to see what actually runs.
create or replace function public.invite_model(
  p_model_user_id uuid,
  p_message       text default null
)
returns public.invites
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  if not exists (
    select 1 from public.users u
    where u.id = p_model_user_id and u.role = 'model' and u.discoverable is true
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

  -- ⚠️⚠️ A DECLINE IS FINAL, AND IT IS CHECKED PER PAIR RATHER THAN PER
  -- INVITE. She declined the STYLIST, not one message; asking again tomorrow
  -- because yesterday's row was the one refused would make Decline a snooze.
  --
  -- ⚠️ 23P01 (exclusion_violation) AND NOT 42501. The four "cannot be
  -- invited" causes share one code precisely so a stylist cannot probe which,
  -- but a decline is ALREADY visible to her: the RLS policy "stylist reads
  -- own sent invites" shows her the declined row on her own list. Withholding
  -- something she can already see would buy nothing and leave her with an
  -- unexplained refusal.
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

  -- ⚠️ THE INSERT IS STILL THE RATE LIMIT, only the window changed. A unique
  -- violation here is the second invite TODAY being refused by the database,
  -- not by a check that can be skipped.
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
$function$;

grant execute on function public.invite_model(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who is still invitable.
-- ---------------------------------------------------------------------------
-- Only the final NOT EXISTS changes: "never invited" becomes "not declined,
-- and not already invited today".
create or replace function public.invitable_models(
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_radius_mi double precision default null
)
returns table (
  id              uuid,
  first_name      text,
  last_initial    text,
  profile_pic_url text,
  distance_mi     double precision,
  hair_colour     text,
  hair_type       text,
  hair_length     text,
  hair_condition  text,
  skin_tone       text,
  skin_type       text,
  eye_colour      text,
  eye_shape       text,
  nail_condition  text,
  bio             text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  where u.role = 'model'
    and u.discoverable is true
    and u.id <> auth.uid()
    and (
      p_radius_mi is null
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
    and not public.is_blocked_pair(auth.uid(), u.id)
    and not public.is_suspended(u.id)
    -- ⚠️ TWO REASONS TO DROP OUT NOW, AND THEY ARE NOT THE SAME LENGTH.
    -- A declined model is gone for good. A model invited today comes back
    -- tomorrow. Both are excluded rather than shown with a dead button,
    -- because a card whose only action cannot work is worse than no card.
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
$function$;

grant execute on function public.invitable_models(double precision, double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The column comment 0113 wrote, which now says the wrong thing.
-- ---------------------------------------------------------------------------
comment on column public.users.discoverable is
  'Model opt-out for stylist-to-model invites (0113). True means stylists with '
  'a published shop can see her in invitable_models and invite her, at most '
  'once a day each, and not at all once she has declined one (0114). Never '
  'exposes her email. Settings has the toggle.';

-- ---------------------------------------------------------------------------
-- 5. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_n int;
begin
  -- (a) The old rule is gone and the new one is a CONSTRAINT, not an index
  --     with a hopeful name.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.invites'::regclass and conname = 'invites_one_per_pair'
  ) then
    raise exception '0114: invites_one_per_pair still exists, so one-per-day cannot apply. Rolled back.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invites'::regclass
       and contype = 'u' and conname = 'invites_one_per_day'
  ) then
    raise exception '0114: invites_one_per_day unique constraint is missing. Rolled back.';
  end if;

  -- (b) ⚠️ sent_on IS GENERATED. If it were an ordinary column a caller could
  --     write any date into it and send unlimited invites in one minute.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='invites' and column_name='sent_on'
       and is_generated = 'ALWAYS'
  ) then
    raise exception '0114: invites.sent_on is missing or is not GENERATED ALWAYS, so the daily '
      'rule could be bypassed by writing the column. Rolled back.';
  end if;

  -- (c) ⚠️ THE DAILY RULE ACTUALLY REFUSES A SECOND ROW. Not "the constraint
  --     is listed" — the insert is attempted and must fail. Rolled back
  --     either way; this whole block runs inside the migration's transaction.
  declare
    v_prov uuid;
    v_model uuid;
    v_ok boolean := false;
  begin
    select p.id into v_prov from public.providers p limit 1;
    select u.id into v_model from public.users u where u.role = 'model' limit 1;
    if v_prov is not null and v_model is not null then
      insert into public.invites (provider_id, model_user_id) values (v_prov, v_model);
      begin
        insert into public.invites (provider_id, model_user_id) values (v_prov, v_model);
      exception when unique_violation then
        v_ok := true;
      end;
      -- Leave the table as it was found: empty.
      delete from public.invites where provider_id = v_prov and model_user_id = v_model;
      if not v_ok then
        raise exception '0114: a SECOND invite to the same model on the same day was accepted. '
          'The daily rule does not hold. Rolled back.';
      end if;
    else
      raise notice '0114: no provider or no model to test the daily rule against; '
        'the constraint exists but was not exercised.';
    end if;
  end;

  -- (d) Both functions survived, on one signature each, still DEFINER,
  --     still callable.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='invite_model';
  if v_n <> 1 then
    raise exception '0114: invite_model exists on % signatures; it must be exactly 1. Rolled back.', v_n;
  end if;
  if not has_function_privilege('authenticated', 'public.invite_model(uuid, text)', 'EXECUTE') then
    raise exception '0114: authenticated cannot execute invite_model. Rolled back.';
  end if;
  if not has_function_privilege('authenticated',
       'public.invitable_models(double precision, double precision, double precision)', 'EXECUTE') then
    raise exception '0114: authenticated cannot execute invitable_models. Rolled back.';
  end if;

  -- (e) The postures 0113 set are unchanged. A migration that relaxes one
  --     rule is exactly when the others get relaxed by accident.
  if has_table_privilege('authenticated', 'public.invites', 'INSERT') then
    raise exception '0114: authenticated holds INSERT on public.invites. Rolled back.';
  end if;
  if has_function_privilege('authenticated',
       'public.nearby_models(double precision, double precision, double precision)', 'EXECUTE') then
    raise exception '0114: authenticated can execute nearby_models — 0097 revoked that. Rolled back.';
  end if;

  raise notice '0114: one invite per stylist per model per British day, and none after a '
    'decline. invites holds % row(s).', (select count(*) from public.invites);
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0114', 'one_invite_a_day_not_one_ever', '514bf914c3358ebb35f187108bf9271004456f24d05d75bc5af506984123f0e1');

commit;

notify pgrst, 'reload schema';

-- ⚠️ TO UNDO: drop constraint invites_one_per_day; drop column sent_on;
-- re-add `unique (provider_id, model_user_id)`; restore invite_model and
-- invitable_models from 0113. Delete the '0114' row last. Note that re-adding
-- the per-pair constraint will FAIL if any pair has more than one row by
-- then, which is the honest obstacle: going back to "one ever" after invites
-- have been sent is a decision about those rows, not a schema change.

-- ===========================================================================
-- 0065_the_slot_decides_when_the_appointment_is
--
-- A booking's date and times come from the AVAILABILITY ROW, not from the
-- client, and a slot that has already started cannot be applied for at all.
-- Audit item 133, part 1.
--
-- ⚠️ Apply 0064 first.
--
-- ── THE FAULT ──────────────────────────────────────────
-- On 30 Sep 2026 at 16:37 Micky applied for a 9am slot THAT MORNING. The
-- application was accepted and landed in the stylist's diary as a pending
-- application for an appointment that had already happened.
--
-- Every availability query in both apps filtered with `date >= today` and
-- nothing anywhere compared the time of day. That half is fixed in the clients
-- (item 133 part 2) — but the clients are not where this can be settled:
--
--   * the apply wizard keeps its state in the URL, so a page left open since
--     the morning still holds a slot id that was valid when it loaded; and
--   * `"model can create session"` is a PERMISSIVE INSERT policy on
--     public.sessions for `authenticated` whose only check is
--     `auth.uid() = model_user_id`. **Any signed-in member can insert a
--     session row directly, with any date, any time, for any provider**,
--     without going near create_session_with_consent.
--
-- So a guard inside the function would be a guard with a documented way round
-- it. This is a trigger.
--
-- ── WHAT THE FUNCTION WAS DOING, WHICH IS THE BIGGER HALF ──
-- create_session_with_consent took p_date, p_start_time, p_end_time and
-- p_scheduled_at FROM THE CALLER and wrote them straight into the row. It
-- never read the availability row at all — so nothing anywhere checked that
-- the times being recorded had any relationship to the slot being booked, or
-- that the slot belonged to the provider being booked.
--
-- The past-date case is one symptom of that. Deriving the four values from the
-- row closes the class: a booking now says what the slot says, or it fails.
--
-- ── WHY A TRIGGER AND NOT THE FUNCTION ─────────────────
-- Because of the permissive INSERT policy above, and because there is already
-- a precedent doing exactly this: tg_session_price_snapshot (0052) is a
-- SECURITY DEFINER BEFORE INSERT trigger that reads the availability row and
-- overwrites a column, with a comment saying the value is "never supplied by a
-- client". This is the same shape for four more columns.
--
-- ⚠️ ONE IMPLEMENTATION. The rule lives here and only here. The function stops
-- reading its four arguments rather than checking them a second time — two
-- copies of a rule is the fault this codebase has recorded in safeList, in
-- FeaturedStylists and in the `date >= today` filter this very item is about.
--
-- ── ⚠️ TRIGGER ORDER MATTERS, AND IT IS ALPHABETICAL ───
-- Postgres fires same-event triggers in NAME order. On public.sessions,
-- BEFORE INSERT:
--
--     session_apply_gate        (0049)  eligibility; reads model_user_id
--     session_price_snapshot    (0052)  price; reads availability_id
--     session_slot_authority    (THIS)  sets date/start/end/scheduled_at
--     trg_reject_overlapping_session    reads date, start_time, end_time
--
-- The overlap guard must see the CORRECTED values, so this has to sort before
-- it — `s` < `t`, which it does. Renaming any of these four reorders them.
-- The VERIFY below asserts the order rather than trusting the name.
--
-- ── ⚠️ EUROPE/LONDON, EXPLICITLY ───────────────────────
-- availability.date and .start_time are a bare date and a bare time: UK wall
-- clock, no offset. `now()` is timestamptz and this database runs UTC, so
-- comparing them without naming the zone is an hour LENIENT from late March to
-- late October — exactly the length of a slot. `at time zone 'Europe/London'`
-- reads the naive timestamp AS London time, which is what it means.
--
-- ── WHAT IS STILL CLIENT-SUPPLIED, SO THE NEXT PERSON KNOWS ──
-- p_duration_minutes. It is now the only time-related value the caller still
-- decides, and with end_time derived it is redundant with it. Left alone here
-- because the four fields were the agreed scope; worth closing next time this
-- function is opened.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0065') then
    raise exception 'Migration 0065 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0064') then
    raise exception '0065 expects 0064 to be applied first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE SLOT IS THE AUTHORITY
--
-- SECURITY DEFINER so it can read public.availability whatever the caller's
-- RLS allows — the same reason tg_session_price_snapshot is.
--
-- `for update` takes a row lock, so two applications for the same slot
-- serialise here rather than racing. The 23505 from sessions_active_slot_uniq
-- still decides the winner and still propagates uncaught, so the app's
-- slot-race branch is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.tg_session_slot_authority()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a        record;
  v_starts timestamptz;
begin
  -- A booking without a slot is not a thing this product makes, and allowing
  -- one would be the way round everything below.
  if new.availability_id is null then
    raise exception 'A booking must say which slot it is for.'
      using errcode = 'CV003';
  end if;

  select av.provider_id, av.date, av.start_time, av.end_time
    into a
  from public.availability av
  where av.id = new.availability_id
  for update;

  if not found then
    raise exception 'That slot no longer exists.'
      using errcode = 'CV003';
  end if;

  if new.provider_id is distinct from a.provider_id then
    raise exception 'That slot belongs to a different stylist.'
      using errcode = 'CV003';
  end if;

  v_starts := (a.date + a.start_time) at time zone 'Europe/London';

  if v_starts <= now() then
    raise exception 'That appointment has already started — please choose another time.'
      using errcode = 'CV003';
  end if;

  -- ⚠️ THE CALLER'S VALUES ARE DISCARDED, not compared. A mismatch is not an
  -- error to report, it is a value to ignore: the row is the fact.
  new.date         := a.date;
  new.start_time   := a.start_time;
  new.end_time     := a.end_time;
  new.scheduled_at := v_starts;

  return new;
end $$;

comment on function public.tg_session_slot_authority() is
  'BEFORE INSERT on sessions: takes date, start_time, end_time and scheduled_at '
  'from the availability row and refuses a slot that has already started '
  '(SQLSTATE CV003, Europe/London). These four are never supplied by a client, '
  'for the same reason price_pence is not (0052). A trigger rather than a check '
  'inside create_session_with_consent because "model can create session" is a '
  'permissive INSERT policy, so a member can insert a session row directly. '
  '0065, audit item 133.';

drop trigger if exists session_slot_authority on public.sessions;
create trigger session_slot_authority
before insert on public.sessions
for each row execute function public.tg_session_slot_authority();

-- ---------------------------------------------------------------------------
-- 2. THE FUNCTION STOPS READING FOUR OF ITS ARGUMENTS
--
-- ⚠️ THE SIGNATURE IS UNCHANGED ON PURPOSE. p_date, p_start_time, p_end_time
-- and p_scheduled_at stay in the argument list and are now DEAD: nothing reads
-- them. Dropping them would mean a new overload and a coordinated client
-- deploy for no behavioural gain — 0058 is the record of what that costs.
--
-- They are passed as NULL rather than quietly ignored so the deadness is
-- visible at the insert, and so that if this trigger were ever dropped the
-- next booking fails loudly on a NOT NULL constraint instead of silently
-- writing whatever a client sent. (The PREFLIGHT reports whether those columns
-- are in fact NOT NULL; if they are nullable that safety net does not exist.)
--
-- `create or replace` keeps the function's existing grants. A `drop` would not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_session_with_consent(p_provider_id uuid, p_availability_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_scheduled_at timestamp with time zone, p_duration_minutes integer, p_treatment_id uuid, p_location_type text, p_note text, p_photo_urls text[], p_consent_document_id uuid, p_consent_version integer, p_content_hash text, p_acknowledgements jsonb, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_me         uuid := auth.uid();
  v_session_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if p_consent_document_id is null or p_content_hash is null or p_acknowledgements is null then
    raise exception 'Consent is required to book' using errcode = '23502';
  end if;

  -- The booking. A 23505 from sessions_active_slot_uniq is deliberately NOT
  -- caught: it propagates unchanged so the app's slot-race branch still fires.
  --
  -- ⚠️ NULLS FOR THE FOUR TIME COLUMNS. session_slot_authority fills them from
  -- the availability row before any constraint is checked. p_date,
  -- p_start_time, p_end_time and p_scheduled_at are dead arguments (0065).
  insert into public.sessions (
    provider_id, model_user_id, model_id, availability_id,
    date, start_time, end_time, scheduled_at, duration_minutes,
    treatment_id, location_type, note, photo_urls, status
  ) values (
    p_provider_id, v_me, v_me, p_availability_id,
    null, null, null, null, p_duration_minutes,
    p_treatment_id, p_location_type, p_note, p_photo_urls, 'pending'
  )
  returning id into v_session_id;

  -- The consent. Any failure here aborts the whole function, so the booking
  -- above is rolled back with it. There is no path to a confirmed booking
  -- without a consent record.
  insert into public.session_consents (
    session_id, user_id, category_id,
    consent_document_id, consent_version, content_hash,
    acknowledgements, agreed_at
  ) values (
    v_session_id, v_me, p_category_id,
    p_consent_document_id, p_consent_version, p_content_hash,
    p_acknowledgements, now()
  );

  return v_session_id;
end $function$;

comment on function public.create_session_with_consent(uuid, uuid, date, time without time zone, time without time zone, timestamp with time zone, integer, uuid, text, text, text[], uuid, integer, text, jsonb, uuid) is
  'Creates a pending session and its consent record in one transaction. '
  '⚠️ p_date, p_start_time, p_end_time and p_scheduled_at are DEAD ARGUMENTS '
  'since 0065: they are passed as NULL and session_slot_authority fills those '
  'columns from the availability row. They remain in the signature only to '
  'avoid a new overload and a coordinated client deploy. p_duration_minutes is '
  'the one time-related value a caller still decides.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0065', 'the_slot_decides_when_the_appointment_is', '1f356184212b56119cd21d685ac5b30c5489e491c570b5ff69d2a04d286baae3');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0064') = 1
--       as v_0064_applied,
--     to_regprocedure('public.tg_session_price_snapshot()') is not null
--       as precedent_exists,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.sessions'::regclass
--         and tgname = 'session_slot_authority') = 0
--       as not_already_there,
--     (select string_agg(column_name || '=' || is_nullable, ', ' order by column_name)
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'sessions'
--         and column_name in ('date','start_time','end_time','scheduled_at'))
--       as four_columns_nullability;
--
--   Expect the first three true. The fourth is FYI: `NO` on all four means a
--   dropped trigger would fail loudly rather than write nulls. If any say
--   `YES`, say so — that safety net is missing and is worth adding separately.
-- ===========================================================================
--
-- ── VERIFY — both halves, as a member, in ONE rolled-back block ─────────
--
--   ⚠️ CORRECTED 1 Oct 2026, AFTER THE FIRST VERSION WOULD NOT RUN. It had
--   three faults, all found by Micky pasting it: `availability` has no
--   created_at column to order by, and `sessions` requires treatment_id and
--   location_type, which the inserts did not supply. A verify block that has
--   to be repaired before it runs is not a verify block — it is a draft, and
--   the next person meets the draft rather than the check.
--
--   It is now ONE paste, with each half in its own savepoint, for the reason
--   recorded at 0057: two blocks pasted separately can be misread as each
--   other. The slots are created as the migration runner (so availability RLS
--   is not in the way) and only the SESSION inserts run as the member.
--
--   Uses the model test account from CLAUDE.md — subscribed and verified, so
--   it clears session_apply_gate. Everything is rolled back.
--
--   -- (a) trigger order: this must sort before the overlap guard.
--   select tgname from pg_trigger
--   where tgrelid = 'public.sessions'::regclass and not tgisinternal
--     and tgtype & 4 = 4          -- INSERT
--   order by tgname;
--
--   Expect session_apply_gate, session_price_snapshot, session_slot_authority,
--   trg_reject_overlapping_session — in that order.
--
--   -- (b) and (c) together:
--   begin;
--   do $v$
--   declare
--     v_prov  uuid; v_treat uuid; v_past uuid; v_future uuid;
--     v_state text; v_date date; v_start time; v_end time; v_report text := '';
--   begin
--     select provider_id, id into v_prov, v_treat
--     from public.provider_treatments limit 1;
--     if v_prov is null then
--       raise exception 'ROLLED BACK. No provider with a treatment, so the trigger cannot be exercised.';
--     end if;
--
--     insert into public.availability (provider_id, date, start_time, end_time,
--                                      active_treatments, is_taken)
--     values (v_prov, current_date, '00:01', '00:30', array[v_treat::text], false)
--     returning id into v_past;
--
--     insert into public.availability (provider_id, date, start_time, end_time,
--                                      active_treatments, is_taken)
--     values (v_prov, current_date + 30, '14:00', '16:00', array[v_treat::text], false)
--     returning id into v_future;
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130',
--                         'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     -- (b) a slot that started at 00:01 today
--     begin
--       insert into public.sessions (provider_id, model_user_id, model_id,
--                                    availability_id, treatment_id, location_type,
--                                    duration_minutes, status)
--       values (v_prov, auth.uid(), auth.uid(), v_past, v_treat, 'provider',
--               30, 'pending');
--       v_state := 'NO ERROR — the past slot was ACCEPTED, which is the bug';
--     exception when others then
--       v_state := sqlstate || ' ' || sqlerrm;
--     end;
--     v_report := 'past slot: ' || v_state;
--
--     -- (c) a slot 30 days out, with every time argument a lie
--     insert into public.sessions (provider_id, model_user_id, model_id,
--                                  availability_id, date, start_time, end_time,
--                                  scheduled_at, treatment_id, location_type,
--                                  duration_minutes, status)
--     values (v_prov, auth.uid(), auth.uid(), v_future,
--             current_date + 999, '03:00', '04:00', now(),
--             v_treat, 'provider', 120, 'pending')
--     returning date, start_time, end_time into v_date, v_start, v_end;
--     v_report := v_report || ' | future slot written as ' || v_date || ' '
--                 || v_start || '-' || v_end
--                 || ' (expected ' || (current_date + 30) || ' 14:00-16:00)';
--
--     execute 'reset role';
--     -- ⚠️ THE RESULTS GO IN THE EXCEPTION, NOT IN raise notice. The Supabase
--     -- SQL editor does not surface NOTICE output, so a block that reports
--     -- through notices reports nothing at all there. Corrected 1 Oct 2026
--     -- after Micky had to rewrite it to see the result.
--     raise exception 'ROLLED BACK ON PURPOSE. %', v_report;
--   end $v$;
--   rollback;
--
--   Expect: past slot -> CV003 "That appointment has already started"; future
--   slot -> current_date + 30 at 14:00-16:00, NOT +999 and not 03:00. The
--   caller's values were discarded, which is the whole point.
-- ===========================================================================

-- ===========================================================================
-- 0080_one_way_to_write_an_appointment
--
-- All four notices about a booking render the appointment the same way:
--
--     Monday 5 October at 9:00am
--
-- Audit item 150.
--
-- ⚠️ Apply 0079 first.
--
-- ── THE FAULT ──────────────────────────────────────────
-- Two notices about ONE booking, going to the two people involved, rendering
-- the same appointment differently — and both reach inboxes:
--
--   session_applied    A model has applied for Brows on 5 Oct 2026 at 09:00
--   session_accepted   Your booking for Monday 5 October has been confirmed.
--
-- An accident of which migration touched which string, not a choice.
-- notify_session_applied came from 0077, before the date format was decided
-- for 0078, so it was never part of that decision.
--
-- ── THE DECISION (Micky, 3 Oct 2026) ───────────────────
-- Option 1 of two: **all four read the same way, with the time.** The reason is
-- the one that chose the long form in the first place — these are read days
-- later in an inbox, out of context. *"Your booking for Monday 5 October has
-- been confirmed"* makes a model open the app to find out when, and the apply
-- notice already demonstrates the time is worth carrying. Consistency across
-- the two roles matters most, because both people are reading about the same
-- appointment.
--
-- Time rendering chosen here rather than by round trip: **9:00am** — lowercase,
-- no space, minutes always shown. It reads as speech, which is what an inbox
-- wants, and it is unambiguous at a glance in a way 09:00 is not on a phone.
--
-- ── ⚠️ ONE FUNCTION, NOT THE SAME EXPRESSION TWICE ─────
-- booking_when() exists because writing the format into both functions would
-- recreate, in the same migration, the exact fault being fixed: one rendering
-- duplicated, free to drift the moment somebody edits one. That is item 143
-- (`provider_id` dropped from one of two copies), item 150 itself, and the
-- three hand-maintained type lists of item 151.
--
-- A later change to how an appointment reads is now one line in one place.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0079') then
    raise exception '0080: apply 0079 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The one rendering.
--
-- IMMUTABLE and language sql so it can be inlined; it reads nothing.
--
-- ⚠️ THE TIME IS GUARDED, THE DATE IS NOT. sessions.start_time is nullable —
-- create_session_with_consent inserts null and 0065's trigger fills it from the
-- availability row — so a null is reachable if that trigger is ever bypassed,
-- and `null` concatenated into the body would make the WHOLE body null. A
-- notification with no body is worse than one without a time. sessions.date is
-- NOT NULL, so it needs no guard.
-- ---------------------------------------------------------------------------
create or replace function public.booking_when(p_date date, p_start time)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_start is null
             then to_char(p_date, 'FMDay FMDD FMMonth')
           else to_char(p_date, 'FMDay FMDD FMMonth')
                || ' at ' || to_char(p_start, 'FMHH12:MI')
                || lower(to_char(p_start, 'AM'))
         end;
$$;

comment on function public.booking_when(date, time) is
  'The one way an appointment is written to a member: ''Monday 5 October at 9:00am''. FMDay and '
  'FMMonth strip the padding Postgres adds to those names; FMDD and FMHH12 strip leading zeros. '
  'Falls back to the date alone when start_time is null, because a null concatenated into a body '
  'makes the whole body null. 0080, audit item 150.';

grant execute on function public.booking_when(date, time) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The apply notice (0077) — the one that was never part of the decision.
-- ---------------------------------------------------------------------------
create or replace function public.notify_session_applied(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model    uuid;
  v_provider uuid;
  v_owner    uuid;
  v_date     date;
  v_start    time;
  v_treat    text;
begin
  select s.model_user_id, s.provider_id, s.date, s.start_time,
         coalesce(nullif(btrim(t.name), ''), nullif(btrim(t.category), ''), 'a treatment')
    into v_model, v_provider, v_date, v_start, v_treat
    from public.sessions s
    left join public.provider_treatments t on t.id = s.treatment_id
   where s.id = p_session_id;

  if v_model is null then
    return;                         -- no such session; nothing to announce
  end if;

  -- ⚠️ THE AUTHORISATION. Only the model on the booking may announce it. This
  -- is the rule the open policy does not have, and the reason this function
  -- exists rather than a direct insert.
  if v_model is distinct from auth.uid() then
    raise exception 'notify_session_applied: only the model on this booking can announce it'
      using errcode = '42501';
  end if;

  select p.user_id into v_owner from public.providers p where p.id = v_provider;
  if v_owner is null then
    return;                         -- no stylist to tell; the caller logged it
  end if;

  -- ⚠️ DATE AND TIME COME FROM THE ROW, NOT FROM ARGUMENTS. 0065's
  -- session_slot_authority fills them from the availability row, and
  -- create_session_with_consent's own p_date/p_start_time are dead arguments
  -- that it passes as null. Reading them back is the only correct source.
  --
  -- ⚠️ 0080: was 'on 5 Oct 2026 at 09:00'. Now booking_when(), so the stylist
  -- and the model read the same appointment the same way.
  insert into public.notifications (user_id, type, title, body, session_id)
  values (
    v_owner,
    'session_applied',
    'New treatment application',
    'A model has applied for ' || v_treat
      || ' on ' || public.booking_when(v_date, v_start),
    p_session_id
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The three transition notices (0078) — they gain the time.
--
-- The only changes: start_time is now selected, and v_when comes from
-- booking_when(). The authorisation, the status check and the three strings are
-- reproduced unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.notify_session_transition(p_session_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model       uuid;
  v_date        date;
  v_start       time;
  v_status      text;
  v_is_provider boolean;
  v_when        text;
begin
  if p_to not in ('accepted', 'declined', 'completed') then
    raise exception 'notify_session_transition: % is not an announceable transition', p_to
      using errcode = '22023';
  end if;

  select s.model_user_id, s.date, s.start_time, s.status,
         exists (select 1 from public.providers p
                  where p.id = s.provider_id and p.user_id = auth.uid())
    into v_model, v_date, v_start, v_status, v_is_provider
    from public.sessions s
   where s.id = p_session_id;

  if v_model is null then
    return;                      -- no such booking; nothing to announce
  end if;

  if not (v_is_provider or public.is_admin()) then
    raise exception 'notify_session_transition: only the provider can announce %', p_to
      using errcode = '42501';
  end if;

  if v_status is distinct from p_to then
    raise exception 'notify_session_transition: this booking is %, not % — nothing announced',
      coalesce(v_status, 'null'), p_to using errcode = '55000';
  end if;

  -- ⚠️ 0080: was date only. One rendering, shared with the apply notice.
  v_when := public.booking_when(v_date, v_start);

  insert into public.notifications (user_id, type, title, body, session_id)
  values (
    v_model,
    'session_' || p_to,
    case p_to
      when 'accepted'  then 'Treatment accepted! 🎉'
      when 'declined'  then 'Treatment update'
      else                  'Treatment complete'
    end,
    case p_to
      when 'accepted'  then 'Your booking for ' || v_when || ' has been confirmed.'
      -- ⚠️ 'was not confirmed', never 'declined'. Mobile's wording, kept
      -- deliberately: the model is not told she was turned down in those words.
      when 'declined'  then 'Your booking for ' || v_when || ' was not confirmed.'
      else                  'Your treatment on ' || v_when
                            || ' is marked complete. Leave a review?'
    end,
    p_session_id
  );
end
$$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0080', 'one_way_to_write_an_appointment', '421fba1e453c34a8234a1cb29732b9e36fa9496633d238767224415e3e3151c1');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   ⚠️ IT ASSERTS THE PREMISE RATHER THAN MY MEMORY. Both bodies below are
--   reproduced from the repo copies of 0077 and 0078. If the LIVE bodies have
--   since diverged, this migration would silently discard that change — so the
--   preflight requires the OLD strings to still be present. A false here means
--   stop and re-read the live definition, not "apply anyway".
--
--   with a as (select pg_get_functiondef('public.notify_session_applied(uuid)'::regprocedure) as c),
--        t as (select pg_get_functiondef('public.notify_session_transition(uuid,text)'::regprocedure) as c)
--   select
--     (select count(*) from public.schema_migrations where version = '0079') = 1
--       as v_0079_applied,
--     (select c like '%FMDD Mon YYYY%' from a)      as apply_still_has_old_date,
--     (select c like '%HH24:MI%' from a)            as apply_still_has_24h_time,
--     (select c like '%FMDay FMDD FMMonth%' from t) as transition_has_long_date,
--     (select c not like '%booking_when%' from t)   as transition_not_already_done,
--     to_regprocedure('public.booking_when(date,time)') is null
--       as helper_is_new;
--
--   Expect all six true.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   Conventions: every variable in `declare`, one `%` fed one concatenated
--   string, scalar subqueries rather than `select ... into`.
--
--   -- (a) the rendering itself, including the null-time fallback. No subjects.
--   select public.booking_when(date '2026-10-05', time '09:00') as nine_am,
--          public.booking_when(date '2026-10-05', time '14:30') as half_two,
--          public.booking_when(date '2026-10-05', time '00:05') as five_past_midnight,
--          public.booking_when(date '2026-10-05', null)         as no_time;
--
--   Expect 'Monday 5 October at 9:00am', 'Monday 5 October at 2:30pm',
--   'Monday 5 October at 12:05am', and 'Monday 5 October'.
--   ⚠️ The midnight case is there because 12-hour clocks are where off-by-twelve
--   lives, and an email saying 0:05am would be wrong in a way nobody reads back.
--
--   -- (b) all four notices now agree, read from the LIVE bodies.
--   with a as (select pg_get_functiondef('public.notify_session_applied(uuid)'::regprocedure) as c),
--        t as (select pg_get_functiondef('public.notify_session_transition(uuid,text)'::regprocedure) as c)
--   select (select c like '%booking_when%' from a)     as apply_uses_helper,
--          (select c like '%booking_when%' from t)     as transitions_use_helper,
--          (select c not like '%FMDD Mon YYYY%' from a) as old_apply_format_gone,
--          (select c not like '%HH24:MI%' from a)       as old_24h_time_gone,
--          (select c not like '%FMDay FMDD FMMonth%' from t)
--            as transition_no_longer_renders_its_own;
--
--   Expect all five true. The last two matter most: a leftover inline format
--   would mean one notice still renders its own, which is the fault returning
--   inside its own fix.
--
--   -- (c) ⚠️ RE-RUN 0078's BLOCK (c) AND THE TWO SUPPLEMENTARY TRANSITION
--   --     BLOCKS. The bodies have changed, so the expected text has changed:
--   --
--   --       accepted   Your booking for Monday 5 October at 9:00am has been confirmed.
--   --       declined   Your booking for Monday 5 October at 9:00am was not confirmed.
--   --       completed  Your treatment on Monday 5 October at 9:00am is marked
--   --                  complete. Leave a review?
--   --
--   --     A pending row is needed again, and the first one was made through the
--   --     LIVE apply flow rather than hand-inserted, for the reason recorded in
--   --     0078: a hand-made row risks testing a shape the real flow does not
--   --     produce. Doing it the same way also re-exercises the apply notice,
--   --     which is the other half of what this migration changed.
-- ===========================================================================

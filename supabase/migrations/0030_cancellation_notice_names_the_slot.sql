-- ===========================================================================
-- 0030_cancellation_notice_names_the_slot
--
-- The three messages give the date and not the time, so a stylist with two
-- bookings on the same day cannot tell which one just freed.
--
-- ⚠️ Apply 0029 first.
--
-- ── HOW THIS WAS FOUND ──────────────────────────────────────────────────
-- By reading the three messages side by side, which is exactly what 0029's
-- Block A exists for. Each one is fine alone: "Sam cancelled their booking on
-- 16 September" reads perfectly until you are the stylist with a 10am and a 3pm
-- that day, and now you have to go and look.
--
-- The block only became visible because the three were printed together. A
-- verify block that renders output for a person to READ, rather than asserting
-- a boolean, is worth having for exactly this class of defect — nothing could
-- have failed here.
--
-- ── WHY THE FUNCTION IS DROPPED AND NOT REPLACED ────────────────────────
-- `create or replace function` with a DIFFERENT argument list does not replace
-- anything: it creates an OVERLOAD. The old four-argument version would still
-- exist, every existing four-argument call would still resolve to it, and this
-- migration would appear to do nothing while the old wording carried on being
-- sent. Worse, a call passing the new arguments would become ambiguous.
--
-- So the old signature is dropped first, by exact signature, and every caller
-- is updated in the same transaction.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the function this migration rewrites must be the one 0029 created.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancellation_notice'
  ) then
    raise exception '0030: public.cancellation_notice does not exist. Apply 0029 first.';
  end if;
end $$;

-- Drop by exact signature. Leaving it would create an overload, not a fix.
drop function if exists public.cancellation_notice(text, text, date, text);

-- ---------------------------------------------------------------------------
-- The three messages, now naming the slot.
-- ---------------------------------------------------------------------------
create function public.cancellation_notice(
  p_kind       text,          -- 'block' | 'by_stylist' | 'by_model'
  p_other_name text,
  p_date       date,
  p_reason     text default null,
  p_start_time time default null,
  p_treatment  text default null
) returns table (title text, body text)
-- STABLE, not IMMUTABLE: to_char() depends on lc_time.
language plpgsql stable
as $$
declare
  -- "16 September at 2:30pm", or "16 September" when there is no time on the
  -- row. On the hour reads as "2pm" rather than "2:00pm".
  v_time text := case
                   when p_start_time is null then ''
                   when extract(minute from p_start_time) = 0
                     then ' at ' || lower(to_char(p_start_time, 'FMHH12am'))
                   else ' at ' || lower(to_char(p_start_time, 'FMHH12:MIam'))
                 end;
  v_when text := to_char(p_date, 'FMDD FMMonth') || v_time;
  v_who  text := coalesce(nullif(btrim(coalesce(p_other_name, '')), ''), 'your stylist');
  v_what text := case
                   when nullif(btrim(coalesce(p_treatment, '')), '') is null then ''
                   else ' (' || btrim(p_treatment) || ')'
                 end;
  v_said text := case
                   when nullif(btrim(coalesce(p_reason, '')), '') is null then ''
                   else chr(10) || chr(10) || 'They said: "' || btrim(p_reason) || '"'
                 end;
begin
  if p_kind = 'block' then
    -- ⚠️ DO NOT ADD A REASON TO THIS ONE, AND DO NOT ADD "we can't explain why".
    --
    -- The recipient does not know a block happened and must not learn it from a
    -- notification. Any hint of cause narrows it to one person.
    --
    -- "We can't share why" is also wrong here, and not only for being coy: the
    -- platform did not decide anything. A person did. Implying an institutional
    -- judgement invites the reader to picture a file and a finding that do not
    -- exist. Silence about cause is the honest answer, not a withheld one.
    --
    -- The time and treatment are safe to add: they identify WHICH booking, and
    -- say nothing about why. That distinction is the test for anything else
    -- anyone ever wants to put in this branch.
    return query select
      'Your booking on ' || v_when || ' has been cancelled',
      'Your booking with ' || v_who || v_what || ' won''t be going ahead. Nothing '
      || 'about your account has changed.' || chr(10) || chr(10)
      || 'You can find another stylist in Browse.';

  elsif p_kind = 'by_stylist' then
    return query select
      v_who || ' cancelled your booking on ' || v_when,
      v_who || ' can no longer make this appointment' || v_what || '.' || v_said
      || chr(10) || chr(10)
      || 'That slot has been released. You can apply to another stylist in Browse.';

  elsif p_kind = 'by_model' then
    -- The identifying detail matters most here. A stylist with a 10am and a 3pm
    -- on the same day was being told only the date, and had to go and look.
    return query select
      v_who || ' cancelled their booking on ' || v_when,
      'That ' || v_when || v_what || ' slot is free again and back on your calendar.'
      || v_said;

  else
    raise exception 'cancellation_notice: unknown kind %', p_kind;
  end if;
end $$;

comment on function public.cancellation_notice(text, text, date, text, time, text) is
  'The only place the three cancellation messages are written. They must not '
  'converge: the block case is silent about CAUSE on purpose, and adding a reason '
  '"for consistency" would leak who blocked whom. Time and treatment are safe in '
  'all three — they identify which booking and say nothing about why, which is the '
  'test for anything else anyone wants to add here.';

-- ---------------------------------------------------------------------------
-- Callers, updated in the same transaction so none is left on the old shape.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(
  p_session_id uuid,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me         uuid := auth.uid();
  v_s          record;
  v_is_model   boolean;
  v_other      uuid;
  v_other_name text;
  v_my_name    text;
  v_treat      text;
  v_notice     record;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_me is null then
    raise exception 'cancel_booking: not signed in';
  end if;

  select s.id, s.status, s.date, s.start_time, s.model_user_id, s.provider_id, s.treatment_id
    into v_s
  from public.sessions s where s.id = p_session_id;

  if v_s.id is null then
    raise exception 'cancel_booking: booking not found';
  end if;
  if v_s.status not in ('pending', 'accepted') then
    raise exception 'cancel_booking: this booking is already %', v_s.status;
  end if;

  v_is_model := (v_s.model_user_id = v_me);
  if not v_is_model and not exists (
    select 1 from public.providers p where p.id = v_s.provider_id and p.user_id = v_me
  ) then
    raise exception 'cancel_booking: not a participant of this booking';
  end if;

  if v_reason is not null and length(v_reason) > 280 then
    v_reason := left(v_reason, 280);
  end if;

  select coalesce(nullif(btrim(coalesce(t.name, '')), ''), t.category) into v_treat
  from public.provider_treatments t where t.id = v_s.treatment_id;

  if v_is_model then
    select p.user_id, p.name into v_other, v_other_name
    from public.providers p where p.id = v_s.provider_id;
  else
    v_other := v_s.model_user_id;
    select p.name into v_other_name from public.providers p where p.id = v_s.provider_id;
  end if;
  select nullif(btrim(coalesce(u.first_name, '')), '') into v_my_name
  from public.users u where u.id = v_me;

  update public.sessions
     set status = 'cancelled',
         cancelled_by = v_me,
         cancelled_at = now(),
         cancellation_reason = v_reason
   where id = p_session_id;

  -- The name in the message is the CANCELLER's: it tells the other party who
  -- cancelled on them.
  select * into v_notice from public.cancellation_notice(
    case when v_is_model then 'by_model' else 'by_stylist' end,
    coalesce(v_my_name, case when v_is_model then 'The model' else v_other_name end),
    v_s.date, v_reason, v_s.start_time, v_treat);

  if v_other is not null then
    insert into public.notifications (user_id, type, title, body, session_id)
    values (v_other, 'session_cancelled', v_notice.title, v_notice.body, p_session_id);
  end if;

  return jsonb_build_object('ok', true, 'session_id', p_session_id,
                            'notified', v_other is not null);
end $$;

create or replace function public.cancel_sessions_for_block(p_other_user_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me      uuid := auth.uid();
  v_count   int  := 0;
  v_sess    record;
  v_notice  record;
  v_name    text;
  v_treat   text;
begin
  if v_me is null then
    raise exception 'cancel_sessions_for_block: not signed in';
  end if;

  for v_sess in
    select s.id, s.date, s.start_time, s.treatment_id, s.model_user_id, s.provider_id
    from public.sessions s
    where s.status in ('pending', 'accepted')
      and (
        (s.model_user_id = p_other_user_id
          and exists (select 1 from public.providers p
                       where p.id = s.provider_id and p.user_id = v_me))
        or
        (s.model_user_id = v_me
          and exists (select 1 from public.providers p
                       where p.id = s.provider_id and p.user_id = p_other_user_id))
      )
  loop
    -- cancelled_by stays NULL: recording the blocker here would put "who blocked
    -- whom" one query away from anything that ever renders the column.
    update public.sessions
       set status = 'cancelled', cancelled_at = now()
     where id = v_sess.id;
    v_count := v_count + 1;

    select nullif(btrim(coalesce(p.name, '')), '') into v_name
    from public.providers p where p.id = v_sess.provider_id;
    select coalesce(nullif(btrim(coalesce(t.name, '')), ''), t.category) into v_treat
    from public.provider_treatments t where t.id = v_sess.treatment_id;

    select * into v_notice
    from public.cancellation_notice('block', v_name, v_sess.date, null,
                                    v_sess.start_time, v_treat);

    insert into public.notifications (user_id, type, title, body, session_id)
    values (p_other_user_id, 'session_cancelled', v_notice.title, v_notice.body, v_sess.id);
  end loop;

  return jsonb_build_object('ok', true, 'cancelled', v_count);
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0030', 'cancellation_notice_names_the_slot', '170fa98070d45d19448a04c9366dcac7d205d498b2c88aeae6035dee34281424');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ── BLOCK A — the three, side by side, with a time ──────────────────────
--
--   The same block as 0029, now with a time and a treatment. Read them
--   together: that is how the missing slot identifier was found in the first
--   place, and nothing could have asserted it.
--
--   select kind, n.title, n.body from (
--     values ('block'), ('by_stylist'), ('by_model')
--   ) k(kind), lateral public.cancellation_notice(
--     k.kind, 'Sam', current_date + 12, 'car trouble, so sorry',
--     time '14:30', 'Balayage') n;
--
--   Expect every one to name 16 September at 2:30pm (or whatever the date is),
--   and 'block' STILL to show no reason despite one being passed.
--
-- ── BLOCK B — the block message still leaks no cause ────────────────────
--
--   Unchanged from 0029 and worth re-running after any edit to that branch.
--
--   select body ~* '(reason|why|because|explain|cancelled by|blocked)' as leaks_cause
--   from public.cancellation_notice('block', 'Sam', current_date + 12, null,
--                                   time '14:30', 'Balayage');
--
--   Expect false.
--
-- ── BLOCK C — on the hour reads naturally ───────────────────────────────
--
--   select title from public.cancellation_notice(
--     'by_model', 'Mia', current_date + 3, null, time '14:00', null);
--
--   Expect "... at 2pm", not "at 2:00pm".
--
-- ── BLOCK D — no stale overload survived ────────────────────────────────
--
--   The failure this migration was written to avoid. If the old four-argument
--   function is still here, every existing call resolves to it and the new
--   wording is never sent.
--
--   select p.oid::regprocedure as signature
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'cancellation_notice';
--
--   Expect exactly ONE row, the six-argument version.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

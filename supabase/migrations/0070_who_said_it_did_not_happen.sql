-- ===========================================================================
-- 0070_who_said_it_did_not_happen
--
-- A sixth session status, 'not_held', and two timestamps recording WHO SAID SO
-- rather than who failed to turn up. Audit item 138.
--
-- ⚠️ Apply 0069 first.
--
-- ── THE GAP THIS CLOSES ────────────────────────────────
-- Item 134 gave an accepted booking whose time has passed a question rather
-- than a verdict: "Did this happen?". The stylist could answer yes, with Mark
-- complete. Nobody could answer no — so a booking that genuinely did not go
-- ahead stayed 'accepted' for ever, indistinguishable from one that happened
-- and was never marked.
--
-- ── ⚠️ WHAT IS RECORDED, AND WHAT IS NOT ───────────────
-- The row stores "Micky said this did not happen, at 14:32 on 3 October".
-- It never stores "the model did not turn up". The first is a fact about a
-- statement somebody made; the second is an accusation about somebody's
-- behaviour, and nothing in this system can establish it. Both parties were
-- somewhere; the product was in neither place.
--
-- That distinction is the whole design. It is why this is a pair of
-- timestamps rather than a `no_show_by` column, and why the clients read
-- "Priya said this didn't happen" rather than "Priya reported a no-show".
--
-- ── WHY TWO COLUMNS AND NOT ONE ────────────────────────
-- A single "who said so" column holds one answer, so the second person to say
-- it would either overwrite the first or be dropped. Both saying so is a
-- materially different record from one saying so — it is agreement rather than
-- assertion — and a dispute turns on exactly that.
--
--   not_held_model_at     non-null  -> the model said so, and when
--   not_held_provider_at  non-null  -> the stylist said so, and when
--   both non-null                   -> they agree
--
-- A session_not_held_reports table was considered and rejected: it earns its
-- keep only if a third party can report, or if a statement can be retracted
-- and re-made. Neither is true here, and two parties with fixed roles need two
-- columns.
--
-- ── ⚠️ TERMINAL, AND AN ACCIDENTAL PRESS NEEDS AN ADMIN ─
-- 'not_held' joins completed / declined / cancelled / expired as terminal. A
-- member who taps it by mistake CANNOT undo it: there is no un-saying
-- mechanism, deliberately, because one designed in a hurry is worse than none
-- — it would let somebody quietly withdraw a statement the other party has
-- already been told about and may have acted on.
--
-- **This will be the first support request this feature generates.** The
-- remedy is an admin correcting the row by hand: admins bypass the actor rules
-- at the top of enforce_session_status_transition, so an admin can move it
-- back to 'accepted' and null both timestamps. That is the intended path and
-- it is written here so the first person to be asked does not have to work it
-- out under time pressure.
--
-- ── WHY A GUARD AND NOT JUST AN RPC ────────────────────
-- report_not_held() below is the path the clients use, and it stamps the
-- caller's own column from auth.uid() rather than trusting a client to say
-- which one. But an RPC is a convenience, not a privilege: `"model can create
-- session"` already showed what a permissive policy lets a member do directly,
-- and the UPDATE policy on sessions lets either participant write the row.
--
-- So the guard refuses 'not_held' unless the ACTOR'S OWN timestamp is set in
-- the same statement. A row saying it did not happen with nobody having said
-- so is worse than no row: it is an unattributed assertion in the one record a
-- dispute would reach for.
-- ===========================================================================

begin;

do $$
declare
  v_code text;
begin
  if exists (select 1 from public.schema_migrations where version = '0070') then
    raise exception 'Migration 0070 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0069') then
    raise exception '0070 expects 0069 to be applied first.';
  end if;

  -- Comments stripped before matching: pg_get_functiondef returns the prose
  -- too, which is how 0068's guard matched its own description of a gap.
  v_code := regexp_replace(
    pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
    '--[^' || chr(10) || ']*', '', 'g');

  if v_code not like '%admin_suspension%' then
    raise exception '0070: run_email_reconcile does not list admin_suspension, so 0068 has not run.';
  end if;
  if position('delete from public.email_sends' in v_code)
     < position('insert into public.email_reconcile_runs' in v_code) then
    raise exception '0070: run_email_reconcile still has the DELETE above its INSERT, so 0069 has not run. Applying this would reinstate a function that raises on every call.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE VOCABULARY AND THE TWO STATEMENTS
-- ---------------------------------------------------------------------------
alter table public.sessions drop constraint sessions_status_check;

alter table public.sessions add constraint sessions_status_check
  check (status = any (array['pending', 'accepted', 'declined',
                             'completed', 'cancelled', 'expired', 'not_held']));

alter table public.sessions
  add column if not exists not_held_model_at    timestamptz,
  add column if not exists not_held_provider_at timestamptz;

comment on column public.sessions.not_held_model_at is
  'When the MODEL said this booking did not happen. A record of a statement, '
  'not a finding: it never means the stylist failed to turn up. Null means she '
  'has not said so. 0070.';
comment on column public.sessions.not_held_provider_at is
  'When the STYLIST said this booking did not happen. Both columns non-null '
  'means they agree, which is a different record from one of them asserting '
  'it. 0070.';

-- ---------------------------------------------------------------------------
-- 2. THE GUARD
--
-- Brought forward from 0066's version with three additions, and nothing else
-- changed.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_session_status_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  is_provider boolean;
  is_model    boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  -- 'not_held' joins the terminal states (0070). An accidental press is undone
  -- by an admin, who bypasses above; there is deliberately no self-service way
  -- to withdraw a statement the other party has already been told about.
  if old.status in ('completed', 'declined', 'cancelled', 'expired', 'not_held') then
    raise exception 'Session is already % and cannot change', old.status using errcode = '42501';
  end if;

  if new.status = 'accepted'
     and (old.date + old.start_time) at time zone 'Europe/London' <= now() then
    raise exception 'That appointment has already started and can no longer be accepted.'
      using errcode = 'CV003';
  end if;

  is_model := (auth.uid() = old.model_user_id);
  is_provider := exists (select 1 from public.providers p where p.id = old.provider_id and p.user_id = auth.uid());

  -- ⚠️ 0070. EITHER PARTY may say a booking did not happen, which is why this
  -- is checked before the provider-only block below. Three conditions:
  --   * only from 'accepted' — a pending or declined application is not a
  --     booking that could have happened;
  --   * only once the appointment has started, Europe/London;
  --   * AND THE ACTOR'S OWN TIMESTAMP MUST BE SET IN THE SAME STATEMENT, so
  --     the row can never say it did not happen without saying who said so.
  if new.status = 'not_held' then
    if not (is_model or is_provider) then
      raise exception 'Not a participant of this booking' using errcode = '42501';
    end if;
    if old.status <> 'accepted' then
      raise exception 'Only a confirmed booking can be recorded as not having happened.'
        using errcode = 'CV004';
    end if;
    if (old.date + old.start_time) at time zone 'Europe/London' > now() then
      raise exception 'That appointment has not happened yet.' using errcode = 'CV004';
    end if;
    if is_model and new.not_held_model_at is null then
      raise exception 'Recording that a booking did not happen must also record who said so.'
        using errcode = 'CV004';
    end if;
    if is_provider and new.not_held_provider_at is null then
      raise exception 'Recording that a booking did not happen must also record who said so.'
        using errcode = 'CV004';
    end if;
    return new;
  end if;

  if new.status in ('accepted', 'declined', 'completed') then
    if not is_provider then
      raise exception 'Only the provider can set a session to %', new.status using errcode = '42501';
    end if;
  elsif new.status = 'cancelled' then
    if not (is_provider or is_model) then
      raise exception 'Not a participant of this session' using errcode = '42501';
    end if;
  else
    -- 'expired' lands here for anyone holding a JWT: only the null-uid path
    -- exempted above may write it (0067).
    raise exception 'Illegal status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$function$;

comment on function public.enforce_session_status_transition() is
  'BEFORE UPDATE OF status on sessions. Who may move a booking where. '
  '''expired'' is writable only by the null-uid path (0067); an appointment that '
  'has started can no longer be ACCEPTED though it may always be declined '
  '(0066); and ''not_held'' may be set by EITHER participant, only from '
  '''accepted'', only after the appointment started, and only in a statement that '
  'also stamps that actor''s own not_held_*_at — so the row can never assert '
  'that something did not happen without recording who said so (0070).';

-- ---------------------------------------------------------------------------
-- 3. THE PATH THE CLIENTS USE
--
-- Stamps the caller's own column from auth.uid(). A second call by the other
-- party stamps the second column and leaves the status alone, because it is
-- already 'not_held' and the guard early-returns on an unchanged status.
--
-- coalesce() on the timestamp means pressing twice does not move your own
-- time: the first statement is the one that was made.
-- ---------------------------------------------------------------------------
create or replace function public.report_not_held(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me         uuid := auth.uid();
  v_date       date;
  v_status     text;
  v_model      uuid;
  v_provider   uuid;
  v_is_model   boolean;
  v_other      uuid;
  v_who        text;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select s.date, s.status, s.model_user_id, p.user_id
    into v_date, v_status, v_model, v_provider
  from public.sessions s
  join public.providers p on p.id = s.provider_id
  where s.id = p_session_id
  for update of s;

  if not found then
    raise exception 'No such booking' using errcode = 'CV004';
  end if;

  v_is_model := (v_me = v_model);
  if not (v_is_model or v_me = v_provider) then
    raise exception 'Not a participant of this booking' using errcode = '42501';
  end if;

  -- The remaining conditions are enforced by the guard on the UPDATE below.
  -- They are not repeated here: one implementation, and the guard is the one
  -- that cannot be gone round.
  if v_is_model then
    update public.sessions
       set not_held_model_at = coalesce(not_held_model_at, now()),
           status = 'not_held'
     where id = p_session_id;
    v_other := v_provider;
    select coalesce(u.first_name, 'The model') into v_who
    from public.users u where u.id = v_me;
  else
    update public.sessions
       set not_held_provider_at = coalesce(not_held_provider_at, now()),
           status = 'not_held'
     where id = p_session_id;
    v_other := v_model;
    select coalesce(p.name, 'The stylist') into v_who
    from public.providers p where p.user_id = v_me;
  end if;

  -- ⚠️ THE OTHER PARTY IS TOLD, NEUTRALLY, AND ONLY ONCE. It is the only way
  -- they learn there is something to agree with or dispute. The sentence
  -- reports a statement and characterises nobody: "X has recorded that…", not
  -- "X says you did not turn up".
  --
  -- Suppressed when they have already said it themselves — telling somebody
  -- you agree with them is not news, and would arrive as a second
  -- notification about a thing they started.
  if v_other is not null and (
       (v_is_model     and (select not_held_provider_at from public.sessions where id = p_session_id) is null)
    or (not v_is_model and (select not_held_model_at    from public.sessions where id = p_session_id) is null)
  ) then
    insert into public.notifications (user_id, type, title, body, session_id)
    values (
      v_other, 'session_not_held', 'Booking marked as not held',
      v_who || ' has recorded that your appointment on '
            || to_char(v_date, 'FMDD FMMonth') || ' did not go ahead. '
            || 'If that is not right, you can say so on the booking.',
      p_session_id);
  end if;
end $$;

comment on function public.report_not_held(uuid) is
  'Records that the CALLER says a booking did not happen, stamping their own '
  'not_held_*_at from auth.uid() rather than trusting the client to say which. '
  'Either participant may call it. The other party is notified once, neutrally, '
  'unless they already said it themselves. 0070, audit item 138.';

revoke all on function public.report_not_held(uuid) from public, anon;
grant execute on function public.report_not_held(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE NEW TYPE, IN BOTH ALLOWLISTS
--
-- Both, together, because a type in the trigger and not the reconciler is
-- emailed and never checked — items 135 and 136, a week apart, from exactly
-- that. Rebuilt from 0069's body, which the guard above has just confirmed is
-- what is live.
-- ---------------------------------------------------------------------------
drop trigger if exists notify_email on public.notifications;
create trigger notify_email after insert on public.notifications
  for each row
  when (new.type = any (array['session_applied', 'session_accepted', 'session_declined',
                              'session_cancelled', 'verification', 'payment_failed',
                              'admin_warning', 'admin_suspension', 'session_expired',
                              'session_not_held']))
  execute function public.tg_notify_email();

create or replace function public.run_email_reconcile(p_hours integer default 24)
returns public.email_reconcile_runs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.email_reconcile_runs;
  v_since timestamptz := now() - make_interval(hours => p_hours);
begin
  -- ⚠️ NOTHING MAY COME BETWEEN THIS `with` AND THE `insert` BELOW IT.
  -- A CTE attaches to the single statement that follows it. From 0047 to 0069
  -- a DELETE sat here and this function raised 42P01 on every call it ever
  -- had, nightly, while appearing to be a working monitor (item 136).
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      -- ⚠️ MUST MATCH THE notify_email TRIGGER'S WHEN CLAUSE. The trigger
      -- decides whether an email is attempted; this decides whether a missing
      -- attempt is noticed. A type in one and not the other is emailed and
      -- never checked — where admin_suspension sat from 0061 to 0068.
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired',
                     'session_not_held')
  ),
  attempts as (
    select e.id,
           max(case when s.status = 'sent'    then 1 else 0 end) as sent,
           max(case when s.status = 'failed'  then 1 else 0 end) as failed,
           max(case when s.status = 'skipped' then 1 else 0 end) as skipped,
           count(s.id)                                           as tries
    from emailable e
    left join public.email_sends s on s.kind = 'notification' and s.ref_id = e.id
    group by e.id
  )
  insert into public.email_reconcile_runs (window_hours, emailable, sent, failed, skipped, no_attempt)
  select p_hours,
         count(*),
         coalesce(sum(sent), 0),
         coalesce(sum(case when sent = 0 and failed = 1 then 1 else 0 end), 0),
         coalesce(sum(case when sent = 0 and failed = 0 and skipped = 1 then 1 else 0 end), 0),
         coalesce(sum(case when tries = 0 then 1 else 0 end), 0)
  from attempts
  returning * into v_row;

  -- 90 days, per the Privacy policy. Position is load-bearing: see above.
  delete from public.email_sends where created_at < now() - interval '90 days';

  return v_row;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0070', 'who_said_it_did_not_happen', '3c7580f58429b91d6c91bcfc3c7ccd403ea4b81f5eb413af0940dcdfe6821b2b');

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0069') = 1
--       as v_0069_applied,
--     (select pg_get_constraintdef(oid) from pg_constraint
--       where conrelid = 'public.sessions'::regclass
--         and conname = 'sessions_status_check')              as status_check_now,
--     (select count(*) from information_schema.columns
--       where table_schema = 'public' and table_name = 'sessions'
--         and column_name in ('not_held_model_at','not_held_provider_at')) = 0
--       as columns_not_there_yet,
--     (select count(*) from public.sessions
--       where status = 'accepted'
--         and (date + start_time) at time zone 'Europe/London' <= now())
--       as bookings_this_will_apply_to;
--
--   Expect true, the six-value list, true. The last number is how many past
--   accepted bookings gain the control once the clients ship — it was 1 on
--   1 Oct (the July booking).
-- ===========================================================================
--
-- ── VERIFY — as both parties, rolled back ───────────────────────────────
--
--   Results come back in the EXCEPTION: the Supabase SQL editor does not
--   surface NOTICE output. Written against the real column list — sessions
--   requires treatment_id and location_type, availability has no created_at.
--
--   begin;
--   do $v$
--   declare
--     v_prov uuid; v_puser uuid; v_treat uuid; v_model uuid;
--     v_slot uuid; v_sess uuid; v_state text; v_report text := '';
--     v_m timestamptz; v_p timestamptz; v_status text; v_notes int;
--   begin
--     -- ⚠️ BOTH PARTIES ACT IN THIS BLOCK, so NEITHER may be an admin:
--     -- an admin bypasses the guard and every assertion below passes without
--     -- testing anything. On 2 Oct `limit 1` over public.users picked
--     -- ff06d568 — a provider and an admin — and this block reported a hole
--     -- in the guard that was not there.
--     select p.id, p.user_id, pt.id into v_prov, v_puser, v_treat
--     from public.providers p
--     join public.provider_treatments pt on pt.provider_id = p.id
--     where p.user_id is not null
--       and not exists (select 1 from public.admins a where a.user_id = p.user_id)
--     limit 1;
--     -- The model test account by id (CLAUDE.md), not whoever sorts first.
--     select u.id into v_model from public.users u
--      where u.id = 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'
--        and u.id <> coalesce(v_puser, '00000000-0000-0000-0000-000000000000'::uuid);
--     if v_prov is null or v_model is null then
--       raise exception 'ROLLED BACK. Need a provider with a treatment and one other user.';
--     end if;
--
--     insert into public.availability (provider_id, date, start_time, end_time,
--                                      active_treatments, is_taken)
--     values (v_prov, current_date + 7, '10:00', '12:00', array[v_treat::text], false)
--     returning id into v_slot;
--     insert into public.sessions (provider_id, model_user_id, model_id,
--                                  availability_id, treatment_id, location_type,
--                                  duration_minutes, status)
--     values (v_prov, v_model, v_model, v_slot, v_treat, 'provider', 120, 'pending')
--     returning id into v_sess;
--     update public.sessions set status = 'accepted' where id = v_sess;
--     update public.sessions
--        set date = current_date, start_time = '00:01', end_time = '00:30'
--      where id = v_sess;
--
--     -- (a) the direct path with no attribution must be refused
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     -- ⚠️ PROVE THE ACTOR CAN EXERCISE THE RULE BEFORE TESTING IT.
--     -- enforce_session_status_transition returns early for admins and for a
--     -- null auth.uid(). An actor that trips either bypasses every rule below
--     -- and the block reports a clean pass having tested nothing — which is
--     -- exactly what happened on 2 Oct, when an unordered `limit 1` over
--     -- public.users picked ff06d568: a provider AND an admin.
--     if auth.uid() is null or public.is_admin() then
--       raise exception 'ROLLED BACK, TESTED NOTHING. actor auth.uid()=% is_admin=%. Admins and the null-uid path bypass this guard, so no rule below could fire. Pick a member who is neither.',
--         coalesce(auth.uid()::text, 'NULL'), public.is_admin();
--     end if;
--
--     begin
--       update public.sessions set status = 'not_held' where id = v_sess;
--       v_state := 'NO ERROR - an unattributed not_held was accepted, which is the hole';
--     exception when others then
--       v_state := sqlstate || ' ' || sqlerrm;
--     end;
--     v_report := 'unattributed direct update: ' || v_state;
--
--     -- (b) the model says so, through the RPC
--     perform public.report_not_held(v_sess);
--     execute 'reset role';
--     select status, not_held_model_at, not_held_provider_at
--       into v_status, v_m, v_p from public.sessions where id = v_sess;
--     v_report := v_report || ' | after model: status=' || v_status
--              || ' model_at set=' || (v_m is not null)::text
--              || ' provider_at set=' || (v_p is not null)::text;
--
--     -- (c) the stylist agrees
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_puser::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     -- ⚠️ PROVE THE ACTOR CAN EXERCISE THE RULE BEFORE TESTING IT.
--     -- enforce_session_status_transition returns early for admins and for a
--     -- null auth.uid(). An actor that trips either bypasses every rule below
--     -- and the block reports a clean pass having tested nothing — which is
--     -- exactly what happened on 2 Oct, when an unordered `limit 1` over
--     -- public.users picked ff06d568: a provider AND an admin.
--     if auth.uid() is null or public.is_admin() then
--       raise exception 'ROLLED BACK, TESTED NOTHING. actor auth.uid()=% is_admin=%. Admins and the null-uid path bypass this guard, so no rule below could fire. Pick a member who is neither.',
--         coalesce(auth.uid()::text, 'NULL'), public.is_admin();
--     end if;
--
--     perform public.report_not_held(v_sess);
--     execute 'reset role';
--     select not_held_model_at, not_held_provider_at into v_m, v_p
--     from public.sessions where id = v_sess;
--     select count(*) into v_notes from public.notifications
--      where session_id = v_sess and type = 'session_not_held';
--     v_report := v_report || ' | after both: model_at set=' || (v_m is not null)::text
--              || ' provider_at set=' || (v_p is not null)::text
--              || ' notifications=' || v_notes;
--
--     raise exception 'ROLLED BACK ON PURPOSE. %', v_report;
--   end $v$;
--   rollback;
--
--   Expect:
--     * the unattributed direct update -> CV004 "must also record who said so";
--     * after the model -> status not_held, model_at set, provider_at NOT set;
--     * after both     -> both set, and notifications = 1. One, not two: the
--       second party agreeing is not news to the person who said it first.
-- ===========================================================================

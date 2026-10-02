-- ===========================================================================
-- 0066_an_appointment_that_has_started_cannot_be_accepted
--
-- Adds 'expired' to the session status vocabulary, makes it terminal, and
-- refuses to ACCEPT an application whose appointment has already begun.
-- Audit item 134, part one of two.
--
-- ⚠️ Apply 0065 first.
--
-- ⚠️ THIS MIGRATION CHANGES NO ROW'S STATUS. It widens a CHECK constraint and
-- replaces a trigger function. Nothing becomes 'expired' here — that is 0067,
-- which is separate precisely so this half can be applied whenever, and the
-- half that makes rows appear waits for a client deploy.
--
-- ── WHY THE ACCEPT RULE IS THE ACTUAL FIX ──────────────
-- 0065 stopped a past slot being BOOKED. It guards INSERT, and only INSERT.
-- A pending application whose appointment has since come and gone could still
-- be ACCEPTED, all day, by a stylist working through her list — which produces
-- exactly the thing item 133 was about, one step later in the flow.
--
-- The scheduled job in 0067 does not close that. A job that runs nightly
-- leaves the window open for the whole day, and a job that runs every minute
-- is a job pretending to be a constraint. So the rule lives here, in the
-- transition guard, and the job becomes housekeeping: it tidies a list, it
-- does not enforce anything.
--
-- ── WHY 'expired' AND NOT 'declined' ───────────────────
-- Because they are not the same thing to the person who applied. 'declined'
-- means a stylist looked and said no; 'expired' means nobody ever answered.
-- A model deciding whether to apply to that stylist again needs to know which
-- it was, and reusing 'declined' would tell her something untrue about
-- somebody else's behaviour.
--
-- ── WHO CAN WRITE 'expired' ────────────────────────────
-- Nobody with a JWT. The actor rules below list who may set 'accepted',
-- 'declined', 'completed' and 'cancelled'; anything else falls to the final
-- `else` and raises "Illegal status transition". 'expired' is deliberately not
-- added to any of those lists, so it can only be written by the null-uid path
-- the top of the function already exempts — which is the scheduled job.
--
-- ── WHERE THE ACCEPT REFUSAL SITS, AND WHY IT IS AFTER THE BYPASS ──
-- The existing early return exempts trusted server code and admins from the
-- ACTOR rules, and this new rule sits after it, so it exempts them too.
-- Deliberate: an admin repairing a booking by hand is the path of last resort
-- and blocking it here would leave no path at all. The people the rule is for
-- — a stylist working through her applications — always carry a JWT.
--
-- ⚠️ Note the asymmetry with 0065's trigger, which has no bypass and applies
-- to everyone including the service role. That is right for an INSERT, where
-- there is no legitimate reason to record an appointment in the past. Here
-- there is: correcting one.
--
-- ── ⚠️ EUROPE/LONDON, AGAIN AND FOR THE SAME REASON ────
-- sessions.date and .start_time are a bare date and a bare time meaning UK
-- wall clock. This database runs UTC, so an unqualified comparison is an hour
-- LENIENT from late March to late October — the length of a slot. Third time
-- this has had to be said in three days; it is said in the code rather than
-- remembered.
--
-- ── DECLINING IS NEVER GATED ───────────────────────────
-- Same principle as 0045's fee gate. A stylist must always be able to say no,
-- including to something she can no longer say yes to. Only 'accepted' is
-- refused below.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0066') then
    raise exception 'Migration 0066 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0065') then
    raise exception '0066 expects 0065 to be applied first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE VOCABULARY
--
-- Read from the live constraint before writing this:
--   sessions_status_check CHECK (status = ANY (ARRAY['pending','accepted',
--                                'declined','completed','cancelled']))
-- ---------------------------------------------------------------------------
alter table public.sessions drop constraint sessions_status_check;

alter table public.sessions add constraint sessions_status_check
  check (status = any (array['pending', 'accepted', 'declined',
                             'completed', 'cancelled', 'expired']));

-- ---------------------------------------------------------------------------
-- 2. THE GUARD
--
-- Brought forward from the LIVE definition (pg_get_functiondef, 1 Oct 2026),
-- not from supabase/session-status-guard.sql — though on this occasion the two
-- agreed. Two changes only:
--
--   * 'expired' joins the terminal list, so an expired application cannot be
--     accepted afterwards;
--   * accepting an appointment that has already started is refused.
--
-- Everything else is character-for-character what was live.
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

  -- 'expired' joins this list (0066): once an application has lapsed it does
  -- not come back, or a stylist could accept it days later.
  if old.status in ('completed', 'declined', 'cancelled', 'expired') then
    raise exception 'Session is already % and cannot change', old.status using errcode = '42501';
  end if;

  -- ⚠️ 0066, item 134. The appointment cannot be agreed to after it has begun.
  -- Declining is deliberately NOT gated: a stylist must always be able to say
  -- no, including to something she can no longer say yes to.
  if new.status = 'accepted'
     and (old.date + old.start_time) at time zone 'Europe/London' <= now() then
    raise exception 'That appointment has already started and can no longer be accepted.'
      using errcode = 'CV003';
  end if;

  is_model := (auth.uid() = old.model_user_id);
  is_provider := exists (select 1 from public.providers p where p.id = old.provider_id and p.user_id = auth.uid());
  if new.status in ('accepted', 'declined', 'completed') then
    if not is_provider then
      raise exception 'Only the provider can set a session to %', new.status using errcode = '42501';
    end if;
  elsif new.status = 'cancelled' then
    if not (is_provider or is_model) then
      raise exception 'Not a participant of this session' using errcode = '42501';
    end if;
  else
    -- 'expired' lands here for anyone holding a JWT, which is the intent: only
    -- the null-uid path exempted above may write it.
    raise exception 'Illegal status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$function$;

comment on function public.enforce_session_status_transition() is
  'BEFORE UPDATE OF status on sessions. Who may move a booking where, plus two '
  'rules added in 0066: ''expired'' is terminal, and an appointment that has '
  'already started (Europe/London) can no longer be ACCEPTED — declining it is '
  'always allowed. ''expired'' is writable only by the null-uid path, which is '
  'the scheduled job in 0067. Audit items 133 and 134.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0066', 'an_appointment_that_has_started_cannot_be_accepted', '862464801238ef818b875c774ca62c4bcc313875841050e2952c8f51f41d8efe');

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0065') = 1
--       as v_0065_applied,
--     (select pg_get_constraintdef(oid) from pg_constraint
--       where conrelid = 'public.sessions'::regclass
--         and conname = 'sessions_status_check')                as status_check_now,
--     (select count(*) from public.sessions where status = 'expired') = 0
--       as nothing_expired_yet;
--
--   Expect true, the five-value list, true. If status_check_now already
--   mentions 'expired', this migration has run.
-- ===========================================================================
--
-- ── VERIFY — behavioural, as a real stylist, rolled back ────────────────
--
--   ONE paste, each half in its own savepoint (the 0057 shape). Written
--   against the actual column list: sessions requires treatment_id and
--   location_type, and availability has no created_at (the 0065 lesson).
--
--   The booking is created by the migration runner — auth.uid() is null there,
--   which the guard exempts, so the setup cannot be blocked by the rule under
--   test. Only the two ATTEMPTS run as the stylist.
--
--   begin;
--   do $v$
--   declare
--     v_prov uuid; v_puser uuid; v_treat uuid; v_slot uuid; v_sess uuid;
--     v_model uuid; v_state text; v_report text := '';
--   begin
--     -- ⚠️ NOT AN ADMIN. The actor here is the STYLIST, and an admin
--     -- bypasses the guard entirely. This pick was `limit 1` until 2 Oct and
--     -- happened to land on a non-admin provider; the same pattern in 0070
--     -- landed on one who was both and reported a hole that did not exist.
--     select p.id, p.user_id, pt.id into v_prov, v_puser, v_treat
--     from public.providers p
--     join public.provider_treatments pt on pt.provider_id = p.id
--     where p.user_id is not null
--       and not exists (select 1 from public.admins a where a.user_id = p.user_id)
--     limit 1;
--     select id into v_model from public.users
--      where id <> coalesce(v_puser, id) limit 1;   -- only owns the row, never acts
--     if v_prov is null or v_model is null then
--       raise exception 'ROLLED BACK. Need a provider with a treatment and one other user.';
--     end if;
--
--     -- a FUTURE slot, so 0065's insert trigger is satisfied
--     insert into public.availability (provider_id, date, start_time, end_time,
--                                      active_treatments, is_taken)
--     values (v_prov, current_date + 7, '10:00', '12:00', array[v_treat::text], false)
--     returning id into v_slot;
--
--     insert into public.sessions (provider_id, model_user_id, model_id,
--                                  availability_id, treatment_id, location_type,
--                                  duration_minutes, status)
--     values (v_prov, v_model, v_model, v_slot, v_treat, 'provider', 120, 'pending')
--     returning id into v_sess;
--
--     -- move it into the past. Allowed here because auth.uid() is null.
--     update public.sessions
--        set date = current_date, start_time = '00:01', end_time = '00:30'
--      where id = v_sess;
--
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
--     -- (a) the stylist tries to accept it
--     begin
--       update public.sessions set status = 'accepted' where id = v_sess;
--       v_state := 'NO ERROR — a started appointment was ACCEPTED, which is the bug';
--     exception when others then
--       v_state := sqlstate || ' ' || sqlerrm;
--     end;
--     v_report := 'accept a started appointment: ' || v_state;
--
--     -- (b) she declines it instead, which must still work
--     begin
--       update public.sessions set status = 'declined' where id = v_sess;
--       v_state := 'OK — declined';
--     exception when others then
--       v_state := sqlstate || ' ' || sqlerrm;
--     end;
--     v_report := v_report || ' | decline the same one: ' || v_state;
--
--     execute 'reset role';
--     -- ⚠️ THE RESULTS GO IN THE EXCEPTION, NOT IN raise notice. The Supabase
--     -- SQL editor does not surface NOTICE output, so a block reporting
--     -- through notices reports nothing there at all.
--     raise exception 'ROLLED BACK ON PURPOSE. %', v_report;
--   end $v$;
--   rollback;
--
--   Expect: accept -> CV003 "That appointment has already started and can no
--   longer be accepted."; decline -> OK. Declining is never gated.
--
--   -- (c) the constraint takes the new value
--   select 'expired' = any (
--     regexp_split_to_array(
--       (select pg_get_constraintdef(oid) from pg_constraint
--         where conrelid = 'public.sessions'::regclass
--           and conname = 'sessions_status_check'), '\W+')) as accepts_expired;
--
--   Expect true.
-- ===========================================================================

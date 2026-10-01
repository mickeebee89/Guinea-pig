-- ===========================================================================
-- 0067_an_application_nobody_answered_lapses
--
-- A pending application whose appointment has passed becomes 'expired', the
-- model is told, and a daily job keeps it that way. Audit item 134, part two.
--
-- ⚠️ Apply 0066 first. ⚠️ AND READ THE NEXT PARAGRAPH BEFORE APPLYING IT.
--
-- ── ⚠️ NOTHING HERE CAN REFUSE TO RUN EARLY, AND THAT IS THE RISK ──────
-- This migration makes rows change status. An 'expired' session appears in
-- NEITHER of the two groups the clients render:
--
--     Awaiting acceptance = status === 'pending'
--     Past                = completed | cancelled | (accepted AND date < today)
--
-- So until the clients are deployed with 'expired' in the Past group, an
-- expired application simply VANISHES from both the model's and the stylist's
-- lists. Not an error, not an empty state — gone.
--
-- 0063 was sequenced the same way and could protect itself: it queried
-- pg_depend and refused to run until the view had been rebuilt, because the
-- thing it waited for was visible IN THE DATABASE. **There is no equivalent
-- here.** A client deploy leaves no trace Postgres can see, so no ASSERT in
-- this file can check it. I cannot make this migration refuse, and saying so
-- plainly is the only protection available.
--
-- The structural protection instead: 0066 changes no row's status and can be
-- applied whenever. THIS one is a separate, deliberate act, to be applied only
-- after the deploy that teaches the clients the word.
--
--     1. apply 0066                      (safe alone, nothing changes)
--     2. deploy the clients              (Past group learns 'expired')
--     3. apply this                      (rows start changing)
--     4. node scripts/gen-supabase-types.mjs --applied 0067
--
-- ── WHAT THIS IS FOR ───────────────────────────────────
-- 'pending' has no date filter anywhere in either client, so an application
-- nobody answered sits in a stylist's Awaiting list for ever. Nobody can act
-- on it — 0066 makes accepting it impossible — so it is a row that can only be
-- ignored, mixed in with the ones that need a decision today.
--
-- ── WHO IS TOLD, AND WHO IS NOT ────────────────────────
-- THE MODEL IS TOLD. "Nobody answered" is a different thing from "she said
-- no", and the model is the only person who needs the difference: it is what
-- tells her whether applying to that stylist again is worth it. The wording
-- below is careful not to imply a refusal, and careful not to characterise the
-- stylist's behaviour — she may have been ill, or away, or the application may
-- have arrived an hour before the slot.
--
-- THE STYLIST IS NOT TOLD. A notification saying "you did not act on this"
-- is a nag about something she can no longer do anything about.
--
-- ── ONE FUNCTION, ONE FLAG, NOT TWO CODE PATHS ─────────
-- The backfill and the nightly run are the same operation with different
-- noise, so they are one function and a boolean. Writing the rule twice — once
-- for history, once for the future — is the fault this file has recorded in
-- safeList, in FeaturedStylists and in the five copies of `date >= today`.
--
-- ── ⚠️ THE BACKFILL IS SILENT, AND TODAY IT IS ALSO EMPTY ──
-- The rule stands whatever the count: emailing somebody in October about an
-- application they made in July is noise about a thing they stopped thinking
-- about months ago. `p_notify => false` for history; the scheduled job
-- notifies from here on.
--
-- ⚠️ BUT THE COUNT IS ZERO, AND MY FIRST VERSION OF THIS FILE SAID TWO.
-- The two rows came from a diagnostic query whose predicate was
-- `status in ('pending', 'accepted')`. THIS statement only touches 'pending'.
-- One of those two was accepted, so it was never a candidate — the number was
-- wrong before anything was deleted, and it was wrong because a count was
-- carried from a WIDER question to a NARROWER action without re-reading it.
--
-- Corrected against the live counts, 1 Oct 2026: accepted 1, cancelled 21,
-- completed 11, declined 3, pending 0. The backfill is a no-op today, and the
-- preflight below expects 0 rather than telling you to stop when it sees the
-- truth.
--
-- ── WHAT IS NOT FIXED HERE ─────────────────────────────
-- run_email_reconcile does not list 'admin_suspension', so the notification
-- telling somebody their account is restricted is the one type excluded from
-- the check that catches missed emails. Found while reading these allowlists;
-- it is its own item and its own migration. One change, one reason.
-- ===========================================================================

begin;

do $$
declare
  v_con text;
begin
  if exists (select 1 from public.schema_migrations where version = '0067') then
    raise exception 'Migration 0067 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0066') then
    raise exception '0067 expects 0066 to be applied first.';
  end if;

  -- Same guard 0061 used before adding a notification type: if notifications
  -- .type is CHECK-constrained and does not allow the new value, every insert
  -- below would fail at run time rather than here.
  select pg_get_constraintdef(c.oid) into v_con
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%type%';

  if v_con is not null and v_con not like '%session_expired%' then
    raise exception '0067: notifications.type has a CHECK that does not allow session_expired: %. Widen it first.', v_con;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE RUN LOG
--
-- Shaped after retention_runs (0005), and for the same reason its comment
-- gives: the ABSENCE of recent rows is the alarm. A scheduled job that has
-- quietly stopped looks exactly like a scheduled job with nothing to do.
-- ---------------------------------------------------------------------------
create table if not exists public.session_expiry_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  notified    boolean     not null,
  ok          boolean     not null,
  duration_ms integer,
  expired     integer     not null default 0,
  results     jsonb       not null
);

comment on table public.session_expiry_runs is
  'One row per run of expire_past_applications(), including the silent backfill. '
  'The absence of recent rows is itself the alarm: it means the daily job has '
  'stopped and stale applications are accumulating in stylists'' lists again. '
  '0067, audit item 134.';

alter table public.session_expiry_runs enable row level security;
revoke all on public.session_expiry_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE JOB
--
-- SECURITY DEFINER, and it runs with no JWT, so enforce_session_status_
-- transition's null-uid exemption lets it write 'expired' — the one path 0066
-- leaves open for that value.
-- ---------------------------------------------------------------------------
create or replace function public.expire_past_applications(p_notify boolean default true)
returns public.session_expiry_runs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row     public.session_expiry_runs;
  v_started timestamptz := clock_timestamp();
  v_ids     uuid[];
begin
  -- Europe/London, for the third migration running: date and start_time are UK
  -- wall clock and this database is UTC, so an unqualified comparison expires
  -- things an hour late for seven months of the year.
  -- ⚠️ A DATA-MODIFYING CTE, not `returning ... into`. `into` binds ONE row,
  -- so `returning s.id into v_ids` silently keeps the last id and loses the
  -- rest — the run log would then report one expiry however many there were,
  -- and the notifications would go to one model out of several.
  with moved as (
    update public.sessions s
       set status = 'expired'
     where s.status = 'pending'
       and (s.date + s.start_time) at time zone 'Europe/London' <= now()
    returning s.id
  )
  select array_agg(moved.id) into v_ids from moved;

  if p_notify and v_ids is not null then
    insert into public.notifications (user_id, type, title, body, session_id)
    select s.model_user_id,
           'session_expired',
           'Your application has expired',
           'Your application to ' || coalesce(p.name, 'the stylist')
             || ' for ' || to_char(s.date, 'FMDD FMMonth')
             || ' has expired — it was not answered before the appointment time. '
             || 'That is not a no: you are welcome to apply again for another slot.',
           s.id
    from public.sessions s
    left join public.providers p on p.id = s.provider_id
    where s.id = any (v_ids);
  end if;

  insert into public.session_expiry_runs (notified, ok, duration_ms, expired, results)
  values (
    p_notify, true,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int,
    coalesce(array_length(v_ids, 1), 0),
    jsonb_build_object('session_ids', coalesce(to_jsonb(v_ids), '[]'::jsonb))
  )
  returning * into v_row;

  return v_row;
end $$;

comment on function public.expire_past_applications(boolean) is
  'Pending applications whose appointment has passed (Europe/London) become '
  '''expired'' and the MODEL is notified — never the stylist, who can no longer '
  'act on it either way. p_notify => false is the silent backfill for history; '
  'the daily job runs with the default. One function and a flag rather than two '
  'code paths. 0067, audit item 134.';

revoke all on function public.expire_past_applications(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE NEW TYPE GETS AN EMAIL, AND GETS RECONCILED
--
-- Both allowlists, together. Adding a type to the trigger but not to the
-- reconciler produces a notification that is emailed and never checked — which
-- is exactly the gap 'admin_suspension' is sitting in right now, because 0061
-- updated one list and not the other.
--
-- Both are rebuilt from the LIVE definitions read on 1 Oct 2026, not from
-- 0047's text, which is stale: 0061 already replaced the trigger.
-- ---------------------------------------------------------------------------
drop trigger if exists notify_email on public.notifications;
create trigger notify_email after insert on public.notifications
  for each row
  when (new.type = any (array['session_applied', 'session_accepted', 'session_declined',
                              'session_cancelled', 'verification', 'payment_failed',
                              'admin_warning', 'admin_suspension', 'session_expired']))
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
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      -- ⚠️ 'session_expired' added by 0067. 'admin_suspension' is STILL
      -- MISSING and that is a known gap with its own item — not fixed here,
      -- because one change gets one reason.
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'session_expired')
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
  -- 90 days, because that is what the Privacy policy now says: "A record that
  -- we sent you an email … kept for 90 days". Deleted here rather than in
  -- run_retention_purge so the promise is kept by the job that runs nightly,
  -- not monthly. The reconcile only ever looks at the last 24 hours.
  delete from public.email_sends where created_at < now() - interval '90 days';

  insert into public.email_reconcile_runs (window_hours, emailable, sent, failed, skipped, no_attempt)
  select p_hours,
         count(*),
         coalesce(sum(sent), 0),
         coalesce(sum(case when sent = 0 and failed = 1 then 1 else 0 end), 0),
         coalesce(sum(case when sent = 0 and failed = 0 and skipped = 1 then 1 else 0 end), 0),
         coalesce(sum(case when tries = 0 then 1 else 0 end), 0)
  from attempts
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE SILENT BACKFILL
--
-- Two rows expected. No notifications: see the header.
-- ---------------------------------------------------------------------------
select public.expire_past_applications(p_notify => false);

-- ---------------------------------------------------------------------------
-- 5. DAILY, AT 03:40 UTC
--
-- Clear of purge-verification-selfies (03:15) and retention-purge (03:20 on
-- the 1st), so the three never overlap.
--
-- Daily is a tidiness cadence, not a guard: 0066 makes accepting a started
-- appointment impossible the moment it starts, so nothing depends on how
-- quickly this runs. If it were the guard, daily would be far too slow.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-past-applications') then
    perform cron.unschedule('expire-past-applications');
  end if;
  perform cron.schedule('expire-past-applications', '40 3 * * *',
                        'select public.expire_past_applications();');
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0067', 'an_application_nobody_answered_lapses', 'af4bc6c30fc685eb93be00d144f791b8d27b041234767ab547e9b53ad84ec037');

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0066') = 1
--       as v_0066_applied,
--     (select count(*) from public.sessions s
--       where s.status = 'pending'
--         and (s.date + s.start_time) at time zone 'Europe/London' <= now())
--       as rows_the_backfill_will_expire,
--     (select count(*) from cron.job where jobname = 'expire-past-applications') = 0
--       as not_already_scheduled;
--
--   Expect true, 0, true as of 1 Oct 2026 — there are no pending sessions at
--   all. ANY number is fine to proceed on; the point of printing it is that you
--   know what the backfill is about to change BEFORE it changes it. If it is
--   large and you were not expecting it, stop and look.
--
--   ⚠️ AND CONFIRM THE CLIENTS ARE DEPLOYED. Nothing in this file can check
--   it. Open /bookings as a stylist after the deploy and confirm the Past
--   group is rendering; an expired row is invisible in a client that predates
--   it.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the backfill did what it said, and told nobody
--   select ran_at, notified, ok, expired, results
--   from public.session_expiry_runs order by id desc limit 1;
--
--   Expect notified = false, ok = true, expired = 0 (nothing pending today).
--
--   select count(*) from public.notifications where type = 'session_expired';
--
--   Expect 0. The backfill is silent; anything above zero means p_notify
--   defaulted somewhere it should not have.
--
--   -- (b) the two rows moved, and nothing else did
--   select status, count(*) from public.sessions group by status order by 1;
--
--   Expect no 'expired' row today, and 'pending' absent entirely. The state
--   this migration describes will first appear when a real application lapses.
--
--   -- (c) the job is scheduled
--   select jobname, schedule, command, active from cron.job
--   where jobname = 'expire-past-applications';
--
--   -- (d) the notifying path, building its own pending row.
--   --
--   -- ⚠️ IT CREATES ONE RATHER THAN BORROWING ONE. The first version said
--   -- "select id from public.sessions where status = 'pending' limit 1",
--   -- which assumes a pending application exists. None do — so that block
--   -- would have updated nothing, expired nothing, and printed a clean zero
--   -- that looked like a pass. A verify that silently tests nothing is worse
--   -- than one that fails.
--   --
--   -- The slot is created in the FUTURE because 0065's insert trigger refuses
--   -- a session against a started slot, then moved into the past as the
--   -- migration runner, where auth.uid() is null and the status guard stands
--   -- aside. That is the same sequence a real application goes through, only
--   -- faster.
--   --
--   -- Results come back in the EXCEPTION, not through raise notice: the
--   -- Supabase SQL editor does not surface NOTICE output.
--   begin;
--   do $v$
--   declare
--     v_prov uuid; v_treat uuid; v_model uuid; v_slot uuid; v_sess uuid;
--     v_expired int; v_type text; v_title text; v_body text; v_to uuid;
--   begin
--     select p.id, pt.id into v_prov, v_treat
--     from public.providers p
--     join public.provider_treatments pt on pt.provider_id = p.id
--     limit 1;
--     select u.id into v_model from public.users u
--      where u.id <> coalesce((select user_id from public.providers where id = v_prov), u.id)
--      limit 1;
--     if v_prov is null or v_model is null then
--       raise exception 'ROLLED BACK. Need a provider with a treatment and one other user.';
--     end if;
--
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
--     -- into the past, as the runner
--     update public.sessions
--        set date = current_date, start_time = '00:01', end_time = '00:30'
--      where id = v_sess;
--
--     select expired into v_expired from public.expire_past_applications();
--
--     select n.type, n.title, n.body, n.user_id
--       into v_type, v_title, v_body, v_to
--     from public.notifications n
--     where n.session_id = v_sess and n.type = 'session_expired';
--
--     raise exception 'ROLLED BACK ON PURPOSE. expired=% | notified_user=% | model=% | type=% | title=% | body=%',
--       v_expired, v_to, v_model, v_type, v_title, v_body;
--   end $v$;
--   rollback;
--
--   Expect expired = 1, the notified user to EQUAL the model id printed beside
--   it, and a body that neither says nor implies the stylist refused. Read the
--   sentence, not just the count.
-- ===========================================================================

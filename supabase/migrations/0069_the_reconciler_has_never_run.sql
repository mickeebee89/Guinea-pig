-- ===========================================================================
-- 0069_the_reconciler_has_never_run
--
-- Moves one DELETE out from between a CTE and the statement that reads it.
-- run_email_reconcile has raised 42P01 on every invocation since it was
-- created. Audit item 136.
--
-- ⚠️ Apply 0068 first.
--
-- ── THE FAULT ──────────────────────────────────────────
-- The function reads:
--
--     with emailable as (…), attempts as (…)
--     delete from public.email_sends where created_at < now() - interval '90 days';
--     insert into public.email_reconcile_runs (…)
--     select … from attempts
--
-- **A CTE attaches to the single statement that follows it.** The DELETE
-- consumed the WITH clause, so by the time the INSERT runs there is no
-- `attempts` to select from:
--
--     ERROR: 42P01: relation "attempts" does not exist
--     CONTEXT: PL/pgSQL function run_email_reconcile(integer) line 39
--
-- The CTEs are not optional decoration — `attempts` is the whole computation.
-- The function has never returned a row.
--
-- ── ⚠️ WHAT THIS MEANS, WHICH IS WORSE THAN THE BUG ────
-- run_email_reconcile exists to catch emails that never went. Its own comment
-- says `no_attempt > 0` is "the failure the log itself cannot" see — a
-- notification where the trigger never reached the send function leaves no
-- trace in email_sends, so counting is the only way to find it.
--
-- **That check has itself never run.** From the day it was created it has
-- raised, nightly, and the thing it was built to notice has gone unwatched for
-- exactly as long as it has appeared to be watched. A monitor that is broken
-- is worse than no monitor, because no monitor is a known gap and a broken one
-- is a believed reassurance.
--
-- Item 135 — the suspension type missing from its list — was a real gap in a
-- check that was not running either way. Fixing the list mattered; it did not
-- make the list do anything.
--
-- ── WHY NOTHING REPORTED IT ────────────────────────────
-- Three separate things could have, and none did:
--
--   * **pg_cron records the failure.** `cron.job_run_details` holds a 'failed'
--     row for every nightly run. Nothing reads that table.
--   * **The run log is empty, and emptiness is the designed alarm.**
--     `retention_runs` has exactly this contract and its comment spells it out
--     — "the absence of recent rows is itself the alarm" — and the admin
--     dashboard queries it and goes red. `email_reconcile_runs` was given the
--     same shape and **was never surfaced anywhere.** It appears in the
--     generated types and in no screen. The alarm existed; nobody wired the
--     bell.
--   * **0047's own verify checked the wrong thing.** Block A asserts
--     `count(*) from cron.job where jobname = 'email-reconcile'` — that the job
--     is SCHEDULED, not that it SUCCEEDS. Proving the guard is not proving the
--     function, which is already a recorded lesson about verify blocks here.
--
-- ── ⚠️ AND I CARRIED IT THROUGH TWICE WITHOUT LOOKING ──
-- 0067 and 0068 both replace this function, and both reproduce the broken body
-- verbatim because I copied it from pg_get_functiondef and changed one string
-- in a list. Reading a live definition is not the same as running it. Neither
-- migration's verify ever called it.
--
-- ── THE FIX ────────────────────────────────────────────
-- The DELETE moves below the INSERT, so the CTE chain is adjacent to its
-- consumer. Nothing else changes: the 90-day retention still happens on every
-- run, and it still happens in the nightly job rather than the monthly purge,
-- which is why it was put in this function in the first place.
--
-- Deleting after counting is also marginally more correct — the window is 24
-- hours, so rows older than 90 days cannot belong to it either way, but the
-- count is now taken before anything is removed rather than after.
-- ===========================================================================

begin;

do $$
declare
  v_code text;
begin
  if exists (select 1 from public.schema_migrations where version = '0069') then
    raise exception 'Migration 0069 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0068') then
    raise exception '0069 expects 0068 to be applied first.';
  end if;

  -- Comments stripped before matching, for the reason 0068's guard had to
  -- learn the hard way: pg_get_functiondef returns the prose too.
  v_code := regexp_replace(
    pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
    '--[^' || chr(10) || ']*', '', 'g');

  if v_code not like '%admin_suspension%' then
    raise exception '0069: the live run_email_reconcile does not list admin_suspension, so 0068 has not run. Apply it first.';
  end if;
end $$;

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
  -- A CTE attaches to the single statement that follows it. From 0047 until
  -- 0069 a DELETE sat here, so the INSERT ran with no `attempts` in scope and
  -- the function raised 42P01 every single time it was called — nightly, for
  -- as long as it existed, while appearing to be a working monitor.
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      -- ⚠️ THIS LIST MUST MATCH THE notify_email TRIGGER'S WHEN CLAUSE.
      -- They are two halves of one rule: the trigger decides whether an email
      -- is attempted, this decides whether a missing attempt is noticed. A
      -- type in the first and not the second is emailed and never checked.
      -- 'admin_suspension' was in that state from 0061 to 0068 (item 135).
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired')
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

  -- 90 days, because that is what the Privacy policy says: "A record that we
  -- sent you an email … kept for 90 days". Kept in this function rather than
  -- run_retention_purge so the promise is kept by the job that runs nightly,
  -- not monthly — that reasoning is unchanged, only the position is.
  --
  -- ⚠️ IT RUNS AFTER THE COUNT, AND MUST STAY THERE. Between the CTE and the
  -- insert it broke the whole function for the life of 0047.
  delete from public.email_sends where created_at < now() - interval '90 days';

  return v_row;
end $$;

comment on function public.run_email_reconcile(integer) is
  'Counts notifications that should have been emailed in the last p_hours and '
  'how many actually were. no_attempt > 0 means the trigger never reached the '
  'send function. ⚠️ Its type list must match the notify_email trigger''s WHEN '
  'clause (item 135), and nothing may sit between its CTE chain and the insert '
  'that reads it — a DELETE there made this function raise 42P01 on every run '
  'from 0047 to 0069, so it has never produced a row (item 136).';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0069', 'the_reconciler_has_never_run', '1b1b6aab2abbc09057e0b6026d0bdcf13b79ac1749ec9a17344ab70f7cedb440');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   -- (1) how long has it been failing, and how loudly?
--   select
--     (select applied_at from public.schema_migrations where version = '0047')
--       as reconciler_created,
--     (select count(*) from public.email_reconcile_runs)
--       as runs_ever_recorded,
--     (select schedule from cron.job where jobname = 'email-reconcile')
--       as scheduled;
--
--   Expect runs_ever_recorded = 0. That zero IS the evidence: the function
--   inserts its own run row as its last act, so a single successful call in
--   the table's life would have left one.
--
--   -- (2) the failures pg_cron has been recording all along
--   select start_time, status, return_message
--   from cron.job_run_details
--   where command like '%run_email_reconcile%'
--   order by start_time desc limit 10;
--
--   Expect status 'failed' and the 42P01 message on every row. This is the
--   table nothing reads.
--
--   -- (3) confirm it still raises, before changing it
--   select public.run_email_reconcile(1);
--
--   Expect ERROR 42P01 relation "attempts" does not exist. If this RETURNS a
--   row, stop — the live body is not what this migration assumes.
-- ===========================================================================
--
-- ── VERIFY — ⚠️ BY CALLING IT, WHICH IS WHAT NOBODY DID ─────────────────
--
--   0047's verify checked that the job was SCHEDULED. That is why this went
--   unnoticed: a scheduled job that raises every night looks exactly like a
--   scheduled job, from the only thing anyone was looking at.
--
--   -- (a) it returns a row
--   begin;
--     select * from public.run_email_reconcile(24);
--   rollback;
--
--   Expect one row: window_hours 24, and counts that are numbers rather than
--   an error. emailable may well be 0 — a quiet day is a legitimate answer,
--   and distinguishing it from a broken function is the entire point of the
--   run row existing.
--
--   -- (b) it leaves its trace. NOT rolled back: this is the first real run.
--   select public.run_email_reconcile(24);
--   select * from public.email_reconcile_runs order by id desc limit 1;
--
--   Expect exactly one row in a table that has been empty since 22 Sep.
--
--   -- (c) the retention it also performs still happens
--   select count(*) from public.email_sends
--   where created_at < now() - interval '90 days';
--
--   Expect 0 after (b). Nothing older than 90 days survives a run.
-- ===========================================================================

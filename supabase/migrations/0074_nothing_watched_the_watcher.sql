-- ===========================================================================
-- 0074_nothing_watched_the_watcher
--
-- A scheduled job that asks GitHub whether live-drift.yml is still running,
-- and records the answer where a dashboard tile can show it. Audit item 142.
--
-- ⚠️ Apply 0073 first.
--
-- ── THE FAULT ──────────────────────────────────────────
-- live-drift.yml says it runs hourly. Measured 2 Oct 2026 across every run
-- GitHub reports for it: 49 runs in 237 hours, median gap 5.1 hours, longest
-- 8.6. Scheduled workflows are best-effort and roughly four firings in five
-- are dropped. The claim and its enforcer disagreed for ten days and nothing
-- compared them.
--
-- A push trigger now carries the signal, so the cadence matters less. What is
-- still true is that NOTHING WATCHES WHETHER THE WORKFLOW RUNS AT ALL, and
-- **a gap in runs is indistinguishable from no drift** — both are silence, and
-- silence is what a healthy check emits. GitHub also disables a scheduled
-- workflow after 60 days of repository inactivity, so the monitor switches
-- itself off exactly when the project goes quiet, which is when a stale site
-- would go unnoticed longest.
--
-- ── WHY THIS CANNOT LIVE IN GITHUB ACTIONS ─────────────
-- A watcher inside Actions would be scheduled by the very scheduler it is
-- checking. It has to run on different infrastructure, and this project
-- already has some whose runs are logged and surfaced: pg_cron. Four jobs use
-- it — retention-purge, purge-selfies, expire-past-applications,
-- email-reconcile — and this is the fifth.
--
-- ── ⚠️ IT DOES NOT RAISE, AND MICKY ASKED THAT IT WOULD ─
-- The agreed shape was "raise if the newest run is older than 12 hours". It
-- records instead, and the 12-hour judgement lives in the dashboard tile.
-- Two reasons, both learned here:
--
--   1. A RAISE WOULD DESTROY ITS OWN EVIDENCE. The insert and the raise are
--      one transaction, so raising rolls back the row that proves what was
--      seen. The alarm would delete the record of why it fired.
--   2. A RAISE FROM pg_cron LANDS IN cron.job_run_details, which item 136
--      proved nothing reads: run_email_reconcile raised on every call for
--      nine days and eight consecutive failures sat there unread.
--
-- So the job's only duty is to record, and the tile judges. That is the same
-- division as the other four, and the reason this item exists at all: the tile
-- is the part that works, because it needs nothing to fire to be noticed.
--
-- ── THE THRESHOLD, AND WHERE IT CAME FROM ──────────────
-- 12 hours, derived from the sample rather than picked: the longest gap
-- observed across those 49 runs is 8.6 hours, so 12 gives about 1.4x headroom.
-- It would have produced zero false alarms across the ten days measured, and
-- catches a disabled workflow within half a day. It lives in ONE place —
-- driftWatchState() in admin/app/page.tsx — exactly as the other four tiles
-- hold their own ("It runs daily, so 2 days is a run has been missed").
--
-- ── WHY ONE JOB AND NOT TWO ────────────────────────────
-- pg_net is asynchronous and sends only AFTER COMMIT, so a run cannot read its
-- own answer however long it sleeps — the request has not left yet. Rather
-- than two cron jobs (one to ask, one to read), each run SETTLES THE PREVIOUS
-- ASK AND THEN ASKS AGAIN. One job, one table, and if the job stops, the tile
-- goes stale, which is the entire point.
--
-- The consequence, stated because it shows in the tile: the newest row is
-- always unanswered, and the freshest ANSWER is up to an hour old. The tile
-- reads the newest answered row for GitHub's lag and the newest row of all for
-- the watcher's own heartbeat.
--
-- ── IT MUST SAY WHICH SILENCE IT IS LOOKING AT ─────────
-- Unauthenticated GitHub API calls are limited to 60 an hour per IP, and the
-- egress IP is shared. One call an hour is far inside that, but a 403 is
-- possible, and if this repo is ever made private the answer becomes 404.
-- **"GitHub would not tell us" is not "the workflow has stopped."** So
-- http_status is recorded and the tile distinguishes them, which is item 140's
-- lesson: that tile reported "could not read" rather than "Never", and being
-- able to tell those apart is what made it diagnosable.
--
-- No token, deliberately. A GitHub PAT in the database would be a durable
-- secret stored to avoid a rate limit this job is nowhere near.
-- ===========================================================================
begin;

-- ── guards ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0073') then
    raise exception '0074: apply 0073 first.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '0074: pg_net is not installed, so nothing can call GitHub (push-setup.sql installs it).';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '0074: pg_cron is not installed, so the watcher has no scheduler.';
  end if;
  if to_regclass('net._http_response') is null then
    raise exception '0074: net._http_response is not reachable, so an answer could never be read back.';
  end if;
end $$;

-- ── the log ───────────────────────────────────────────────────────────────
create table public.drift_check_runs (
  id                uuid primary key default gen_random_uuid(),
  asked_at          timestamptz not null default now(),
  -- The pg_net request this row is waiting on. Settled by the NEXT run.
  request_id        bigint not null,
  answered_at       timestamptz,
  -- What GitHub said. NULL means no response row was found at all, which is a
  -- different fault from a response saying no.
  http_status       integer,
  -- created_at of live-drift.yml's newest run, whatever its conclusion. The
  -- question is "did it RUN", not "did it pass" — a failing live-drift is the
  -- alarm working.
  newest_run_at     timestamptz,
  newest_conclusion text,
  -- Why any of the above is null. Never null itself when something went wrong.
  note              text
);

-- ⚠️ THE ACCESS SHAPE IS COPIED FROM email_reconcile_runs ON PURPOSE.
-- 0071 (item 140) found three run-log tables with one contract and three
-- different access shapes, one of which — written by belt-and-braces instinct
-- with RLS and no policy AND the grant revoked — locked the console out of the
-- table whose emptiness was supposed to be the alarm. It failed silent, not
-- safe. This is the shape 0071 settled on, and the VERIFY below asserts the
-- two tables match rather than trusting that this comment stayed true.
alter table public.drift_check_runs enable row level security;

revoke all on public.drift_check_runs from anon;
grant select on public.drift_check_runs to authenticated;

create policy drift_check_select_admin on public.drift_check_runs
  for select to authenticated using (public.is_admin());

comment on table public.drift_check_runs is
  'One row an hour: did .github/workflows/live-drift.yml actually run? The newest row is always '
  'unanswered — pg_net sends after commit, so each run settles the previous ask and then asks again. '
  'http_status null means no response at all; a non-200 means GitHub would not tell us, which is NOT '
  'the same as the workflow having stopped. Judged at 12 hours by driftWatchState() in the admin '
  'dashboard, never here: a raise would roll back this row. 0074, audit item 142.';

-- ── the job ───────────────────────────────────────────────────────────────
create function public.run_drift_watch()
returns public.drift_check_runs
language plpgsql
security definer
-- Everything in the net schema is fully qualified below, so net is NOT on the
-- path: a SECURITY DEFINER function's path is the one place a shadowed name
-- would run as the owner.
set search_path = public, pg_temp
as $$
declare
  v_pending record;
  v_resp    record;
  v_row     public.drift_check_runs;
  v_req     bigint;
begin
  -- ── 1. settle whatever the last run asked ───────────────────────────────
  -- Every unanswered row, not just the newest: if a response never arrives the
  -- row stays open for ever, and one open row must not block the next.
  for v_pending in
    select id, request_id from public.drift_check_runs
     where answered_at is null
     order by asked_at
  loop
    select status_code, content into v_resp
      from net._http_response
     where id = v_pending.request_id;

    if not found then
      -- pg_net clears old responses, so a row that never got one stays open
      -- until it is plainly too old to be waiting on, then says so.
      update public.drift_check_runs
         set answered_at = case when asked_at < now() - interval '6 hours' then now() end,
             note        = case when asked_at < now() - interval '6 hours'
                                then 'no pg_net response ever arrived'
                                else 'still waiting on pg_net' end
       where id = v_pending.id;
      continue;
    end if;

    -- The parse is per-row and guarded: a 403 or a 404 returns HTML, and
    -- casting that to jsonb raises. A watcher that crashes on an unexpected
    -- body is a watcher that stops watching.
    begin
      if v_resp.status_code = 200 and v_resp.content is not null then
        update public.drift_check_runs
           set answered_at       = now(),
               http_status       = v_resp.status_code,
               newest_run_at     = (v_resp.content::jsonb -> 'workflow_runs' -> 0 ->> 'created_at')::timestamptz,
               newest_conclusion = (v_resp.content::jsonb -> 'workflow_runs' -> 0 ->> 'conclusion'),
               note              = case
                                     when (v_resp.content::jsonb -> 'workflow_runs' -> 0) is null
                                       then 'GitHub answered 200 but reported no runs at all'
                                   end
         where id = v_pending.id;
      else
        update public.drift_check_runs
           set answered_at = now(),
               http_status = v_resp.status_code,
               note        = 'GitHub would not answer (HTTP ' || coalesce(v_resp.status_code::text, 'none')
                             || ') — not evidence the workflow stopped'
         where id = v_pending.id;
      end if;
    exception when others then
      update public.drift_check_runs
         set answered_at = now(),
             http_status = v_resp.status_code,
             note        = 'could not read the response body: ' || sqlerrm
       where id = v_pending.id;
    end;
  end loop;

  -- ── 2. ask again ────────────────────────────────────────────────────────
  -- Public repo, so no token: see the header. The User-Agent is not optional —
  -- GitHub rejects requests without one.
  select net.http_get(
    url     => 'https://api.github.com/repos/mickeebee89/Guinea-pig/actions/workflows/live-drift.yml/runs',
    params  => jsonb_build_object('per_page', '1'),
    headers => jsonb_build_object(
                 'User-Agent', 'cavy-drift-watch',
                 'Accept',     'application/vnd.github+json'),
    timeout_milliseconds => 10000
  ) into v_req;

  insert into public.drift_check_runs (request_id) values (v_req)
  returning * into v_row;

  return v_row;
end
$$;

comment on function public.run_drift_watch() is
  'Settles the previous ask, then asks GitHub whether live-drift.yml has run. Records only — it never '
  'raises on a stale answer, because the raise and the insert are one transaction and the raise would '
  'roll back the evidence. 0074, audit item 142.';

-- Nobody calls this but the scheduler.
revoke all on function public.run_drift_watch() from public, anon, authenticated;

-- ── the schedule ──────────────────────────────────────────────────────────
-- Hourly at 35 past: clear of retention-purge (03:20), expire-past-applications
-- (03:40) and email-reconcile (04:10), and off the hour for the same reason
-- live-drift.yml is.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'drift-watch') then
    perform cron.unschedule('drift-watch');
  end if;
  perform cron.schedule('drift-watch', '35 * * * *', $cron$select public.run_drift_watch();$cron$);
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0074', 'nothing_watched_the_watcher', 'cfe785af5a57d779a5e289c2dc4bd2fd0e57ac9fc579f529cb40a58985bd0de9');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0073') = 1
--       as v_0073_applied,
--     (select count(*) from pg_extension where extname = 'pg_net') = 1
--       as pg_net_installed,
--     (select count(*) from pg_extension where extname = 'pg_cron') = 1
--       as pg_cron_installed,
--     to_regclass('net._http_response') is not null
--       as can_read_responses,
--     to_regclass('public.drift_check_runs') is null
--       as table_is_new,
--     (select count(*) from cron.job where jobname = 'drift-watch') = 0
--       as job_is_new;
--
--   Expect all six true. If table_is_new or job_is_new is false this migration
--   has already been applied, or something else has taken the name.
--
--   ⚠️ AND READ pg_net's OWN SIGNATURE BEFORE TRUSTING THE CALL ABOVE. The
--   function names its arguments (url, params, headers, timeout_milliseconds),
--   which only works if this pg_net has them. Reading the live definition
--   rather than assuming it is the standing rule here, and the one that was
--   walked past twice in a day:
--
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'net' and p.proname = 'http_get';
--
--   Expect args to include `timeout_milliseconds integer`. If it does not,
--   this pg_net predates that parameter: drop the `timeout_milliseconds =>`
--   line from run_drift_watch() before applying, and nothing else changes.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   ⚠️ READ THIS FIRST: BLOCK C COMMITS, DELIBERATELY. pg_net sends only after
--   commit, so a rolled-back call never leaves the database and would prove
--   nothing about GitHub, the URL, the headers or the parse. It writes two rows
--   to a log table and sends two unauthenticated GETs. That is the cost of
--   proving the chain, and 0069 is why it is paid: a function body that parses
--   is not a function body that works, and run_email_reconcile spent nine days
--   raising on every call while looking perfect.
--
--   -- (a) THE ACCESS SHAPE MATCHES ITS NEIGHBOUR, asserted rather than
--   --     described. This is item 140 in one query: three run-log tables, one
--   --     contract, three access shapes, and the odd one out locked the console
--   --     out of the alarm. Read from the live catalogue, not from the file.
--   do $v$
--   declare
--     r record;
--   begin
--     select
--       has_table_privilege('authenticated', 'public.drift_check_runs', 'select') as new_auth_select,
--       has_table_privilege('authenticated', 'public.email_reconcile_runs', 'select') as old_auth_select,
--       has_table_privilege('anon', 'public.drift_check_runs', 'select')          as new_anon_select,
--       (select relrowsecurity from pg_class where oid = 'public.drift_check_runs'::regclass) as new_rls,
--       (select count(*) from pg_policies
--         where schemaname = 'public' and tablename = 'drift_check_runs'
--           and cmd = 'SELECT' and 'authenticated' = any(roles)
--           and qual like '%is_admin%')                                          as new_admin_policies
--     into r;
--
--     raise exception
--       'new_auth_select=% old_auth_select=% new_anon_select=% new_rls=% new_admin_policies=%',
--       r.new_auth_select, r.old_auth_select, r.new_anon_select, r.new_rls, r.new_admin_policies;
--   end
--   $v$;
--
--   Expect new_auth_select t, old_auth_select t (THE TWO MUST AGREE — that is
--   the point of reading both), new_anon_select f, new_rls t,
--   new_admin_policies 1. The results come back in the exception because the
--   Supabase SQL editor does not surface NOTICE output.
--
--   -- (b) the job is scheduled, read from cron.job rather than assumed
--   select jobname, schedule, active, command from cron.job where jobname = 'drift-watch';
--
--   Expect one row: '35 * * * *', active true, calling public.run_drift_watch().
--
--   -- (c) THE CHAIN ACTUALLY WORKS. Two calls a minute or so apart, because
--   --     the first cannot settle itself — that asynchrony IS the design and
--   --     a verify that ignored it would pass while the parse was broken.
--
--   select id, asked_at, request_id from public.run_drift_watch();
--
--   -- ...wait about 30 seconds, then:
--
--   select id, asked_at, request_id from public.run_drift_watch();
--
--   -- ...then read what the second call settled:
--   select asked_at, answered_at, http_status, newest_run_at, newest_conclusion, note,
--          round(extract(epoch from (answered_at - newest_run_at)) / 3600.0, 1) as lag_hours
--     from public.drift_check_runs
--    order by asked_at;
--
--   Expect TWO rows. The FIRST must have answered_at set, http_status 200, a
--   newest_run_at within the last few hours, and note null. The SECOND is the
--   new ask and must still be open (answered_at null) — if it is already
--   settled, something is wrong with the pipelining, not right with it.
--
--   ⚠️ WHAT EACH FAILURE MEANS, so a red result is not read as drift:
--     http_status 403  — rate-limited or missing User-Agent. NOT the workflow.
--     http_status 404  — the repo went private, or the workflow file was
--                        renamed. The URL carries its filename.
--     http_status null — pg_net never produced a response; check the extension
--                        and that the database has egress.
--     note set, status 200 — GitHub answered but the body was not what the
--                        parse expected. Read net._http_response.content.
--
--   -- (d) the raise that is NOT there. Proves the decision above is real in
--   --     the body rather than only in this header: no code path raises on a
--   --     stale answer, so no alarm can roll back its own evidence.
--   select
--     pg_get_functiondef('public.run_drift_watch()'::regprocedure)
--       not like '%raise exception%'                      as never_raises,
--     pg_get_functiondef('public.run_drift_watch()'::regprocedure)
--       like '%http_get%'                                 as still_asks_github;
--
--   Expect both true.
-- ===========================================================================

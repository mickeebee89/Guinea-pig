-- ===========================================================================
-- 0005_retention_purge
--
-- Makes the retention promises actually happen, on a schedule, with a record
-- of every run.
--
-- WHY
--   Three tables now survive account deletion by design — session_consents and
--   moderation_actions since account-deletion-fix.sql, and reports since
--   migration 0004. Each was given a retention period in prose and nothing that
--   enforces the upper bound. account-deletion-fix.sql:379 has carried a
--   "RETENTION JOB — still to build" note since it was written.
--
--   That gap is why cavybeauty.com/delete-account cannot currently name a
--   period for reports: privacy-admin-access-clause.md:70 records the rule the
--   hard way — a stated retention period that nothing enforces is worse than
--   saying nothing. This file is what turns "for as long as it could still
--   matter" into a number.
--
--   The guards are the LOWER bound: guard_session_consents and
--   guard_moderation_actions refuse deletion before the period is up. This is
--   the UPPER bound. Neither is much use alone.
--
-- ── WHY NOT THE purge-selfies PATTERN ──────────────────────────────────────
--   purge-selfies runs pg_cron -> pg_net -> an edge function -> a vault secret
--   -> a matching CRON_SECRET on the function. All of that exists for one
--   reason: it deletes STORAGE OBJECTS, which SQL cannot do.
--
--   Retention is row deletes and a column scrub. Pure SQL. So cron calls it
--   directly and the entire secret-handling chain disappears — no pg_net, no
--   vault entry, no edge function, no secret to keep in sync in two places and
--   no placeholder to forget.
--
--   pg_cron is already installed and purge-verification-selfies is scheduled
--   and active (confirmed 8 Aug 2026), so no extension setup is needed here.
--
-- ── WHAT RUNS ──────────────────────────────────────────────────────────────
--   session_consents   scrub ip_address + device_info   agreed_at  + 12 months
--   session_consents   delete                           agreed_at  + 6 years
--   moderation_actions delete                           created_at + 6 years
--   reports            delete                           created_at + 6 years
--
--   Six years is the Limitation Act 1980 period for contract claims in England
--   & Wales. Twelve months for ip/device because those prove the ACT of
--   consenting, which matters early; six-year-old IP data proves little and is
--   not proportionate to keep.
--
-- ── THE SANITY BRAKE, AND WHAT IT IS NOT ───────────────────────────────────
--   Each delete refuses if it would remove EVERY row of a non-empty table. That
--   is not a tunable threshold — it is an assertion that the date boundary is
--   filtering something. It catches the whole class of bug that makes this job
--   dangerous: an interval that evaluates to zero, a mistyped column, a
--   comparison the wrong way round.
--
--   It cannot fire spuriously on an app launched in 2026, because no row is six
--   years old. When that stops being true — if a table ever legitimately
--   contains nothing but expired rows — the run will refuse and say so in
--   retention_runs rather than deleting. Deliberate: refusing and reporting is
--   the right failure for a job whose mistakes are unrecoverable.
--
--   ⚠ IT IS NOT A SUBSTITUTE FOR THE GUARDS. session_consents and
--   moderation_actions are additionally protected by triggers that refuse early
--   deletion, so a bug in this file cannot destroy a recent record on those
--   two. reports had no such guard when this file was written; migration 0006
--   adds one, which is what makes the protection symmetric across all three.
--
--   Apply 0006 as well. Between 0005 and 0006 this brake and the dry run are
--   the only thing standing between a bad predicate and every live report.
--
-- ── HOW ANYONE FINDS OUT IT STOPPED ────────────────────────────────────────
--   The moment this ships, the delete-account page can claim deletion happens.
--   A job that silently stops then makes the policy false, and nothing would
--   notice — the same shape as teardown.mjs exiting 0 on a partial failure.
--
--   So every run writes to public.retention_runs, including failures and dry
--   runs. FOLLOW-UP: surface "last successful run" on the admin dashboard, red
--   past 40 days. Nobody queries a table on a hunch; someone does look at the
--   dashboard. Until that tile exists, this job is only as reliable as someone
--   remembering to check.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0005') then
    raise exception 'Migration 0005 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The record of every run.
--
--    Failures are rows here too, not just an absent row. "It ran and three of
--    four operations failed" and "it never ran" are different problems and must
--    not look the same.
-- ---------------------------------------------------------------------------
create table if not exists public.retention_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  dry_run     boolean     not null,
  ok          boolean     not null,
  duration_ms integer,
  results     jsonb       not null
);

comment on table public.retention_runs is
  'One row per run of run_retention_purge(), including dry runs and failures. '
  'The absence of recent rows is itself the alarm: it means the scheduled job '
  'has stopped, and the retention promises on the delete-account page are no '
  'longer being kept.';

create index if not exists retention_runs_ran_at_idx
  on public.retention_runs (ran_at desc);

alter table public.retention_runs enable row level security;

-- Admins read it from the console. Nobody writes it through the API — the
-- function runs as its definer and bypasses RLS.
drop policy if exists retention_runs_read_admin on public.retention_runs;
create policy retention_runs_read_admin
  on public.retention_runs
  as permissive for select to authenticated
  using (is_admin());

revoke all on public.retention_runs from anon;

-- ---------------------------------------------------------------------------
-- 2. The job itself.
--
--    Every operation runs in its own subtransaction. One failing must not
--    cancel the other three, and must not pass silently either — it is recorded
--    against its own key and the run is marked not ok.
--
--    p_dry_run counts without changing anything and still writes a
--    retention_runs row, so "what would this delete" is answerable at any time
--    and leaves a trace that it was asked.
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_purge(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_started  timestamptz := clock_timestamp();
  v_results  jsonb := '{}'::jsonb;
  v_ok       boolean := true;
  r          record;
  n          bigint;
  v_total    bigint;
begin
  -- ── 12-month scrub of the act-of-consent fields ──────────────────────────
  -- Only ip_address and device_info change. guard_session_consents rejects an
  -- update where anything else differs, so this must stay exactly this narrow.
  begin
    if p_dry_run then
      select count(*) into n
        from public.session_consents
       where agreed_at < now() - interval '12 months'
         and (ip_address is not null or device_info is not null);
    else
      update public.session_consents
         set ip_address = null, device_info = null
       where agreed_at < now() - interval '12 months'
         and (ip_address is not null or device_info is not null);
      get diagnostics n = row_count;
    end if;
    v_results := v_results || jsonb_build_object('session_consents_scrubbed', n);
  exception when others then
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'session_consents_scrubbed_error', sqlerrm, 'sqlstate', sqlstate);
  end;

  -- ── 6-year deletions ─────────────────────────────────────────────────────
  -- Driven off a list rather than three near-identical blocks: the boundaries
  -- are the only thing that differs, so they are the only thing written out.
  for r in
    select * from (values
      ('session_consents',   'agreed_at',  '6 years'),
      ('moderation_actions', 'created_at', '6 years'),
      ('reports',            'created_at', '6 years')
    ) as t(tbl, col, keep)
  loop
    begin
      execute format('select count(*) from public.%I where %I < now() - interval %L',
                     r.tbl, r.col, r.keep) into n;
      execute format('select count(*) from public.%I', r.tbl) into v_total;

      if n > 0 and n = v_total then
        -- The boundary matched everything. On a database whose oldest row is
        -- from 2026 that cannot be right, so refuse and say so rather than
        -- carry out an unrecoverable delete on a suspect predicate.
        v_ok := false;
        v_results := v_results || jsonb_build_object(
          r.tbl || '_deleted', 0,
          r.tbl || '_refused',
          format('would delete all %s row(s) — boundary is not filtering, refused', v_total));
      elsif n = 0 then
        v_results := v_results || jsonb_build_object(r.tbl || '_deleted', 0);
      elsif p_dry_run then
        v_results := v_results || jsonb_build_object(r.tbl || '_would_delete', n);
      else
        execute format('delete from public.%I where %I < now() - interval %L',
                       r.tbl, r.col, r.keep);
        get diagnostics n = row_count;
        v_results := v_results || jsonb_build_object(r.tbl || '_deleted', n);
      end if;
    exception when others then
      v_ok := false;
      v_results := v_results || jsonb_build_object(
        r.tbl || '_error', sqlerrm, r.tbl || '_sqlstate', sqlstate);
    end;
  end loop;

  insert into public.retention_runs (dry_run, ok, duration_ms, results)
  values (
    p_dry_run,
    v_ok,
    (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
    v_results);

  return jsonb_build_object('ok', v_ok, 'dry_run', p_dry_run) || v_results;
end;
$function$;

revoke all on function public.run_retention_purge(boolean) from public, anon, authenticated;
-- postgres and service_role only. cron runs it as the user that scheduled it;
-- no client has any business calling it.

comment on function public.run_retention_purge(boolean) is
  'Enforces the upper bound of the retention periods stated on '
  'cavybeauty.com/delete-account. Scheduled monthly as retention-purge. '
  'Pass true for a dry run. Every call is recorded in public.retention_runs.';

-- ---------------------------------------------------------------------------
-- 3. Schedule it.
--
--    Monthly. The boundaries are 12 months and 6 years, so a daily run would
--    do the same work 30 times over for no gain.
--
--    03:20 UTC on the 1st — twenty past three, offset from
--    purge-verification-selfies at 03:15 so the two never overlap, and outside
--    UK peak either side of BST.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'retention-purge') then
    perform cron.unschedule('retention-purge');
  end if;
  perform cron.schedule('retention-purge', '20 3 1 * *',
                        'select public.run_retention_purge();');
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0005', 'retention_purge', 'ad8f47b262c091d114dd2a9132889bb992fa005e3ccea37085f28b0198396bb0');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- Written for the Supabase SQL editor: one paste per block, each ending in
-- exactly one select. See 0000 for why.
--
-- RUN BLOCK A FIRST, BEFORE THE MONTHLY JOB EVER FIRES. It is the only chance
-- to see what the boundaries match while nothing has been deleted.
--
-- ── BLOCK A — dry run. Changes nothing. ────────────────────────────────────
--
--   select public.run_retention_purge(true);
--
--   On a database whose oldest row is from 2026, expect every *_would_delete
--   to be absent and every *_deleted to be 0 — nothing is six years old yet.
--   session_consents_scrubbed may be non-zero once consents pass 12 months.
--
--   Any key ending _refused means the sanity brake fired: the boundary matched
--   every row in that table. On this data that is a bug in the predicate, not
--   a real expiry. Investigate before letting the schedule run.
--
--
-- ── BLOCK B — the job is scheduled ─────────────────────────────────────────
--
--   select jobid, jobname, schedule, active
--   from cron.job
--   where jobname in ('retention-purge', 'purge-verification-selfies')
--   order by jobname;
--
--   Expect two rows, both active. retention-purge at '20 3 1 * *'.
--
--
-- ── BLOCK C — is the OTHER job actually succeeding? ────────────────────────
-- Scheduled and active is not the same as working. purge-verification-selfies
-- has been active since well before this migration; if it has been failing
-- every night, the 90-day selfie retention has never happened and nobody would
-- know. This is the query that answers it, and it is worth running once.
--
--   select j.jobname,
--          d.status,
--          d.start_time,
--          left(coalesce(d.return_message, ''), 120) as message
--   from cron.job_run_details d
--   join cron.job j on j.jobid = d.jobid
--   order by d.start_time desc
--   limit 20;
--
--   Expect status 'succeeded'. A run of 'failed' rows against
--   purge-verification-selfies is a live problem in its own right — the shared
--   secret or the edge function, not this migration.
--
--
-- ── BLOCK D — what the runs recorded ───────────────────────────────────────
--
--   select ran_at, dry_run, ok, duration_ms, results
--   from public.retention_runs
--   order by ran_at desc
--   limit 10;
--
--   The dry run from block A should be the first row, with dry_run = true.
--
--
-- ── BLOCK E — the brake actually stops a bad predicate ─────────────────────
-- Proves the safety net works rather than assuming it. Uses a deliberately
-- broken boundary (interval '0 years', which matches everything) against a
-- copy of the real logic, and rolls back. Paste as ONE run.
--
--   create or replace function pg_temp.verify_brake()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare n bigint; v_total bigint; v_out text;
--   begin
--     execute 'select count(*) from public.reports where created_at < now() - interval ''0 years''' into n;
--     execute 'select count(*) from public.reports' into v_total;
--     if v_total = 0 then
--       v_out := 'inconclusive — reports is empty, nothing for the brake to catch';
--     elsif n > 0 and n = v_total then
--       v_out := 'brake would fire — matched all ' || v_total || ' row(s), delete refused';
--     else
--       v_out := 'PROBLEM: a zero-length boundary matched ' || n || ' of ' || v_total
--             || ' — the brake would NOT have fired';
--     end if;
--     check_name := 'sanity brake catches a boundary that filters nothing';
--     outcome := v_out;
--     return next;
--   end $f$;
--
--   select * from pg_temp.verify_brake();
--
--   This only reads. It reproduces the brake's condition rather than calling
--   run_retention_purge with a bad interval, because there is no way to pass
--   one in — which is itself the point.
--
--
-- ── BLOCK F — prove it actually deletes something ──────────────────────────
-- RUN THIS AFTER 0006. Block A's dry run returned zero for every operation,
-- which confirms the function executes and the predicates parse — and nothing
-- else. No row was old enough to be selected, so none of the delete logic ran.
-- A check that cannot fail is not evidence.
--
-- This back-dates real data inside a rollback so the purge has something to
-- take. Paste as ONE run. Passed 8 Aug 2026.
--
--   create or replace function pg_temp.verify_purge_actually_deletes()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_report uuid; v_consent uuid; v_doc uuid;
--     v_res jsonb; v_gone boolean; v_scrubbed boolean;
--     v_delete text := 'not reached';
--     v_scrub  text := 'not reached';
--   begin
--     begin
--       -- Back-date a real report past 6 years. UPDATE is allowed:
--       -- guard_reports governs DELETE only, which is the distinction 0006
--       -- makes so the moderation queue keeps working.
--       select id into v_report from public.reports order by created_at desc limit 1;
--       if v_report is null then
--         v_delete := 'skipped — no reports to back-date';
--       else
--         update public.reports set created_at = now() - interval '7 years' where id = v_report;
--       end if;
--
--       -- A synthetic consent old enough to scrub. A real one cannot be
--       -- back-dated: guard_session_consents refuses any update inside 12
--       -- months. session_id and user_id carry no FK (account-deletion-fix
--       -- severed them), so random ids are valid and avoid colliding with the
--       -- unique constraint on a real row.
--       select id into v_doc from public.consent_documents limit 1;
--       if v_doc is not null then
--         insert into public.session_consents
--           (session_id, user_id, consent_document_id, consent_version, content_hash,
--            acknowledgements, agreed_at, ip_address, device_info)
--         values (gen_random_uuid(), gen_random_uuid(), v_doc, 1, 'purge-test',
--                 '[]'::jsonb, now() - interval '13 months',
--                 '203.0.113.1'::inet, '{"t":"purge-test"}'::jsonb)
--         returning id into v_consent;
--       end if;
--
--       v_res := public.run_retention_purge(false);
--
--       if v_report is not null then
--         select not exists(select 1 from public.reports where id = v_report) into v_gone;
--         v_delete := case when v_gone
--           then 'deleted — purge and guard agree on the boundary'
--           else 'PROBLEM: a 7-year-old report survived the purge' end;
--       end if;
--
--       if v_consent is not null then
--         select (ip_address is null and device_info is null) into v_scrubbed
--           from public.session_consents where id = v_consent;
--         v_scrub := case when v_scrubbed
--           then 'ip and device nulled on a 13-month-old consent — correct'
--           else 'PROBLEM: the scrub left them populated' end;
--       else
--         v_scrub := 'skipped — no consent_documents row';
--       end if;
--
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_delete := 'could not test — ' || left(sqlerrm, 100);
--       end if;
--     end;
--
--     check_name := 'purge deletes an over-age report'; outcome := v_delete; return next;
--     check_name := '12-month ip/device scrub';         outcome := v_scrub;  return next;
--   end $f$;
--
--   select * from pg_temp.verify_purge_actually_deletes();
--
-- Everything rolls back, including the retention_runs row the purge writes.
--
-- The first check is the valuable one: it exercises 0005 and 0006 against each
-- other at the only boundary they share, which is the one place they could
-- disagree. moderation_actions is not tested separately because it goes through
-- the identical loop as reports — same format() path, only the table name
-- differs.
--
--
-- ── STILL TO DO, AND THE JOB IS ONLY HALF-USEFUL WITHOUT IT ────────────────
--   * Admin dashboard tile: last successful run from public.retention_runs,
--     red past 40 days. Until it exists, a job that stops is invisible.
--   * Tighten cavybeauty.com/delete-account: "for as long as it could still
--     matter to a safety decision or a legal claim" becomes the specific
--     period once this has run successfully at least once. That sentence in
--     site/content/legal.ts was written to be replaced.
-- ===========================================================================

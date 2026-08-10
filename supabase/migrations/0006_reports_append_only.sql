-- ===========================================================================
-- 0006_reports_append_only
--
-- Stops anything deleting a report before its retention period is up.
--
-- WHY
--   Migration 0004 made reports survive account deletion. Migration 0005 gave
--   them an upper bound — deleted at six years, by a scheduled job. This is the
--   lower bound, and without it the pair is lopsided.
--
--   session_consents and moderation_actions each have a guard that refuses
--   early deletion, and account-deletion-fix.sql:382 states plainly what those
--   guards are for: "a job that over-reaches fails safely rather than deleting
--   something it should not". reports had no such guard, which left 0005's
--   purge as the only thing between a bad date predicate and every live
--   complaint on the system — on the one table whose whole purpose is to
--   outlive the person it is about.
--
--   0005 carries a sanity brake that refuses to delete every row of a table.
--   That catches the worst case. It does not catch a predicate that deletes
--   most of them, and it does nothing about a delete issued by anything other
--   than the purge job.
--
-- ── DIFFERENT FROM moderation_actions ON PURPOSE ───────────────────────────
--   guard_moderation_actions refuses ALL updates — those records are finished
--   the moment they are written.
--
--   Reports are not. They have a workflow: admin/app/reports/page.tsx writes
--   status, resolved_at and resolution when a report is dismissed or resolved,
--   and delete_account_data nulls reviewed_by when the reviewing admin deletes
--   their own account. A blanket update ban would break the moderation queue
--   outright — the surface this whole sequence exists to protect.
--
--   So this guard governs DELETE only. Reports stay editable and become
--   deletable at six years, matching the boundary 0005 purges on.
--
-- ── WHAT THIS BREAKS, AND WHY THAT IS THE POINT ────────────────────────────
--   seed/teardown.mjs deleted reports in two places. Those deletes are removed
--   in the same change as this file.
--
--   Checked before deciding rather than assumed: seed/seed.mjs creates NO
--   reports at all. So teardown was never clearing seeded data — it was
--   clearing reports filed BY HAND during testing, which is exactly the
--   category of deletion this guard exists to refuse. Teardown is a convenience
--   tool; "delete the evidence because it is inconvenient" is the behaviour
--   0004 was written to prevent, and a developer script is not an exception to
--   that.
--
--   After 0004 those reports do not accumulate as junk anyway: teardown deletes
--   the users, so reporter_id and reported_id are nulled by the SET NULL
--   cascade and the row survives showing "deleted account" in the queue.
--   Dismiss it and it leaves the open filter. That is the correct end state —
--   a record that something was reported, with nobody's data attached.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0006') then
    raise exception 'Migration 0006 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The guard.
--
--    The comparison mirrors guard_moderation_actions exactly, so the two
--    cannot drift apart on the boundary. It also lines up with 0005, which
--    deletes where created_at < now() - interval '6 years': a row sitting
--    exactly on the boundary is not selected by the purge and not refused by
--    the guard, so there is no row the two disagree about.
-- ---------------------------------------------------------------------------
create or replace function public.guard_reports()
returns trigger language plpgsql
set search_path to 'public' as $function$
begin
  if old.created_at > now() - interval '6 years' then
    raise exception
      'reports is append-only until its 6-year retention expires (created_at %)', old.created_at
      using errcode = '42501';
  end if;
  return old;
end;
$function$;

revoke all on function public.guard_reports() from public, anon;

drop trigger if exists trg_lock_reports on public.reports;
create trigger trg_lock_reports
  before delete on public.reports
  for each row execute function public.guard_reports();

comment on function public.guard_reports() is
  'Refuses deletion of a report before 6 years from created_at. DELETE only — '
  'reports have a moderation workflow that must keep writing status, '
  'resolved_at, resolution and reviewed_by, unlike moderation_actions which is '
  'immutable once written. The matching purge is run_retention_purge (0005).';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0006', 'reports_append_only', '2eeecc7b6e875ae47a1bdfc69c1406ba1b66c228f15b02f403c90c2ac8ba7a9d');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- Written for the Supabase SQL editor: one paste, ending in one select.
--
-- ── BLOCK A — the guard refuses, the workflow still works ──────────────────
-- Paste from `create or replace` to the final select as ONE run. Everything
-- rolls back.
--
--   create or replace function pg_temp.verify_0006()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_id uuid;
--     v_delete text := 'not reached';
--     v_update text := 'not reached';
--   begin
--     select id into v_id from public.reports order by created_at desc limit 1;
--     if v_id is null then
--       check_name := 'no reports to test with'; outcome := 'skipped'; return next; return;
--     end if;
--
--     -- A recent report must not be deletable.
--     begin
--       delete from public.reports where id = v_id;
--       v_delete := 'PROBLEM: the delete was accepted';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm = 'ROLLBACK_ME' then null;
--       elsif sqlstate = '42501' then
--         v_delete := 'refused by the guard — correct';
--       else
--         v_delete := 'INCONCLUSIVE — refused by ' || sqlstate || ', not the guard: '
--                  || left(sqlerrm, 70);
--       end if;
--     end;
--
--     -- …but the moderation workflow must still be able to close it.
--     begin
--       update public.reports
--          set status = 'dismissed', resolved_at = now()
--        where id = v_id;
--       v_update := 'accepted — the moderation queue still works';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_update := 'PROBLEM: the guard is blocking the workflow — ' || left(sqlerrm, 70);
--       end if;
--     end;
--
--     check_name := 'recent report cannot be deleted'; outcome := v_delete; return next;
--     check_name := 'report can still be resolved';    outcome := v_update; return next;
--   end $f$;
--
--   select * from pg_temp.verify_0006();
--
--   Expect both rows clean. The second matters as much as the first: a guard
--   that also froze the moderation workflow would be a worse bug than the one
--   this fixes.
--
--
-- ── BLOCK B — 0005 and 0006 agree about the boundary ───────────────────────
--
--   select count(*) filter (where created_at < now() - interval '6 years') as purge_would_take,
--          count(*) filter (where created_at > now() - interval '6 years') as guard_would_refuse,
--          count(*) as total
--   from public.reports;
--
--   purge_would_take + guard_would_refuse must equal total. Any shortfall is a
--   row on the exact boundary, which neither touches — harmless, but worth
--   knowing it is the reason rather than wondering.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
--
-- Apply, verify, THEN run this. It compares every file against
-- public.schema_migrations and reports PENDING, DRIFTED, ORPHAN or SUPERSEDED.
--
-- It is the last step because it is the one that catches what the verify
-- blocks above cannot: a migration that was written and committed but never
-- actually run. That happened to 0009 -- it existed only as a file for a day,
-- and it was noticed by eye rather than by anything checking. A check that
-- depends on someone noticing is not a check.
--
-- Needs SUPABASE_SERVICE_ROLE_KEY in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
-- ===========================================================================

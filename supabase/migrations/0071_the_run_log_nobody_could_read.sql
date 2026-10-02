-- ===========================================================================
-- 0071_the_run_log_nobody_could_read
--
-- Lets the admin console read session_expiry_runs, which 0067 locked so
-- thoroughly that the tile built to watch it could not. Audit item 140.
--
-- ⚠️ Apply 0070 first.
--
-- ── THE FAULT ──────────────────────────────────────────
-- 0067 created the table like this:
--
--     alter table public.session_expiry_runs enable row level security;
--     revoke all on public.session_expiry_runs from anon, authenticated;
--
-- Row level security with NO POLICY denies everything, and the revoke removes
-- the table grant as well — so the console does not even reach RLS. Two
-- independent locks, neither of which has a key.
--
-- The table's own comment says "the absence of recent rows is itself the alarm",
-- which only means something if somebody can see the rows.
--
-- ── ⚠️ THE TWO NEIGHBOURS WERE BOTH DONE DIFFERENTLY ───
-- There are three run-log tables with the same contract and three different
-- access shapes:
--
--   retention_runs (0005)        RLS on, policy using (is_admin()),
--                                revoked from anon only
--   email_reconcile_runs (0047)  RLS on, policy for select to authenticated
--                                using (is_admin()), no revoke
--   session_expiry_runs (0067)   RLS on, NO POLICY, revoked from anon AND
--                                authenticated
--
-- Three tables, one purpose, three answers. I wrote the third without reading
-- the first two, and locked it twice over by belt-and-braces instinct — which
-- is the opposite of belt and braces, because nothing about it fails safe. It
-- fails *silent*: the job kept writing rows nobody could read.
--
-- This matches the shape of email_reconcile_runs, which is the closest
-- neighbour in both age and purpose.
--
-- ── WHY THE GRANT AND THE POLICY ARE BOTH NEEDED ───────
-- The grant decides whether the role may touch the table at all; the policy
-- decides which rows it sees. 0067 removed the first, so adding only a policy
-- would change nothing and this migration would look applied while the tile
-- stayed red. Both, or neither is any use.
--
-- anon stays revoked. Nothing about a scheduled job belongs on the public web.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0071') then
    raise exception 'Migration 0071 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0070') then
    raise exception '0071 expects 0070 to be applied first.';
  end if;
  if to_regclass('public.session_expiry_runs') is null then
    raise exception '0071: session_expiry_runs does not exist. 0067 has not run.';
  end if;
end $$;

-- The table grant, which 0067 took away. Without this the policy below is
-- never consulted.
grant select on public.session_expiry_runs to authenticated;

-- And the row rule, matching email_reconcile_select_admin exactly.
drop policy if exists session_expiry_select_admin on public.session_expiry_runs;
create policy session_expiry_select_admin on public.session_expiry_runs
  for select to authenticated using (public.is_admin());

comment on table public.session_expiry_runs is
  'One row per run of expire_past_applications(), including the silent backfill. '
  'The absence of recent rows is itself the alarm: it means the daily job has '
  'stopped and stale applications are accumulating in stylists'' lists again. '
  'Readable by admins only (0071 — 0067 created it readable by nobody, so the '
  'alarm it was built to raise could not be seen). 0067, audit items 134 and 140.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0071', 'the_run_log_nobody_could_read', 'a7ab5aa581b2d47377115064b4c0cd4d64320dc84bc54f2aa8dedac9e6f7b0c4');

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0070') = 1
--       as v_0070_applied,
--     has_table_privilege('authenticated', 'public.session_expiry_runs', 'select')
--       as authenticated_can_select_now,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'session_expiry_runs')
--       as policies_now,
--     (select count(*) from public.session_expiry_runs) as rows_in_the_table;
--
--   Expect true, FALSE, 0, and a non-zero row count — a table with rows in it
--   that the console cannot read, which is the whole of this item.
-- ===========================================================================
--
-- ── VERIFY — as an admin and as a member, rolled back ───────────────────
--
--   Results come back in the exception: the Supabase SQL editor does not
--   surface NOTICE output.
--
--   begin;
--   do $v$
--   declare
--     v_admin uuid; v_member uuid; v_as_admin int; v_as_member int; v_report text;
--   begin
--     select user_id into v_admin from public.admins limit 1;
--     select u.id into v_member from public.users u
--      where not exists (select 1 from public.admins a where a.user_id = u.id)
--      limit 1;
--     if v_admin is null or v_member is null then
--       raise exception 'ROLLED BACK. Need one admin and one non-admin user.';
--     end if;
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     if not public.is_admin() then
--       raise exception 'ROLLED BACK, TESTED NOTHING. The admin claim did not carry.';
--     end if;
--     select count(*) into v_as_admin from public.session_expiry_runs;
--     execute 'reset role';
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     if public.is_admin() then
--       raise exception 'ROLLED BACK, TESTED NOTHING. The non-admin pick is an admin.';
--     end if;
--     select count(*) into v_as_member from public.session_expiry_runs;
--     execute 'reset role';
--
--     v_report := 'rows as admin=' || v_as_admin || ' | rows as member=' || v_as_member;
--     raise exception 'ROLLED BACK ON PURPOSE. %', v_report;
--   end $v$;
--   rollback;
--
--   Expect the admin to see every row and the member to see 0 — not an error,
--   zero: RLS filters rows rather than refusing the query, so a member gets an
--   empty list and learns nothing about what is in there.
-- ===========================================================================

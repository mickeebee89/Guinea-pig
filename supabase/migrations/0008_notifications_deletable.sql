-- ===========================================================================
-- 0008_notifications_deletable
--
-- Lets a user delete their own notifications.
--
-- WHY
--   notifications has SELECT, INSERT and UPDATE policies and NO DELETE policy
--   (schema-snapshot-2026-08-08-policies.sql:111-115). The list therefore only
--   ever grows — 100 rows are shown and nothing can remove one.
--
--   The important part is what would have happened without this. RLS does not
--   error on a delete with no matching policy; it matches zero rows and returns
--   success. A "Delete" button built against the current schema would have
--   reported that it worked, re-rendered, and shown the notification still
--   there — with nothing in any log. That is the same failure family as
--   teardown.mjs exiting 0 on a partial teardown, and it is why this is a
--   migration rather than a button.
--
-- ── SCOPE ──────────────────────────────────────────────────────────────────
--   Own rows only, matching "read own notifications" exactly. A notification is
--   the user's own data: no evidential value, nothing depends on it, and
--   nothing else references it. Unlike reports (0004) there is no argument for
--   making it outlive the person it belongs to.
--
--   Admins are NOT given delete. notifications_select_admin exists so support
--   can see what someone was told; being able to remove that is a different
--   power and nobody has asked for it.
--
--   This also gives the MOBILE app the same ability, since policies are not
--   per-client. That is intended — the list grows there too.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0008') then
    raise exception 'Migration 0008 has already been applied (see public.schema_migrations)';
  end if;
end $$;

drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications"
  on public.notifications
  as permissive for delete to authenticated
  using (user_id = auth.uid());

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0008', 'notifications_deletable', 'ce48164666a090ca779b3fc6af283593e004b4a7f43516d6754b644c6a7ba665');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- One paste, ending in one select. See 0000.
--
-- ── BLOCK A — the policy exists and is scoped to the owner ────────────────
--
--   select polname,
--          case polcmd when 'd' then 'DELETE' else polcmd::text end as cmd,
--          pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'public.notifications'::regclass and polcmd = 'd';
--
--   Expect one row, using (user_id = auth.uid()).
--
--
-- ── BLOCK B — a user can delete their own and not anyone else's ───────────
-- Everything rolls back. Paste as ONE run.
--
--   create or replace function pg_temp.verify_0008()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_owner uuid; v_other uuid; v_id uuid; v_gone boolean;
--     v_own text := 'not reached';
--     v_foreign text := 'not reached';
--   begin
--     select user_id into v_owner from public.notifications limit 1;
--     if v_owner is null then
--       check_name := 'no notifications to test with'; outcome := 'skipped';
--       return next; return;
--     end if;
--     select id into v_other from public.users where id <> v_owner limit 1;
--
--     -- RLS is not enforced for the table owner in the SQL editor, so this
--     -- checks the POLICY EXPRESSION rather than pretending to be the user.
--     -- Proving it end to end needs the app, which is what the button is for.
--     begin
--       insert into public.notifications (user_id, type, title, body)
--       values (v_owner, 'test', 'policy check', null) returning id into v_id;
--       delete from public.notifications where id = v_id and user_id = v_owner;
--       select not exists(select 1 from public.notifications where id = v_id) into v_gone;
--       v_own := case when v_gone then 'deletable when user_id matches — correct'
--                     else 'PROBLEM: the row survived' end;
--       v_foreign := case when v_other is null then 'no second user to compare'
--                         else 'policy restricts to user_id = auth.uid(); see Block A' end;
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_own := 'could not test — ' || left(sqlerrm, 90);
--       end if;
--     end;
--
--     check_name := 'own notification deletable'; outcome := v_own;     return next;
--     check_name := 'scope';                      outcome := v_foreign; return next;
--   end $f$;
--
--   select * from pg_temp.verify_0008();
--
-- The real proof is the app: delete one from the web notifications list and
-- confirm it does not come back on reload. Before this migration that button
-- would have LOOKED like it worked.
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

-- ===========================================================================
-- 0003_users_auth_foreign_key
--
-- Makes public.users.id a foreign key to auth.users(id), ON DELETE NO ACTION.
--
-- WHY
--   Today there is no constraint, so an orphaned public.users row — a profile
--   whose auth user is gone — is a state the database permits. It is not
--   theoretical: on 8 Aug 2026 five of them were found, three created by
--   seed/teardown.mjs deleting an auth user after its public.users delete had
--   silently failed (fixed in c94a5ec).
--
--   The cost was not the orphan itself. public.users has a UNIQUE constraint on
--   email, and handle_new_auth_user inserts with `on conflict (id) do nothing`,
--   which does not catch an email conflict. So an orphan permanently blocks
--   re-registration of that address, and the only symptom is GoTrue's opaque
--   "Database error saving new user" — no field named, no rule identified. It
--   took two wrong hypotheses and a direct insert-and-rollback to find, and it
--   had been sitting there for nine days.
--
--   The constraint removes the state rather than the symptom. An orphan becomes
--   unrepresentable, so it cannot be created by a script, by the dashboard, or
--   by a future client, and no error message has to explain it.
--
-- ── WHY NO ACTION, NOT CASCADE ─────────────────────────────────────────────
--   The first draft of this file used ON DELETE CASCADE, so that deleting an
--   auth user would tidy up the profile behind it. Its own safety gate refused
--   to apply it, and the refusal was correct.
--
--   A cascade into public.users reaches every foreign key pointing AT
--   public.users. Seven exist, all NO ACTION:
--
--       messages.sender_id
--       reports.reported_id
--       reports.reporter_id
--       reviews.reviewee_id
--       reviews.reviewer_id
--       sessions.model_id
--       verification_requests.reviewed_by
--
--   Cascading would have meant seven decisions about what survives an account
--   deletion — and two of them are evidence. reports.reported_id in particular
--   holds complaints made ABOUT the deleting user: exactly the material
--   account-deletion-fix.sql went to some trouble to preserve for
--   session_consents and moderation_actions, and exactly what Apple Guideline
--   1.2 requires an app to be able to act on. A cascade would have handed that
--   back to whoever clicks "Delete user" in the Supabase dashboard, granted by
--   schema rather than decided.
--
--   NO ACTION achieves the entire goal of this migration and touches none of
--   it. An orphan is equally unrepresentable: the difference is only that a
--   delete which would create one is REFUSED instead of tidied up after.
--
--   What that costs, precisely: the Supabase dashboard's "Delete user" button
--   now fails with a foreign-key violation naming this constraint, where today
--   it silently succeeds and leaves the orphan behind. That is the trade — a
--   loud failure in place of a quiet corruption, on a path that was never the
--   correct one anyway.
--
-- ── WHY THIS BREAKS NOTHING ────────────────────────────────────────────────
--   Both real deletion paths already delete public.users BEFORE the auth user:
--     * delete_account_data (account-deletion-fix.sql:334), called by the
--       delete-account edge function before auth.admin.deleteUser
--     * seed/teardown.mjs, which since c94a5ec refuses to delete the auth user
--       at all if the profile delete failed
--
--   Verified rather than assumed, 8 Aug 2026: delete_account_data was called
--   for all 55 existing accounts inside a rollback transaction, each in its own
--   subtransaction so no account's deletes could mask another's blocker. All 55
--   completed. Against non-empty data — 42 messages, 33 sessions, 17 reviews,
--   26 verification requests, 3 reports.
--
--   And by code: all seven foreign keys above are handled explicitly inside the
--   RPC, so the result is not an artefact of which rows happen to exist.
--
--   The constraint is therefore invisible to both paths. It only ever fires on
--   a path that is deleting an auth user without dealing with its profile,
--   which is the bug.
--
-- ── FOLLOW-UP AFTER APPLYING ───────────────────────────────────────────────
--   CLAUDE.md's schema anchor opens "public.users has NO FK to auth.users",
--   which becomes false. The sentence after it — "deleting the auth user does
--   NOT cascade public.users, delete it explicitly" — stays true, and in fact
--   becomes enforced rather than merely advised.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0003') then
    raise exception 'Migration 0003 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Refuse if any orphan still exists.
--
--    Adding the constraint would fail on its own here, but with a generic
--    "violates foreign key constraint" naming one row. This reports the count
--    and the addresses, because the addresses are the actionable part — each is
--    an email that currently cannot register — and prints the statement that
--    clears them. A guard that only refuses sends you off to find a query it
--    already has everything needed to write.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  sample text;
begin
  select count(*), string_agg(u.email, ', ' order by u.email)
    into n, sample
  from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id);

  if n > 0 then
    -- ONE literal with real newlines in it. Not E-strings, and not adjacent
    -- literals relying on implicit concatenation: that rule resumes on a bare
    -- quote, so E'…' E'…' is a syntax error — the mistake that stopped an
    -- earlier version of this file applying. A literal with nothing to
    -- remember cannot be got wrong.
    raise exception
'Cannot add the constraint: % orphaned public.users row(s) have no auth user.
Each one blocks re-registration of its address:
  %

To clear them, run BOTH of these together. The update has to land before the
delete, or the delete fails on the audit foreign key:

  update public.admin_audit_log set target_user_id = null
   where target_user_id in (select u.id from public.users u
         where not exists (select 1 from auth.users a where a.id = u.id));

  delete from public.users u
   where not exists (select 1 from auth.users a where a.id = u.id);

Then re-run this migration.', n, sample;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The constraint.
--
--    NO ACTION is written out rather than left implicit. It is the whole
--    decision this file rests on, and a reader should not have to know that an
--    omitted ON DELETE clause means NO ACTION to see what was chosen.
--
--    Validated immediately: public.users is tens of rows, so NOT VALID plus a
--    later VALIDATE would add a step for no benefit and leave a window where
--    the guarantee is only partial.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where contype = 'f'
      and conrelid = 'public.users'::regclass
      and confrelid = 'auth.users'::regclass
  ) then
    raise exception 'public.users already has a foreign key to auth.users — inspect before proceeding';
  end if;
end $$;

alter table public.users
  add constraint users_id_auth_users_fkey
  foreign key (id) references auth.users(id) on delete no action;

comment on constraint users_id_auth_users_fkey on public.users is
  'Added by migration 0003. An orphaned profile row (no auth user) blocks '
  're-registration of its email via the UNIQUE constraint on users.email, and '
  'surfaces only as GoTrue''s opaque "Database error saving new user". NO ACTION '
  'rather than CASCADE deliberately: cascading would reach seven FKs into '
  'public.users, two of which (reports.reported_id, reports.reporter_id) are '
  'moderation evidence. Delete public.users explicitly before the auth user — '
  'delete_account_data and teardown.mjs both already do.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0003', 'users_auth_foreign_key', 'ce8c4f9f09c9c74a1036b755c718f66731f7c4fa5d737f42e7352b11e84db317');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- THE ENUMERATION QUERY
--
-- Kept because it earned its place: as a gate in an earlier draft of this file
-- it refused the CASCADE version and named all seven blockers at once, which is
-- what turned a seven-decision migration into a one-decision one.
--
-- It answers "what would a cascade into public.users have to get past", and it
-- is worth re-running before ANY future change to that table's delete
-- behaviour. The repo cannot answer it — supabase/*.sql documents about a third
-- of the live schema — so ask the catalogue.
--
--   select con.conrelid::regclass::text as tbl,
--          att.attname::text            as col,
--          case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
--               when 'c' then 'CASCADE' when 'n' then 'SET NULL' else 'OTHER' end as on_delete
--   from pg_constraint con
--   join unnest(con.conkey) k(attnum) on true
--   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
--   where con.contype = 'f'
--     and con.confrelid = 'public.users'::regclass
--   order by 1, 2;
--
-- As of 8 Aug 2026 that returns exactly the seven listed in the header, all
-- NO ACTION. session_consents and moderation_actions do NOT appear: their FKs
-- were severed by supabase/account-deletion-fix.sql, so they reference nothing
-- and survive account deletion by design.
-- ===========================================================================


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- WRITTEN FOR THE SUPABASE SQL EDITOR, which is the tool these actually get
-- pasted into. Two things about it shape every block below:
--   * only the LAST result set of a run is returned, so each block ends in
--     exactly one select;
--   * temp objects do not survive between separate runs, so a block that
--     creates a pg_temp function must be pasted together with the select that
--     calls it, as ONE run.
--
-- No block needs an outer begin/rollback. Every check that writes does so
-- inside a plpgsql subtransaction forced to roll back by raising, so there is
-- no cleanup step to forget and no way to leave test rows behind. plpgsql
-- variables are NOT transactional, so what a check observed survives its own
-- rollback and is still returned to you.
--
-- ── BLOCK A — the constraint exists with the right delete rule ─────────────
--
--   select conname,
--          confdeltype,
--          case confdeltype
--            when 'a' then 'NO ACTION — correct'
--            when 'c' then 'CASCADE — WRONG, the shape 0003 rejected'
--            else confdeltype::text
--          end as verdict
--   from pg_constraint
--   where conrelid  = 'public.users'::regclass
--     and confrelid = 'auth.users'::regclass;
--
--   Expect exactly one row, confdeltype 'a'.
--
--
-- ── BLOCK B — behaviour: four checks, one result set ───────────────────────
-- Paste from `create or replace` to the final select as ONE run.
--
--   create or replace function pg_temp.verify_0003()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_a    uuid  := '00000000-0000-0000-0000-0000000000fa';
--     v_b    uuid  := '00000000-0000-0000-0000-0000000000fb';
--     v_meta jsonb := '{"role":"model","date_of_birth":"1990-01-01","terms_accepted":true}'::jsonb;
--     v_orphan   text := 'not reached';
--     v_signup   text := 'not reached';
--     v_refused  text := 'not reached';
--     v_ordered  text := 'not reached';
--     v_profiles int;
--   begin
--     -- 1. An orphaned profile must be impossible.
--     --
--     --    The row is filled in far enough to get PAST the NOT NULL columns,
--     --    and the SQLSTATE is checked, because the first version of this
--     --    check did neither: it inserted only (id, email, role), was rejected
--     --    by first_name NOT NULL before the foreign key was ever evaluated,
--     --    and reported a pass. A check that can pass without exercising the
--     --    thing it names is worse than no check — it reads as evidence.
--     --
--     --    23503 is foreign_key_violation. Anything else is INCONCLUSIVE, not
--     --    a pass: it means the row was rejected earlier for some other
--     --    reason, and the FK still has not been tested.
--     begin
--       insert into public.users (id, email, role, first_name)
--       values (gen_random_uuid(), 'orphan-test@example.invalid', 'model', 'Orphan');
--       v_orphan := 'PROBLEM: the insert was accepted';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm = 'ROLLBACK_ME' then
--         null;
--       elsif sqlstate = '23503' then
--         v_orphan := 'rejected by the foreign key — correct (' || left(sqlerrm, 70) || ')';
--       else
--         v_orphan := 'INCONCLUSIVE — rejected by ' || sqlstate || ', not the foreign key: '
--                  || left(sqlerrm, 70)
--                  || '. Supply the missing column and re-run; this did not test 0003.';
--       end if;
--     end;
--
--     -- 2 and 3. Signup still works, and the auth delete is then refused.
--     --    One subtransaction, because 3 depends on 2 having happened.
--     begin
--       insert into auth.users (id, email, raw_user_meta_data)
--       values (v_a, 'fk-test-a@example.invalid', v_meta);
--
--       select count(*) into v_profiles from public.users where id = v_a;
--       v_signup := case when v_profiles = 1
--                        then 'profile created by the trigger — correct'
--                        else 'PROBLEM: trigger produced ' || v_profiles || ' profile row(s)' end;
--
--       begin
--         delete from auth.users where id = v_a;
--         v_refused := 'PROBLEM: the auth delete succeeded and orphaned the profile';
--       exception when others then
--         v_refused := 'refused as expected — ' || left(sqlerrm, 90);
--       end;
--
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_signup := 'could not test — ' || left(sqlerrm, 90);
--       end if;
--     end;
--
--     -- 4. The correct order still works: profile first, then the auth user.
--     --    This is what delete_account_data and teardown.mjs both do.
--     begin
--       insert into auth.users (id, email, raw_user_meta_data)
--       values (v_b, 'fk-test-b@example.invalid', v_meta);
--       delete from public.users where id = v_b;
--       delete from auth.users  where id = v_b;
--       v_ordered := 'both deletes succeeded — correct';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_ordered := 'PROBLEM: ' || left(sqlerrm, 90);
--       end if;
--     end;
--
--     check_name := '1. orphan profile insert';                   outcome := v_orphan;  return next;
--     check_name := '2. signup creates the profile';              outcome := v_signup;  return next;
--     check_name := '3. auth delete refused while profile lives'; outcome := v_refused; return next;
--     check_name := '4. profile-then-auth delete still works';    outcome := v_ordered; return next;
--   end $f$;
--
--   select * from pg_temp.verify_0003();
--
-- Expect four rows, none containing the word PROBLEM. Row 3 is the behaviour
-- this migration introduces; row 4 is the proof it did not break the path
-- account deletion actually uses.
--
-- If row 2 reads "could not test", the hand-written insert into auth.users was
-- rejected — a limitation of poking GoTrue's own table directly, not a failure
-- of the constraint. Rows 1 and 4 still stand on their own.
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

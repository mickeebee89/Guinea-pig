-- ===========================================================================
-- 0003_users_auth_foreign_key
--
-- Makes public.users.id a real foreign key to auth.users(id), ON DELETE CASCADE.
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
-- ── WHY CASCADE AND NOT A PLAIN FK ─────────────────────────────────────────
--   Both prevent orphans; they differ in how. A plain (NO ACTION) FK would
--   refuse to delete an auth user while the profile survives, forcing every
--   caller to delete public.users first. delete_account_data and teardown.mjs
--   already do exactly that, so both would keep working — but the Supabase
--   dashboard's "Delete user" button would start failing, and that button is a
--   path a human actually uses.
--
--   CASCADE makes it work instead of fail: the profile and its CASCADE children
--   go with the auth user. That is what deleting an account already means, and
--   it is precisely the step teardown.mjs got wrong by hand.
--
--   The tradeoff, stated plainly: deleting an auth row from the dashboard now
--   destroys the profile and everything hanging off it (blocks, favourites,
--   model_attributes, model_photos, subscriptions, verification_*). Today it
--   leaves them behind. That is not a loss of safety — leaving them behind IS
--   the orphan bug — but it does mean the dashboard button is now genuinely
--   destructive rather than merely half-effective.
--
-- ── THE PART THAT IS NOT OPTIONAL ──────────────────────────────────────────
--   The cascade means an auth delete now reaches every FK pointing INTO
--   public.users. Any of those with NO ACTION or RESTRICT will abort the auth
--   delete — a blocker that does not exist today, because today the auth delete
--   never touches public.users at all.
--
--   admin_audit_log.target_user_id is one such FK (NO ACTION), so section 2
--   converts it to SET NULL. That is not a new decision: delete_account_data
--   already nulls that exact column by hand, for the stated reason that the
--   audit trail should outlive the rows it points at. This puts the same rule
--   in the schema, where a caller cannot forget it.
--
--   Section 3 then REFUSES TO PROCEED if any other non-cascading FK into
--   public.users exists, naming every one it finds. Applying this migration is
--   therefore its own preflight: on an unexpected constraint it fails with the
--   full list and, because the whole file is one transaction, changes nothing.
--
-- ── WHAT THIS DOES NOT TOUCH ───────────────────────────────────────────────
--   session_consents and moderation_actions had their FKs deliberately severed
--   by supabase/account-deletion-fix.sql, so they no longer reference anything
--   and are invisible to section 3. Their rows survive account deletion by
--   design and are purged by retention. Nothing here changes that.
--
--   Ordering inside delete_account_data stays as it is. It deletes public.users
--   before the edge function deletes the auth user, so the cascade fires on an
--   already-empty row. The explicit delete is still correct and still wanted —
--   it keeps the database work inside one transaction that can roll back, which
--   a cascade triggered from GoTrue could not.
--
-- ── FOLLOW-UP REQUIRED AFTER APPLYING ──────────────────────────────────────
--   Three places record the old fact and become wrong the moment this commits:
--     * CLAUDE.md — "public.users has NO FK to auth.users" (a schema anchor,
--       read at the start of every session, so this one matters most)
--     * supabase/account-deletion-fix.sql:331 — the comment above the
--       `delete from public.users` inside delete_account_data
--     * web-phase-1-handover.md — the delete-account clause reasoning
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
--    "violates foreign key constraint" that names one row. This reports the
--    count and the addresses, because the addresses are the actionable part —
--    each one is an email that currently cannot register.
--
--    It also prints the statement that clears them. A guard that only refuses
--    sends you off to find a query, which is a round trip the guard already has
--    everything it needs to save. This is the same statement that cleared the
--    five orphans on 8 Aug 2026.
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
    -- literals relying on implicit concatenation: that rule resumes with a bare
    -- quote, so E'…' E'…' is a syntax error, and it is the mistake that stopped
    -- this file applying the first time. A literal with nothing to remember
    -- cannot be got wrong.
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

Then re-run this migration. If the delete fails on a DIFFERENT foreign key,
that table needs the same treatment — null the pointer, keep the row — and
section 3 of this file names every one of them.', n, sample;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. admin_audit_log.target_user_id -> SET NULL.
--
--    Required, not tidying: without it the cascade added in section 4 would
--    make auth deletion blockable by an audit row, which it is not today.
--
--    The constraint name is discovered rather than assumed. account-deletion-fix
--    had to do the same and found a name this repo had never recorded; the live
--    schema has drifted far enough past supabase/*.sql that hardcoding a name is
--    a guess dressed up as a statement.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
  found boolean := false;
begin
  for c in
    select con.conname
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.conrelid = 'public.admin_audit_log'::regclass
      and con.confrelid = 'public.users'::regclass
      and att.attname = 'target_user_id'
  loop
    found := true;
    execute format('alter table public.admin_audit_log drop constraint %I', c.conname);
    raise notice 'dropped % (was NO ACTION)', c.conname;
  end loop;

  if found then
    alter table public.admin_audit_log
      add constraint admin_audit_log_target_user_id_fkey
      foreign key (target_user_id) references public.users(id) on delete set null;
    raise notice 'recreated admin_audit_log_target_user_id_fkey as ON DELETE SET NULL';
  else
    -- Not an error. It may already be SET NULL from a previous attempt, or the
    -- FK may point somewhere else entirely. Section 3 is the actual gate.
    raise notice 'no NO ACTION FK found on admin_audit_log.target_user_id -> public.users';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Gate: nothing else may block a cascade into public.users.
--
--    Enumerated live rather than read from the repo. Fails with the complete
--    list, not one constraint at a time, so a surprise costs one round trip
--    instead of one per constraint.
-- ---------------------------------------------------------------------------
do $$
declare
  blockers text;
begin
  select string_agg(
           format('%s.%s (%s)', con.conrelid::regclass, att.attname,
                  case con.confdeltype when 'a' then 'NO ACTION'
                                       when 'r' then 'RESTRICT'
                                       else con.confdeltype::text end),
           E'\n  ' order by con.conrelid::regclass::text, att.attname)
    into blockers
  from pg_constraint con
  join unnest(con.conkey) k(attnum) on true
  join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = k.attnum
  where con.contype = 'f'
    and con.confrelid = 'public.users'::regclass
    and con.confdeltype not in ('c', 'n');   -- CASCADE and SET NULL are fine

  if blockers is not null then
    -- Single literal, real newlines — see the note in section 1.
    raise exception
'Refusing to add the cascade. These foreign keys into public.users would abort
an auth-user delete:
  %

Each needs a deliberate decision: SET NULL, CASCADE, or sever the constraint.
Nothing has been changed.', blockers;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The constraint.
--
--    Validated immediately — public.users is small enough (tens of rows) that
--    NOT VALID plus a later VALIDATE would add a second step for no benefit,
--    and would leave a window where the guarantee is only partial.
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
  foreign key (id) references auth.users(id) on delete cascade;

comment on constraint users_id_auth_users_fkey on public.users is
  'Added by migration 0003. An orphaned profile row (no auth user) blocks '
  're-registration of its email via the UNIQUE constraint on users.email, and '
  'surfaces only as GoTrue''s opaque "Database error saving new user". CASCADE '
  'makes that state unrepresentable rather than merely detectable.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0003', 'users_auth_foreign_key', '4bf62fa029e6d5bb5c6f107cbe6bf5ad875dbf4e0b1746e7bfc30df37fa2973c');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
--   -- 1. The constraint exists with the right delete rule (expect one row, 'c')
--   select conname, confdeltype
--   from pg_constraint
--   where conrelid = 'public.users'::regclass
--     and confrelid = 'auth.users'::regclass;
--
--   -- 2. Orphans are now impossible (expect an exception, not a row)
--   begin;
--     insert into public.users (id, email, role)
--     values (gen_random_uuid(), 'orphan-test@example.invalid', 'model');
--   rollback;   -- expect: violates foreign key constraint "users_id_auth_users_fkey"
--
--   -- 3. The cascade actually fires, and signup still works end to end.
--   --    This exercises handle_new_auth_user (which inserts into public.users
--   --    from an AFTER INSERT trigger, so the FK is checked mid-transaction)
--   --    and then the cascade, in one go.
--   begin;
--     insert into auth.users (id, email, raw_user_meta_data)
--     values ('00000000-0000-0000-0000-0000000000ff', 'cascade-test@example.invalid',
--             '{"role":"model","date_of_birth":"1990-01-01","terms_accepted":true}'::jsonb);
--     select count(*) as profile_created from public.users
--      where id = '00000000-0000-0000-0000-0000000000ff';        -- expect 1
--     delete from auth.users where id = '00000000-0000-0000-0000-0000000000ff';
--     select count(*) as profile_after_delete from public.users
--      where id = '00000000-0000-0000-0000-0000000000ff';        -- expect 0
--   rollback;
--
--   -- 4. Audit rows survive a cascade with their pointer nulled, not deleted.
--   --    Run inside the same style of transaction if you want to prove it on
--   --    real data without keeping the change.
--   select confdeltype from pg_constraint
--   where conname = 'admin_audit_log_target_user_id_fkey';       -- expect 'n'
-- ===========================================================================

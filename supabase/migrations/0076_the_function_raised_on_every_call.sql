-- ===========================================================================
-- 0076_the_function_raised_on_every_call
--
-- 0075's function raises 42804 on every call that reaches its INSERT. Fixes
-- it, and exercises the body inside this migration so the next one of these
-- cannot reach production. Audit item 145.
--
-- ⚠️ Apply 0075 first.
--
-- ── THE FAULT ──────────────────────────────────────────
--   ERROR 42804: column "session_id" is of type uuid but expression is of
--   type text
--
-- A bare `null` in a SELECT list is typed `text`, and `notifications.session_id`
-- is `uuid`. So the insert could never have worked, and the function raised
-- every time a stylist saved availability while having at least one favouriter.
--
-- ── HOW IT WOULD HAVE PRESENTED, WHICH IS THE WORST PART ─
-- Both wrappers swallow the error and `console.warn` it, because the notice is
-- best-effort by design — a notification failure must never affect whether the
-- availability saved. So `new_availability` would simply have STOPPED. Nothing
-- on screen, nothing in any log a person reads, and the save still succeeding.
--
-- **That is 0069's family exactly** (item 136): `run_email_reconcile` raised on
-- every call from 22 Sep and nobody knew for nine days, because its failures
-- went to `cron.job_run_details` and its silence looked like a quiet night.
-- A function that cannot run, inside a caller that cannot complain, is
-- indistinguishable from a feature nobody is using.
--
-- ── THE FIX IS TO STOP NAMING THE COLUMN ───────────────
-- `null::uuid` would compile, and would be patching the symptom. The actual
-- mistake was listing a column whose value is meant to be its default:
-- `session_id` is nullable, and a new-times notice is not tied to a session.
-- Both clients' original inserts omitted it, and mobile's said why —
-- *"session_id is omitted (not tied to a session) so it can't violate
-- notifications_session_id_fkey"*. The migration that replaced them named it
-- and then had to invent a value for it.
--
-- So: name the four columns that have values, and let the rest default.
-- Nothing to type wrongly if there is nothing to type.
--
-- ── ⚠️ AND IT NOW EXERCISES ITSELF BEFORE COMMITTING ───
-- The self-test below calls the function as a real stylist and requires it to
-- write at least one row, then discards those rows. If the body raises, THIS
-- MIGRATION FAILS AND NEVER APPLIES.
--
-- Why that is the right place for it: nothing in this repo can catch a type
-- error inside a plpgsql body. Not `tsc` (it is SQL), not eslint, not
-- `next build`, not `check-migration-tails` (it only proves the tail is
-- comments), not `check-types-freshness` (it compares a stamp and never
-- contacts the database). The VERIFY block caught it — and a VERIFY block runs
-- *after* commit, so the broken function was live until somebody got round to
-- the block.
--
-- ⚠️ IT MUST IMPERSONATE, OR IT TESTS NOTHING. Run as `postgres`, `auth.uid()`
-- is null, so the function returns 0 at its guard and NEVER REACHES THE INSERT.
-- A self-test that called it plainly would have passed 0075 unchanged. That is
-- the same trap as 0070's verify, which picked an admin to test a rule about
-- non-admins, and as 0027's before it.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0075') then
    raise exception '0076: apply 0075 first.';
  end if;
end $$;

create or replace function public.notify_favourites_of_availability()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_id uuid;
  v_name        text;
  v_count       integer;
begin
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider_id, v_name
    from public.providers p
   where p.user_id = auth.uid();

  if v_provider_id is null then
    return 0;
  end if;

  -- ⚠️ session_id IS NOT LISTED, AND THAT IS THE FIX. It is nullable, a
  -- new-times notice is not tied to a session, and naming it forced a literal
  -- whose type had to be guessed. A bare null in a select list is text;
  -- session_id is uuid; 0075 raised 42804 on every call that got this far.
  -- Four columns with values, and the rest default.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct f.user_id,
         'new_availability',
         'New availability posted',
         v_name || ' has posted new times.',
         jsonb_build_object('provider_id', v_provider_id)
    from public.favourites f
   where f.provider_id = v_provider_id;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function public.notify_favourites_of_availability() is
  'Writes one new_availability notification per model who favourited the CALLING stylist, carrying '
  'data.provider_id so both clients can link it to her shop. Takes no argument: the provider comes '
  'from auth.uid(), so it cannot be aimed at anyone else. Returns how many rows were written. '
  '0076 fixed 0075, which raised 42804 on every call because it named session_id and gave it a bare '
  'null. Audit items 143, 145.';

revoke all on function public.notify_favourites_of_availability() from public, anon;
grant execute on function public.notify_favourites_of_availability() to authenticated;

-- ── THE SELF-TEST ─────────────────────────────────────────────────────────
-- Runs the body for real, as a stylist, and discards what it wrote. A nested
-- BEGIN/EXCEPTION is its own subtransaction, so raising inside it undoes the
-- inserted rows without touching the DDL above.
do $$
declare
  v_uid uuid;
  v_n   integer;
begin
  select p.user_id into v_uid
    from public.providers p
   where exists (select 1 from public.favourites f where f.provider_id = p.id)
   order by p.id
   limit 1;

  if v_uid is null then
    -- Said out loud rather than passing quietly: with no favourited stylist
    -- the body cannot be reached, so this migration proves nothing about it.
    raise warning '0076: NO STYLIST HAS A FAVOURITER, so the function body was NOT exercised. Run VERIFY (b) by hand once one exists.';
    return;
  end if;

  begin
    -- Impersonation is what makes this a test. Without it auth.uid() is null,
    -- the guard returns 0, and the INSERT is never reached — see the header.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

    select public.notify_favourites_of_availability() into v_n;

    if coalesce(v_n, 0) < 1 then
      raise exception '0076: self-test wrote % row(s) for a stylist who HAS a favouriter. Expected at least 1.', v_n;
    end if;

    raise exception 'SELFTEST_DISCARD';
  exception
    when others then
      if sqlerrm <> 'SELFTEST_DISCARD' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claims', '', true);
  raise notice '0076: self-test wrote and discarded rows successfully.';
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0076', 'the_function_raised_on_every_call', 'a3ee4b4eaa532ad6df7c8b3c356fb27be3bf4a94239800d2dc29e90de6086883');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   Proves the fault is still there, so a pass is not mistaken for a no-op.
--   Comments stripped: the body below discusses session_id in prose.
--
--   with f as (
--     select regexp_replace(
--              pg_get_functiondef('public.notify_favourites_of_availability()'::regprocedure),
--              '--[^' || chr(10) || ']*', '', 'g') as code
--   )
--   select
--     (select count(*) from public.schema_migrations where version = '0075') = 1
--       as v_0075_applied,
--     code like '%session_id%'      as still_names_session_id,
--     (select count(*) from public.favourites) > 0
--       as self_test_can_run
--   from f;
--
--   Expect the first two true. If self_test_can_run is false the migration
--   still applies, but raises a WARNING saying the body was not exercised.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the column is gone from the body, read from the LIVE definition
--   with f as (
--     select regexp_replace(
--              pg_get_functiondef('public.notify_favourites_of_availability()'::regprocedure),
--              '--[^' || chr(10) || ']*', '', 'g') as code
--   )
--   select code not like '%session_id%' as session_id_no_longer_named,
--          code like '%jsonb_build_object%' as still_carries_provider_id
--     from f;
--
--   Expect both true.
--
--   -- (b) 0075's VERIFY (b), unchanged, which is the block that found this.
--   --     It is the only check in this repo that executes the body.
--   --     Expect favourites=1 wrote=1, body ending 'has posted new times.',
--   --     session_id=null, and data.provider_id EQUAL to the expected id.
--
--   -- (c) the self-test above actually ran rather than warning past itself.
--   --     If the migration printed the WARNING instead, this is why, and (b)
--   --     is then the only evidence the body works.
-- ===========================================================================

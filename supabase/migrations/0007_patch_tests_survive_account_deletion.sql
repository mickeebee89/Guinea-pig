-- ===========================================================================
-- 0007_patch_tests_survive_account_deletion
--
-- FIXES A LATENT BLOCKER: once a single patch test exists, the people it names
-- cannot delete their accounts.
--
-- WHAT BREAKS
--   delete-account's preflight (supabase/functions/delete-account/index.ts:94)
--   aborts on any patch_tests row referencing the caller as model, provider or
--   logger, and returns 409 with nothing deleted. patch_tests is empty today, so
--   nothing is broken yet — the first real patch test breaks it for that model
--   AND that stylist, permanently, and the only symptom is a support email.
--
--   That is an Apple Guideline 5.1.1(v) failure and it would make
--   cavybeauty.com/privacy false, which states you can delete your account at
--   any time.
--
-- ── WHY DE-IDENTIFY RATHER THAN DELETE ─────────────────────────────────────
--   A patch test is an allergy check before a treatment such as hair dye. The
--   record is not really about the model — it is the STYLIST'S EVIDENCE that a
--   required safety step happened. If a client reacts to a dye and says no test
--   was done, that row is the defence.
--
--   Deleting it with the account would hand any claimant a way to destroy the
--   evidence against their own claim, by pressing Delete account first. Same
--   reasoning as reports in 0004, and the same resolution: the record survives,
--   the person does not.
--
-- ── SAME SHAPE AS 0004, FOR THE SAME REASON ────────────────────────────────
--   model_id and provider_id are NOT NULL, so ON DELETE SET NULL is illegal
--   until that is dropped — and dropping it alone would permit a patch test
--   naming nobody, which is worse than the problem.
--
--   So the guarantee moves, exactly as it did for reports: model_email_hash and
--   provider_email_hash become NOT NULL, populated by trigger at insert. A row
--   naming nobody cannot be inserted, because the lookup returns null and
--   NOT NULL rejects it. The uuids can then only go null via the cascade, by
--   which point identity is recorded.
--
--   BOTH parties get identity, not just the model. For a claim you need to know
--   who was tested and who tested them, and either can delete their account.
--   logged_by is nulled without denormalising: it records which account keyed
--   the row in, which is administrative rather than evidential, and it is
--   already nullable.
--
-- ── ⚠ GAP: RETENTION PERIOD IS NOT SETTLED, SO NONE IS SET ─────────────────
--   patch_tests is deliberately NOT added to run_retention_purge (0005) here.
--
--   Everything else in that job uses six years, the Limitation Act 1980 period
--   for contract claims. Patch tests relate to PERSONAL INJURY claims, where the
--   period is three years — but running from the date of knowledge, not the act,
--   with further rules on top. Six years would over-retain Article 9 health data
--   and three might under-retain it, and picking either from a migration comment
--   is exactly the kind of confident guess this project keeps paying for.
--
--   CONSEQUENCE, STATED PLAINLY: until it is added, patch tests are kept
--   indefinitely. That is a real data-protection gap, not a neutral default. It
--   is on the same solicitor list as the Article 9 questions in
--   site/content/legal.ts. Adding it afterwards is one line in the purge's
--   table list.
--
-- ── ALSO NOT FIXED HERE ────────────────────────────────────────────────────
--   patch_tests.category_id is NOT NULL and has NO foreign key at all. Nothing
--   stops a treatment category being deleted and leaving every patch test
--   pointing at a category that no longer exists — the same class of problem
--   0003 fixed for profiles. Out of scope deliberately; it deserves its own
--   change rather than riding along in a deletion fix.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0007') then
    raise exception 'Migration 0007 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Durable identity for both parties.
-- ---------------------------------------------------------------------------
alter table public.patch_tests
  add column if not exists model_name          text,
  add column if not exists model_email_hash    text,
  add column if not exists provider_name       text,
  add column if not exists provider_email_hash text;

comment on column public.patch_tests.model_email_hash is
  'SHA-256 of lower(email) of the person tested, at the time of the test. '
  'Survives that account being deleted, when model_id is nulled. The record is '
  'the stylist''s evidence that a required safety step happened, so it has to '
  'outlive either party leaving.';

comment on column public.patch_tests.provider_email_hash is
  'SHA-256 of lower(email) of the stylist who carried out the test. Survives '
  'their account being deleted — a claim can be brought after they have gone.';

-- ---------------------------------------------------------------------------
-- 2. Populate at insert. Mirrors set_report_subjects() exactly.
--
--    BEFORE INSERT only. The SET NULL cascade in section 5 is an update, and a
--    trigger that re-derived identity there would look up a user that no longer
--    exists.
--
--    The lookup is against public.users even though the foreign keys point at
--    auth.users: public.users.id references auth.users(id) since 0003, so the
--    ids are the same and public.users is where the name and email live.
-- ---------------------------------------------------------------------------
create or replace function public.set_patch_test_subjects()
returns trigger language plpgsql security definer
set search_path to 'public', 'extensions' as $function$
begin
  if new.model_name is null or new.model_email_hash is null then
    select
      nullif(btrim(coalesce(u.first_name, '')
             || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
      encode(digest(lower(btrim(u.email)), 'sha256'), 'hex')
      into new.model_name, new.model_email_hash
    from public.users u where u.id = new.model_id;
  end if;

  if new.provider_name is null or new.provider_email_hash is null then
    select
      nullif(btrim(coalesce(u.first_name, '')
             || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
      encode(digest(lower(btrim(u.email)), 'sha256'), 'hex')
      into new.provider_name, new.provider_email_hash
    from public.users u where u.id = new.provider_id;
  end if;

  return new;
end;
$function$;

revoke all on function public.set_patch_test_subjects() from public, anon;

drop trigger if exists trg_patch_test_subjects on public.patch_tests;
create trigger trg_patch_test_subjects
  before insert on public.patch_tests
  for each row execute function public.set_patch_test_subjects();

-- ---------------------------------------------------------------------------
-- 3. Backfill, then prove it is complete.
--
--    patch_tests is empty as of 8 Aug 2026, so this is a no-op today. It is
--    written anyway because "the table was empty when I wrote the migration" is
--    not a property the migration can rely on at the moment it runs.
-- ---------------------------------------------------------------------------
update public.patch_tests pt
   set model_name = nullif(btrim(coalesce(u.first_name, '')
         || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
       model_email_hash = encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex')
  from public.users u
 where u.id = pt.model_id and pt.model_email_hash is null;

update public.patch_tests pt
   set provider_name = nullif(btrim(coalesce(u.first_name, '')
         || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
       provider_email_hash = encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex')
  from public.users u
 where u.id = pt.provider_id and pt.provider_email_hash is null;

do $$
declare n int;
begin
  select count(*) into n from public.patch_tests
   where model_email_hash is null or provider_email_hash is null;
  if n > 0 then
    raise exception
'Backfill incomplete: % patch test(s) still have no subject hash.

That should be impossible while model_id and provider_id are NOT NULL foreign
keys, so it means one of them points at an auth user with no public.users row.
Understand that before continuing — section 4 would fail anyway.

  select id, model_id, provider_id from public.patch_tests
   where model_email_hash is null or provider_email_hash is null;', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The replacement invariant, before the NOT NULLs come off the uuids.
-- ---------------------------------------------------------------------------
alter table public.patch_tests
  alter column model_email_hash    set not null,
  alter column provider_email_hash set not null;

-- ---------------------------------------------------------------------------
-- 5. The foreign keys.
--
--    Names discovered and reused rather than invented. All three point at
--    auth.users, confirmed against pg_constraint before this was written.
-- ---------------------------------------------------------------------------
do $$
declare
  n_model text; p_model oid;
  n_prov  text; p_prov  oid;
  n_log   text; p_log   oid;
begin
  select con.conname, con.confrelid into n_model, p_model
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
   where con.contype = 'f' and con.conrelid = 'public.patch_tests'::regclass
     and att.attname = 'model_id';

  select con.conname, con.confrelid into n_prov, p_prov
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
   where con.contype = 'f' and con.conrelid = 'public.patch_tests'::regclass
     and att.attname = 'provider_id';

  select con.conname, con.confrelid into n_log, p_log
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
   where con.contype = 'f' and con.conrelid = 'public.patch_tests'::regclass
     and att.attname = 'logged_by';

  if n_model is null or n_prov is null or n_log is null then
    raise exception
'Expected foreign keys on patch_tests.model_id, .provider_id and .logged_by.
Found: model=%, provider=%, logged_by=%. Nothing has been changed.',
      coalesce(n_model, 'MISSING'), coalesce(n_prov, 'MISSING'), coalesce(n_log, 'MISSING');
  end if;

  if p_model <> 'auth.users'::regclass
     or p_prov <> 'auth.users'::regclass
     or p_log  <> 'auth.users'::regclass then
    raise exception
'Foreign keys point somewhere unexpected: model -> %, provider -> %, logged_by -> %.
Expected auth.users for all three. Nothing has been changed.',
      p_model::regclass::text, p_prov::regclass::text, p_log::regclass::text;
  end if;

  execute format('alter table public.patch_tests drop constraint %I', n_model);
  execute format('alter table public.patch_tests drop constraint %I', n_prov);
  execute format('alter table public.patch_tests drop constraint %I', n_log);

  alter table public.patch_tests alter column model_id    drop not null;
  alter table public.patch_tests alter column provider_id drop not null;

  execute format(
    'alter table public.patch_tests add constraint %I foreign key (model_id) '
    'references auth.users(id) on delete set null', n_model);
  execute format(
    'alter table public.patch_tests add constraint %I foreign key (provider_id) '
    'references auth.users(id) on delete set null', n_prov);
  execute format(
    'alter table public.patch_tests add constraint %I foreign key (logged_by) '
    'references auth.users(id) on delete set null', n_log);

  raise notice 'patch_tests FKs recreated as ON DELETE SET NULL: %, %, %',
    n_model, n_prov, n_log;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0007', 'patch_tests_survive_account_deletion', '5590ca1e8c83f4fbf2c7ab04fca89bd833827e69e6c7b3ab4af6109733c5c142');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- Written for the Supabase SQL editor: one paste per block, each ending in
-- exactly one select. See 0000.
--
-- ⚠ THE EDGE FUNCTION MUST BE REDEPLOYED TOO. This migration removes the
-- database-level blocker; the preflight list in delete-account/index.ts is a
-- separate copy of the same knowledge and will keep refusing until it ships:
--     npx supabase functions deploy delete-account      (from the repo ROOT)
--
-- ── BLOCK A — shape ────────────────────────────────────────────────────────
--
--   select att.attname, att.attnotnull as not_null,
--          case con.confdeltype when 'n' then 'SET NULL' when 'a' then 'NO ACTION'
--               when 'c' then 'CASCADE' else coalesce(con.confdeltype::text, '—') end as on_delete
--   from pg_attribute att
--   left join pg_constraint con
--          on con.conrelid = att.attrelid and con.contype = 'f'
--         and att.attnum = any(con.conkey)
--   where att.attrelid = 'public.patch_tests'::regclass
--     and att.attname in ('model_id','provider_id','logged_by',
--                         'model_email_hash','provider_email_hash')
--   order by att.attname;
--
--   Expect the three id columns SET NULL and nullable, both hash columns
--   NOT NULL.
--
--
-- ── BLOCK B — the behaviour, against a synthetic row ───────────────────────
-- patch_tests is empty, so there is nothing real to test with. This creates a
-- row, deletes the model's auth user, and checks the record survived — then
-- rolls the whole thing back. It picks a live user and the first value of the
-- result enum, so nothing is hardcoded. Paste as ONE run.
--
--   create or replace function pg_temp.verify_0007()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_model uuid; v_prov uuid; v_cat uuid; v_type text; v_id uuid;
--     v_model_after uuid; v_name text; v_hash text;
--     v_survived text := 'not reached';
--     v_nullrow  text := 'not reached';
--   begin
--     -- Pick a model who is NOT an admin: admin_audit_log.admin_id is NO ACTION
--     -- to auth.users and would block the auth delete for a reason that has
--     -- nothing to do with patch tests.
--     select u.id into v_model from public.users u
--      where not exists (select 1 from public.admins a where a.user_id = u.id)
--        and not exists (select 1 from public.admin_audit_log l where l.admin_id = u.id)
--      order by u.created_at limit 1;
--     select id into v_prov from public.users where id <> v_model order by created_at desc limit 1;
--     select id into v_cat  from public.treatment_categories limit 1;
--     select atttypid::regtype::text into v_type
--       from pg_attribute
--      where attrelid = 'public.patch_tests'::regclass and attname = 'result';
--
--     if v_model is null or v_prov is null or v_cat is null then
--       check_name := 'setup'; outcome := 'skipped — need two non-admin users and a category';
--       return next; return;
--     end if;
--
--     begin
--       execute format(
--         'insert into public.patch_tests (model_id, provider_id, category_id, result) '
--         'values ($1, $2, $3, (enum_range(null::%s))[1]) returning id', v_type)
--       into v_id using v_model, v_prov, v_cat;
--
--       -- THE REAL DELETION PATH. A bare `delete from public.users` fails on
--       -- messages_sender_id_fkey and the other NO ACTION references 0003
--       -- enumerated; clearing them first is what delete_account_data is for.
--       -- An earlier version of this check deleted the row directly and
--       -- reported "could not test" for a reason that had nothing to do with
--       -- this migration.
--       perform public.delete_account_data(v_model);
--       delete from auth.users where id = v_model;
--
--       select pt.model_id, pt.model_name, pt.model_email_hash
--         into v_model_after, v_name, v_hash
--         from public.patch_tests pt where pt.id = v_id;
--
--       v_survived := case
--         when v_hash is null then 'PROBLEM: the record lost its subject identity'
--         when v_model_after is not null then 'PROBLEM: model_id was not nulled'
--         else 'survived — model_id NULL, name ' || coalesce(v_name, '(none)')
--              || ', hash ' || left(v_hash, 8) || '…'
--         end;
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_survived := 'could not test — ' || left(sqlerrm, 100);
--       end if;
--     end;
--
--     -- A patch test naming nobody must still be impossible.
--     begin
--       execute format(
--         'insert into public.patch_tests (model_id, provider_id, category_id, result) '
--         'values (null, null, $1, (enum_range(null::%s))[1])', v_type)
--       using v_cat;
--       v_nullrow := 'PROBLEM: accepted a patch test naming nobody';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_nullrow := 'rejected as expected — ' || left(sqlerrm, 80);
--       end if;
--     end;
--
--     check_name := 'patch test survives its model being deleted'; outcome := v_survived; return next;
--     check_name := 'patch test naming nobody is rejected';        outcome := v_nullrow;  return next;
--   end $f$;
--
--   select * from pg_temp.verify_0007();
--
--   Expect neither row to contain PROBLEM.
--
--
-- ── BLOCK C — account deletion completes for every account ─────────────────
-- The same harness used for 0003 and 0004. This migration does not change
-- delete_account_data, but it does change what can block the auth delete that
-- follows it, so the pass is worth re-establishing.
--
--   create or replace function pg_temp.dryrun_delete_all()
--   returns table(email text, result text, code text)
--   language plpgsql as $f$
--   declare u record;
--   begin
--     for u in select us.id, us.email from public.users us order by us.email loop
--       begin
--         perform public.delete_account_data(u.id);
--         raise exception 'DRYRUN_OK';
--       exception when others then
--         email := u.email;
--         if sqlerrm = 'DRYRUN_OK' then result := 'ok'; code := '';
--         else result := sqlerrm; code := sqlstate; end if;
--         return next;
--       end;
--     end loop;
--   end $f$;
--
--   select * from pg_temp.dryrun_delete_all() order by (result = 'ok'), email;
--
--   Every row must read 'ok'.
-- ===========================================================================

-- ===========================================================================
-- 0000_migrations_framework
--
-- Records which migrations have actually been applied, in the database, so the
-- answer to "did this run?" is a query rather than someone's memory.
--
-- WHY THIS SHAPE
--   Two constraints drove it, both from how the work actually happens here:
--
--   1. Write the file, commit it, paste it into the SQL editor. No CLI step.
--      A process that fights the workflow gets bypassed, and a bypassed process
--      is worse than none — it leaves a record that looks authoritative and is
--      wrong.
--
--   2. "Did this run?" must be queryable state, not a convention. A naming
--      convention is exactly what already failed: supabase/*.sql documented
--      about a third of the live schema while reading like a complete record,
--      and the providers SELECT policy the whole public website depends on
--      existed in no file at all.
--
-- HOW A MIGRATION USES IT
--   Every migration file has a guard at the top and a footer at the bottom:
--
--     -- guard: refuses to run twice
--     do $$ begin
--       if exists (select 1 from public.schema_migrations where version = '0001')
--         then raise exception 'Migration 0001 already applied'; end if;
--     end $$;
--
--     ... the migration ...
--
--     -- MIGRATION FOOTER
--     insert into public.schema_migrations (version, name, checksum)
--     values ('0001', 'consent_capture', '<sha256 of everything above this line>');
--
--   The whole file runs inside one transaction, so if the guard fires or any
--   statement fails, nothing is applied and nothing is recorded. Applied and
--   recorded cannot come apart.
--
--   The checksum is over the file content ABOVE the `-- MIGRATION FOOTER` line.
--   scripts/migration-status.mjs recomputes it the same way, so a file edited
--   after being applied is detectable — the database knows what it actually
--   ran, not what the file currently says.
--
-- CHECKING STATUS
--   select * from public.schema_migrations order by version;
--   node scripts/migration-status.mjs      -- compares files against the table
-- ===========================================================================

begin;

create table if not exists public.schema_migrations (
  version     text primary key,
  name        text        not null,
  checksum    text        not null,
  applied_at  timestamptz not null default now(),
  applied_by  text        not null default current_user
);

comment on table public.schema_migrations is
  'Which migrations have been applied. Written by each migration''s own footer, '
  'inside the same transaction as the migration, so the two cannot diverge. '
  'checksum covers the file above its `-- MIGRATION FOOTER` line.';

alter table public.schema_migrations enable row level security;

-- Admins can read it from the console; nobody can write it through the API.
-- Migrations write it as postgres in the SQL editor, which bypasses RLS.
drop policy if exists schema_migrations_read_admin on public.schema_migrations;
create policy schema_migrations_read_admin
  on public.schema_migrations
  as permissive for select to authenticated
  using (is_admin());

revoke all on public.schema_migrations from anon;

-- 0000 records itself, so the table is never empty and the mechanism is
-- proven by its own first use.
insert into public.schema_migrations (version, name, checksum)
values ('0000', 'migrations_framework', 'bootstrap')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';

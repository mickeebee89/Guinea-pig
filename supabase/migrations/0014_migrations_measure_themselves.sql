-- ===========================================================================
-- 0014_migrations_measure_themselves
--
-- A migration that changes data must record what it found BEFORE changing it,
-- and must refuse to run when reality does not match what its author assumed.
-- Both happen inside the migration, in the same paste.
--
-- ── WHY: TWO SKIPPED PRE-CHECKS IN TWO DAYS ───────────────────────────────
-- 0012 carried its pre-check in its own header comments. Result: "run the
-- migration" and "run the thing that must precede it" were the same paste, the
-- pre-check was skipped, and the baseline it existed to capture — how many
-- slots were carrying dead treatment ids — is gone permanently, because the
-- repair had already rewritten the rows it would have measured.
--
-- 0013 moved the pre-check to its own file. It was skipped again, and run
-- afterwards. The diagnosis from the operator is exact and worth quoting:
--
--   "The separate file wasn't the fix. The instruction to run it lives in your
--    message, and by the time I'm in the SQL editor I'm pasting migrations."
--
-- That is right, and it generalises: **a pre-check that depends on someone
-- remembering is not a check.** It is the same failure this repo has already
-- written down twice — migration-status.mjs exists because "did this run?" was
-- answerable only from memory, and 0000 says a check that depends on someone
-- noticing is not a check. Moving the file was treating the symptom. The step
-- has to be inside the thing that cannot be skipped: the paste itself.
--
-- ── THE TWO MECHANISMS ────────────────────────────────────────────────────
--
-- 1. MEASURE. The migration writes its own before-figures into
--    migration_findings as its first act. Nobody has to run anything, nobody
--    has to keep the output, and the numbers survive in a table whether or not
--    a human read them at the time. 0012's lost baseline would have been
--    captured automatically.
--
-- 2. ASSERT. Where the author expects a particular state, the migration raises
--    and aborts instead of proceeding. An assertion that fires is not a
--    nuisance — it is the migration saying the world is not what it was written
--    against, which is exactly when a human should look.
--
--    Bypassing an assertion has to be deliberate and visible, so it needs a
--    session setting the operator types on purpose:
--
--      set local cavy.migration_override = 'yes';
--
--    Typing that is a decision. Forgetting to run a separate file is not.
--
-- ── THE TEMPLATE ──────────────────────────────────────────────────────────
-- Copy this into any migration that touches data. It goes AFTER the
-- already-applied guard and BEFORE the first mutating statement.
--
--   -- measure
--   insert into public.migration_findings (version, item, value)
--   select '00NN', 'slots holding a dead treatment id',
--          count(*)::text
--     from public.availability a
--    where ...;
--
--   -- assert
--   do $$
--   declare v_live integer;
--   begin
--     select count(*) into v_live from public.sessions where ...;
--     if v_live > 0
--        and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
--       raise exception
--         '00NN expected no live bookings, found %. Look at migration_findings, '
--         'then re-run with: set local cavy.migration_override = ''yes'';', v_live;
--     end if;
--   end $$;
--
-- `current_setting(..., true)` returns NULL rather than erroring when the
-- setting is absent, so the common case — nobody has set it — is the safe one.
--
-- ── WHAT THIS DOES NOT CLAIM ──────────────────────────────────────────────
-- Recording a finding proves it was MEASURED, not that anyone READ it. That is
-- a real limit and it is the point: the value of the recording is that the
-- number still exists tomorrow, when someone asks how bad it was before. An
-- assertion is the part that forces a human to look, and assertions are for
-- the cases where proceeding blind is actually dangerous — not for every
-- migration, or they become noise to be overridden by habit.
--
-- This migration adds only a table. It changes no data, so by its own rule it
-- has nothing to measure and nothing to assert.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0014') then
    raise exception 'Migration 0014 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Findings are append-only by convention rather than by trigger.
--
-- No append-only trigger here on purpose: session_consents and
-- moderation_actions have one because they are evidence about people, and that
-- protection is worth the cost of never being able to correct them. These are
-- operational numbers about our own schema. A wrong one should be fixable.
-- ---------------------------------------------------------------------------
create table if not exists public.migration_findings (
  id          bigint generated always as identity primary key,
  version     text        not null,
  item        text        not null,
  value       text,
  recorded_at timestamptz not null default now()
);

create index if not exists migration_findings_version_idx
  on public.migration_findings (version, recorded_at desc);

alter table public.migration_findings enable row level security;

-- Admin-read only, matching schema_migrations. These numbers describe the
-- shape of the database's problems and are nobody's business but ours.
drop policy if exists migration_findings_read_admin on public.migration_findings;
create policy migration_findings_read_admin
  on public.migration_findings as permissive for select to authenticated
  using (is_admin());

-- No INSERT policy: migrations run as the service role / SQL editor, which
-- bypasses RLS. An app client has no reason to write one, so none may.

-- ---------------------------------------------------------------------------
-- Backfill what is still knowable from 0012 and 0013.
--
-- 0012's headline number is NOT knowable — the repair rewrote those rows before
-- anything counted them, and nothing distinguishes a slot it emptied from one
-- that was always empty. Recording that it is unrecoverable is more useful than
-- leaving a gap that reads like nobody looked.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value) values
  ('0012', 'slots holding a dead treatment id, before repair',
           'UNRECOVERABLE - pre-check skipped, repair ran first'),
  ('0012', 'slots holding a dead treatment id, after repair',      '0'),
  ('0013', 'FK on sessions.treatment_id',                          'none'),
  ('0013', 'terminal bookings with a dead treatment_id',           '19'),
  ('0013', 'terminal orphans - decision',                          'ACCEPTED, not repaired'),
  ('0013', 'live bookings with a dead treatment_id',               '0'),
  ('0013', 'live bookings with a treatment, at apply time',        '9');

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0014', 'migrations_measure_themselves', 'a19bcf395326182c210b4f75a8b64c1c8efed3ea09c82db66f7e6677934bf8dc');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — the table exists and holds the backfill ────────────────────
--
--   select version, item, value, recorded_at
--   from public.migration_findings
--   order by version, id;
--
-- ── BLOCK B — the assertion pattern actually aborts. Rolls itself back. ──
--
--   begin;
--     do $$
--     begin
--       if coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
--         raise exception 'expected: this is what a tripped assertion looks like';
--       end if;
--     end $$;
--   rollback;
--
-- ── BLOCK C — and that the override lets it through ──────────────────────
--
--   begin;
--     set local cavy.migration_override = 'yes';
--     do $$
--     begin
--       if coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
--         raise exception 'should NOT fire - the override is set';
--       end if;
--     end $$;
--     select 'override works' as outcome;
--   rollback;
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
--
-- Needs SUPABASE_SERVICE_ROLE_KEY in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
-- ===========================================================================

-- ===========================================================================
-- 0026_moderation_action_revoke_verification
--
-- Adds ONE enum label. Deliberately does nothing else.
--
-- ⚠️ THIS FILE MUST NOT USE THE VALUE IT ADDS. That is the whole reason it is
-- its own migration, and 0027 is where the value gets used.
--
-- ── THE RULE, ESTABLISHED BEFORE WRITING RATHER THAN AFTER ────────────────
-- PostgreSQL < 12: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
--   block AT ALL. Every migration in this project is wrapped in begin/commit
--   with a schema_migrations insert at the end, so on such a server this file
--   cannot work and the assert below stops it rather than half-applying.
--
-- PostgreSQL >= 12: it CAN run inside a transaction block, but the new label
--   CANNOT BE USED until that transaction commits. Using it earlier fails with
--   `unsafe use of new value "..." of enum type moderation_action_type`.
--
-- So: adding the label and writing anything that references it must be two
-- separate transactions, which in this framework means two files. A single
-- migration doing both would abort on the second half — and it would abort
-- AFTER the enum change, leaving the type altered and the mechanism missing.
--
-- A plpgsql function body containing the literal is not itself "use" (the body
-- is stored as text and not resolved at CREATE time), but a DEFAULT, a CHECK,
-- an INSERT, or a SQL-language function under `check_function_bodies` all are.
-- Splitting the files removes the need to be right about which.
--
-- ── WHY `revoke_verification` AND NOT `revoke` ────────────────────────────
-- The existing five labels — warn, suspend, ban, reinstate, dismiss — are all
-- conduct outcomes: things done to someone because of how they behaved.
-- Revocation is not necessarily punishment. The commonest case is an admin
-- correcting their own mistake: a selfie approved that should not have been.
--
-- `revoke` alone would sit in that list reading as a sixth punishment and would
-- not say what was revoked — a subscription? a session? `revoke_verification`
-- names the object, and keeps the door open for other revocations later without
-- one of them silently inheriting this one's meaning.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the server must be one where this can work at all.
-- ---------------------------------------------------------------------------
do $$
declare v_num int := current_setting('server_version_num')::int;
begin
  insert into public.migration_findings (version, item, value)
  values ('0026', 'server_version', current_setting('server_version'));

  if v_num < 120000 then
    raise exception
      '0026: PostgreSQL % cannot run ALTER TYPE ... ADD VALUE inside a transaction '
      'block, and every migration here is wrapped in begin/commit. Run the ALTER TYPE '
      'by hand outside a transaction, then re-run this file.', current_setting('server_version');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The label. IF NOT EXISTS so a re-run is harmless.
-- ---------------------------------------------------------------------------
alter type public.moderation_action_type add value if not exists 'revoke_verification';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0026', 'moderation_action_revoke_verification', '3c098140e2a132c1939a149dd7e4e9857e0d3bf1d2cb93c73cd0ee30d1971f5a');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Written for the Supabase SQL editor.
--
-- ── BLOCK A — the label exists ──────────────────────────────────────────
--
--   select enumlabel, enumsortorder
--   from pg_enum where enumtypid = 'public.moderation_action_type'::regtype
--   order by enumsortorder;
--
--   Expect six: warn, suspend, ban, reinstate, dismiss, revoke_verification.
--
-- ── BLOCK B — it is usable NOW, in a later transaction ──────────────────
--
--   This is the check that the split was necessary and sufficient. It must
--   succeed here, having failed had it been in 0026 itself.
--
--   begin;
--     select 'revoke_verification'::public.moderation_action_type;
--   rollback;
--
-- ── THEN APPLY 0027, which is the mechanism. 0026 on its own changes no
--    behaviour at all: it adds a word nothing yet writes.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

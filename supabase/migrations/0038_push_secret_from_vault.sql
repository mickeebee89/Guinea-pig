-- ===========================================================================
-- 0038_push_secret_from_vault
--
-- Take the send-push shared secret out of the two function bodies that carry it,
-- and read it from Vault at call time instead. Audit item 36.
--
-- ── WHAT AND WHY ────────────────────────────────────────────────────────
-- public.tg_message_push  (messages      → message_push, AFTER INSERT)
-- public.tg_notify_push   (notifications → notify_push,  AFTER INSERT)
--
-- Both build the send-push request with the header value hardcoded:
--   jsonb_build_object(..., 'x-push-secret', '<literal>')
-- which puts the secret in pg_proc, readable by anyone with direct database
-- access, and in anything that dumps function definitions.
--
-- Nothing was exposed: there are no real users (58 accounts, all the owner's or
-- disposable), pg_catalog is not reachable through the Data API (406 PGRST106 —
-- exposed schemas are public and graphql_public), and direct database access is
-- the owner's alone. Rotated anyway, for the forward-looking reason: a secret in a
-- function body is a thing nobody remembers to change, and it becomes reachable
-- the day the platform's assumptions stop holding.
--
-- SCOPE was set by a sweep, not by the two already known (10 Sep): every non-C
-- function in every schema (102), all cron jobs (2), trigger arguments (0 exist),
-- role and database settings (16), and the settings table (8 rows). Only these
-- two functions hold a hardcoded value.
--
-- ── ⚠️ HOW: EDIT THE LIVE DEFINITION IN PLACE, DO NOT RETYPE IT ──────────
-- This migration does not contain either function. It reads each one's current
-- definition from the database, replaces exactly ONE expression — the hardcoded
-- header value — with a Vault lookup, checks the result, and re-creates it.
--
-- Chosen deliberately (Micky, 10 Sep): the rest of both bodies — how
-- tg_message_push resolves the recipient, when it skips, what it sends — has only
-- been seen summarised, and retyping logic from a summary is guessing. A retyped
-- copy that quietly differs from live would be a wrong record; the repo not
-- holding a copy is a known gap, and a smaller one.
--
-- So neither the secret nor either function body appears in this file, in its
-- output, or in any NOTICE it raises. Only counts are reported.
--
-- ── THE VAULT PATTERN IS AN EXISTING ONE ────────────────────────────────
-- cron_secret_purge_selfies (27 Jul) is read inline in purge-selfies-cron.sql as
--   (select decrypted_secret from vault.decrypted_secrets where name = '...')
-- This follows it, under the name push_hook_secret — matching send-push's own
-- environment variable, PUSH_HOOK_SECRET.
--
-- ── ⚠️ ONE DEPARTURE FROM THAT PATTERN, AND WHY ─────────────────────────
-- The lookup here is wrapped in coalesce(..., ''). The cron job can afford a bare
-- subquery; these two cannot, because they are AFTER INSERT triggers on
-- messages and notifications. If the Vault row were ever missing, a bare lookup
-- yields NULL, and whatever pg_net does with a NULL header value would happen
-- INSIDE the insert of a user's message. With coalesce, a missing secret sends an
-- empty header, send-push refuses it with 403, and the push is lost — but the
-- message is not. A missing secret must never stop someone sending a message.
--
-- The assertions below also check that each function's owner can read
-- vault.decrypted_secrets. A permission error is NOT caught by coalesce, and would
-- fail every message insert, so it is refused here, before anything changes.
--
-- ── ORDER — THE ROTATION ────────────────────────────────────────────────
--   1. generate a new value locally; do not paste it anywhere else
--   2. Vault: create push_hook_secret with that value
--   3. Edge Functions secrets: set PUSH_HOOK_SECRET to the same value
--   4. apply this migration immediately
-- Between 3 and 4, pushes fail (send-push expects the new value, the functions
-- still send the old one). Rows still insert — pg_net is asynchronous. With no
-- real users that window reaches no one.
--
-- This migration REFUSES to apply if push_hook_secret is not already in Vault.
-- ===========================================================================

begin;

do $$
declare
  v_fn        text;
  v_oid       oid;
  v_owner     oid;
  v_def       text;
  v_new       text;
  v_hits      integer;
  -- The one expression being replaced: 'x-push-secret', '<any literal>'
  v_pattern   constant text := '(''x-push-secret''\s*,\s*)''[^'']*''';
  -- What replaces it. See the header for why coalesce.
  v_lookup    constant text :=
    '\1coalesce((select decrypted_secret from vault.decrypted_secrets where name = ''push_hook_secret''), '''')';
  v_marker    constant text := 'name = ''push_hook_secret''';
begin
  -- ── ASSERT: Vault is there, and the secret is already in it ────────────
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception '0038: vault.decrypted_secrets does not exist — Vault must be enabled.';
  end if;

  if not exists (select 1 from vault.secrets where name = 'push_hook_secret') then
    raise exception
      '0038: push_hook_secret is not in Vault. Create it (with the same value as the '
      'PUSH_HOOK_SECRET edge function secret) immediately before applying this.';
  end if;

  -- Length only — the value is never read into output.
  if (select coalesce(length(decrypted_secret), 0)
        from vault.decrypted_secrets where name = 'push_hook_secret') < 32 then
    raise exception '0038: push_hook_secret is shorter than 32 characters — is it the real value?';
  end if;

  foreach v_fn in array array['tg_message_push', 'tg_notify_push'] loop

    select p.oid, p.proowner, pg_get_functiondef(p.oid)
      into v_oid, v_owner, v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_fn;

    if v_oid is null then
      raise exception '0038: public.% does not exist.', v_fn;
    end if;

    -- The function runs SECURITY DEFINER as its owner, so the OWNER must be able
    -- to read the view. If not, every insert that fires it would fail.
    if not has_table_privilege(v_owner, 'vault.decrypted_secrets', 'select') then
      raise exception
        '0038: the owner of public.% cannot read vault.decrypted_secrets. Applying this would '
        'make every insert that fires it fail. Nothing has been changed.', v_fn;
    end if;

    -- EXACTLY one hardcoded header value, or stop. Zero means it has already been
    -- moved (a second run?) or the body has changed shape; two means something
    -- this migration was not written for.
    select count(*) into v_hits from regexp_matches(v_def, v_pattern, 'g');
    if v_hits <> 1 then
      raise exception
        '0038: expected exactly one hardcoded x-push-secret value in public.%, found %. '
        'Nothing has been changed.', v_fn, v_hits;
    end if;

    v_new := regexp_replace(v_def, v_pattern, v_lookup);

    -- Check the rewrite before executing it: the Vault lookup appears exactly
    -- once, the hardcoded form is gone, and no quoted long hex literal survives.
    if (length(v_new) - length(replace(v_new, v_marker, ''))) / length(v_marker) <> 1
       or v_new ~ v_pattern
       or v_new ~ '''[0-9A-Fa-f]{24,}''' then
      raise exception '0038: the rewritten public.% did not come out as expected. Nothing has been changed.', v_fn;
    end if;

    -- CREATE OR REPLACE keeps the function's owner, grants and trigger bindings.
    execute v_new;

    -- And read it back from the catalogue, rather than trusting the execute.
    select pg_get_functiondef(v_oid) into v_def;
    if v_def ~ '''[0-9A-Fa-f]{24,}''' or position(v_marker in v_def) = 0 then
      raise exception '0038: public.% did not read back as expected after re-creation.', v_fn;
    end if;

    raise notice '0038: public.% now reads push_hook_secret from Vault.', v_fn;
  end loop;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0038', 'push_secret_from_vault', 'd02ddb27195767eebf6aa9e42666228290ea07017f8eef218aec771b0820260c');

commit;


-- ===========================================================================
-- VERIFY — after applying. Nothing here prints a secret or a function body.
--
-- ── BLOCK A — neither function holds a hardcoded value any more ──────────
--
--   select p.proname,
--          pg_get_functiondef(p.oid) ~ '''[0-9A-Fa-f]{24,}'''          as still_has_hex_literal,
--          position('name = ''push_hook_secret''' in pg_get_functiondef(p.oid)) > 0
--                                                                     as reads_from_vault,
--          (select string_agg(t.tgname, ', ') from pg_trigger t
--             where t.tgfoid = p.oid and not t.tgisinternal)          as still_fired_by
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('tg_message_push', 'tg_notify_push');
--
--   Expect both: still_has_hex_literal false, reads_from_vault true, and
--   still_fired_by message_push / notify_push.
--
-- ── BLOCK B — a push actually goes through ──────────────────────────────
--
--   Send yourself a message or a notification from the app, then:
--
--   select id, status_code, left(content::text, 80) as content, error_msg, created
--   from net._http_response
--   order by created desc
--   limit 5;
--
--   Expect 200 with {"sent":…} for the request just made. A 403 means the header
--   and PUSH_HOOK_SECRET do not match — check both were set to the same value.
--   send-push's responses carry counts and error text, never the secret.
--
--   This is the check that matters. Block A proves the definitions changed; only
--   Block B proves the secret in Vault and the one in the edge function agree.
-- ===========================================================================


-- ===========================================================================
-- ⚠️ STAMP BEFORE YOU APPLY — NOT AFTER
--
--   node scripts/migration-status.mjs --stamp     <- BEFORE pasting this file
--   (paste the whole file into the Supabase SQL editor)
--   node scripts/migration-status.mjs             <- confirm: applied, no drift
--
-- WHY THE ORDER MATTERS. A new file's footer says PENDING_CHECKSUM, and
-- --stamp replaces it with the real checksum. Apply first and the database
-- records the literal string PENDING_CHECKSUM, which the checksum written
-- afterwards can never match, so the ledger reads DRIFTED from then on. 0040
-- was applied that way on 11 Sep 2026 and needed a reconcile by hand.
--
-- This block used to say "LAST STEP, EVERY TIME" and name only the status
-- report. That was correct about the report and SILENT about stamping — which
-- is how a migration written by copying the nearest file gets applied
-- unstamped. Swept across every migration on 13 Sep 2026, audit item 41.
--
-- The status report is still worth running last. It catches what no verify
-- block can: a migration written, committed, and never applied at all. 0009 sat
-- in that state for a day and was noticed by eye. A check that depends on
-- someone noticing is not a check. It needs the service-role key in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
--
-- Editing this block on an APPLIED migration is safe, and that is measured
-- rather than assumed: it sits BELOW the MIGRATION FOOTER line, the checksum
-- covers only what is above that line, and every body checksum in this
-- directory was recomputed before and after the sweep.
-- ===========================================================================

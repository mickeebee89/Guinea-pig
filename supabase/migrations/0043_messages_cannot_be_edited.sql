-- ===========================================================================
-- 0043_messages_cannot_be_edited
--
-- A sent message cannot be changed by anyone using the app. Not your own, not
-- the other person's. Audit item 59. Decision: Micky, 20 Sep 2026 — "block
-- edits entirely", with read receipts kept.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- "participants can update messages" (schema-snapshot-2026-08-08-policies.sql:76-79)
-- is a PERMISSIVE UPDATE policy for `authenticated` whose only test is that the
-- caller is the booking's model or its stylist. RLS CANNOT RESTRICT COLUMNS —
-- column control in Postgres is a GRANT, not a policy — so either party could
-- UPDATE any column of any message in the booking: `body`, `sender_id`,
-- `created_at`, their own or the other person's.
--
-- Two consequences, in the order they matter:
--
--   1. MESSAGES ARE EVIDENCE. A report can quote a chat and an admin reads the
--      chat to decide it. Either party could rewrite what the other said,
--      before or after a report was made.
--   2. It walked round 0042. That screen is BEFORE INSERT, so a message that
--      passed it could be changed to anything with one PATCH.
--
-- ── ⚠️ THE GRANT IS WHAT CLOSES THIS, NOT THE POLICY ────────────────────
-- The policy is left exactly as it is, and it is still the ROW rule: who may
-- touch which rows. Note that it has no WITH CHECK, so Postgres reuses its
-- USING clause for the check — which is why a participant could write as well
-- as read the rows it matches, and why tightening the policy alone would not
-- have fixed this without also changing who can mark a message read.
--
-- What changes is the COLUMN privilege:
--
--   revoke update on public.messages from public, anon, authenticated
--   grant  update (read_at) on public.messages to authenticated
--
-- After this, an UPDATE naming any other column is refused by Postgres itself
-- with 42501, before RLS is consulted. `body` and `sender_id` are UNWRITABLE
-- BY ANY END USER, on either client, through PostgREST, by any route.
--
-- ── WHAT STAYS WRITABLE, DELIBERATELY ───────────────────────────────────
-- `read_at`, including on the OTHER person's messages. That is not an
-- oversight: it is how a read receipt is recorded. A receipt says "I have read
-- what you sent", so the reader necessarily writes to the sender's row. All
-- four call sites do exactly that:
--
--   site/app/(app)/messages/[sessionId]/ChatThread.tsx:67-70   one arriving message
--   site/lib/queries/thread.ts:132-137                         the thread, on open
--   mobile/src/app/(app)/chat/[sessionId].tsx:234-240          the thread, on open
--   mobile/src/app/(app)/chat/[sessionId].tsx:273-277          one arriving message
--
-- Searched on 20 Sep across site, mobile/src, admin, seed, scripts and
-- supabase/functions: those four are the ONLY updates of this table anywhere,
-- and every one of them writes read_at and nothing else. The console does not
-- update messages. No SQL function does.
--
-- The remaining freedom is that a participant can set, or clear, read_at on
-- messages in their own booking. Someone could mark a message unread, or read,
-- dishonestly. That is the cost of receipts working at all, and it changes no
-- content.
--
-- ── WHAT service_role RETAINS, AND WHY ──────────────────────────────────
-- Everything. service_role keeps full UPDATE on public.messages, because:
--
--   * it is the identity the edge functions and seed/teardown run as
--     (seed/seed.mjs:457 inserts demo chat), and a support fix or a data
--     repair has to remain possible without a migration;
--   * it bypasses RLS entirely, so it was never constrained by the policy this
--     migration works alongside;
--   * nothing reachable by a signed-in person runs as service_role. The key
--     lives in edge-function secrets and in Micky's shell, never in a client
--     bundle (checked 18 Sep: no SERVICE_ROLE reference in site/ or admin/).
--
-- So "nobody can edit a message" means nobody using the app. An admin with the
-- service-role key still can, and that is the same standing as every other
-- table.
--
-- ── WHY REVOKING FROM public IS PART OF IT ──────────────────────────────
-- A privilege held by PUBLIC is held by every role, so revoking from
-- `authenticated` alone would leave the door open if PUBLIC had UPDATE. The
-- ASSERT below refuses to run unless service_role's UPDATE is granted to
-- service_role EXPLICITLY — because if service_role's access came only via
-- PUBLIC, this migration would take it away and break seeding and support.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the shape this was written against.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.messages') is null then
    raise exception '0043: public.messages is missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'read_at'
  ) then
    raise exception '0043: public.messages.read_at is missing — it is the one column this grants back.';
  end if;

  -- The row rule this migration deliberately leaves alone. If it has been
  -- renamed or dropped, the reasoning in the header no longer describes
  -- reality and someone should read both before applying.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and cmd = 'UPDATE'
  ) then
    raise exception '0043: no UPDATE policy on public.messages — the header assumes "participants can update messages" is the row rule. Read it before applying.';
  end if;

  -- ⚠️ service_role must hold UPDATE in its OWN right, not through PUBLIC.
  -- Otherwise the revoke below silently removes it.
  --
  -- Read from the table's ACL rather than information_schema.role_table_grants:
  -- those views only show grants involving roles the CALLER is a member of, so
  -- a true grant can read as absent and this assert would refuse a correct
  -- migration. aclexplode has no such caveat.
  if not exists (
    select 1
    from pg_class c, aclexplode(c.relacl) a
    where c.oid = 'public.messages'::regclass
      and a.grantee = 'service_role'::regrole
      and a.privilege_type = 'UPDATE'
  ) then
    raise exception '0043: service_role does not hold UPDATE on public.messages in its own right. Revoking from PUBLIC would take away the access the edge functions and seed scripts rely on. Grant it explicitly first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE — who could update this table before the change, so the record shows
-- what was taken away rather than what someone remembers being there.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0043',
       'update_grant_before_' || coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'),
       'table-level UPDATE'
from pg_class c, aclexplode(c.relacl) a
where c.oid = 'public.messages'::regclass and a.privilege_type = 'UPDATE';

insert into public.migration_findings (version, item, value)
select '0043', 'update_policy_' || policyname,
       'permissive=' || permissive || ', with_check=' || coalesce(with_check, 'null (USING reused)')
from pg_policies
where schemaname = 'public' and tablename = 'messages' and cmd = 'UPDATE';

-- ---------------------------------------------------------------------------
-- THE CHANGE.
--
-- Column-level, because that is the only thing in Postgres that can say "this
-- column and not that one". The policy above still decides WHICH ROWS; this
-- decides WHICH COLUMNS. Both apply: a participant may write read_at on rows
-- in their own booking, and nothing else, anywhere.
-- ---------------------------------------------------------------------------
revoke update on public.messages from public, anon, authenticated;

grant update (read_at) on public.messages to authenticated;

-- anon is given nothing back on purpose: a signed-out caller cannot be a
-- participant, so it has no read receipt to record.

comment on column public.messages.read_at is
  'When the recipient read this message. The ONLY column an end user may update (0043): table-level '
  'UPDATE is revoked from public, anon and authenticated, and only update(read_at) is granted back to '
  'authenticated. Writable on the OTHER person''s messages by design — a receipt is the reader saying '
  '"I have read what you sent" — bounded to their own booking by the participant policy, which is '
  'left as the row rule. body and sender_id are unwritable by any end user: audit item 59, where '
  'either party could rewrite any message in a booking, including the other person''s.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0043', 'messages_cannot_be_edited', '201ff6b7b1a272ca51f570db1faf3eb2da0dff82d54bec51932f55223a1730d3');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Each block is one self-contained paste.
--
-- ── BLOCK A — the table grants as they now stand ────────────────────────
--
-- Read from the ACL, not information_schema: those views hide grants for roles
-- the caller is not a member of, which would make a real grant read as absent.
-- A grantee of '-' is PUBLIC.
--
--   select coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC') as grantee,
--          a.privilege_type
--   from pg_class c, aclexplode(c.relacl) a
--   where c.oid = 'public.messages'::regclass
--   order by 1, 2;
--
--   Expect NO row with privilege_type UPDATE for PUBLIC, anon or authenticated.
--   service_role must still have UPDATE, alongside its other privileges.
--   authenticated keeps SELECT and INSERT: sending and reading are untouched.
--
-- ── BLOCK B — and the one column that was granted back ──────────────────
--
--   select att.attname as column_name,
--          coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC') as grantee,
--          a.privilege_type
--   from pg_attribute att, aclexplode(att.attacl) a
--   where att.attrelid = 'public.messages'::regclass
--     and att.attacl is not null
--   order by 1, 2, 3;
--
--   Expect exactly one row: read_at, authenticated, UPDATE. Any other column
--   listed for authenticated is a column an end user can still rewrite. A
--   column-level ACL exists only where one was granted, so every other column
--   returning nothing is the correct result, not a missing answer.
--
-- ── BLOCK C — a real participant can mark read, and cannot edit the text.
--               Rolls itself back ──────────────────────────────────────────
--
-- Uses the model test account (b0df9c2f…, CLAUDE.md) and its most recent
-- booking that actually has a message in it.
--
--   do $$
--   declare
--     v_user uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_msg  uuid; n integer; v_log text := '';
--   begin
--     select m.id into v_msg
--     from public.messages m
--     join public.sessions s on s.id = m.session_id
--     where s.model_user_id = v_user
--     order by m.created_at desc
--     limit 1;
--     if v_msg is null then
--       raise exception '0043 Block C: the model test account has no messages — cannot exercise this.';
--     end if;
--
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_user), true);
--     set local role authenticated;
--
--     begin
--       update public.messages set read_at = now() where id = v_msg;
--       get diagnostics n = row_count;
--       v_log := v_log || format(E'\nread_at: %s row(s)   (1 is correct — receipts still work)', n);
--     exception when others then
--       v_log := v_log || format(E'\nread_at: BLOCKED %s (%s)   <-- WRONG, receipts are broken', sqlstate, sqlerrm);
--     end;
--
--     begin
--       update public.messages set body = body || ' edited' where id = v_msg;
--       get diagnostics n = row_count;
--       v_log := v_log || format(E'\nbody:    %s row(s)   <-- STILL EDITABLE', n);
--     exception when insufficient_privilege then
--       v_log := v_log || E'\nbody:    refused, 42501 insufficient_privilege (correct)';
--     when others then
--       v_log := v_log || format(E'\nbody:    refused %s (%s)   <-- unexpected code', sqlstate, sqlerrm);
--     end;
--
--     begin
--       update public.messages set sender_id = v_user where id = v_msg;
--       get diagnostics n = row_count;
--       v_log := v_log || format(E'\nsender:  %s row(s)   <-- STILL EDITABLE', n);
--     exception when insufficient_privilege then
--       v_log := v_log || E'\nsender:  refused, 42501 insufficient_privilege (correct)';
--     when others then
--       v_log := v_log || format(E'\nsender:  refused %s (%s)   <-- unexpected code', sqlstate, sqlerrm);
--     end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.%', v_log;
--   end $$;
--
--   Expect: read_at 1 row, body refused 42501, sender refused 42501. The
--   refusal is the GRANT, not the policy — Postgres checks column privileges
--   before it consults RLS.
--
-- ── BLOCK D — the row rule still bounds read_at to your own booking.
--               Rolls itself back ──────────────────────────────────────────
--
--   do $$
--   declare
--     v_msg uuid; v_outsider uuid; n integer;
--   begin
--     select m.id into v_msg from public.messages m order by m.created_at desc limit 1;
--     select u.id into v_outsider
--     from public.users u
--     where u.id not in (
--       select s.model_user_id from public.sessions s
--        join public.messages m2 on m2.session_id = s.id where m2.id = v_msg
--       union
--       select p.user_id from public.sessions s
--        join public.providers p on p.id = s.provider_id
--        join public.messages m2 on m2.session_id = s.id where m2.id = v_msg)
--     limit 1;
--     if v_msg is null or v_outsider is null then
--       raise exception '0043 Block D: no message, or no non-participant to test with.';
--     end if;
--
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_outsider), true);
--     set local role authenticated;
--     update public.messages set read_at = now() where id = v_msg;
--     get diagnostics n = row_count;
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nnon-participant read_at: % row(s) — 0 is correct', n;
--   end $$;
--
--   Expect 0 rows: the policy refuses the row, so nothing matches. A row count
--   here would mean the participant policy is not doing its half.
--
-- ── BLOCK E — sending still works, and 0042 still screens it ────────────
--
-- The grant touched UPDATE only. This confirms INSERT is unaffected and the
-- banned-words screen still fires. Same shape as 0042's Block D.
--
--   do $$
--   declare
--     v_user uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_sess uuid; v_w text; v_log text := '';
--   begin
--     select id into v_sess from public.sessions
--      where model_user_id = v_user order by date desc limit 1;
--     if v_sess is null then
--       raise exception '0043 Block E: no booking for the model test account.';
--     end if;
--     select btrim(w) into v_w
--       from jsonb_array_elements_text((select value::jsonb from public.settings
--                                       where key = 'banned_words')) w
--      where btrim(w) <> '' limit 1;
--
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_user), true);
--     set local role authenticated;
--
--     begin
--       insert into public.messages (session_id, sender_id, body)
--         values (v_sess, v_user, 'verify 0043 plain control');
--       v_log := v_log || E'\nplain send:  inserted (correct)';
--     exception when others then
--       v_log := v_log || format(E'\nplain send:  refused %s (%s)', sqlstate, sqlerrm);
--     end;
--
--     begin
--       insert into public.messages (session_id, sender_id, body)
--         values (v_sess, v_user, 'verify 0043 ' || v_w);
--       v_log := v_log || E'\nlisted word: INSERTED  <-- 0042 NO LONGER SCREENING';
--     exception when sqlstate 'CV001' then
--       v_log := v_log || E'\nlisted word: refused, CV001 (correct)';
--     when others then
--       v_log := v_log || format(E'\nlisted word: refused %s (%s)', sqlstate, sqlerrm);
--     end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.%', v_log;
--   end $$;
--
--   Expect the plain send to insert and the listed word to be refused CV001.
--   A plain send refused by RLS (a cancelled or blocked booking) says so and is
--   not a failure of this migration.
-- ===========================================================================


-- ===========================================================================
-- ⚠️ STAMPED BY HAND. DO NOT RUN --stamp.
--
-- Audit item 60: `node scripts/migration-status.mjs --stamp` replaces the FIRST
-- occurrence of the pending sentinel in every file that contains it, and the
-- 13 Sep sweep put that sentinel in the comment of every migration from 0001 to
-- 0041. One run rewrites all of them. This file was therefore written with its
-- own placeholder, checksummed directly, and the value pasted in:
--
--   node -e "const fs=require('fs'),c=require('crypto');const p='supabase/migrations/0043_messages_cannot_be_edited.sql';const s=fs.readFileSync(p,'utf8');console.log(c.createHash('sha256').update(s.slice(0,s.indexOf('-- MIGRATION FOOTER')).replace(/\r\n/g,'\n'),'utf8').digest('hex'))"
--
-- That is the same calculation the script performs (checksumOf,
-- scripts/migration-status.mjs:118-122): sha256 of everything ABOVE the footer
-- line, with CRLF normalised. Nothing below the footer affects it, which is why
-- this block can say so.
--
-- THE ORDER STILL MATTERS. The checksum must be in the file BEFORE it is
-- pasted into the SQL editor. Apply it with a placeholder and the database
-- records the placeholder, which nothing afterwards can match, and the ledger
-- reads DRIFTED from then on — 0040, 11 Sep 2026.
--
-- AFTER APPLYING, confirm the ledger. It needs the service-role key in the
-- shell, and it is the only check that catches a migration written, committed
-- and never applied:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
--   node scripts/migration-status.mjs
-- ===========================================================================

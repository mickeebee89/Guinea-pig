-- ===========================================================================
-- 0098_anon_writes_nothing_in_public
--
-- Item 206. ⚠️ Apply 0097 first. ⚠️ TOUCHES NO TABLE, NO POLICY AND NO BODY.
-- It removes grants.
--
-- Revokes INSERT, UPDATE, DELETE and TRUNCATE from `anon` on every base table
-- in `public` that holds one. Measured 12 Oct 2026: **42 tables, 145 grants.**
--
-- ── ⚠️⚠️ WHY IT IS SAFE BY CONSTRUCTION, AND NOT BY TESTING ────────────────
-- **Not one PERMISSIVE policy in `public` grants `anon` an INSERT, UPDATE,
-- DELETE or ALL** (measured: zero). Every one of these 42 tables has RLS
-- enabled. So every anon write is already filtered to zero rows before it
-- reaches a row.
--
-- ✅ **A REVOKE CANNOT BREAK WHAT RLS ALREADY BLOCKS.** No working feature can
-- depend on a privilege that no policy permits — not because nothing has been
-- observed using it, but because nothing *could*. That turns "will this break
-- the public form" from a worry into a question the measurement answers.
--
-- ⚠️ THE ONE PUBLIC WRITE PATH A VISITOR PLAUSIBLY USED WAS CHECKED ANYWAY,
-- because "no policy permits it" is an argument and a named feature is a fact.
-- The waitlist: **three independent reasons it is unaffected.**
--   1. There is no public waitlist form. `site/app/(public)/for-stylists/
--      page.tsx:50-57` records it closed on 22 Sep 2026 (item 71); the only
--      surviving references are prose saying so.
--   2. ⚠️ **It never used `anon`.** `supabase/functions/waitlist-signup/
--      index.ts:15` builds its client with `SUPABASE_SERVICE_ROLE_KEY`, so
--      **`service_role` performed that insert** — which this migration does not
--      touch. The function header calls it "a public, ANONYMOUS endpoint",
--      which describes the CALLER, not the database role. Reading that line as
--      the role is exactly the mistake this note exists to prevent.
--   3. The function is not deployed (CLAUDE.md: six functions exist, not this).
--
-- ── ⚠️⚠️ TRUNCATE IS THE PART RLS CANNOT HELP WITH. READ THIS TWICE. ───────
-- **ROW-LEVEL SECURITY DOES NOT APPLY TO TRUNCATE AT ALL.** It is not a
-- row-filtered operation; a policy has nothing to filter. So the paragraph
-- above — RLS blocks every anon write — **is false for TRUNCATE, and TRUNCATE
-- was granted on all 42 tables.**
--
-- ⚠️ THE ONLY THING STANDING IN FRONT OF IT TODAY IS THAT **PostgREST EXPOSES
-- NO TRUNCATE VERB.** That is a property of the API layer, not of the database.
-- It is not a grant, not a policy and not a constraint; it is the absence of a
-- feature in a piece of software in front of the database, and it would stop
-- being true if anything else ever connected with the anon key.
--
-- ⚠️ AND ITS REACHABILITY IS UNPROVEN, NOT DISPROVEN. The probe that would have
-- settled it could not run: `EXPLAIN` does not accept TRUNCATE, so nothing was
-- measured. `has_table_privilege('anon', …, 'TRUNCATE')` returned **true**. The
-- grant exists; whether anything can reach it was never established. **Do not
-- let this be recorded as safe.**
--
-- ── ⚠️ WHAT THIS DOES NOT TOUCH, DELIBERATELY ──────────────────────────────
-- * **SELECT.** `anon` needs read access for the public pages and keeps every
--   one of its **45** SELECT grants. The verify asserts that number before and
--   after, because a privilege migration that quietly took a read grant would
--   present as the public website going blank.
-- * **`authenticated`.** Never swept, and its grants are a different problem:
--   on a TABLE there is no owner bypass, so RLS applies normally and many of
--   those grants are live features. Its own item.
-- * **`service_role`.** What the edge functions use. Asserted unchanged.
-- * **The six views.** `public_profiles` and `public_categories` are
--   auto-updatable and owned by `postgres`, so a write through either would run
--   as the owner and **bypass RLS on `users` entirely** — ⚠️ `authenticated`
--   held the identical `arwdDxtm` set, SELECT included, so every signed-in
--   account could have issued a targeted DELETE against `users`. Both roles'
--   write grants were revoked **by hand on 12 Oct 2026**, before this migration.
--   0098 **asserts that as state and does not re-issue it**: re-issuing would
--   have the framework record a change it did not make.
--
-- ── ⚠️ TABLE-LEVEL IS SUFFICIENT HERE, AND THAT WAS MEASURED ───────────────
-- A table-level `REVOKE` does **not** clear `pg_attribute.attacl`, so a
-- table-wide revoke leaves column-level grants standing — and a table-level
-- end-state check would PASS while they did. 0088 is the precedent: it did
-- `revoke update on public.users from authenticated, anon` and then
-- `grant update (col, …) … to authenticated`.
--
-- ✅ Measured 12 Oct 2026: **`anon` holds no column-level write grant anywhere
-- in `public`**, so a table-level revoke is enough. The end state asserts both
-- forms regardless, because the assertion should hold whatever a later reader
-- changes.
--
-- ── ⚠️ WHY THE LOOP CANNOT PRINT WHAT IT TOUCHED ───────────────────────────
-- `raise notice` is invisible in the Supabase SQL editor (the lesson 0090's
-- verify cost five rounds), and a DO block cannot return a result set. **So the
-- list is captured BEFORE the change, by the preflight, not after it by this
-- migration.** What this file does instead is refuse unless the population is
-- exactly what was listed: 42 tables and 145 grants, counted two different ways
-- that must agree.
--
-- ── ⚠️⚠️ THE TWO COUNTS, AND WHY THEIR AGREEMENT IS THE REAL GATE ──────────
-- `has_table_privilege` answers "can anon do this", which is TRUE for a
-- privilege held **via PUBLIC or via role membership** as well as by a direct
-- grant. `information_schema.role_table_grants` lists only grants made **to
-- anon**. ⚠️ `revoke … from anon` removes only the latter.
--
-- So if the two counts disagree, some privilege is not anon's to lose: it comes
-- from a grant to PUBLIC, and revoking PUBLIC would take it from
-- `authenticated` and `service_role` too. **This migration refuses rather than
-- guessing which.** Their agreement is what proves every one of the 145 is a
-- direct grant.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- ===========================================================================
begin;

do $mig$
declare
  v_tab_h   integer;  -- tables, by has_table_privilege
  v_grt_h   integer;  -- grants, by has_table_privilege
  v_grt_i   integer;  -- grants, by information_schema (direct to anon only)
  v_sel     integer;
  v_auth    integer;
  v_svc     integer;
  v_sel2    integer;
  v_auth2   integer;
  v_svc2    integer;
  v_pub     text;
  v_col     text;
  v_views   text;
  v_done    integer := 0;
  v_left    text;
  r         record;
begin
  if not exists (select 1 from public.schema_migrations where version = '0097') then
    raise exception '0098: apply 0097 first.';
  end if;

  -- ── (a) THE POPULATION, COUNTED TWO WAYS ────────────────────────────────
  select count(distinct c.oid), count(*)
    into v_tab_h, v_grt_h
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as pr(p)
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, pr.p);

  select count(*) into v_grt_i
    from information_schema.role_table_grants g
   where g.grantee = 'anon' and g.table_schema = 'public'
     and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = g.table_name
                    and c.relkind = 'r');

  if v_tab_h <> 42 or v_grt_h <> 145 then
    raise exception '%', '0098: expected 42 base tables and 145 anon write grants (measured 12 Oct '
      || '2026); found ' || v_tab_h || ' table(s) and ' || v_grt_h || ' grant(s). THE DATABASE HAS '
      || 'MOVED SINCE THIS WAS WRITTEN — re-run preflight0098 and read the list before changing '
      || 'the numbers here. Nothing changed.';
  end if;

  -- ⚠️ THE AGREEMENT GATE. See the header: a difference means some privilege is
  -- not a direct grant to anon and `revoke … from anon` would not remove it.
  if v_grt_h <> v_grt_i then
    raise exception '%', '0098: anon can perform ' || v_grt_h || ' write(s) but only ' || v_grt_i
      || ' are granted TO anon. The difference comes from a grant to PUBLIC or from role '
      || 'membership, and `revoke … from anon` cannot remove either — while revoking PUBLIC would '
      || 'take the privilege from authenticated and service_role as well. ⚠️ THIS MIGRATION WILL '
      || 'NOT GUESS WHICH. Read the ACLs and decide. Nothing changed.';
  end if;

  -- ⚠️ AND NAME ANY PUBLIC WRITE GRANT EXPLICITLY, because the count check
  -- above would miss one that anon ALSO holds directly.
  select string_agg(c.relname || ' := ' || array_to_string(c.relacl, ' '), chr(10)
                    order by c.relname)
    into v_pub
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relacl is not null
     and exists (select 1 from unnest(c.relacl) x
                  where x::text like '=%'
                    and (x::text like '=%a%' or x::text like '=%w%'
                         or x::text like '=%d%' or x::text like '=%D%'));
  if v_pub is not null then
    raise exception '%', '0098: PUBLIC holds a write grant on one or more tables. Revoking from anon '
      || 'would leave it, and revoking from PUBLIC would reach authenticated and service_role. '
      || 'Nothing changed.' || chr(10) || v_pub;
  end if;

  -- (b) COLUMN-LEVEL GRANTS. Measured as none; asserted anyway, because a
  -- table-level revoke would not clear attacl and the end state must not be
  -- able to pass while one stands.
  select string_agg(c.relname || '.' || a.attname, ', ' order by c.relname, a.attname)
    into v_col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
     and a.attacl is not null
     and exists (select 1 from unnest(a.attacl) x
                  where x::text like 'anon=%'
                    and (x::text like 'anon=%a%' or x::text like 'anon=%w%'));
  if v_col is not null then
    raise exception '%', '0098: anon holds COLUMN-level write grant(s), which a table-level revoke '
      || 'does NOT remove: ' || v_col || '. This migration only does table-level revokes, so it '
      || 'would report success and leave these standing. Nothing changed.';
  end if;

  -- (c) ⚠️ THE PREMISE. If any PERMISSIVE policy grants anon a write, some
  -- feature might genuinely depend on it and "safe by construction" is false.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and permissive = 'PERMISSIVE'
                and cmd in ('INSERT','UPDATE','DELETE','ALL') and 'anon' = any(roles)) then
    raise exception '%', '0098: a PERMISSIVE policy grants anon a write, so the header''s '
      || '"a revoke cannot break what RLS already blocks" is NOT true here. Read it before '
      || 'applying. Nothing changed.' || chr(10)
      || (select string_agg(tablename || '/' || policyname || ' [' || cmd || ']', ', '
                            order by tablename, policyname)
            from pg_policies
           where schemaname = 'public' and permissive = 'PERMISSIVE'
             and cmd in ('INSERT','UPDATE','DELETE','ALL') and 'anon' = any(roles));
  end if;

  -- (d) THE VIEWS, AS STATE. ⚠️ Revoked BY HAND on 12 Oct 2026; this asserts
  -- and does not re-issue. public_profiles and public_categories are
  -- auto-updatable and owned by postgres, so a write through either bypasses
  -- RLS on the base table — for BOTH roles, which is why both are checked.
  select string_agg(c.relname, ', ' order by c.relname) into v_views
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and (has_table_privilege('anon', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE')
       or has_table_privilege('anon', c.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', c.oid, 'INSERT')
       or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('authenticated', c.oid, 'DELETE')
       or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  if v_views is not null then
    raise exception '%', '0098: a view in public still carries a write grant for anon or '
      || 'authenticated: ' || v_views || '. ⚠️ An auto-updatable view owned by the base table''s '
      || 'owner bypasses RLS entirely, so this is the severe form of this finding and it must be '
      || 'clear before the table revokes are recorded as a fix. Revoke it by hand, then re-run. '
      || 'Nothing changed.';
  end if;

  -- (e) THE BEFORE-NUMBERS FOR EVERYTHING THIS MUST NOT TOUCH.
  select count(*) into v_sel
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT';
  if v_sel <> 45 then
    raise exception '0098: anon holds % SELECT grant(s) in public, expected 45 (measured 12 Oct 2026). Nothing changed.', v_sel;
  end if;
  select count(*) into v_auth
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public';
  select count(*) into v_svc
    from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public';

  -- ── THE LOOP ────────────────────────────────────────────────────────────
  -- ⚠️ DRIVEN BY WHAT IS ACTUALLY HELD, not by a list written into this file. A
  -- fixed list goes stale against a database that has gained a table; this
  -- cannot, and the count gate above is what makes the loop's scope auditable.
  for r in
    select c.oid::regclass as rel, pr.p as priv
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as pr(p)
     where n.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('anon', c.oid, pr.p)
     order by c.relname, pr.p
  loop
    -- %s for the privilege keyword and the relation: both come from this file's
    -- own array and from pg_class, neither from anything a client can set.
    execute format('revoke %s on table %s from anon', r.priv, r.rel);
    v_done := v_done + 1;
  end loop;

  if v_done <> 145 then
    raise exception '0098: the loop revoked % grant(s), expected 145. Rolled back.', v_done;
  end if;

  -- ── THE END STATE, ASSERTED FROM THE CATALOGUE ──────────────────────────
  -- ⚠️ (f) ZERO, COUNTED FRESH. Not `v_done = 145`, which is a report about the
  -- loop; this is a statement about the database, so a filter that disagreed
  -- with the counting query rolls the migration back instead of passing over an
  -- incomplete set.
  select string_agg(c.relname || ' ' || pr.p, ', ' order by c.relname, pr.p)
    into v_left
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as pr(p)
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, pr.p);
  if v_left is not null then
    raise exception '%', '0098: anon can STILL write after the loop: ' || v_left
      || '. A privilege held via PUBLIC, via role membership, or at column level would survive '
      || '`revoke … from anon`. Rolled back.';
  end if;

  -- (g) AND NOT AT COLUMN LEVEL EITHER. has_any_column_privilege asks the
  -- question has_table_privilege cannot.
  select string_agg(c.relname, ', ' order by c.relname) into v_left
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_any_column_privilege('anon', c.oid, 'INSERT')
       or has_any_column_privilege('anon', c.oid, 'UPDATE'));
  if v_left is not null then
    raise exception '%', '0098: anon still holds a COLUMN-level write on: ' || v_left
      || '. Rolled back.';
  end if;

  -- (h) THE THREE CONTROLS. ⚠️ Each one bounds a different blast radius: SELECT
  -- is what the public website needs, authenticated is every live feature, and
  -- service_role is the edge functions.
  select count(*) into v_sel2
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT';
  if v_sel2 <> 45 then
    raise exception '%', '0098: anon''s SELECT grants went from 45 to ' || v_sel2
      || '. This migration must not touch SELECT — the public website reads with it. Rolled back.';
  end if;
  select count(*) into v_auth2
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public';
  select count(*) into v_svc2
    from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public';
  if v_auth2 <> v_auth or v_svc2 <> v_svc then
    raise exception '%', '0098: a grant moved on a role this migration must not touch — '
      || 'authenticated ' || v_auth || '→' || v_auth2
      || ', service_role ' || v_svc || '→' || v_svc2 || '. Rolled back.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0098', 'anon_writes_nothing_in_public', 'e0cbd2c269c8c617b3249ac0a5214ba5491686ed0c7dea76491ad082d983247d');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — three blocks, all run 12 Oct 2026. The files were deleted
-- after applying; their findings are below and in audit items 206, 207 and
-- 208, and the view-write sweep is kept re-runnable in item 206 because
-- NOTHING WATCHES FOR A SEVENTH VIEW.
--
--   MEASURED: 42 base tables / 145 anon write grants · 0 PERMISSIVE policies
--   grant anon a write · anon SELECT = 45 · anon holds NO column-level write
--   grant · the six views clean for both anon and authenticated after the
--   hand-run revokes · public_profiles and public_categories auto-updatable,
--   owner=postgres, security_invoker=FALSE, users FORCE rls=false.
--
-- ⚠️ 0098b EXISTS BECAUSE 0098's ROWS 8 AND 9 MEASURED THE WRONG THING. Both
-- probed `set first_name = first_name`, whose right-hand side READS the column,
-- so both were refused for lack of SELECT — by my own probe, not by a guard.
-- **A refusal for the wrong reason is not a pass**, and it reported the safe
-- answer, which is the worst direction for a wrong probe to fail in.
--
-- ⚠️ ROW 10 MEASURED NOTHING. `EXPLAIN` does not accept TRUNCATE. See the
-- header: the grant exists and its reachability is unproven, not disproven.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION. Catalogue reads only. Every number is measured here, and
-- line 7 says which side of the apply it is on (item 188's ninth).
--
--   do $$
--   declare
--     r_zero text := 'not run';
--     r_col  text := 'not run';
--     r_sel  text := 'not run';
--     r_auth text := 'not run';
--     r_view text := 'not run';
--     r_trunc text := 'not run';
--     r_appl text := 'not run';
--     v_n    integer;
--     v_txt  text;
--   begin
--     -- 1 ⚠️ THE END STATE, counted fresh rather than reported from the loop.
--     select count(*), string_agg(c.relname || ' ' || pr.p, ', ' order by c.relname, pr.p)
--       into v_n, v_txt
--       from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as pr(p)
--      where n.nspname = 'public' and c.relkind = 'r'
--        and has_table_privilege('anon', c.oid, pr.p);
--     r_zero := case when v_n = 0 then 'pass  - anon holds 0 write grants on 0 base tables in public'
--                    else 'FAIL  - ' || v_n || ' remain: ' || v_txt end;
--
--     -- 2 ⚠️ NOT A DUPLICATE OF 1. A table-level revoke does not clear attacl,
--     -- so a column-level grant survives it and line 1 would still pass.
--     select count(*) into v_n
--       from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relkind = 'r'
--        and (has_any_column_privilege('anon', c.oid, 'INSERT')
--          or has_any_column_privilege('anon', c.oid, 'UPDATE'));
--     r_col := case when v_n = 0 then 'pass  - and none at column level either'
--                   else 'FAIL  - ' || v_n || ' table(s) still carry a column-level anon write' end;
--
--     -- 3 ⚠️ THE CONTROL THAT MATTERS MOST TO A VISITOR. If this moved, the
--     -- public website stopped reading.
--     select count(*) into v_n
--       from information_schema.role_table_grants
--      where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT';
--     r_sel := case when v_n = 45 then 'pass  - anon SELECT still exactly 45'
--                   else 'FAIL  - anon SELECT is ' || v_n || ', was 45' end;
--
--     -- 4 authenticated and service_role untouched
--     select count(*) into v_n
--       from information_schema.role_table_grants
--      where grantee in ('authenticated','service_role') and table_schema = 'public'
--        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--     r_auth := 'info  - authenticated + service_role hold ' || v_n
--               || ' write grant(s) in public; 0098 did not touch either role, and authenticated''s '
--               || 'are their own item';
--
--     -- 5 ⚠️ THE SEVERE HALF, ASSERTED AS STATE. Revoked by hand, not by 0098.
--     select string_agg(c.relname, ', ' order by c.relname) into v_txt
--       from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relkind = 'v'
--        and (has_table_privilege('anon', c.oid, 'INSERT')
--          or has_table_privilege('anon', c.oid, 'UPDATE')
--          or has_table_privilege('anon', c.oid, 'DELETE')
--          or has_table_privilege('anon', c.oid, 'TRUNCATE')
--          or has_table_privilege('authenticated', c.oid, 'INSERT')
--          or has_table_privilege('authenticated', c.oid, 'UPDATE')
--          or has_table_privilege('authenticated', c.oid, 'DELETE')
--          or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
--     r_view := case when v_txt is null
--                    then 'pass  - no view in public carries a write for anon or authenticated'
--                    else 'FAIL  - ' || v_txt || ' still does; an auto-updatable view owned by the '
--                         || 'base table''s owner bypasses RLS entirely' end;
--
--     -- 6 ⚠️ AND THE PART NOTHING ABOVE PROVES. Stated as a limit, not a pass.
--     r_trunc := 'limit - TRUNCATE is outside RLS entirely, so the "no policy permits it" argument '
--                || 'never covered it. anon''s TRUNCATE grants are gone (line 1 counts them), but '
--                || 'whether they were ever REACHABLE was not measured: EXPLAIN does not accept '
--                || 'TRUNCATE. Unproven, not disproven.';
--
--     r_appl := case when exists (select 1 from public.schema_migrations where version = '0098')
--                    then 'info  - 0098 IS applied'
--                    else '⚠️ 0098 has NOT been applied (no row in schema_migrations). '
--                         || 'Nothing above describes a change that has happened.' end;
--
--     raise exception '%',
--       chr(10) || '=== 0098 VERIFY ==='
--       || chr(10) || '1  anon writes, zero     : ' || r_zero
--       || chr(10) || '2  nor at column level   : ' || r_col
--       || chr(10) || '3  control, SELECT = 45  : ' || r_sel
--       || chr(10) || '4  other roles           : ' || r_auth
--       || chr(10) || '5  views, as state       : ' || r_view
--       || chr(10) || '6  ⚠️ what this proves not: ' || r_trunc
--       || chr(10) || '7  applied?              : ' || r_appl;
--   end $$;
--
--   EXPECT: 1, 2, 3 and 5 pass; 4 and 7 are info; 6 is a stated limit.
--
--   ⚠️ LINE 6 IS NOT A FAILURE AND MUST NOT BE READ AS ONE. It is the one claim
--   this migration cannot make. Removing it would leave the block looking like a
--   clean sweep of a problem that is only mostly closed.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

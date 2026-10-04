-- ===========================================================================
-- 0084_a_silent_no_op_becomes_a_refusal
--
-- Twenty tables lose UPDATE from `authenticated` and `anon`. Item 156, the
-- narrower half — the one the evidence actually supports.
--
-- ⚠️ Apply 0083 first.
--
-- ── WHAT THIS IS, SAID AT THE WIDTH THE EVIDENCE SUPPORTS ──────────────────
-- The first version of this claim was *"behaviour-neutral by construction"*.
-- That was too wide, and it was my claim. None of the twenty has an
-- UPDATE-capable policy, so an update from `authenticated` today matches zero
-- rows and **raises nothing**. After this it raises `permission denied`.
--
-- **A silent no-op becomes a loud refusal.** Probably an improvement — a client
-- that was quietly failing will now say so — but it is a CHANGE, and 0079's
-- lesson is exactly that an RLS USING failure on UPDATE is invisible. The
-- honest claim: *no `authenticated` client update or upsert targets any of the
-- twenty; the single UPDATE that exists runs as the service role.* Checked
-- 4 Oct 2026 across site, admin, mobile and the edge functions, for `.update(`
-- and `.upsert(` only — a plain INSERT is unaffected by revoking UPDATE.
--
-- That one UPDATE is `supabase/functions/stripe-webhook/index.ts:311`, which
-- writes `stripe_webhook_events` on `SUPABASE_SERVICE_ROLE_KEY`. `service_role`
-- is a different role and is not revoked from, and the guard below proves it
-- still holds UPDATE directly rather than through PUBLIC.
--
-- ── ⚠️ TWO SEARCHES, AND THE GUARD RUNS BOTH ───────────────────────────────
-- The client sweep is the easier one to think of and it is the INCOMPLETE one.
-- A search of three apps and the edge functions cannot see a SECURITY INVOKER
-- function in the database: it runs with the CALLER's privileges, so it breaks
-- the instant a grant narrows, and it appears in no client file.
--
-- **This class nearly broke 0079.** `_withdraw_stylist` is INVOKER, updates
-- `public.sessions`, appears in no client file, and would have failed the moment
-- 0079 applied. It was caught only by that migration's PREFLIGHT, which read the
-- live function definitions rather than the repo.
--
-- ⚠️ SO BOTH SEARCHES ARE IN THE GUARD BELOW, NOT ONLY IN THE PREFLIGHT. A
-- preflight is advisory — it informs whoever reads it. A guard is enforcement:
-- it refuses regardless of who read what. The rule this project keeps
-- relearning is that mechanisms adopted to stop a trap get walked past on the
-- tasks that feel too small to need them, so the check lives where skipping it
-- is not possible.
--
-- `prokind in ('f','p')` excludes aggregates, which `pg_get_functiondef`
-- refuses — that refusal killed an earlier version of this query outright.
--
-- ── ⚠️ AND THE REVOKE HAS TO BE EFFECTIVE, NOT JUST ISSUED ─────────────────
-- Revoking UPDATE from `authenticated` while **PUBLIC** holds UPDATE changes
-- nothing at all: the privilege is still reachable, and the migration would
-- report success having done nothing. The guard refuses if PUBLIC holds UPDATE
-- on any of the twenty.
--
-- PUBLIC is NOT revoked from instead, deliberately. It is a pseudo-role, and
-- `service_role`'s access is the thing that would go with it if any of these
-- tables turned out to rely on PUBLIC rather than on its own grant. That is a
-- decision, and the same shape as the preflight that once queried `pg_roles`
-- for `'public'`, found no row, and read an unasked question as an answer.
--
-- ── ONE EXECUTABLE LIST — AND ⚠️ THREE COPIES IN THIS FILE ─────────────────
-- The guard and the revoke iterate the SAME array, so a table cannot be checked
-- and not revoked, or revoked and not checked. The cost is one long DO block
-- instead of twenty reviewable statements, and that trade is deliberate.
--
-- ⚠️ BUT THIS FILE CONTAINS THE TWENTY NAMES **THREE TIMES**, AND AN EARLIER
-- DRAFT OF THIS HEADER CLAIMED ONE. The executable copy is below; the PREFLIGHT
-- and the VERIFY block each carry their own, because they are pasted into the
-- SQL editor separately and cannot reference a variable declared in a migration
-- that has not run yet.
--
-- So the drift this section claims to prevent is prevented only INSIDE the
-- transaction. Across the three copies it is not prevented by anything — it was
-- caught here by a throwaway script run against the finished file, which is
-- exactly the kind of check that works once and then is not there next time.
-- Recorded rather than papered over: a count of 20 in the guard proves the
-- executable list is whole, and proves nothing about the other two.
--
-- A `0\d{3}` in a comment is checked by check-migration-forward-refs.mjs; a
-- retyped table list in a verify block is checked by nobody. Same shape, and
-- only one of them has a mechanism.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
-- The `users` / `providers` column grants are item 156's other half and they
-- close item 157 with them. They are NOT here: they need four reads that have
-- not been done, the sharpest being **which `is_verified` the shop page and the
-- verified badge actually read**. A displayed flag that is not the protected
-- flag means a stylist can show a badge she was never given, and narrowing a
-- grant without knowing which column is read would move the problem rather than
-- fix it.
--
-- ── AND A RIDER, SAID PLAINLY ──────────────────────────────────────────────
-- One COMMENT ON COLUMN at the end, for `patch_tests.provider_id`. It belongs
-- to the same item and nothing else is touching that table.
-- ===========================================================================
begin;

do $$
declare
  -- ⚠️ THE ONLY **EXECUTABLE** COPY. The PREFLIGHT and VERIFY blocks below
  -- `commit;` retype it, and nothing checks the three against each other. See
  -- the header; do not read this as "the only copy".
  v_tables text[] := array[
    'admin_audit_log', 'admins', 'blocks', 'drift_check_runs',
    'email_reconcile_runs', 'email_sends', 'email_unsubscribe_tokens',
    'favourites', 'migration_findings', 'moderation_actions',
    'name_changes', 'provider_availability', 'retention_runs',
    'reviews', 'schema_migrations', 'session_consents',
    'stripe_webhook_events', 'treatments', 'verification_attempts',
    'waitlist'];
  v_t       text;
  v_missing text := '';
  v_public  text := '';
  v_policy  text := '';
  v_invoker text := '';
  v_svc     text := '';
  v_before  integer := 0;
  v_after   integer := 0;
begin
  if not exists (select 1 from public.schema_migrations where version = '0083') then
    raise exception '0084: apply 0083 first.';
  end if;

  -- A typo that drops a name from the array is otherwise completely invisible:
  -- the migration would succeed having revoked nineteen.
  if array_length(v_tables, 1) <> 20 then
    raise exception '0084: the list holds % name(s), not 20. Item 156 named twenty; a shorter list means one was lost in editing, and the revoke would silently skip it.',
      array_length(v_tables, 1);
  end if;

  -- ── THE PER-TABLE READS ──────────────────────────────────────────────
  foreach v_t in array v_tables loop
    if to_regclass('public.' || quote_ident(v_t)) is null then
      v_missing := v_missing || ' ' || v_t;
      continue;
    end if;

    -- (i) PUBLIC holding UPDATE would make this whole migration a no-op that
    -- reports success. grantee = 0 is PUBLIC in aclexplode's output.
    if exists (select 1
                 from pg_class c
                 cross join lateral aclexplode(c.relacl) a
                where c.oid = to_regclass('public.' || quote_ident(v_t))
                  and a.privilege_type = 'UPDATE'
                  and a.grantee = 0) then
      v_public := v_public || ' ' || v_t;
    end if;

    -- (ii) An UPDATE-capable policy means a real feature depends on updating
    -- this table, and the premise of the sweep ("every client reference is a
    -- SELECT or an INSERT") does not hold for it.
    if exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = v_t
                  and p.cmd in ('UPDATE', 'ALL')
                  and ('authenticated' = any (p.roles) or 'public' = any (p.roles))) then
      v_policy := v_policy || ' ' || v_t;
    end if;

    -- (iii) What the revoke has to bite on. Counted so a no-op cannot pass as
    -- a success.
    if has_table_privilege('authenticated', 'public.' || quote_ident(v_t), 'UPDATE') then
      v_before := v_before + 1;
    end if;

    -- (iv) service_role must keep UPDATE where it uses it. Named rather than
    -- assumed: stripe-webhook writes stripe_webhook_events on that key.
    if v_t = 'stripe_webhook_events'
       and not has_table_privilege('service_role', 'public.' || quote_ident(v_t), 'UPDATE') then
      v_svc := v_svc || ' ' || v_t;
    end if;
  end loop;

  -- ── THE SECOND SEARCH, THE ONE A CLIENT SWEEP CANNOT DO ──────────────
  v_invoker := coalesce((
    select string_agg(distinct f.fname || ' -> ' || t.name, ', ')
      from (select p.proname::text as fname, pg_get_functiondef(p.oid) as def
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.prokind in ('f', 'p')
               and not p.prosecdef) f
      cross join unnest(v_tables) as t(name)
     where f.def ~* ('update[[:space:]]+(public\.)?' || t.name || '[^a-z_]')
  ), '');

  -- ── THE REFUSALS. Each names what to decide, not just what is wrong. ──
  if v_missing <> '' then
    raise exception '0084: not a table in public:%. Item 156 listed twenty; read the schema before revoking on a name that does not resolve. Nothing changed.', v_missing;
  end if;
  if v_public <> '' then
    raise exception '0084: PUBLIC holds UPDATE on:%. Revoking from authenticated would change nothing while reporting success. Decide whether PUBLIC should lose it — which may take service_role with it — before applying. Nothing changed.', v_public;
  end if;
  if v_policy <> '' then
    raise exception '0084: an UPDATE-capable policy exists for authenticated on:%. The sweep''s premise (every client reference is a SELECT or an INSERT) does not hold for that table, so revoking would break a real feature rather than turn a silent no-op into a refusal. Nothing changed.', v_policy;
  end if;
  if v_invoker <> '' then
    raise exception '0084: SECURITY INVOKER function(s) update these tables: %. An INVOKER function runs with the caller''s privileges and appears in NO client file — this is the class that nearly broke 0079 via _withdraw_stylist. Either that table keeps its grant, or the function becomes DEFINER with its execute grant checked. Neither decision belongs in this migration. Nothing changed.', v_invoker;
  end if;
  if v_svc <> '' then
    raise exception '0084: service_role does NOT hold UPDATE on:%, yet stripe-webhook updates it on the service-role key. Read the grants before narrowing anything. Nothing changed.', v_svc;
  end if;
  if v_before = 0 then
    raise exception '0084: authenticated holds UPDATE on NONE of the twenty already, so this migration has nothing to do and its premise is wrong. That is worth knowing before it commits as a success.';
  end if;

  -- ── THE REVOKE ───────────────────────────────────────────────────────
  foreach v_t in array v_tables loop
    execute format('revoke update on public.%I from authenticated', v_t);
    execute format('revoke update on public.%I from anon', v_t);
  end loop;

  -- ── THE POST-CONDITION ───────────────────────────────────────────────
  -- Proves the revoke took effect rather than assuming the statements did what
  -- they were asked. has_table_privilege reads the privilege as it now stands,
  -- including anything reachable through PUBLIC — so this catches an
  -- ineffective revoke even if (i) somehow missed it.
  foreach v_t in array v_tables loop
    if has_table_privilege('authenticated', 'public.' || quote_ident(v_t), 'UPDATE') then
      v_after := v_after + 1;
    end if;
  end loop;

  if v_after <> 0 then
    raise exception '0084: authenticated can still UPDATE % of the twenty after the revoke, so the privilege is reachable by a route this migration did not account for. Rolled back.', v_after;
  end if;

  raise notice '0084: authenticated held UPDATE on % of 20 before; 0 after.', v_before;
end $$;

-- ---------------------------------------------------------------------------
-- THE RIDER — patch_tests.provider_id
--
-- 0083 commented both `pt_update` policies, which settled the name collision
-- for anyone reading a POLICY. ⚠️ But the hazard is the COLUMN NAME: the next
-- person reads the name and not the constraint (Micky, 5 Oct). A `provider_id`
-- holding an `auth.users` id fails SILENTLY when joined to `providers.id` —
-- both are uuid, so the join is type-valid and simply matches nothing.
--
-- Read from the database by 0083's PREFLIGHT, not from a file:
-- `patch_tests_provider_id_fkey -> auth.users`.
--
-- The comment goes where the misreading happens. `schema-snapshot-2026-08-08`
-- has carried this warning since before 0000 and item 158 was still written
-- without it, which is the argument for attaching it to the object rather than
-- to a file somebody has to think to open.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'patch_tests'
                    and column_name = 'provider_id') then
    raise exception '0084: public.patch_tests.provider_id does not exist. Read the table before commenting on it.';
  end if;
end $$;

comment on column public.patch_tests.provider_id is
  '⚠️ THIS HOLDS AN auth.users ID, NOT A providers.id — the only provider_id in this schema that '
  'does (patch_tests_provider_id_fkey -> auth.users, read 5 Oct 2026). Joining it to providers.id '
  'FAILS SILENTLY: both are uuid, so the join is type-valid and simply matches nothing. That is why '
  'pt_update on this table compares auth.uid() = provider_id directly while the identically-named '
  'pt_update on provider_treatments uses a subquery — both are correct for their own table. '
  'Items 156 and 158. No code writes this table and it is empty (legal.ts), so nothing depends on '
  'it yet; the name will outlive that.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0084', 'a_silent_no_op_becomes_a_refusal', '36212d035ee0ad07712fb6a0d029baa980f81687df9c015b922d3d134ca56c50');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- ⚠️ IT CARRIES BOTH SEARCHES. The client sweep was done in the repo on
-- 4 Oct 2026 and is recorded in item 156; the two things a repo search CANNOT
-- see are here — the INVOKER-function query, and whether PUBLIC holds the
-- privilege being revoked. The migration's guard runs both again, because a
-- preflight informs and a guard enforces.
--
--   with t(name) as (values
--     ('admin_audit_log'),('admins'),('blocks'),('drift_check_runs'),
--     ('email_reconcile_runs'),('email_sends'),('email_unsubscribe_tokens'),
--     ('favourites'),('migration_findings'),('moderation_actions'),
--     ('name_changes'),('provider_availability'),('retention_runs'),
--     ('reviews'),('schema_migrations'),('session_consents'),
--     ('stripe_webhook_events'),('treatments'),('verification_attempts'),
--     ('waitlist'))
--   select
--     (select count(*) from public.schema_migrations where version = '0083') = 1
--       as v_0083_applied,
--     (select count(*) from t) = 20 as twenty_names,
--     (select count(*) from t
--       where to_regclass('public.' || quote_ident(t.name)) is null) = 0
--       as all_twenty_resolve,
--     (select count(*) from t
--       where has_table_privilege('authenticated', 'public.' || quote_ident(t.name), 'UPDATE'))
--       as auth_can_update_now,
--     coalesce((select string_agg(t.name, ', ' order by t.name) from t
--                where exists (select 1 from pg_class c
--                               cross join lateral aclexplode(c.relacl) a
--                              where c.oid = to_regclass('public.' || quote_ident(t.name))
--                                and a.privilege_type = 'UPDATE'
--                                and a.grantee = 0)),
--              'none') as public_holds_update_on,
--     coalesce((select string_agg(distinct t.name, ', ' order by t.name) from t
--                join pg_policies p on p.schemaname = 'public' and p.tablename = t.name
--               where p.cmd in ('UPDATE', 'ALL')
--                 and ('authenticated' = any (p.roles) or 'public' = any (p.roles))),
--              'none') as update_policy_on,
--     coalesce((select string_agg(distinct f.fname || ' -> ' || t.name, ', ')
--                 from (select p.proname::text as fname, pg_get_functiondef(p.oid) as def
--                         from pg_proc p
--                         join pg_namespace n on n.oid = p.pronamespace
--                        where n.nspname = 'public'
--                          and p.prokind in ('f', 'p')
--                          and not p.prosecdef) f
--                 cross join t
--                where f.def ~* ('update[[:space:]]+(public\.)?' || t.name || '[^a-z_]')),
--              'none') as invoker_fns_updating_these,
--     has_table_privilege('service_role', 'public.stripe_webhook_events', 'UPDATE')
--       as svc_keeps_its_one_update;
--
--   EXPECT: v_0083_applied, twenty_names, all_twenty_resolve and
--   svc_keeps_its_one_update all TRUE; public_holds_update_on,
--   update_policy_on and invoker_fns_updating_these all 'none'; and
--   auth_can_update_now a NUMBER — 20 if nothing has been narrowed before.
--
--   ⚠️ auth_can_update_now IS THE ONE THAT PROVES THIS MIGRATION DOES ANYTHING.
--   If it is 0, the revoke is a no-op and the premise is wrong; the guard
--   refuses on exactly that, because a migration that commits having done
--   nothing reads identically to one that worked. It is also the only place the
--   BEFORE number is visible — the guard's `raise notice` does not surface in
--   the Supabase editor.
--
--   ⚠️ ANY OF THE THREE 'none' COLUMNS COMING BACK NON-EMPTY IS A DECISION, NOT
--   A FIX. Item 156: "Either that table keeps its grant, or the function becomes
--   DEFINER with its execute grant checked. Neither decision belongs inside the
--   revoke migration." The guard refuses rather than choosing.
-- ===========================================================================
--
-- ── VERIFY — ONE BLOCK ──────────────────────────────────────────────────
--
--   begin;
--   do $v$
--   declare
--     v_tables text[] := array[
--       'admin_audit_log', 'admins', 'blocks', 'drift_check_runs',
--       'email_reconcile_runs', 'email_sends', 'email_unsubscribe_tokens',
--       'favourites', 'migration_findings', 'moderation_actions',
--       'name_changes', 'provider_availability', 'retention_runs',
--       'reviews', 'schema_migrations', 'session_consents',
--       'stripe_webhook_events', 'treatments', 'verification_attempts',
--       'waitlist'];
--     v_t    text;
--     v_upd  integer := 0;
--     v_sel  integer := 0;
--     v_ins  integer := 0;
--     v_anon integer := 0;
--     v_del  text := '';
--     r_a text := 'not run';
--     r_b text := 'not run';
--     r_c text := 'not run';
--     r_d text := 'not run';
--   begin
--     begin
--       foreach v_t in array v_tables loop
--         if has_table_privilege('authenticated', 'public.' || quote_ident(v_t), 'UPDATE')
--           then v_upd := v_upd + 1; end if;
--         if has_table_privilege('authenticated', 'public.' || quote_ident(v_t), 'SELECT')
--           then v_sel := v_sel + 1; end if;
--         if has_table_privilege('authenticated', 'public.' || quote_ident(v_t), 'INSERT')
--           then v_ins := v_ins + 1; end if;
--         if has_table_privilege('anon', 'public.' || quote_ident(v_t), 'UPDATE')
--           then v_anon := v_anon + 1; end if;
--         if has_table_privilege('authenticated', 'public.' || quote_ident(v_t), 'DELETE')
--           then v_del := v_del || ' ' || v_t; end if;
--       end loop;
--       r_a := 'authenticated UPDATE ' || v_upd || '/20 (want 0) | anon UPDATE ' || v_anon
--           || '/20 (want 0) | SELECT ' || v_sel || '/20 and INSERT ' || v_ins
--           || '/20 still held, so the revoke was surgical rather than broad';
--     exception when others then r_a := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       r_b := 'service_role UPDATE on stripe_webhook_events: '
--           || case when has_table_privilege('service_role', 'public.stripe_webhook_events', 'UPDATE')
--                   then 'yes' else 'NO — THE WEBHOOK IS BROKEN' end;
--     exception when others then r_b := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       execute 'set local role authenticated';
--       begin
--         -- `where false` touches no row, and `set name = 'x'` reads no column,
--         -- so this tests the UPDATE PRIVILEGE and nothing else. Before this
--         -- migration it succeeded silently, affecting zero rows.
--         execute 'update public.schema_migrations set name = ''x'' where false';
--         r_c := 'NOT REFUSED — authenticated still updated a revoked table.';
--       exception when others then
--         r_c := case when sqlerrm like '%permission denied%'
--                     then 'refused with permission denied — the silent no-op is now loud'
--                     else 'refused for a DIFFERENT reason: ' || sqlerrm end;
--       end;
--       execute 'reset role';
--     exception when others then r_c := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       r_d := 'patch_tests.provider_id comment: '
--           || case when col_description('public.patch_tests'::regclass,
--                        (select a.attnum from pg_attribute a
--                          where a.attrelid = 'public.patch_tests'::regclass
--                            and a.attname = 'provider_id'))
--                        like '%auth.users ID, NOT A providers.id%'
--                   then 'present' else 'MISSING OR CHANGED' end
--           || ' | authenticated also holds DELETE on:'
--           || case when v_del = '' then ' none' else v_del end;
--     exception when others then r_d := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || '(a) grants       : ' || r_a || chr(10)
--       || '(b) service_role : ' || r_b || chr(10)
--       || '(c) the refusal  : ' || r_c || chr(10)
--       || '(d) comment, del : ' || r_d;
--   end $v$;
--   rollback;
--
--   EXPECT: (a) UPDATE 0/20 and anon 0/20, with SELECT and INSERT still non-zero
--   — that pairing is the whole claim, since a count of zero everywhere would
--   mean the revoke was broader than intended. (b) yes. (c) refused with
--   permission denied. (d) present.
--
--   ⚠️ (c) MATCHES sqlerrm TEXT, NOT SQLSTATE. insufficient_privilege is 42501
--   and so is every `raise ... using errcode = '42501'` in this schema, so a
--   sqlstate match would pass on the wrong refusal (0079's test 5).
--
--   ⚠️ (c) IS THE ONLY SECTION THAT PROVES THE BEHAVIOUR CHANGE RATHER THAN THE
--   GRANT. The grant counts in (a) are read from the catalogue; (c) actually
--   attempts the update as `authenticated` and is refused. The two can disagree
--   — a privilege reachable by a route the catalogue read did not cover would
--   show as 0 in (a) and succeed in (c).
--
--   ⚠️ (d) ALSO REPORTS SOMETHING THIS MIGRATION DOES NOT FIX: whether
--   `authenticated` still holds DELETE on any of the twenty. DELETE is out of
--   scope here, but a DELETE grant with no DELETE policy is the SAME silent-no-op
--   shape this migration exists to remove. If that list comes back non-empty it
--   is a finding, not a failure — raise it rather than widening this file.
-- ===========================================================================

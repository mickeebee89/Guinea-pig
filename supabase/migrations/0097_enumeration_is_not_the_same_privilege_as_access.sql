-- ===========================================================================
-- 0097_enumeration_is_not_the_same_privilege_as_access
--
-- Item 205. ⚠️ Apply 0096 first. ⚠️ ADOPTS NO BODY AND CHANGES NO BEHAVIOUR OF
-- ANY LIVE PAGE. It removes one grant.
--
-- Revokes EXECUTE on `public.nearby_models(double precision, double precision,
-- double precision)` from `authenticated`, and from `anon` and PUBLIC if either
-- holds it.
--
-- ── WHY NOW, AND WHY "NOT TODAY" WAS WRONG ─────────────────────────────────
-- `nearby_models(null, null, null)` returns up to **200 rows** of first name,
-- last initial, profile photo, distance in miles, hair colour, hair type, hair
-- length and skin tone — to **any account that can sign up for free and call
-- it**. It filters on two things only: `role = 'model'` and the block pair. Not
-- suspension, not verification, not subscription.
--
-- **On 11 and 12 Oct 2026 two real models signed up.** Until then every row it
-- returned was one of Micky's test accounts.
--
-- ⚠️ I ARGUED FOR DEFERRING THIS, on the grounds that reaching it needs
-- somebody who knows the RPC exists. **That was never a control, and the
-- argument did not survive the thing behind the door changing.** Micky's
-- correction, 12 Oct 2026: *"The cost of the fix has not changed and the thing
-- being protected has."* Recorded because the analysis was right and the
-- recommendation was wrong, which is the harder failure to notice.
--
-- ── ⚠️⚠️ WHAT THIS DOES NOT FIX. DO NOT READ IT AS SOLVED. ─────────────────
-- **It removes ENUMERATION. It removes no ACCESS.**
--
-- `site/lib/queries/salonFloor.ts` already said so, in the note explaining why
-- the web built a shared wall instead of model browse: `public_profiles` has
-- **no WHERE clause**, and `model_attributes` and `model_photos` both carry a
-- PERMISSIVE SELECT policy `using (true)` for `authenticated`. So **any
-- signed-in account can still read any model's profile if it knows the id** —
-- name, photo, attributes, photos, reviews, via `/model/[id]`.
--
-- ✅ What changes is the shape of the ask: from *"here are 200, sorted by
-- distance, filterable"* to *"if you know the id"*. salonFloor.ts calls that a
-- real difference while the access rules are identical, and it is right. **It is
-- not the same as closing it.** Item 205 holds the measured scope: which tables,
-- which policies, and what a signed-in stranger can retrieve per id.
--
-- ── ⚠️ THE ONE CALLER IS MOTHBALLED, AND THIS IS THE LINE THAT STOPS THE
-- ── REVOKE BEING FOUND LATER AS A MYSTERY ──────────────────────────────────
-- **`mobile/src/app/(app)/provider-dashboard.tsx:612`** is the only caller in
-- any of the three apps. Mobile is mothballed (CLAUDE.md, 6 Oct 2026) and has
-- never been submitted to either store.
--
-- ⚠️⚠️ **SO: MOBILE'S PROVIDER DASHBOARD CANNOT SHIP UNTIL THIS GRANT IS
-- RESTORED, OR THE SCREEN IS REBUILT.** After this migration the RPC returns
-- `42501 permission denied for function nearby_models` to a signed-in stylist.
-- It will present as the nearby-models list being empty or erroring, in a screen
-- nobody has opened for months, and the cause will be six weeks upstream. Item
-- 205 carries the same line.
--
-- ⚠️ 0 LIVE / 1 DORMANT. No file in `site/` or `admin/` references the function.
--
-- ── ⚠️ THE FUNCTION IS NOT DROPPED, AND THAT IS DELIBERATE ─────────────────
-- Dropping it would lose the body, and restoring the grant is one statement
-- while rewriting the function is not. `service_role` keeps EXECUTE, so a
-- server-side caller is still possible if the feature ever returns with a gate
-- in front of it.
--
-- ── ⚠️ THE LIVE ACL IS THE AUTHORITY, NOT THE REPO ─────────────────────────
-- 0018:173 granted EXECUTE, and the hand-run `supabase/nearby-models-any.sql`
-- **dropped and recreated the function and re-granted it** on 25 Sep 2026. A
-- grant re-applied by hand once can have been re-applied again, so this
-- migration reads `proacl` and refuses if it does not find what was measured.
--
-- ⚠️ MEASURED 12 Oct 2026 (preflight0097): the revoke list is derived from that
-- reading, not from 0018.
--
-- ⚠️ AND `has_function_privilege('public', …)` RAISES — PUBLIC is a pseudo-role,
-- not a role — so every grant question here is answered from the ACL text. A
-- NULL `proacl` is not "no grants": it means the default is in force, which for
-- a function is EXECUTE TO PUBLIC.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- The generated types describe the function's signature, which does not move. A
-- types regeneration is not required and would produce no diff.
-- ===========================================================================
begin;

do $mig$
declare
  v_oid    oid;
  v_sig    text;
  v_before text;
  v_after  text;
  v_len    integer;
  v_md5    text;
  v_n      integer;
  -- ⚠️ ONE BOOLEAN PER GRANTEE, READ FROM unnest(proacl). A PUBLIC aclitem is
  -- the one whose grantee is EMPTY, so it renders starting with '=' — and a
  -- positional LIKE over a joined ACL string can quietly answer "no". NULL
  -- proacl is handled separately in v_pub because it MEANS PUBLIC holds it.
  v_auth   boolean;
  v_anon   boolean;
  v_pub    boolean;
  v_svc    boolean;
begin
  if not exists (select 1 from public.schema_migrations where version = '0096') then
    raise exception '0097: apply 0096 first.';
  end if;

  -- (a) EXACTLY ONE SIGNATURE, so the revoke cannot miss an overload that still
  -- holds the grant.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nearby_models';
  if v_n <> 1 then
    raise exception '%', '0097: expected exactly one public.nearby_models; found ' || v_n
      || '. A second overload could keep the grant this migration is removing. Read them before '
      || 'applying. Nothing changed.';
  end if;

  select p.oid, p.oid::regprocedure::text, length(p.prosrc), md5(p.prosrc)
    into v_oid, v_sig, v_len, v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nearby_models';

  -- (b) ⚠️ THE GRANT MUST STILL BE THERE. If it is already gone, this migration
  -- has run or somebody revoked it by hand, and either way the framework should
  -- not record a change it did not make.
  select coalesce(array_to_string(p.proacl, '   '), '(NULL — default, EXECUTE TO PUBLIC)')
    into v_before
    from pg_proc p where p.oid = v_oid;
  select exists (select 1 from unnest(p.proacl) x where x::text like 'authenticated=%X%'),
         exists (select 1 from unnest(p.proacl) x where x::text like 'anon=%X%'),
         p.proacl is null
           or exists (select 1 from unnest(p.proacl) x where x::text like '=%X%'),
         exists (select 1 from unnest(p.proacl) x where x::text like 'service_role=%X%')
    into v_auth, v_anon, v_pub, v_svc
    from pg_proc p where p.oid = v_oid;
  if not (v_auth or v_anon or v_pub) then
    raise exception '%', '0097: neither authenticated, anon nor PUBLIC holds EXECUTE on '
      || v_sig || ' — there is nothing to revoke. Live ACL: ' || v_before
      || '. If this migration has already run, the ledger will say so. Nothing changed.';
  end if;

  -- ── THE REVOKE ──────────────────────────────────────────────────────────
  -- ⚠️ ALL THREE GRANTEES, UNCONDITIONALLY. `revoke` on a grantee that does not
  -- hold the privilege is a no-op, not an error, so naming all three is cheaper
  -- and more honest than three conditionals — and it closes the NULL-acl case,
  -- where PUBLIC holds EXECUTE by default and no aclitem says so.
  revoke execute on function
    public.nearby_models(double precision, double precision, double precision) from public;
  revoke execute on function
    public.nearby_models(double precision, double precision, double precision) from anon;
  revoke execute on function
    public.nearby_models(double precision, double precision, double precision) from authenticated;

  -- ── THE END STATE, ASSERTED FROM THE CATALOGUE ──────────────────────────
  select coalesce(array_to_string(p.proacl, '   '), '(NULL)') into v_after
    from pg_proc p where p.oid = v_oid;

  -- (c) ⚠️ A NULL ACL AFTER A REVOKE WOULD BE A DISASTER MISREAD AS SUCCESS:
  -- NULL means "default", and the default is EXECUTE TO PUBLIC. So the revoke
  -- must leave a non-null ACL that names the remaining grantees explicitly.
  if (select proacl is null from pg_proc where oid = v_oid) then
    raise exception '%', '0097: proacl is NULL after the revoke, which means DEFAULT privileges are '
      || 'in force — and the default for a function is EXECUTE TO PUBLIC. The revoke would have made '
      || 'the function MORE reachable, not less. Rolled back.';
  end if;
  select exists (select 1 from unnest(p.proacl) x where x::text like 'authenticated=%X%'),
         exists (select 1 from unnest(p.proacl) x where x::text like 'anon=%X%'),
         p.proacl is null
           or exists (select 1 from unnest(p.proacl) x where x::text like '=%X%'),
         exists (select 1 from unnest(p.proacl) x where x::text like 'service_role=%X%')
    into v_auth, v_anon, v_pub, v_svc
    from pg_proc p where p.oid = v_oid;
  if v_auth or v_anon or v_pub then
    raise exception '%', '0097: EXECUTE is still held after the revoke. Live ACL: ' || v_after
      || '. Rolled back.';
  end if;

  -- (d) THE CONTROL. ⚠️ service_role is what the edge functions use; revoking it
  -- by accident would break server-side callers silently, since nothing in the
  -- repo calls this one today and the breakage would surface later.
  if not v_svc then
    raise exception '%', '0097: service_role no longer holds EXECUTE. This migration must not touch '
      || 'it — it is the role the edge functions use. Live ACL: ' || v_after || '. Rolled back.';
  end if;

  -- (e) AND THE FUNCTION ITSELF IS UNCHANGED. A grant change must not move a
  -- body, and asserting it is how this file proves it adopted nothing.
  if (select length(prosrc) <> v_len or md5(prosrc) <> v_md5 from pg_proc where oid = v_oid) then
    raise exception '0097: nearby_models'' body changed. This migration alters privileges only, so that is impossible by design. Rolled back.';
  end if;
end $mig$;

comment on function public.nearby_models(double precision, double precision, double precision) is
  'Models within a radius, for a stylist-side browse screen. ⚠️ EXECUTE WAS REVOKED FROM '
  'authenticated, anon AND PUBLIC BY 0097 (item 205). It returns up to 200 rows of first name, last '
  'initial, photo, distance and four appearance attributes, filtered only on role and the block '
  'pair — not suspension, not verification, not subscription — so any free account could enumerate '
  'every model. service_role keeps EXECUTE. '
  '⚠️ ITS ONLY CALLER IS mobile/src/app/(app)/provider-dashboard.tsx:612, WHICH IS MOTHBALLED: that '
  'screen cannot ship until this grant is restored or it is rebuilt, and without this line the '
  '42501 would be found as a mystery. '
  '⚠️ THE REVOKE REMOVED ENUMERATION, NOT ACCESS: public_profiles has no WHERE clause and '
  'model_attributes/model_photos are SELECT using (true) to authenticated, so any signed-in account '
  'can still read any model by id. Item 205 holds that scope. '
  '⚠️ DO NOT RE-GRANT THIS TO authenticated to make a screen work. Put the screen behind a function '
  'that returns less, or gate it on something.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0097', 'enumeration_is_not_the_same_privilege_as_access', '535f30ec51986f0ff6930641b61cb20d18d37c6a2b629d66e1e604e6e0986ec4');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — run 12 Oct 2026. The ACL was the authority, not 0018: the
-- hand-run nearby-models-any.sql had re-granted EXECUTE on 25 Sep 2026.
-- Measured: authenticated held EXECUTE; service_role and postgres also; the
-- acl was explicit, not NULL; nearby_models was the only enumerator.
--
-- ⚠️ THE FILE ITSELF WAS DELETED after applying. Its findings are recorded in
-- this header and in audit item 205, so nothing was lost with it — and a
-- re-runnable form of the one query worth keeping (the view-write sweep that
-- came out of the same session) is in item 206.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION. Catalogue reads only. ⚠️ Every number is measured here,
-- and line 5 says which side of the apply it is on (item 188's ninth).
--
--   do $$
--   declare
--     r_gone text := 'not run';
--     r_null text := 'not run';
--     r_svc  text := 'not run';
--     r_body text := 'not run';
--     r_appl text := 'not run';
--     v_oid  oid;
--     v_acl  text;
--   begin
--     select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'nearby_models';
--     select coalesce(array_to_string(proacl, '   '), '(NULL)') into v_acl
--       from pg_proc where oid = v_oid;
--
--     -- 1 ⚠️ THE END STATE. Each grantee tested from unnest, because a PUBLIC
--     -- aclitem is the one whose grantee is EMPTY and a positional LIKE over a
--     -- joined string can quietly answer "no".
--     r_gone := case when v_oid is null then 'FAIL  - nearby_models does not exist'
--       when exists (select 1 from pg_proc p, unnest(p.proacl) x
--                     where p.oid = v_oid
--                       and (x::text like 'authenticated=%X%' or x::text like 'anon=%X%'
--                            or x::text like '=%X%'))
--         then 'FAIL  - EXECUTE still held: ' || v_acl
--       else 'pass  - authenticated, anon and PUBLIC all lack EXECUTE' end;
--
--     -- 2 ⚠️ NOT A DUPLICATE OF 1. A NULL acl satisfies "no aclitem grants it"
--     -- while meaning the DEFAULT applies — and the default is EXECUTE TO PUBLIC.
--     r_null := case when (select proacl is null from pg_proc where oid = v_oid)
--                    then 'FAIL  - proacl is NULL, so DEFAULT applies = EXECUTE TO PUBLIC'
--                    else 'pass  - proacl is explicit, not the default' end;
--
--     -- 3 THE CONTROL. service_role is what the edge functions use.
--     r_svc := case when exists (select 1 from pg_proc p, unnest(p.proacl) x
--                                 where p.oid = v_oid and x::text like 'service_role=%X%')
--                   then 'pass  - service_role still holds EXECUTE'
--                   else 'FAIL  - service_role lost EXECUTE: ' || v_acl end;
--
--     -- 4 the function is untouched
--     r_body := case when exists (select 1 from pg_proc where oid = v_oid
--                                  and prosrc like '%limit 200%' and prosrc like '%is_blocked_pair%')
--                    then 'pass  - body still present and unchanged in shape'
--                    else 'FAIL  - the body is not what 0097 left' end;
--
--     r_appl := case when exists (select 1 from public.schema_migrations where version = '0097')
--                    then 'info  - 0097 IS applied'
--                    else '⚠️ 0097 has NOT been applied (no row in schema_migrations). '
--                         || 'Nothing above describes a change that has happened.' end;
--
--     raise exception '%',
--       chr(10) || '=== 0097 VERIFY ==='
--       || chr(10) || '1  EXECUTE revoked        : ' || r_gone
--       || chr(10) || '2  acl is not the default : ' || r_null
--       || chr(10) || '3  control, service_role  : ' || r_svc
--       || chr(10) || '4  function unchanged     : ' || r_body
--       || chr(10) || '5  applied?               : ' || r_appl
--       || chr(10) || '   live acl              : ' || v_acl;
--   end $$;
--
--   EXPECT: 1-4 pass, 5 reports applied.
--
--   ⚠️ LINE 2 IS THE ONE A READER WILL THINK IS REDUNDANT. It is not: an empty
--   ACL and a NULL ACL are opposite states. NULL means default, and the default
--   for a function is EXECUTE TO PUBLIC — so a revoke that left NULL behind
--   would have made the function MORE reachable while line 1 reported a pass.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

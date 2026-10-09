-- ===========================================================================
-- PREFLIGHT for 0094 — appending pg_temp to every SECURITY DEFINER search_path
-- in public (item 202). Read-only. Returns one row per population plus a list.
--
-- ⚠️ THE LIST IS THE POINT, NOT THE COUNTS. "41 updated" means nothing on a
-- database where somebody has already fixed some; row (e) names every function
-- that will be touched and shows the exact before → after value for each, so the
-- change can be read BEFORE it is made rather than counted after.
--
-- ⚠️⚠️ ROW (d) IS THE ONE THAT CAN STOP 0094. A SECURITY DEFINER function with
-- NO `SET search_path` AT ALL cannot be fixed by appending — there is nothing to
-- append to, and choosing a value for it is a per-function decision, not a
-- mechanical one. 0094 REFUSES if row (d) is non-zero, and names them.
-- ===========================================================================
with d as (
  select p.oid, p.oid::regprocedure as sig, p.proname, p.proconfig,
         pg_get_userbyid(p.proowner) as owner, p.proowner, p.prokind,
         (select c from unnest(coalesce(p.proconfig, '{}'::text[])) c
           where c like 'search_path=%' limit 1) as sp
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
)
select 'a. total' as part, 'SECURITY DEFINER functions in public' as name,
       (select count(*)::text from d) as detail
union all
select 'b. already correct', 'search_path already names pg_temp — WILL BE SKIPPED',
       (select count(*)::text from d where sp like '%pg_temp%')
union all
-- ⚠️ THE PREDICTION 0094 ASSERTS. Micky measured 41 on 9 Oct 2026; if this is
-- not 41, the migration refuses rather than acting on a stale measurement.
select 'c. to be changed', 'has a search_path, but no pg_temp — ⚠️ EXPECT 41',
       (select count(*)::text from d where sp is not null and sp not like '%pg_temp%')
union all
-- ⚠️⚠️ THE BLOCKER. These are WORSE than a missing pg_temp (they inherit the
-- caller's whole search_path) and they CANNOT be batched.
select 'd. ⚠️ CANNOT BATCH', 'SECURITY DEFINER with NO search_path at all',
       coalesce((select count(*)::text || ' :: ' || string_agg(sig::text, ', ' order by sig::text)
                   from d where sp is null), '0')
union all
select 'e. THE LIST', 'every function 0094 will touch: before → after',
       coalesce((select string_agg(sig::text || chr(10) || '     ' || sp
                                     || '   →   ' || sp || ', pg_temp',
                                   chr(10) order by sig::text)
                   from d where sp is not null and sp not like '%pg_temp%'),
                '(nothing to change)')
union all
-- ⚠️ THE ONE THAT WOULD BREAK THE LIVE SITE IF THE BATCH WROTE A FIXED STRING.
-- digest() lives ONLY in `extensions` (0092), so losing it stops every
-- consent_documents insert — and the failure would surface as a broken consent
-- flow, not as a migration error.
select 'f. set_consent_hash', '⚠️ MUST end `public, extensions, pg_temp`',
       coalesce((select 'now: ' || sp || '   →   after: ' || sp || ', pg_temp'
                   from d where proname = 'set_consent_hash'),
                '(set_consent_hash is not SECURITY DEFINER or is missing — read 0092)')
union all
-- ALTER needs ownership. A mid-loop permission failure rolls back, but naming
-- them now is cheaper than reading a rollback.
select 'g. ownership', 'owners of the functions to be changed',
       coalesce((select string_agg(distinct owner || '=' || (
                            owner = current_user
                            or pg_has_role(current_user, proowner, 'USAGE'))::text,
                          ', ' order by owner || '=' || (
                            owner = current_user
                            or pg_has_role(current_user, proowner, 'USAGE'))::text)
                   from d where sp is not null and sp not like '%pg_temp%'),
                '(nothing to change)')
union all
-- ⚠️ ALTER FUNCTION is the wrong statement for a PROCEDURE or an aggregate.
-- prokind: f=function, p=procedure, a=aggregate, w=window.
select 'h. kinds', 'prokind of the functions to be changed (expect all f)',
       coalesce((select string_agg(distinct prokind::text, ', ' order by prokind::text)
                   from d where sp is not null and sp not like '%pg_temp%'),
                '(nothing to change)')
union all
select 'i. gate', '0093 applied',
       ((select count(*) from public.schema_migrations where version = '0093') = 1)::text
 order by part;

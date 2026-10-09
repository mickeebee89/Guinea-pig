-- ===========================================================================
-- PREFLIGHT for 0096 — adopting the two guards on `sessions` that no migration
-- owns (item 199). Read-only. 14 rows.
--
--   trg_reject_overlapping_session  → reject_overlapping_session   BOTH hand-run
--   trg_enforce_session_status      → enforce_session_status_transition
--                                     TRIGGER hand-run; function owned by 0070
--
-- ⚠️⚠️ ROW (h) IS THE ONE TO READ FIRST, AND IT IS NOT ABOUT ADOPTION.
-- `supabase/session-status-guard.sql` holds a copy of
-- `enforce_session_status_transition` that predates 0070 — it has NO `not_held`
-- branch — while its own header says *"This file is safe to re-run."* If anyone
-- ever re-ran it, `report_not_held` would start raising "Illegal status
-- transition" on every use. Row (h) says which version is LIVE right now.
--
-- ⚠⚠ EVERY pg_catalog COLUMN OF TYPE "char" IS CAST WITH ::text BEFORE IT
-- TOUCHES A STRING. Without the cast Postgres cannot choose an operator and
-- raises `42725: operator is not unique: text || "char"` — the whole block fails
-- to run, having tested nothing. `prokind`, `provolatile`, `tgenabled`,
-- `relkind`, `contype`, `confdeltype` and `polcmd` are all "char"; `prosecdef`
-- and the `indis*` family are boolean and also need ::text, but for the
-- different reason that there is no implicit boolean-to-text cast either.
--
-- ⚠️ THIS IS THE SECOND TIME IN THIS POSITION. 0090's `confdeltype` failed the
-- same way, caught by Micky in the same kind of row. Recorded in the verify-block
-- conventions (audit item 188's neighbour) so the third one is prevented rather
-- than caught.
--
-- ⚠️ CR COUNTS ARE MEASURED PER OBJECT. Three objects so far, three shapes:
-- set_consent_hash CR=0 opening 0a; reject_overlapping_session CR=15 opening
-- 0d0a; has_open_availability CR=13 opening 0d0a closing 293b0d0a. Neither is
-- carried into the other, and the status function's is unknown.
-- ===========================================================================
with f as (
  select p.proname, p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proconfig,
         p.proowner, p.prokind, pg_get_userbyid(p.proowner) as owner,
         (select count(*) from pg_proc q join pg_namespace m on m.oid = q.pronamespace
           where m.nspname = 'public' and q.proname = p.proname) as sigs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('reject_overlapping_session', 'enforce_session_status_transition')
)
select 'a. overlap fn' as part, 'ownership / kind / signatures' as name,
       coalesce((select 'owner=' || owner || ' | may replace='
                     || (owner = current_user or pg_has_role(current_user, proowner, 'USAGE'))::text
                     || ' | prokind=' || prokind::text || ' | signatures=' || sigs
                   from f where proname = 'reject_overlapping_session'), '(MISSING)') as detail
union all
select 'b. overlap fn', 'definer / volatility / search_path — ⚠️ expect pg_temp (0094)',
       coalesce((select 'definer=' || prosecdef::text || ' volatility=' || provolatile::text
                     || ' config=' || coalesce(array_to_string(proconfig, ','), '(NULL)')
                   from f where proname = 'reject_overlapping_session'), '(MISSING)')
union all
select 'c. overlap fn', 'FULL hex — build the literal from THIS',
       coalesce((select encode(convert_to(prosrc, 'UTF8'), 'hex')
                   from f where proname = 'reject_overlapping_session'), '(MISSING)')
union all
select 'd. overlap fn', 'length / md5 / CR / LF / opens / closes',
       coalesce((select length(prosrc)::text || ' chars, md5=' || md5(prosrc)
                     || ', CR=' || (length(prosrc) - length(replace(prosrc, chr(13), '')))::text
                     || ', LF=' || (length(prosrc) - length(replace(prosrc, chr(10), '')))::text
                     || ', opens=' || encode(convert_to(left(prosrc, 2), 'UTF8'), 'hex')
                     || ', closes=' || encode(convert_to(right(prosrc, 4), 'UTF8'), 'hex')
                   from f where proname = 'reject_overlapping_session'), '(MISSING)')
union all
select 'e. status fn', 'ownership / kind / signatures',
       coalesce((select 'owner=' || owner || ' | may replace='
                     || (owner = current_user or pg_has_role(current_user, proowner, 'USAGE'))::text
                     || ' | prokind=' || prokind::text || ' | signatures=' || sigs
                   from f where proname = 'enforce_session_status_transition'), '(MISSING)')
union all
select 'f. status fn', 'definer / volatility / search_path',
       coalesce((select 'definer=' || prosecdef::text || ' volatility=' || provolatile::text
                     || ' config=' || coalesce(array_to_string(proconfig, ','), '(NULL)')
                   from f where proname = 'enforce_session_status_transition'), '(MISSING)')
union all
select 'g. status fn', 'length / md5 / CR / LF / opens / closes',
       coalesce((select length(prosrc)::text || ' chars, md5=' || md5(prosrc)
                     || ', CR=' || (length(prosrc) - length(replace(prosrc, chr(13), '')))::text
                     || ', LF=' || (length(prosrc) - length(replace(prosrc, chr(10), '')))::text
                     || ', opens=' || encode(convert_to(left(prosrc, 2), 'UTF8'), 'hex')
                     || ', closes=' || encode(convert_to(right(prosrc, 4), 'UTF8'), 'hex')
                   from f where proname = 'enforce_session_status_transition'), '(MISSING)')
union all
-- ⚠️⚠️ WHICH VERSION IS LIVE. 0070 added a whole `not_held` branch; the
-- hand-run file has none. This is the difference as a boolean, so it does not
-- depend on reading hex correctly.
select 'h. ⚠️ WHICH VERSION', 'is the LIVE status guard 0070''s, or the pre-0070 copy?',
       coalesce((select case
                  when prosrc like '%not_held%' and prosrc like '%CV004%'
                    then '0070''s — has the not_held branch and CV004. Expected.'
                  else '⚠️⚠️ PRE-0070. The live guard has NO not_held branch, so report_not_held '
                       || 'RAISES "Illegal status transition" on every use. '
                       || 'has_not_held=' || (prosrc like '%not_held%')::text
                       || ' has_CV004=' || (prosrc like '%CV004%')::text end
                   from f where proname = 'enforce_session_status_transition'), '(MISSING)')
union all
select 'i. status fn', 'FULL hex — build the literal from THIS if it is adopted',
       coalesce((select encode(convert_to(prosrc, 'UTF8'), 'hex')
                   from f where proname = 'enforce_session_status_transition'), '(MISSING)')
union all
-- ⚠️ BOTH NAMES, AND tgenabled. Item 200: a probe keyed on the function's name
-- printed (MISSING) for a trigger that was present, and (MISSING) could not be
-- told from a mis-aimed question. So this ENUMERATES rather than confirming.
-- tgenabled: O=enabled, D=DISABLED (present and doing nothing), R/A=replica.
select 'j. all triggers', 'every trigger on sessions: name / function / enabled',
       coalesce((select string_agg(t.tgname || '  →  ' || p.proname
                                     || '  [' || t.tgenabled::text || ']', chr(10) order by t.tgname)
                   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where t.tgrelid = to_regclass('public.sessions') and not t.tgisinternal),
                '(NO TRIGGERS ON public.sessions)')
union all
select 'k. overlap trigger', 'pg_get_triggerdef — the exact text to adopt',
       coalesce((select pg_get_triggerdef(t.oid) from pg_trigger t
                  where t.tgrelid = to_regclass('public.sessions')
                    and t.tgname = 'trg_reject_overlapping_session' and not t.tgisinternal),
                '(MISSING — nothing refuses an overlapping booking)')
union all
select 'l. status trigger', 'pg_get_triggerdef — the exact text to adopt',
       coalesce((select pg_get_triggerdef(t.oid) from pg_trigger t
                  where t.tgrelid = to_regclass('public.sessions')
                    and t.tgname = 'trg_enforce_session_status' and not t.tgisinternal),
                '(MISSING — every status transition is unguarded)')
union all
-- If the live guard is 0070's, the status vocabulary must permit what it writes.
select 'm. status vocabulary', 'the CHECK on sessions.status, then values present',
       coalesce((select string_agg(pg_get_constraintdef(oid), ' / ') from pg_constraint
                  where conrelid = to_regclass('public.sessions') and contype = 'c'
                    and pg_get_constraintdef(oid) like '%status%'), '(no CHECK on status)')
       || chr(10) || coalesce((select string_agg(st || '=' || n, ', ' order by st)
            from (select status as st, count(*) as n from public.sessions group by status) q),
            '(no rows)')
union all
select 'n. gate', '0095 applied',
       ((select count(*) from public.schema_migrations where version = '0095') = 1)::text
 order by part;

-- ===========================================================================
-- PREFLIGHT for the has_open_availability fix (item 201). Read-only, 10 rows.
--
-- ⚠️ ROW (c) IS THE HEX AND IT IS THE ONE TO BUILD FROM. 0092 measured CR=0 on
-- set_consent_hash; reject_overlapping_session is CR=15 opening 0d0a. Per
-- object, never assumed — row (d) counts both.
--
-- ⚠️ ROW (g) DECIDES WHETHER THIS IS REACHABLE AT ALL. No code in any of the
-- three apps calls this function except one mothballed mobile screen — but a
-- function in `public` with EXECUTE to PUBLIC is callable by any anon key over
-- PostgREST, whether our code calls it or not.
-- ===========================================================================
with f as (
  select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proconfig, p.prolang,
         pg_get_userbyid(p.proowner) as owner, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_open_availability'
)
select 'a. ownership' as part, 'has_open_availability' as name,
       coalesce((select 'owner=' || owner || ' | current_user=' || current_user
                     || ' | may replace=' || (owner = current_user
                          or pg_has_role(current_user, proowner, 'USAGE'))::text
                     || ' | lang=' || (select lanname from pg_language where oid = prolang)
                   from f), '(MISSING)') as detail
union all
select 'b. properties', 'definer / volatility / search_path',
       coalesce((select 'definer=' || prosecdef::text || ' volatility=' || provolatile::text
                     || ' config=' || coalesce(array_to_string(proconfig, ','), '(NULL)')
                   from f), '(MISSING)')
union all
select 'c. body', 'FULL hex — build the literal from THIS',
       coalesce((select encode(convert_to(prosrc, 'UTF8'), 'hex') from f), '(MISSING)')
union all
select 'd. body', 'length / md5 / CR / LF — ⚠️ CR counted, never assumed',
       coalesce((select length(prosrc)::text || ' chars, md5=' || md5(prosrc)
                     || ', CR=' || (length(prosrc) - length(replace(prosrc, chr(13), '')))::text
                     || ', LF=' || (length(prosrc) - length(replace(prosrc, chr(10), '')))::text
                     || ', opens=' || encode(convert_to(left(prosrc, 2), 'UTF8'), 'hex')
                     || ', closes=' || encode(convert_to(right(prosrc, 4), 'UTF8'), 'hex')
                   from f), '(MISSING)')
union all
select 'e. body', 'pretty-printed, for reading only — NOT for building',
       coalesce((select prosrc from f), '(MISSING)')
union all
select 'f. signatures', 'overloads of has_open_availability (expect 1)',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'has_open_availability')
union all
-- ⚠️ THE REACHABILITY ROW. PUBLIC is a pseudo-role: has_function_privilege
-- RAISES on it, which is why this reads the ACL text instead.
select 'g. who can call it', 'EXECUTE grants — ⚠️ decides whether anon can reach it',
       coalesce((select coalesce(array_to_string(p.proacl, '  '),
                                '(NULL acl = default, i.e. EXECUTE TO PUBLIC)')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'has_open_availability'),
                '(MISSING)')
union all
-- ⚠️ THE BEHAVIOUR BASELINE. The fix must change the ANSWER for nobody, and
-- this is the row that lets that be proven rather than argued.
select 'h. baseline', 'the function''s answer for every provider, today',
       coalesce((select string_agg(pr.id::text || '=' || coalesce(
                          public.has_open_availability(pr.id)::text, 'null'),
                        ', ' order by pr.id::text)
                   from public.providers pr), '(no providers)')
union all
select 'i. baseline', 'the SAME question asked with schema-qualified SQL',
       coalesce((select string_agg(pr.id::text || '=' || (exists (
                          select 1 from public.availability a
                           where a.provider_id = pr.id and a.date >= current_date
                             and not exists (select 1 from public.sessions s
                                              where s.availability_id = a.id
                                                and s.status in ('pending','accepted'))
                        ))::text, ', ' order by pr.id::text)
                   from public.providers pr), '(no providers)')
union all
-- Who else could be poisoned the same way. ⚠️ pg_temp is SESSION-LOCAL, so this
-- is a count of latent primitives, not of live exposures.
select 'j. the forty', 'SECURITY DEFINER functions in public with no pg_temp',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                            where c like 'search_path=%pg_temp%'))
 order by part;

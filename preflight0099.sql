-- ===========================================================================
-- PREFLIGHT for 0099 — storing the town from the postcode lookup. ONE BLOCK,
-- read-only.
--
-- ⚠️⚠️ ROW (b) IS THE ONE THAT MUST BE READ BEFORE THE MIGRATION IS WRITTEN,
-- and it is the rule this session keeps relearning: `pg_get_functiondef`
-- before any migration that replaces a function. 0054 is the only definition
-- of `set_my_postcode` in the repo, but the repo is not the database.
--
-- ⚠️ ROW (d) IS THE TRAP. `set_my_postcode` is SECURITY **INVOKER**, so it
-- writes as the signed-in member — and 0088 revoked table-wide UPDATE on
-- `public.users` and re-granted only 8 named columns. **A new column that is
-- not added to that grant makes every postcode save fail with 42501**, and the
-- action's catch-all turns that into "That didn't save", which names nothing.
--
-- ⚠️ ROW (e) IS THE SECOND TRAP. The migration DROPS the 3-argument function
-- and creates a 5-argument one. A new function gets DEFAULT privileges, which
-- for a function is EXECUTE TO PUBLIC (0097's lesson), so the revoke and grant
-- must be re-applied to the new signature or the RPC becomes callable by anon.
-- ===========================================================================
do $$
declare
  r_cols  text := 'not run';
  r_fn    text := 'not run';
  r_sig   text := 'not run';
  r_grant text := 'not run';
  r_acl   text := 'not run';
  r_data  text := 'not run';
  r_prov  text := 'not run';
  r_gate  text := 'not run';
  v_n     integer;
begin
  -- (a) Do the two columns already exist? If so the migration has run, or
  -- something added them by hand.
  select string_agg(column_name || ' ' || data_type, ', ' order by column_name)
    into r_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('admin_district', 'bua');
  r_cols := coalesce(r_cols, '✅ neither exists yet — nothing to adopt');

  -- (b) ⚠️ THE LIVE FUNCTION, VERBATIM. Build the migration from this, not
  -- from 0054. Hex as well as text, because whitespace is where a difference
  -- hides and the migration asserts the body before replacing it.
  select 'len=' || length(p.prosrc) || ' md5=' || md5(p.prosrc)
      || ' CR=' || (length(p.prosrc) - length(replace(p.prosrc, chr(13), '')))
      || ' LF=' || (length(p.prosrc) - length(replace(p.prosrc, chr(10), '')))
      || ' definer=' || p.prosecdef::text
      || ' volatility=' || p.provolatile::text
      || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(none)')
      || chr(10) || 'hex: ' || encode(convert_to(p.prosrc, 'UTF8'), 'hex')
    into r_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode';
  r_fn := coalesce(r_fn, '⚠️ set_my_postcode DOES NOT EXIST');

  -- (c) ⚠️ EVERY SIGNATURE. The migration drops one and creates another, so an
  -- existing overload would be left behind and `set_my_postcode()` with no
  -- arguments would become ambiguous (42725) — which is how the CLEAR path is
  -- called from postcode-action.ts:46.
  select count(*), string_agg(p.oid::regprocedure::text, chr(10) order by p.oid::regprocedure::text)
    into v_n, r_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode';
  r_sig := v_n || ' signature(s) — expect 1:' || chr(10) || coalesce(r_sig, '(none)');

  -- (d) ⚠️⚠️ authenticated's COLUMN-LEVEL UPDATE GRANT ON users. Expect the 8
  -- from 0088. The two new columns must be added to it.
  select string_agg(a.attname, ', ' order by a.attname) into r_grant
    from pg_attribute a
   where a.attrelid = to_regclass('public.users') and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
  r_grant := coalesce(r_grant, '(none)');

  -- (e) The function's current ACL, so the new signature can be given the same
  -- one rather than the default.
  select coalesce(array_to_string(p.proacl, '   '),
                  '⚠️ NULL = default = EXECUTE TO PUBLIC')
    into r_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode';
  r_acl := coalesce(r_acl, '(function missing)');

  -- (f) The 7 rows the backfill will touch, and the shape of the data.
  select 'users with a postcode: ' || count(*) filter (where postcode is not null)
      || ' | with coordinates: ' || count(*) filter (where latitude is not null)
      || ' | postcode but NO coordinate: '
      || count(*) filter (where postcode is not null and latitude is null)
      || ' | total: ' || count(*)
    into r_data
    from public.users;

  -- (g) providers mirrors the coordinate. ⚠️ Does it hold a postcode too? If it
  -- does, the decision about whether the town goes there as well is a real one
  -- rather than skipped.
  select coalesce(string_agg(column_name, ', ' order by column_name),
                  '✅ none — providers holds no postcode, only the coordinate')
    into r_prov
    from information_schema.columns
   where table_schema = 'public' and table_name = 'providers'
     and column_name in ('postcode', 'admin_district', 'bua', 'location_text');

  r_gate := ((select count(*) from public.schema_migrations where version = '0098') = 1)::text;

  raise exception '%',
    chr(10) || '=== 0099 PREFLIGHT ==='
    || chr(10) || 'a  new columns exist?     : ' || r_cols
    || chr(10) || 'c  signatures             : ' || r_sig
    || chr(10) || 'd  ⚠️ authenticated UPDATE  : ' || r_grant
    || chr(10) || 'e  function acl           : ' || r_acl
    || chr(10) || 'f  data                   : ' || r_data
    || chr(10) || 'g  providers columns      : ' || r_prov
    || chr(10) || 'h  0098 applied           : ' || r_gate
    || chr(10) || 'b  ⚠️ LIVE BODY             : ' || r_fn;
end $$;

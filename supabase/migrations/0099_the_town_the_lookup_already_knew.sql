-- ===========================================================================
-- 0099_the_town_the_lookup_already_knew
--
-- ⚠️ Apply 0098 first. ⚠️ NO DATA IS WRITTEN OR CHANGED by this migration: the
-- two new columns are null on all 35 rows afterwards. The backfill is a
-- separate, unrun script (`backfill-0099-towns.mjs`).
--
-- `site/lib/postcode.ts` already fetches `admin_district` and `bua` from
-- postcodes.io on every lookup and throws both away. For ME4 4TR they are
-- "Medway" (the council) and "Chatham" (the settlement). This stores them.
--
-- ── ⚠️ WHY TWO COLUMNS AND NOT ONE CALLED `town` ───────────────────────────
-- `bua` is the answer to "where are you?" and `admin_district` is the answer to
-- "who collects your bins". **But ONS holds no `bua` for many postcodes**, so a
-- single column named `town` would assert something false every time bua was
-- null and admin_district had to fill in. The source names are kept verbatim so
-- the provenance is unambiguous, and **which one is "the town" is a display
-- decision** — it lives in the admin page and can change without a migration.
--
-- ⚠️ NO CLAIM IS MADE HERE ABOUT HOW OFTEN `bua` IS NULL. The backfill
-- measures it across the 7 real rows and reports; until then it is unknown.
--
-- ── ⚠️⚠️ WHY THE FUNCTION IS DROPPED AND RECREATED RATHER THAN REPLACED ────
-- `create or replace function` CANNOT add parameters — the argument list is
-- part of the identity, so it would create a second overload. And because every
-- parameter has a default, **`set_my_postcode()` with no arguments would then
-- be AMBIGUOUS (42725)** — which is exactly how the CLEAR path calls it
-- (`site/lib/queries/postcode-action.ts:46`). Clearing your postcode would stop
-- working, and the action would report "That didn't save".
--
-- ✅ **AND THE DROP IS SAFE ACROSS THE DEPLOY GAP, WHICH IS WHY IT IS DONE THIS
-- WAY ROUND.** The migration lands before the Vercel deploy. PostgREST calls an
-- RPC with NAMED arguments, and the new 5-parameter function keeps the three
-- old names with the two new ones defaulted — so **the currently deployed site
-- keeps working unchanged**, writing nulls to the town columns until the new
-- code ships.
--
-- ⚠️ THE REVERSE IS NOT TRUE. Once `postcode-action.ts` sends five names it
-- needs this migration. **MIGRATION FIRST, DEPLOY SECOND**, or every postcode
-- save fails.
--
-- ── ⚠️⚠️ THE GRANT, WHICH IS THE ONE THAT WOULD HAVE FAILED SILENTLY ───────
-- `set_my_postcode` is **SECURITY INVOKER** — it writes as the signed-in
-- member. 0088 revoked table-wide UPDATE on `public.users` and re-granted
-- exactly **8 named columns** (verified live, 21 Oct 2026). A new column that is
-- not added to that grant makes **every postcode save fail with 42501**, and
-- `postcode-action.ts` catches it as *"That didn't save. Your postcode is
-- unchanged."* — which names nothing and reads like a lookup problem.
--
-- So the grant goes from 8 columns to 10, and the post-condition asserts the
-- list EXACTLY rather than counting it.
--
-- ── ⚠️ A NEW FUNCTION STARTS AT `EXECUTE TO PUBLIC` ────────────────────────
-- 0097's lesson, a week later: the default ACL for a function is EXECUTE TO
-- PUBLIC, and a NULL `proacl` means that default is in force. The revoke and
-- grant are re-applied to the NEW signature, and the post-condition refuses a
-- null ACL separately from refusing a PUBLIC grantee — they are opposite states
-- and only one of them is visible as an aclitem.
--
-- ── ⚠️ LINE ENDINGS, MEASURED FOR THIS OBJECT AND CARRIED FROM NOTHING ─────
-- This migration CREATES a body rather than comparing one, so the risk runs the
-- other way: the body picking up CRLF from the Supabase editor's paste (item
-- 190) and not matching what the post-condition asserts.
--
-- ✅ So the body is built from `chr(10)` through `format()`. It exists ONCE in
-- this file, the paste cannot alter it, and the result is LF deterministically.
-- Measured locally before writing: **1838 chars, md5
-- f931c2f388e1eee5f56179f67b8d6fbb, CR=0, LF=40**, opening `0a` and closing
-- `0a656e64` ("\nend"). ⚠️ The OLD body is CRLF (CR=30/LF=30, md5
-- 2bdf692a7ad505f3d93f64241f740445) — two objects, two shapes, neither count
-- taken from the other.
--
-- ── AFTER THIS: REGENERATE TYPES ───────────────────────────────────────────
-- Two new columns and a changed RPC signature, so
-- `node scripts/gen-supabase-types.mjs` is required before the site build will
-- type-check against the new call.
-- ===========================================================================
begin;

do $mig$
declare
  -- ⚠️ BUILT FROM chr(10), SO THE PASTE CANNOT ALTER IT. 1838 chars, LF only.
  v_new text :=
    '' ||
    chr(10) || 'declare' ||
    chr(10) || '  v_me uuid := auth.uid();' ||
    chr(10) || 'begin' ||
    chr(10) || '  if v_me is null then' ||
    chr(10) || '    raise exception ''You need to be signed in to set your postcode.'' using errcode = ''42501'';' ||
    chr(10) || '  end if;' ||
    chr(10) || '' ||
    chr(10) || '  -- Either all three arrive or none do. A postcode with no coordinate is a' ||
    chr(10) || '  -- string that looks like it is working, and a coordinate with no postcode' ||
    chr(10) || '  -- cannot be read back or corrected by the person it describes.' ||
    chr(10) || '  if (p_postcode is null) <> (p_lat is null) or (p_lat is null) <> (p_lng is null) then' ||
    chr(10) || '    raise exception ''set_my_postcode: give a postcode and both coordinates, or all three null.''' ||
    chr(10) || '      using errcode = ''22023'';' ||
    chr(10) || '  end if;' ||
    chr(10) || '' ||
    chr(10) || '  -- The town is DERIVED from the postcode, so it cannot outlive it: clearing' ||
    chr(10) || '  -- the postcode clears both names, whatever the caller passed. A town with no' ||
    chr(10) || '  -- postcode behind it could not be checked or corrected by the member.' ||
    chr(10) || '  -- Either name may be null WITH a postcode -- ONS holds no bua for many' ||
    chr(10) || '  -- postcodes -- and that is a normal row, not a failed one.' ||
    chr(10) || '  update public.users' ||
    chr(10) || '     set postcode       = p_postcode,' ||
    chr(10) || '         latitude       = p_lat,' ||
    chr(10) || '         longitude      = p_lng,' ||
    chr(10) || '         admin_district = case when p_postcode is null then null else p_district end,' ||
    chr(10) || '         bua            = case when p_postcode is null then null else p_bua end' ||
    chr(10) || '   where id = v_me;' ||
    chr(10) || '' ||
    chr(10) || '  if not found then' ||
    chr(10) || '    raise exception ''set_my_postcode: no profile row for this account.'' using errcode = ''P0002'';' ||
    chr(10) || '  end if;' ||
    chr(10) || '' ||
    chr(10) || '  -- The stylist mirror. A no-op for a model by the WHERE clause rather than by' ||
    chr(10) || '  -- a role test: ''both'' accounts have a provider row and need it updated too,' ||
    chr(10) || '  -- and reading the role to decide would be a second thing to keep in step.' ||
    chr(10) || '  -- providers holds no postcode and no town, only the coordinate for distance.' ||
    chr(10) || '  update public.providers' ||
    chr(10) || '     set latitude = p_lat, longitude = p_lng' ||
    chr(10) || '   where user_id = v_me;' ||
    chr(10) || 'end';
  -- The 8 columns 0088 left, read live 21 Oct 2026. The end state is these
  -- plus the two new ones, asserted as a LIST rather than a count.
  v_grant_before text[] := array['first_name','instagram_handle','last_initial','latitude',
                                 'longitude','notification_preferences','postcode','profile_pic_url'];
  v_grant_after  text[] := array['admin_district','bua','first_name','instagram_handle',
                                 'last_initial','latitude','longitude',
                                 'notification_preferences','postcode','profile_pic_url'];
  v_old   text;
  v_got   text;
  v_cols  text[];
  v_acl   text;
  v_pc    integer;
  v_town  integer;
  v_n     integer;
begin
  -- (0) ⚠️ THIS FILE'S OWN LITERAL, BEFORE THE DATABASE IS READ (item 190).
  if length(v_new) <> 1838 or md5(v_new) <> 'f931c2f388e1eee5f56179f67b8d6fbb' then
    raise exception '%', '0099: THE BODY LITERAL IN THIS FILE arrived len ' || length(v_new)
      || ' md5 ' || md5(v_new) || ', expected len 1838 md5 f931c2f388e1eee5f56179f67b8d6fbb. '
      || 'The paste altered it. THE DATABASE IS NOT THE PROBLEM. Re-copy with '
      || 'Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 <file>). Nothing changed.';
  end if;

  if not exists (select 1 from public.schema_migrations where version = '0098') then
    raise exception '0099: apply 0098 first.';
  end if;

  -- (a) NEITHER COLUMN MAY EXIST. If one does, something added it by hand and
  -- this migration would be recording a change it did not make.
  select string_agg(column_name, ', ' order by column_name) into v_got
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('admin_district', 'bua');
  if v_got is not null then
    raise exception '%', '0099: public.users already has ' || v_got
      || '. Read why before applying. Nothing changed.';
  end if;

  -- (b) ⚠️ EXACTLY ONE set_my_postcode, AND IT MUST BE THE ONE MEASURED,
  -- because this migration DROPS it. An overload left behind would make
  -- `set_my_postcode()` ambiguous and break the clear path.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode';
  if v_n <> 1 then
    raise exception '0099: expected exactly one public.set_my_postcode; found %. Nothing changed.', v_n;
  end if;

  select p.prosrc into v_old
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode'
     and p.oid::regprocedure::text = 'set_my_postcode(text,double precision,double precision)';
  if v_old is null then
    raise exception '%', '0099: the live set_my_postcode is not the 3-argument '
      || '(text, double precision, double precision) version this migration drops. Nothing changed.'
      || chr(10) || coalesce((select string_agg(p.oid::regprocedure::text, ', ')
                                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and p.proname = 'set_my_postcode'), '(none)');
  end if;
  if length(v_old) <> 1220 or md5(v_old) <> '2bdf692a7ad505f3d93f64241f740445' then
    raise exception '%', '0099: the live set_my_postcode body is len ' || length(v_old)
      || ' md5 ' || md5(v_old) || ', not the measured len 1220 md5 '
      || '2bdf692a7ad505f3d93f64241f740445. ⚠️ THIS MIGRATION DROPS THAT FUNCTION, so it refuses '
      || 'to drop a body nobody has read. Nothing changed.'
      || chr(10) || 'hex: ' || encode(convert_to(v_old, 'UTF8'), 'hex');
  end if;

  -- (c) ⚠️ THE GRANT, AS A LIST. If 0088's 8 are not exactly what is there, the
  -- end state below would be asserting against the wrong baseline.
  select array_agg(a.attname order by a.attname) into v_cols
    from pg_attribute a
   where a.attrelid = to_regclass('public.users') and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
  if v_cols is distinct from v_grant_before then
    raise exception '%', '0099: authenticated''s column UPDATE grant on users is '
      || coalesce(array_to_string(v_cols, ','), '(none)') || ', not 0088''s eight. '
      || 'Read it before adding to it. Nothing changed.';
  end if;

  -- (d) The data this migration must not touch.
  select count(*) filter (where postcode is not null) into v_pc from public.users;

  -- ═══ THE CHANGE ═════════════════════════════════════════════════════════
  alter table public.users add column admin_district text;
  alter table public.users add column bua text;

  -- ⚠️ WITHOUT THIS, EVERY SAVE FAILS 42501. See the header.
  grant update (admin_district, bua) on public.users to authenticated;

  -- ⚠️ DROP then CREATE, not replace — the signature changes. Inside one
  -- transaction, so there is no instant at which the RPC is missing.
  drop function public.set_my_postcode(text, double precision, double precision);

  execute format(
    'create function public.set_my_postcode('
    '  p_postcode text             default null,'
    '  p_lat      double precision default null,'
    '  p_lng      double precision default null,'
    '  p_district text             default null,'
    '  p_bua      text             default null'
    ') returns void language plpgsql security invoker '
    'set search_path to %s as $f$%s$f$',
    'public, pg_temp', v_new);

  -- ⚠️ THE NEW SIGNATURE STARTS AT EXECUTE TO PUBLIC. Matching the ACL measured
  -- on the old one: postgres, authenticated, service_role.
  revoke execute on function
    public.set_my_postcode(text, double precision, double precision, text, text) from public, anon;
  grant execute on function
    public.set_my_postcode(text, double precision, double precision, text, text) to authenticated;

  -- ═══ POST-CONDITIONS ════════════════════════════════════════════════════
  -- (e) The columns, their type and their nullability. ⚠️ Both must be NULLABLE:
  -- a postcode is optional (Privacy §5) and a town is optional even with one.
  select string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable,
                    ', ' order by column_name)
    into v_got
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('admin_district', 'bua');
  if v_got is distinct from 'admin_district text nullable=YES, bua text nullable=YES' then
    raise exception '%', '0099: the new columns are ' || coalesce(v_got, '(missing)')
      || ', expected both text and nullable. Rolled back.';
  end if;

  -- (f) ⚠️ THE GRANT, EXACTLY TEN NAMES. A count would pass if a column were
  -- added and another lost.
  select array_agg(a.attname order by a.attname) into v_cols
    from pg_attribute a
   where a.attrelid = to_regclass('public.users') and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
  if v_cols is distinct from v_grant_after then
    raise exception '%', '0099: authenticated''s column UPDATE grant on users is now '
      || coalesce(array_to_string(v_cols, ','), '(none)') || ', expected exactly '
      || array_to_string(v_grant_after, ',') || '. Rolled back.';
  end if;

  -- (g) ⚠️ AND TABLE-LEVEL UPDATE MUST STILL BE ABSENT. A column grant is only
  -- a restriction while the table-level one is gone (0088, item 156).
  if has_table_privilege('authenticated', to_regclass('public.users'), 'UPDATE') then
    raise exception '0099: authenticated now holds TABLE-level UPDATE on users, which undoes 0088. Rolled back.';
  end if;

  -- (h) Exactly one function, the 5-argument one, with the body built above.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode';
  if v_n <> 1 then
    raise exception '0099: % set_my_postcode function(s) after the change, expected 1. Rolled back.', v_n;
  end if;
  select p.prosrc,
         coalesce(array_to_string(p.proacl, '   '), '(NULL)')
    into v_got, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_my_postcode'
     and p.oid::regprocedure::text
         = 'set_my_postcode(text,double precision,double precision,text,text)';
  if v_got is null then
    raise exception '0099: the 5-argument set_my_postcode is not there after the create. Rolled back.';
  end if;
  if v_got <> v_new then
    raise exception '%', '0099: the stored body is not the one this file built — len '
      || length(v_got) || ' md5 ' || md5(v_got) || '. Rolled back.'
      || chr(10) || 'hex: ' || encode(convert_to(v_got, 'UTF8'), 'hex');
  end if;

  -- (i) Properties, matching the function that was dropped.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_my_postcode'
       and p.prosecdef is false and p.provolatile = 'v'
       and p.proconfig = array['search_path=public, pg_temp']) then
    raise exception '%', '0099: the new function is not invoker/volatile/`public, pg_temp` as the '
      || 'old one was. Rolled back.'
      || chr(10) || coalesce((select 'definer=' || p.prosecdef::text
                                  || ' volatility=' || p.provolatile::text
                                  || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(none)')
                                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and p.proname = 'set_my_postcode'), '?');
  end if;

  -- (j) ⚠️ THE ACL, AND THE NULL CASE SEPARATELY. A NULL proacl satisfies "no
  -- aclitem grants PUBLIC" while MEANING the default is in force — and the
  -- default for a function is EXECUTE TO PUBLIC (0097).
  if v_acl = '(NULL)' then
    raise exception '0099: the new function''s proacl is NULL, so DEFAULT privileges apply — which for a function is EXECUTE TO PUBLIC. Rolled back.';
  end if;
  if exists (select 1 from pg_proc p, unnest(p.proacl) x
              where p.oid::regprocedure::text
                    = 'set_my_postcode(text,double precision,double precision,text,text)'
                and (x::text like 'anon=%X%' or x::text like '=%X%')) then
    raise exception '%', '0099: anon or PUBLIC holds EXECUTE on the new function. acl: ' || v_acl
      || '. Rolled back.';
  end if;
  if not exists (select 1 from pg_proc p, unnest(p.proacl) x
                  where p.oid::regprocedure::text
                        = 'set_my_postcode(text,double precision,double precision,text,text)'
                    and x::text like 'authenticated=%X%') then
    raise exception '%', '0099: authenticated does NOT hold EXECUTE on the new function, so no '
      || 'member could set a postcode. acl: ' || v_acl || '. Rolled back.';
  end if;

  -- (k) ⚠️ NO DATA MOVED. The towns are null on every row — the backfill is a
  -- separate script — and the postcodes that existed still do.
  select count(*) filter (where postcode is not null),
         count(*) filter (where admin_district is not null or bua is not null)
    into v_n, v_town
    from public.users;
  if v_n <> v_pc then
    raise exception '0099: users with a postcode went from % to %. Rolled back.', v_pc, v_n;
  end if;
  if v_town <> 0 then
    raise exception '0099: % row(s) already carry a town. This migration writes no data. Rolled back.', v_town;
  end if;
end $mig$;

comment on column public.users.admin_district is
  'The council area postcodes.io returns for the member''s postcode — "Medway" for ME4 4TR. '
  'Stored by set_my_postcode (0099) from a lookup site/lib/postcode.ts was already making and '
  'discarding. ⚠️ DERIVED, NOT ENTERED: it is whatever ONS says for the postcode she gave, and '
  'clearing the postcode clears it. ⚠️ It is the FALLBACK for display, not the answer to "where are '
  'you?" — see users.bua. Optional, like the postcode (Privacy §5).';

comment on column public.users.bua is
  'The built-up area postcodes.io returns — "Chatham" for ME4 4TR, where admin_district says '
  '"Medway". ⚠️ THIS IS THE ONE A PERSON WOULD ANSWER "where are you?" WITH, so the display prefers '
  'it and falls back to admin_district. ⚠️ ONS HOLDS NO bua FOR MANY POSTCODES, which is why this is '
  'not a single column called `town`: a null here with a postcode present is a NORMAL row, not a '
  'failed one. Stored by set_my_postcode (0099); cleared with the postcode. Optional.';

comment on function public.set_my_postcode(text, double precision, double precision, text, text) is
  'Sets or clears the caller''s postcode, coordinate and town names, and mirrors the coordinate to '
  'providers. SECURITY INVOKER by design — RLS confines it to your own rows, and 0088''s COLUMN-level '
  'UPDATE grant is what bounds it. ⚠️ THE TEN-COLUMN GRANT IS LOAD-BEARING: add a column here without '
  'adding it to that grant and every save fails 42501, which the web action reports as "That didn''t '
  'save". ⚠️ ALL THREE OF postcode/lat/lng OR NONE — a postcode with no coordinate looks like it is '
  'working. ⚠️ THE TOWNS CANNOT OUTLIVE THE POSTCODE: clearing it nulls both, whatever the caller '
  'passed. ⚠️ 0099 DROPPED the 3-argument version rather than replacing it, because adding '
  'parameters creates an overload and `set_my_postcode()` would then be ambiguous — which is how '
  'the clear path calls it. The three original argument NAMES are unchanged, so a client sending '
  'only those still works. Items 90 and 156.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0099', 'the_town_the_lookup_already_knew', '39e2d6c0673e9264171c543b277280121e09b2add105ee7602b3c71c31302e48');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — run against the live database 21 Oct 2026 THROUGH THE SUPABASE
-- CONNECTOR IN CHAT, not by hand in the SQL editor. ⚠️ CORRECTED 21 Oct 2026:
-- this line said "by Micky". The backfill was run the same way. Provenance of a
-- measurement is part of the measurement — who ran it decides what else could
-- have been in the session — and these headers keep saying so about other
-- people's claims.
--   set_my_postcode(text, double precision, double precision) · INVOKER ·
--   VOLATILE · search_path=public, pg_temp · acl postgres + authenticated +
--   service_role · prosrc 1220 chars md5 2bdf692a7ad505f3d93f64241f740445 ·
--   CR 30 / LF 30 (CRLF) · authenticated holds column UPDATE on exactly the 8
--   columns asserted above and NO table-level UPDATE · providers has latitude,
--   location_text, longitude, region and NO postcode · users has no existing
--   town/city/district/admin_district/bua column · 7 of 35 users have a
--   postcode.
--
-- ⚠️ THE FOURTH THING, WHICH I DID NOT ASK FOR AND NEEDED. Micky: the live body
-- is CRLF, so for a migration that CREATES a body the risk runs the other way —
-- the new body picking up CRLF on paste and not matching what is asserted.
-- Hence chr(10) and the (0) check. Measured per object, carried from nothing.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
--   do $$
--   declare
--     r_cols text := 'not run';
--     r_gr   text := 'not run';
--     r_fn   text := 'not run';
--     r_acl  text := 'not run';
--     r_data text := 'not run';
--     r_appl text := 'not run';
--     v_cols text[];
--     v_n    integer;
--     v_t    integer;
--   begin
--     select string_agg(column_name || ' ' || data_type || ' null=' || is_nullable,
--                       ', ' order by column_name)
--       into r_cols
--       from information_schema.columns
--      where table_schema = 'public' and table_name = 'users'
--        and column_name in ('admin_district', 'bua');
--     r_cols := case when r_cols = 'admin_district text null=YES, bua text null=YES'
--                    then 'pass  - both text, both nullable'
--                    else 'FAIL  - ' || coalesce(r_cols, '(missing)') end;
--
--     -- ⚠️ THE ONE THAT DECIDES WHETHER SAVING WORKS AT ALL.
--     select array_agg(a.attname order by a.attname) into v_cols
--       from pg_attribute a
--      where a.attrelid = to_regclass('public.users') and a.attnum > 0 and not a.attisdropped
--        and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
--     r_gr := case when v_cols = array['admin_district','bua','first_name','instagram_handle',
--                                      'last_initial','latitude','longitude',
--                                      'notification_preferences','postcode','profile_pic_url']
--                  then 'pass  - exactly 10, the new two included'
--                  else 'FAIL  - ' || coalesce(array_to_string(v_cols, ','), '(none)') end;
--     if has_table_privilege('authenticated', to_regclass('public.users'), 'UPDATE') then
--       r_gr := r_gr || '  ⚠️ AND table-level UPDATE is back, which undoes 0088';
--     end if;
--
--     select count(*) into v_n
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'set_my_postcode';
--     r_fn := coalesce((select case when v_n <> 1 then 'FAIL  - ' || v_n || ' signatures'
--                                   when length(p.prosrc) = 1838
--                                        and md5(p.prosrc) = 'f931c2f388e1eee5f56179f67b8d6fbb'
--                                     then 'pass  - one 5-arg function, body 1838/f931c2f3…'
--                                   else 'FAIL  - body len ' || length(p.prosrc)
--                                        || ' md5 ' || md5(p.prosrc) end
--                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                        where n.nspname = 'public' and p.proname = 'set_my_postcode'
--                          and p.oid::regprocedure::text
--                              = 'set_my_postcode(text,double precision,double precision,text,text)'),
--                      'FAIL  - the 5-argument function does not exist');
--
--     -- ⚠️ TWO QUESTIONS, NOT ONE: no PUBLIC/anon grantee, AND the acl is not NULL.
--     r_acl := coalesce((select case
--                 when p.proacl is null
--                   then 'FAIL  - proacl is NULL, so the default applies = EXECUTE TO PUBLIC'
--                 when exists (select 1 from unnest(p.proacl) x
--                               where x::text like 'anon=%X%' or x::text like '=%X%')
--                   then 'FAIL  - anon or PUBLIC holds EXECUTE: ' || array_to_string(p.proacl, ' ')
--                 when not exists (select 1 from unnest(p.proacl) x
--                                   where x::text like 'authenticated=%X%')
--                   then 'FAIL  - authenticated has no EXECUTE; nobody can set a postcode'
--                 else 'pass  - ' || array_to_string(p.proacl, '  ') end
--               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--              where n.nspname = 'public' and p.proname = 'set_my_postcode'),
--              'FAIL  - no function to read an acl from');
--
--     -- ⚠️ EXPECTED TO SHOW 7 POSTCODES AND 0 TOWNS. The migration writes no
--     -- data; a non-zero town count here means the backfill has been run.
--     select count(*) filter (where postcode is not null),
--            count(*) filter (where admin_district is not null or bua is not null)
--       into v_n, v_t from public.users;
--     r_data := 'info  - ' || v_n || ' user(s) with a postcode, ' || v_t
--               || ' with a town. 0 towns is correct until the backfill is run.';
--
--     r_appl := case when exists (select 1 from public.schema_migrations where version = '0099')
--                    then 'info  - 0099 IS applied'
--                    else '⚠️ 0099 has NOT been applied (no row in schema_migrations). '
--                         || 'Nothing above describes a change that has happened.' end;
--
--     raise exception '%',
--       chr(10) || '=== 0099 VERIFY ==='
--       || chr(10) || '1  columns              : ' || r_cols
--       || chr(10) || '2  ⚠️ the 10-col grant   : ' || r_gr
--       || chr(10) || '3  the function         : ' || r_fn
--       || chr(10) || '4  acl, and not NULL    : ' || r_acl
--       || chr(10) || '5  data                 : ' || r_data
--       || chr(10) || '6  applied?             : ' || r_appl;
--   end $$;
--
--   EXPECT: 1-4 pass, 5 and 6 info. ⚠️ LINE 2 IS THE ONE THAT DECIDES WHETHER
--   SAVING A POSTCODE WORKS AT ALL — and its failure mode in the product is
--   "That didn't save", which names nothing.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

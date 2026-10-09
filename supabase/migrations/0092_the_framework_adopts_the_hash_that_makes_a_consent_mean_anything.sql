-- ===========================================================================
-- 0092_the_framework_adopts_the_hash_that_makes_a_consent_mean_anything
--
-- Item 189, first of four. ⚠️ Apply 0091 first. ⚠️ CHANGES NO BEHAVIOUR.
--
-- Adopts `public.set_consent_hash()` AND its trigger `trg_consent_hash` into
-- the migration framework, verbatim. Both existed only in
-- `schema-snapshot-2026-08-08.sql` — no migration has ever created, replaced or
-- asserted either.
--
-- ── WHY THIS ONE IS FIRST OF THE FOUR ──────────────────────────────────────
-- **It is the object that makes a consent record mean anything.**
-- `session_consents` stores a `content_hash`, and this function is what computes
-- it. If the formula moved, every stored hash would stop matching the document
-- it names — and the mismatch is the ONLY trace, because the rows are
-- append-only and the documents are versioned. Item 167 asks whether consent
-- records mean anything; this is the object that decides it, and nothing in the
-- repo asserted its shape.
--
-- ── ⚠️⚠️ THREE THINGS PRESERVED EXACTLY, NONE OF THEM HOUSE STYLE ──────────
-- An adoption that "tidies" is not an adoption.
--
--   * **SECURITY INVOKER** (`prosecdef = false`). House style for a trigger that
--     guards something is DEFINER; this one is not, and is not being changed.
--   * **VOLATILE** (`provolatile = 'v'`). It assigns to NEW and returns it.
--   * **`search_path = public, extensions`** — ⚠️ **AND THE `extensions` PART IS
--     LOAD-BEARING.** `digest()` lives there and NOWHERE ELSE (measured 9 Oct
--     2026). Narrowing this to the house `public, pg_temp` would make EVERY
--     insert into `consent_documents` fail, and it would surface as a broken
--     consent flow rather than as an obvious migration error.
--
-- ── ⚠️⚠️ THE BODY, AND WHY IT WAS BUILT FROM HEX RATHER THAN FROM THE PRINTOUT
-- `prosrc` is 217 characters, `md5 = a35131d578e450fac18370e5f38b7494`.
-- **Two of its characters are invisible in any printed body**, and an exact
-- reproduction fails on either:
--
--   * it OPENS with a newline — `0a` before `begin`;
--   * it CLOSES `656e6420` — `end` then ONE SPACE, with NO trailing newline.
--
-- Micky read the full hex and spotted both (9 Oct 2026). The literal below was
-- generated mechanically by decoding that hex and emitting one quoted line per
-- `chr(10)` — not retyped from the pretty-printed version, which would have
-- silently lost the leading newline and the trailing space.
--
-- ⚠️ **AND THE CR QUESTION WAS CHECKED, NOT ASSUMED.** Item 190 found the SQL
-- editor converts LF to CRLF on paste, so a body carrying CR is the norm to
-- expect. This one measured **CR=0, LF=12**. The `chr(10)` construction is right
-- here BECAUSE it was measured, not because it is the habit — and a body that
-- did carry CR would need `chr(13) || chr(10)` instead.
--
-- ── ⚠️ THE TRIGGER IS ADOPTED TOO, AND LEAVING IT WOULD BE HALF A JOB ──────
-- `trg_consent_hash` is as unowned as the function. A function nothing fires
-- computes nothing: without the trigger, `content_hash` would simply be whatever
-- the inserter supplied, which is precisely what 0091's header forbids.
--
-- ⚠️ `create or replace trigger` is used rather than drop-then-create, so there
-- is no instant — even inside a transaction — at which the table has no hash
-- trigger. It needs PostgreSQL 14+; an older server fails loudly on the syntax,
-- which is the right failure.
--
-- ⚠️ AND THE FUNCTION IS NAMED UNQUALIFIED IN THE TRIGGER, DELIBERATELY. That is
-- exactly how `pg_get_triggerdef` renders the live one, and this migration
-- asserts the rendered definition is byte-identical before and after. Writing
-- `public.set_consent_hash()` would be better practice in new code and would
-- make that assertion fail on a cosmetic difference — the trigger resolves its
-- function by OID at creation time, so there is no ambiguity either way.
--
-- ── ⚠️ ITEM 190 APPLIES TO THIS FUNCTION'S FUTURE AS WELL AS ITS PRESENT ───
-- Unlike 0090's new function, this body IS compared — before and after, in this
-- file. So `format()` with a `chr(10)`-built literal is not optional here: a
-- multi-line body written as literal SQL would arrive CRLF from a paste and the
-- migration would refuse itself, which is exactly what 0089 did on its first
-- run.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- Nothing about the signature, the behaviour or any column changes.
-- ===========================================================================
begin;

do $mig$
declare
  -- ⚠️ GENERATED FROM THE LIVE HEX, NOT RETYPED. 217 chars,
  -- md5 a35131d578e450fac18370e5f38b7494. The leading chr(10) and the trailing
  -- space after `end` are the two characters a printout does not show.
  v_want text :=
    '' ||
    chr(10) || 'begin' ||
    chr(10) || '  new.content_hash := encode(' ||
    chr(10) || '    digest(' ||
    chr(10) || '      coalesce(new.title, '''') ||' ||
    chr(10) || '      coalesce(new.body, '''') ||' ||
    chr(10) || '      coalesce(new.acknowledgements::text, ''''),' ||
    chr(10) || '      ''sha256''' ||
    chr(10) || '    ),' ||
    chr(10) || '    ''hex''' ||
    chr(10) || '  );' ||
    chr(10) || '  return new;' ||
    chr(10) || 'end ';
  -- ⚠️ THE OTHER TWO MEASURED CONSTANTS, pinned EXACTLY rather than matched
  -- loosely. A `search_path like '%extensions%'` test would accept
  -- `public, extensions, anything` — which is a check that cannot fail in the one
  -- direction worth testing, audit item 188.
  v_cfg_want text[] := array['search_path=public, extensions'];
  v_tdef_want text :=
    'CREATE TRIGGER trg_consent_hash BEFORE INSERT OR UPDATE ON public.consent_documents '
    'FOR EACH ROW EXECUTE FUNCTION set_consent_hash()';
  v_before   text;
  v_after    text;
  v_tbefore  text;
  v_tafter   text;
  v_sec      boolean;
  v_vol      "char";
  v_cfg      text[];
  v_bad      text;
  v_n        integer;
begin
  -- (0) ⚠️⚠️ THE LITERAL IN THIS FILE, CHECKED BEFORE THE DATABASE IS READ.
  -- Every other check below compares the live function to v_want. If v_want
  -- ITSELF arrived corrupted, those checks would report the DATABASE as wrong
  -- and send the reader to look at the wrong object. Item 190: the SQL editor
  -- converts LF to CRLF on paste, and 0089 refused itself over exactly that.
  -- 217 and the md5 are MEASURED values (9 Oct 2026), not a formula.
  if length(v_want) <> 217 or md5(v_want) <> 'a35131d578e450fac18370e5f38b7494' then
    raise exception '%', '0092: THE LITERAL IN THIS FILE IS NOT THE ONE IT WAS WRITTEN WITH — it arrived '
      || 'len=' || length(v_want) || ' md5=' || md5(v_want)
      || ', expected len=217 md5=a35131d578e450fac18370e5f38b7494. The paste altered it (item 190: '
      || 'LF becomes CRLF). THE DATABASE IS NOT THE PROBLEM. Re-copy the file with '
      || 'Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 <file>). Nothing changed.';
  end if;

  if not exists (select 1 from public.schema_migrations where version = '0091') then
    raise exception '0092: apply 0091 first.';
  end if;

  -- (a) EXACTLY ONE SIGNATURE. An overload would make every read below
  -- ambiguous and the replace would add a second function rather than adopt.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_consent_hash';
  if v_n <> 1 then
    raise exception '0092: expected exactly one public.set_consent_hash; found %. Nothing changed.', v_n;
  end if;

  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_before, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_consent_hash';

  -- (b) THE GATE, md5 and length named explicitly so a failure is directly
  -- comparable to the preflight. If the live body is not the one this was written from, the
  -- adoption WAITS and the difference is the finding. length and md5 are printed
  -- because the difference will be invisible whitespace if it is anything.
  if length(v_before) <> 217 or md5(v_before) <> 'a35131d578e450fac18370e5f38b7494'
     or v_before <> v_want then
    raise exception '%', '0092: the live set_consent_hash() body is NOT what this migration was '
      || 'written from, so adopting it would CHANGE the function that computes every consent hash. '
      || 'THE ADOPTION WAITS AND THE DIFFERENCE IS THE FINDING.'
      || chr(10) || 'live     len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || 'hex: ' || encode(convert_to(v_before, 'UTF8'), 'hex')
      || chr(10) || 'expected len=' || length(v_want) || ' md5=' || md5(v_want)
      || chr(10) || 'hex: ' || encode(convert_to(v_want, 'UTF8'), 'hex');
  end if;

  -- (c) THE THREE PROPERTIES, EACH FOR ITS OWN REASON. ⚠️ `extensions` is the
  -- one that matters functionally: digest() lives only there.
  if v_sec is not false then
    raise exception '0092: set_consent_hash is SECURITY DEFINER live; this migration adopts it as INVOKER. Read it before applying. Nothing changed.';
  end if;
  if v_vol <> 'v' then
    raise exception '%', '0092: set_consent_hash volatility is ' || v_vol::text
      || ', expected v (VOLATILE). Nothing changed.';
  end if;
  if v_cfg is distinct from v_cfg_want then
    raise exception '%', '0092: set_consent_hash search_path is '
      || coalesce(array_to_string(v_cfg, ','), '(none)')
      || ', not the measured `public, extensions`. ⚠️ If `extensions` is missing, digest() lives '
      || 'ONLY there and consent hashing is ALREADY broken — that outranks this migration. If '
      || 'something has been ADDED, read why before this file overwrites it. Nothing changed.';
  end if;

  -- (d) THE TRIGGER MUST EXIST BEFORE IT CAN BE ADOPTED, and its absence would
  -- mean content_hash is not being computed at all.
  select pg_get_triggerdef(t.oid) into v_tbefore
    from pg_trigger t
   where t.tgrelid = 'public.consent_documents'::regclass
     and t.tgname = 'trg_consent_hash' and not t.tgisinternal;
  if v_tbefore is null then
    raise exception '0092: trg_consent_hash is not on public.consent_documents. content_hash is not being computed by anything, which outranks this migration. Nothing changed.';
  end if;
  -- ⚠️ AND IT MUST BE THE TRIGGER THIS FILE DESCRIBES. Present-under-that-name is
  -- not the same claim: an AFTER trigger of the same name would never set
  -- content_hash on the row being written, and `create or replace trigger` below
  -- would silently convert it to BEFORE — a behaviour change inside a migration
  -- whose header promises none.
  if v_tbefore is distinct from v_tdef_want then
    raise exception '%', '0092: trg_consent_hash is not the trigger this migration describes. '
      || 'Nothing changed.' || chr(10) || 'live:     ' || v_tbefore
      || chr(10) || 'expected: ' || v_tdef_want;
  end if;

  -- ── THE ADOPTION ─────────────────────────────────────────────────────────
  -- ⚠️ BUILT FROM v_want, so the body exists ONCE in this file and a paste
  -- cannot alter it (item 190; 0089 refused itself over exactly this).
  execute format(
    'create or replace function public.set_consent_hash() returns trigger '
    'language plpgsql set search_path to %s as $f$%s$f$',
    'public, extensions', v_want);

  -- ⚠️ `create or replace`, not drop-then-create: no instant without a hash
  -- trigger. Unqualified function name to match pg_get_triggerdef's rendering,
  -- so the comparison below is exact — see the header.
  create or replace trigger trg_consent_hash
    before insert or update on public.consent_documents
    for each row execute function set_consent_hash();

  -- ── BEFORE vs AFTER ──────────────────────────────────────────────────────
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_after, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_consent_hash';

  -- ⚠️ md5 AND LENGTH NAMED EXPLICITLY, not left implied by the comparison. If
  -- this fires, the number in the message is directly comparable to the
  -- preflight measurement without re-deriving anything.
  if length(v_after) <> 217 or md5(v_after) <> 'a35131d578e450fac18370e5f38b7494' then
    raise exception '%', '0092: AFTER THE REPLACE the body is len=' || length(v_after)
      || ' md5=' || md5(v_after) || ', not the measured len=217 '
      || 'md5=a35131d578e450fac18370e5f38b7494. Rolled back.'
      || chr(10) || 'hex: ' || encode(convert_to(v_after, 'UTF8'), 'hex');
  end if;

  if v_after <> v_before then
    raise exception '%', '0092: ADOPTION CHANGED THE BODY. Every consent hash computed from now on '
      || 'would differ from every one already stored. Rolled back.'
      || chr(10) || 'before len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || 'hex: ' || encode(convert_to(v_before, 'UTF8'), 'hex')
      || chr(10) || 'after  len=' || length(v_after) || ' md5=' || md5(v_after)
      || chr(10) || 'hex: ' || encode(convert_to(v_after, 'UTF8'), 'hex');
  end if;
  if v_sec is not false or v_vol <> 'v' or v_cfg is distinct from v_cfg_want then
    raise exception '%', '0092: a property moved in the replace — definer=' || v_sec::text
      || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || '. Expected invoker, volatile, search_path = `public, extensions` EXACTLY. Rolled back.';
  end if;

  select pg_get_triggerdef(t.oid) into v_tafter
    from pg_trigger t
   where t.tgrelid = 'public.consent_documents'::regclass
     and t.tgname = 'trg_consent_hash' and not t.tgisinternal;
  if v_tafter is distinct from v_tbefore then
    raise exception '%', '0092: the trigger definition changed. Rolled back.'
      || chr(10) || 'before: ' || coalesce(v_tbefore, '(null)')
      || chr(10) || 'after:  ' || coalesce(v_tafter, '(null)');
  end if;

  -- ⚠️ THE PROOF THAT MATTERS MORE THAN ANY CATALOGUE READ: the function still
  -- computes the hash that every stored consent was recorded against. A body
  -- that matched byte for byte but resolved a different digest() would pass
  -- every check above and fail this one.
  select count(*) into v_n
    from public.session_consents sc
    join public.consent_documents d on d.id = sc.consent_document_id
   where sc.content_hash <> d.content_hash;
  if v_n <> 0 then
    raise exception '0092: % session_consents row(s) no longer match their document''s hash. Rolled back.', v_n;
  end if;

  -- ⚠⚠ AND IF THIS ONE FIRES, THE MESSAGE MUST SAY WHOSE FAULT IT IS.
  -- The body has already been proven byte-identical before and after, so a
  -- failure here is NOT something the replace did — it is pre-existing drift in a
  -- stored hash, which 0092 is the first thing ever to look for. A rollback
  -- whose message leaves that ambiguous sends the reader to audit the migration
  -- instead of the row. The versions are named so the next step is a read, not
  -- a hunt.
  select count(*), string_agg(distinct coalesce(d.version::text, '(null)'), ', ' order by coalesce(d.version::text, '(null)'))
    into v_n, v_bad
    from public.consent_documents d
   where d.content_hash <> encode(extensions.digest(
           coalesce(d.title, '') || coalesce(d.body, '') || coalesce(d.acknowledgements::text, ''),
           'sha256'), 'hex');
  if v_n <> 0 then
    raise exception '%', '0092: the function was adopted UNCHANGED — prosrc is byte-identical before '
      || 'and after, and that is proven above. But ' || v_n || ' consent_documents row(s) store a '
      || 'content_hash this formula does not reproduce, at version(s) ' || v_bad || '. '
      || 'THAT IS PRE-EXISTING DRIFT, NOT SOMETHING THIS MIGRATION DID, and 0092 is the first thing '
      || 'ever to check for it. A stored hash the formula cannot produce means that document''s hash '
      || 'does not attest to its content — which is what item 167 asks about. Read those rows before '
      || 're-running. Rolled back.';
  end if;
end $mig$;

comment on function public.set_consent_hash() is
  'Computes consent_documents.content_hash as sha256(title || body || acknowledgements::text), hex. '
  '⚠️ THE OBJECT THAT MAKES A CONSENT RECORD MEAN ANYTHING: session_consents stores this hash, so if '
  'the formula moved, every stored hash would stop matching the document it names and the mismatch '
  'would be the only trace. ADOPTED VERBATIM BY 0092 from the live object — it predated the migration '
  'framework and existed only in schema-snapshot-2026-08-08.sql. 0092 changed NO behaviour and proves '
  'it: prosrc compared before and after, plus every session_consents row re-checked against its '
  'document and every document re-checked against the formula. ⚠️ search_path is `public, extensions` '
  'and the `extensions` part is LOAD-BEARING — digest() lives only there, so narrowing it to the house '
  '`public, pg_temp` would make every consent_documents insert fail. ⚠️ Never supply content_hash on '
  'insert; this owns it. Item 189.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0092', 'the_framework_adopts_the_hash_that_makes_a_consent_mean_anything', '0a2a47b50e4f324a821c89dddf90c3a71fbf40b05bbaf265793283ef85a83e1c');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — already run 9 Oct 2026; re-run if any time has passed.
--
--   with f as (
--     select p.oid, p.prosrc, p.prosecdef, p.provolatile, p.proconfig, p.proowner
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'set_consent_hash'
--   )
--   select 'a. ownership' as part, 'set_consent_hash' as name,
--          coalesce((select 'owner=' || pg_get_userbyid(proowner)
--                        || ' | current_user=' || current_user
--                        || ' | may replace=' || (pg_get_userbyid(proowner) = current_user
--                                                 or pg_has_role(current_user, proowner, 'USAGE'))::text
--                      from f), '(MISSING)') as detail
--   union all
--   select 'b. properties', 'definer / volatility / search_path',
--          coalesce((select 'definer=' || prosecdef::text
--                        || ' volatility=' || provolatile::text
--                        || ' config=' || coalesce(array_to_string(proconfig, ','), '(NULL)')
--                      from f), '(MISSING)')
--   union all
--   select 'c. body', 'FULL hex — build from THIS, not from a printout',
--          coalesce((select encode(convert_to(prosrc, 'UTF8'), 'hex') from f), '(MISSING)')
--   union all
--   select 'd. body', 'length / md5',
--          coalesce((select length(prosrc)::text || ' chars, md5=' || md5(prosrc) from f), '(MISSING)')
--   union all
--   select 'e. the trigger', 'trg_consent_hash on consent_documents',
--          coalesce((select pg_get_triggerdef(t.oid)
--                      from pg_trigger t
--                     where t.tgrelid = 'public.consent_documents'::regclass
--                       and t.tgname = 'trg_consent_hash' and not t.tgisinternal),
--                   '(MISSING — the hash would stop being computed)')
--   union all
--   select 'f. signatures', 'set_consent_hash overloads (expect 1)',
--          (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname = 'set_consent_hash')
--   union all
--   select 'g. digest reachability', 'where digest() actually lives',
--          coalesce((select string_agg(distinct n.nspname, ', ')
--                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                     where p.proname = 'digest'), '(NOT FOUND)')
--   union all
--   select 'h. gate', '0091 applied',
--          ((select count(*) from public.schema_migrations where version = '0091') = 1)::text
--    order by 1, 2;
--
--   MEASURED 9 Oct 2026: owner=postgres, may replace=true · definer=false,
--   volatility=v, config=search_path=public, extensions · 217 chars,
--   md5=a35131d578e450fac18370e5f38b7494, CR=0 LF=12 · trigger present ·
--   1 signature · digest lives in `extensions` ONLY · 0091 applied.
--
--   ⚠️ (c) IS THE HEX ON PURPOSE. The printed body does not show that prosrc
--   OPENS with a newline and CLOSES with `end` + a SPACE. Both were found by
--   reading the hex, and an exact reproduction fails on either.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION IS NEEDED OR TAKEN. Everything asserted here is the same
-- for every identity: catalogue rows and a recomputation. 0090's verify was
-- wrong five times, every time because a block asked a question of a party that
-- could not answer it honestly — so the seats are enumerated first, and here
-- there are none.
--
--   do $$
--   declare
--     v_want text :=
--       '' ||
--       chr(10) || 'begin' ||
--       chr(10) || '  new.content_hash := encode(' ||
--       chr(10) || '    digest(' ||
--       chr(10) || '      coalesce(new.title, '''') ||' ||
--       chr(10) || '      coalesce(new.body, '''') ||' ||
--       chr(10) || '      coalesce(new.acknowledgements::text, ''''),' ||
--       chr(10) || '      ''sha256''' ||
--       chr(10) || '    ),' ||
--       chr(10) || '    ''hex''' ||
--       chr(10) || '  );' ||
--       chr(10) || '  return new;' ||
--       chr(10) || 'end ';
--     r_body text := 'not run';
--     r_prop text := 'not run';
--     r_trig text := 'not run';
--     r_docs text := 'not run';
--     r_cons text := 'not run';
--     r_ctrl text := 'not run';
--     v_src  text;
--     v_tdef text;
--     v_sec  boolean;
--     v_vol  "char";
--     v_cfg  text[];
--     v_n    integer;
--   begin
--     select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
--       into v_src, v_sec, v_vol, v_cfg
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'set_consent_hash';
--
--     -- ⚠️ THE LITERAL FIRST. If the paste mangled v_want (item 190), line 1
--     -- must say so rather than report the function as changed.
--     r_body := case
--       when length(v_want) <> 217 or md5(v_want) <> 'a35131d578e450fac18370e5f38b7494'
--         then 'FAIL  - THIS VERIFY BLOCK''S OWN LITERAL arrived len ' || length(v_want)
--              || ' md5 ' || md5(v_want) || '. Re-copy it; the function is not implicated.'
--       when v_src = v_want and length(v_src) = 217
--            and md5(v_src) = 'a35131d578e450fac18370e5f38b7494'
--         then 'pass  - byte-identical, len 217, md5 a35131d5… as measured'
--       else 'FAIL  - body differs: len ' || length(coalesce(v_src, ''))
--            || ' md5 ' || coalesce(md5(v_src), '(null)') end;
--
--     -- ⚠️ search_path PINNED EXACTLY, not matched on the substring `extensions`.
--     -- A `like '%extensions%'` test accepts `public, extensions, anything`, so it
--     -- cannot fail in the direction this line exists to test — item 188.
--     r_prop := case when v_sec is false and v_vol = 'v'
--                     and v_cfg is not distinct from array['search_path=public, extensions']
--                    then 'pass  - invoker, volatile, search_path = public, extensions'
--                    else 'FAIL  - definer=' || v_sec::text || ' volatility=' || v_vol::text
--                         || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)') end;
--
--     -- ⚠️ COMPARED, NOT MERELY FOUND. A first draft printed the definition and
--     -- said `pass`, which would have passed on an AFTER trigger of the same name
--     -- — a trigger that can never set content_hash on the row being written.
--     v_tdef := (select pg_get_triggerdef(t.oid) from pg_trigger t
--                 where t.tgrelid = 'public.consent_documents'::regclass
--                   and t.tgname = 'trg_consent_hash' and not t.tgisinternal);
--     r_trig := case
--       when v_tdef is null
--         then 'FAIL  - trg_consent_hash is gone; nothing computes content_hash'
--       when v_tdef = 'CREATE TRIGGER trg_consent_hash BEFORE INSERT OR UPDATE ON '
--                     'public.consent_documents FOR EACH ROW EXECUTE FUNCTION set_consent_hash()'
--         then 'pass  - BEFORE INSERT OR UPDATE ... EXECUTE FUNCTION set_consent_hash()'
--       else 'FAIL  - definition differs: ' || v_tdef end;
--
--     -- ⚠️ THE TWO THAT PROVE BEHAVIOUR RATHER THAN SHAPE. A body that matched
--     -- byte for byte but resolved a different digest() would pass everything
--     -- above and fail these.
--     select count(*) into v_n
--       from public.consent_documents d
--      where d.content_hash <> encode(extensions.digest(
--              coalesce(d.title, '') || coalesce(d.body, '') || coalesce(d.acknowledgements::text, ''),
--              'sha256'), 'hex');
--     -- ⚠️ A FAILURE HERE IS DRIFT IN A STORED HASH, not a fault in the function —
--     -- line 1 is what tests the function. Worded so the two are not confused.
--     r_docs := case when v_n = 0 then 'pass  - every document reproduces its own hash'
--                    else 'FAIL  - ' || v_n || ' document(s) store a hash this formula does not '
--                         || 'produce. Pre-existing drift, not the adoption (see line 1).' end;
--
--     select count(*) into v_n
--       from public.session_consents sc
--       join public.consent_documents d on d.id = sc.consent_document_id
--      where sc.content_hash <> d.content_hash;
--     r_cons := case when v_n = 0 then 'pass  - every consent still matches its document'
--                    else 'FAIL  - ' || v_n || ' consent(s) no longer match' end;
--
--     -- THE CONTROL. 0092 names no other object; the other append-only guard
--     -- must be exactly as it was, or a pass here could be a pass caused by
--     -- something broader having moved.
--     r_ctrl := coalesce((select 'pass  - trg_lock_consents still on session_consents'
--                           from pg_trigger t
--                          where t.tgrelid = 'public.session_consents'::regclass
--                            and t.tgname = 'trg_lock_consents' and not t.tgisinternal),
--                        'FAIL  - trg_lock_consents is gone; session_consents is no longer append-only');
--
--     raise exception '%',
--       chr(10) || '=== 0092 VERIFY ==='
--       || chr(10) || '1  body adopted unchanged  : ' || r_body
--       || chr(10) || '2  properties preserved    : ' || r_prop
--       || chr(10) || '3  trigger                 : ' || r_trig
--       || chr(10) || '4  documents reproduce     : ' || r_docs
--       || chr(10) || '5  consents still match    : ' || r_cons
--       || chr(10) || '6  control, lock intact    : ' || r_ctrl;
--   end $$;
--
--   EXPECT: all six pass. ⚠️ 4 and 5 are the ones worth reading twice — they are
--   the only lines that test what the function DOES rather than what it looks
--   like, and a failure in either means consent records have stopped matching
--   the documents they cite.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

-- ===========================================================================
-- 0094_pg_temp_last_on_every_definer_search_path
--
-- Item 202. ⚠️ Apply 0093 first. ⚠️ TOUCHES NO FUNCTION BODY.
--
-- Appends `pg_temp` to the `search_path` of every SECURITY DEFINER function in
-- `public` that has one and does not already name it.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- **Postgres searches the caller's temporary-table schema FIRST for relations
-- when `pg_temp` is not listed in `search_path`** — before `public`, before
-- `pg_catalog`. `anon`, `authenticated` and `service_role` all hold TEMP on this
-- database (measured 9 Oct 2026), so any of them can create `pg_temp.<table>`
-- and decide what an unqualified relation reference resolves to inside a
-- function running as its owner.
--
-- ── ⚠️⚠️ THE SCOPE, AS MEASURED, BECAUSE THE NUMBER 41 INVITES THE WRONG READ
-- 41 of 78 SECURITY DEFINER functions in `public` lack `pg_temp`. **Micky then
-- measured which of them name a relation WITHOUT its schema, and found exactly
-- one** — `has_open_availability` (item 201). Everything else matched only `v_*`
-- PL/pgSQL variables from `select … into`, `join lateral` aliases, or words
-- inside comments.
--
-- ⚠️ **A MISSING `pg_temp` IS ONLY EXPLOITABLE THROUGH AN UNQUALIFIED RELATION
-- REFERENCE.** `reject_overlapping_session` reads `from public.sessions s` and
-- `is_admin()` reads `from public.admins` — qualified, so the temp schema never
-- enters resolution and neither is exploitable at all.
--
-- ✅ **So this migration is DEFENCE IN DEPTH, not a fix for a live bypass**, and
-- it should not be described as one. What it buys: a future edit that writes an
-- unqualified table name inside any of these forty cannot reintroduce the hazard.
-- That is worth one migration precisely because it costs one migration.
--
-- ⚠️ And `has_open_availability` needs more than this — its BODY must be
-- qualified, which is item 201 and needs its own migration. This one gives it the
-- `pg_temp` half only. ⚠️ THE CONDITION, NOT A NUMBER: item 201 is closed when
-- that function's two table references are schema-qualified; whichever migration
-- does it takes whatever number is next at the time.
--
-- ── ⚠️⚠️ WHY IT APPENDS AND NEVER WRITES A FIXED STRING ────────────────────
-- The obvious batch is `set search_path = public, pg_temp` everywhere. **That
-- would break the live site.** `set_consent_hash` must keep
-- `search_path = public, extensions` because `digest()` lives ONLY in
-- `extensions` (0092) — remove it and **every `consent_documents` insert starts
-- failing**, surfacing as a broken consent flow rather than as a migration error,
-- which is the hardest kind of failure to trace back here.
--
-- So each function's existing list is read and `, pg_temp` is appended to it,
-- per function, and never replaced.
--
-- ── ⚠⚠ AND `set_consent_hash` IS **NOT** IN THIS BATCH. CORRECTED BEFORE APPLY.
-- It was raised as the one that must end `public, extensions, pg_temp`. **It will
-- end `public, extensions`, unchanged, because it is SECURITY INVOKER** —
-- `prosecdef = false`, measured 9 Oct 2026 and preserved deliberately by 0092.
-- The 41 are SECURITY DEFINER functions; this is not one of them.
--
-- ✅ **AND SCOPING TO DEFINER IS CORRECT, NOT AN OVERSIGHT.** Temp-schema
-- shadowing is an ESCALATION primitive only when the function runs as someone
-- else. Inside a SECURITY INVOKER function the caller already has exactly their
-- own privileges, so substituting a relation gains them nothing they could not do
-- by querying it directly. `set_consent_hash` also reads **no relation at all** —
-- it is `digest()` over `new.*` — so there is nothing for a temp table to shadow.
-- Appending `pg_temp` to it would be harmless and would buy nothing.
--
-- ⚠️ **SO THE POST-CONDITION IS THE OPPOSITE ONE: that this batch left it
-- ALONE.** That is the assertion that actually protects `extensions`, and it is
-- stronger than asserting an appended value, because it fails if the batch's
-- population was wider than this file claims.
--
-- ── ⚠️⚠️ WHAT THIS MIGRATION REFUSES TO GUESS ──────────────────────────────
-- A SECURITY DEFINER function with **no `SET search_path` at all** is a worse
-- problem than a missing `pg_temp`: it resolves everything through the caller's
-- own path. **But it cannot be batched** — there is no existing list to append
-- to, and choosing one is a per-function decision. A function that calls
-- `digest()` unqualified while relying on the caller's path to supply
-- `extensions` would be BROKEN by a mechanical `public, pg_temp`.
--
-- ✅ So this migration REFUSES and names them, rather than inventing a value for
-- a function it has not read. ⚠️ If that refusal fires, it is INFORMATION, not a
-- fault: it means the batch's scope was wrong and those functions need reading
-- first.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE, AND NO BODY ─────────────────────
-- `alter function … set search_path` writes `proconfig` only. `prosrc` is
-- untouched — which is why none of 0092's machinery (hex, CR/LF counts, exact
-- body literals) appears here, and why forty objects are a batch rather than
-- forty migrations.
-- ===========================================================================
begin;

do $mig$
declare
  v_total    integer;
  v_ok       integer;
  v_todo     integer;
  v_none     integer;
  v_nonefn   text;
  v_changed  integer := 0;
  v_badkind  text;
  v_sp       text;
  r          record;
begin
  if not exists (select 1 from public.schema_migrations where version = '0093') then
    raise exception '0094: apply 0093 first.';
  end if;

  -- ── THE THREE POPULATIONS, COUNTED BEFORE ANYTHING MOVES ────────────────
  select count(*),
         count(*) filter (where sp like '%pg_temp%'),
         count(*) filter (where sp is not null and sp not like '%pg_temp%'),
         count(*) filter (where sp is null)
    into v_total, v_ok, v_todo, v_none
    from (select (select c from unnest(coalesce(p.proconfig, '{}'::text[])) c
                   where c like 'search_path=%' limit 1) as sp
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef) q;

  -- (a) ⚠️ THE PREDICTION. Written from a measurement of 41 on 9 Oct 2026; if
  -- the live number differs, the database has moved and this migration is
  -- acting on a stale reading of it.
  if v_todo <> 41 then
    raise exception '%', '0094: expected 41 SECURITY DEFINER functions in public with a search_path '
      || 'lacking pg_temp (measured 9 Oct 2026); found ' || v_todo || '. '
      || 'Of ' || v_total || ' definer functions, ' || v_ok || ' already name pg_temp and '
      || v_none || ' have no search_path at all. THE DATABASE HAS MOVED SINCE THIS WAS WRITTEN — '
      || 're-run preflight0094.sql and read row (e) before changing the number here. Nothing changed.';
  end if;

  -- (b) ⚠️⚠️ THE BLOCKER. Named, not counted, because the next step is to read
  -- them one by one.
  if v_none > 0 then
    select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
      into v_nonefn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                        where c like 'search_path=%');
    raise exception '%', '0094: ' || v_none || ' SECURITY DEFINER function(s) in public have NO '
      || 'search_path at all, so there is nothing to append pg_temp TO. They resolve everything '
      || 'through the CALLER''s search_path, which is worse than a missing pg_temp — but a '
      || 'mechanical `public, pg_temp` would BREAK any of them that calls digest() unqualified and '
      || 'relies on the caller for `extensions`. ⚠️ THIS IS INFORMATION, NOT A FAULT: read them, '
      || 'then give each one an explicit list. Nothing changed.'
      || chr(10) || v_nonefn;
  end if;

  -- (c) ALTER FUNCTION is the wrong statement for a procedure or an aggregate.
  select string_agg(distinct p.prokind::text, ', ' order by p.prokind::text) into v_badkind
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prokind <> 'f'
     and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where c like 'search_path=%' and c not like '%pg_temp%');
  if v_badkind is not null then
    raise exception '%', '0094: some targets are prokind ' || v_badkind
      || ', not plain functions (f). ALTER FUNCTION is the wrong statement for a procedure or an '
      || 'aggregate. Read them before batching. Nothing changed.';
  end if;

  -- ── THE LOOP ────────────────────────────────────────────────────────────
  -- ⚠️ EACH FUNCTION'S OWN LIST, APPENDED TO. The value fed back is the one
  -- Postgres itself flattened into proconfig, so it round-trips; `pg_temp` goes
  -- LAST, which is the whole point — listed anywhere earlier and the temp schema
  -- is still searched before the schemas after it.
  for r in
    select p.oid::regprocedure as sig,
           (select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1) as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
       and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                    where c like 'search_path=%' and c not like '%pg_temp%')
     order by p.oid::regprocedure::text
  loop
    -- ⚠️ The value is injected with %s rather than %L because it is a LIST, not
    -- a literal — `public, extensions` quoted whole would be read as one schema
    -- named "public, extensions". It is safe to inject because it comes from
    -- proconfig, which only the function's OWNER can set; it is not reachable
    -- from any client. `substring(from 13)` drops the leading `search_path=`,
    -- which is exactly 12 characters.
    execute format('alter function %s set search_path to %s',
                   r.sig, substring(r.cfg from 13) || ', pg_temp');
    v_changed := v_changed + 1;
  end loop;

  if v_changed <> v_todo then
    raise exception '0094: the loop changed % of % targets. Rolled back.', v_changed, v_todo;
  end if;

  -- ═══ POST-CONDITIONS ════════════════════════════════════════════════════
  -- ⚠️ (d) THE END STATE, NOT THE CHANGE. "41 updated" is a report about the
  -- loop; this is a statement about the database. If the loop missed one — a
  -- filter that disagreed with the counting query, a function created between
  -- the two reads — this refuses rather than reporting a successful pass over an
  -- incomplete set.
  select count(*) into v_todo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                      where c like 'search_path=%pg_temp%');
  if v_todo <> 0 then
    raise exception '%', '0094: ' || v_todo || ' SECURITY DEFINER function(s) in public STILL lack '
      || 'pg_temp after the loop. The loop''s filter and this count disagree, so the batch is '
      || 'incomplete and cannot be verified. Rolled back.'
      || chr(10) || (select string_agg(p.oid::regprocedure::text, ', '
                                       order by p.oid::regprocedure::text)
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                                         where c like 'search_path=%pg_temp%'));
  end if;

  -- ⚠⚠ (e) THE ONE THAT WOULD BREAK THE LIVE SITE — ASSERTED UNTOUCHED.
  -- set_consent_hash is SECURITY INVOKER (prosecdef = false, 0092), so it is NOT
  -- in this batch's population and its search_path must come out of this
  -- migration EXACTLY as it went in. If it has changed, the loop reached wider
  -- than this file claims — and `extensions` is the schema that would be lost.
  -- ⚠️ digest() LIVES ONLY THERE: drop it and every consent_documents insert
  -- fails, surfacing as a broken consent flow rather than as a bad migration.
  select c into v_sp
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         unnest(coalesce(p.proconfig, '{}'::text[])) c
   where n.nspname = 'public' and p.proname = 'set_consent_hash' and c like 'search_path=%';
  if v_sp is distinct from 'search_path=public, extensions' then
    raise exception '%', '0094: set_consent_hash''s search_path is now '
      || coalesce(v_sp, '(none)') || ', expected `search_path=public, extensions` UNCHANGED — it is '
      || 'SECURITY INVOKER and this batch must not have touched it. ⚠️ digest() LIVES ONLY IN '
      || '`extensions`, so if it has been dropped or reordered, EVERY consent_documents INSERT WILL '
      || 'FAIL and it will look like a broken consent flow rather than a bad migration. '
      || 'Rolled back.';
  end if;
  if (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'set_consent_hash') then
    raise exception '0094: set_consent_hash is SECURITY DEFINER, but 0092 adopted it as INVOKER and this migration''s scope assumes that. Read both before re-running. Rolled back.';
  end if;

  -- (f) And prove no BODY moved, since this migration claims to touch none.
  -- set_consent_hash is the one with a measured body to check it against (0092).
  if (select length(prosrc) <> 217 or md5(prosrc) <> 'a35131d578e450fac18370e5f38b7494'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'set_consent_hash') then
    raise exception '0094: set_consent_hash''s BODY changed. This migration alters proconfig only, so that is impossible by design. Rolled back.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0094', 'pg_temp_last_on_every_definer_search_path', '02b730830685889197acfab7c92881fef6886926869651dffd05d80bf2c068f4');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — `preflight0094.sql`. ⚠️ RUN IT BEFORE APPLYING, AND READ ROW
-- (e): it names every function this will touch with its before → after value.
-- The list is more useful before the change than after, and a DO block cannot
-- show it — `raise notice` is invisible in the Supabase editor (item 153's
-- neighbour, learned on 0090).
--
-- ⚠️ ROW (d) CAN STOP THIS MIGRATION, and should. Non-zero means some definer
-- function has no search_path at all, which cannot be appended to.
--
-- ⚠️ ROW (c) MUST READ 41. That is the measurement this file was written from.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION. Catalogue reads only, identical for every identity.
--
--   do $$
--   declare
--     r_end  text := 'not run';
--     r_cons text := 'not run';
--     r_skip text := 'not run';
--     r_body text := 'not run';
--     r_last text := 'not run';
--     v_n    integer;
--     v_no   integer;
--     v_bad  text;
--   begin
--     -- 1 ⚠️ THE END STATE. The only line that matters if you read one.
--     select count(*), string_agg(p.oid::regprocedure::text, ', '
--                                 order by p.oid::regprocedure::text)
--       into v_n, v_bad
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prosecdef
--        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
--                         where c like 'search_path=%pg_temp%');
--     r_end := case when v_n = 0 then 'pass  - every SECURITY DEFINER function in public names pg_temp'
--                   else 'FAIL  - ' || v_n || ' still do not: ' || v_bad end;
--
--     -- 2 ⚠⚠ THE ONE THAT WOULD BREAK THE LIVE SITE — EXPECTED UNCHANGED.
--     -- set_consent_hash is SECURITY INVOKER (0092), so it is NOT in this batch.
--     -- `public, extensions, pg_temp` here would mean the loop reached too far.
--     r_cons := coalesce((select case when c = 'search_path=public, extensions'
--                                     then 'pass  - public, extensions, untouched as intended'
--                                     else 'FAIL  - ' || c || ' — expected `public, extensions` '
--                                          || 'UNCHANGED; digest() lives ONLY in extensions, so '
--                                          || 'every consent_documents insert is at risk' end
--                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
--                                unnest(coalesce(p.proconfig, '{}'::text[])) c
--                          where n.nspname = 'public' and p.proname = 'set_consent_hash'
--                            and c like 'search_path=%'),
--                        'FAIL  - set_consent_hash has no search_path at all');
--
--     -- 3 ⚠️ pg_temp MUST BE LAST, NOT MERELY PRESENT. Listed before another
--     -- schema, the temp schema is still searched ahead of that schema — which is
--     -- the entire defect, moved rather than removed.
--     select count(*), string_agg(p.oid::regprocedure::text, ', '
--                                 order by p.oid::regprocedure::text)
--       into v_n, v_bad
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
--            unnest(coalesce(p.proconfig, '{}'::text[])) c
--      where n.nspname = 'public' and p.prosecdef and c like 'search_path=%'
--        and c like '%pg_temp%' and c not like '%pg_temp';
--     r_last := case when v_n = 0 then 'pass  - pg_temp is last everywhere'
--                    else 'FAIL  - ' || v_n || ' name pg_temp but not last: ' || v_bad end;
--
--     -- 4 ⚠⚠ REWRITTEN 9 Oct 2026 AFTER IT LIED. The first version read:
--     --
--     --     'info  - ' || v_n || ' SECURITY DEFINER functions in public, all of them
--     --      now naming pg_temp; 0094 changed 41 and skipped ' || (v_n - 41) || ' …'
--     --
--     -- ⚠️ EVERY FACTUAL CLAIM IN THAT STRING WAS ARITHMETIC ON AN ASSUMPTION.
--     -- `v_n - 41` assumes 41 were changed; "all of them now naming pg_temp"
--     -- assumes the outcome. Micky ran this block ONCE BEFORE APPLYING: line 1
--     -- correctly reported FAIL and named all 41, and THIS LINE, in the same
--     -- output, said "all of them now naming pg_temp; 0094 changed 41". Two lines
--     -- of one block flatly contradicted each other and only line 1 was honest.
--     --
--     -- ⚠⚠ AND IT BEING AN `info` LINE IS WHY IT SURVIVED. There was no FAIL to
--     -- catch the eye, and a reader skimming for failures would have taken it as
--     -- established. Item 188, in the line whose whole job is to say what changed.
--     --
--     -- ✅ SO IT MEASURES, AND IT NAMES WHETHER THE MIGRATION IS EVEN APPLIED.
--     select count(*) filter (where has_temp),
--            count(*) filter (where not has_temp)
--       into v_n, v_no
--       from (select exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
--                             where c like 'search_path=%pg_temp%') as has_temp
--               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--              where n.nspname = 'public' and p.prosecdef) q;
--     r_skip := case when exists (select 1 from public.schema_migrations where version = '0094')
--                    then 'info  - 0094 IS applied. Measured now: ' || v_n || ' name pg_temp, '
--                         || v_no || ' do not, of ' || (v_n + v_no) || ' SECURITY DEFINER '
--                         || 'functions in public.'
--                    else '⚠️ 0094 has NOT been applied (no row in schema_migrations). Measured '
--                         || 'now: ' || v_n || ' name pg_temp, ' || v_no || ' do not, of '
--                         || (v_n + v_no) || '. Nothing below describes a change that has '
--                         || 'happened.' end;
--
--     -- 5 THE CONTROL. ⚠️ 0094 claims to touch no BODY. If this fails, something
--     -- other than proconfig moved and every pass above is suspect.
--     r_body := coalesce((select case when length(prosrc) = 217
--                                      and md5(prosrc) = 'a35131d578e450fac18370e5f38b7494'
--                                     then 'pass  - set_consent_hash body byte-identical to 0092''s'
--                                     else 'FAIL  - body is len ' || length(prosrc)
--                                          || ' md5 ' || md5(prosrc) end
--                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                          where n.nspname = 'public' and p.proname = 'set_consent_hash'),
--                        'FAIL  - set_consent_hash is missing');
--
--     raise exception '%',
--       chr(10) || '=== 0094 VERIFY ==='
--       || chr(10) || '1  END STATE, zero left    : ' || r_end
--       || chr(10) || '2  set_consent_hash        : ' || r_cons
--       || chr(10) || '3  pg_temp is LAST         : ' || r_last
--       || chr(10) || '4  changed vs skipped      : ' || r_skip
--       || chr(10) || '5  control, no body moved  : ' || r_body;
--   end $$;
--
--   EXPECT: 1, 2, 3 and 5 pass; 4 is an info line, not a test — but it now
--   reports MEASURED counts and says outright when 0094 is not applied, rather
--   than describing what the migration would have done. See its own comment.
--
--   ⚠️ LINE 2 PASSES ON `public, extensions` — WITHOUT pg_temp — AND THAT IS
--   CORRECT. set_consent_hash is SECURITY INVOKER, so it is outside this
--   migration's scope; seeing pg_temp appended there would mean the batch was
--   wider than the file says. Read the header before "fixing" it.
--
--   ⚠️ LINE 3 IS NOT A DUPLICATE OF LINE 1. Line 1 asks whether pg_temp is
--   named; line 3 asks whether it is named LAST. `search_path = pg_temp, public`
--   satisfies line 1 and defends nothing.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

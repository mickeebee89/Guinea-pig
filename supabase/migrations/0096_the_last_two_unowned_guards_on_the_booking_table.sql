-- ===========================================================================
-- 0096_the_last_two_unowned_guards_on_the_booking_table
--
-- Item 199. ⚠️ Apply 0095 first. ⚠️ CHANGES NO BEHAVIOUR.
--
-- `public.sessions` carries six triggers. Four were already owned by migrations.
-- These are the last two, and they were owned by nobody:
--
--   trg_reject_overlapping_session → reject_overlapping_session
--       BOTH hand-run only (supabase/booking-overlap-guard.sql)
--   trg_enforce_session_status     → enforce_session_status_transition
--       TRIGGER hand-run only (supabase/session-status-guard.sql);
--       the FUNCTION is owned by 0066 then 0070
--
-- ── ⚠️⚠️ THE TRIGGER IS THE GUARD, NOT THE FUNCTION ───────────────────────
-- `enforce_session_status_transition` reads perfectly and is checksum-locked by
-- 0070. **But nothing fired it.** On a database where `session-status-guard.sql`
-- was never pasted, every status transition is unguarded while
-- `pg_get_functiondef` shows a flawless guard — a model could PATCH her own
-- application to `accepted`, or a booking to `completed` to unlock a review.
-- Same shape as item 193: the protection is the trigger, not the function.
--
-- ⚠️ This is the LAST object of that shape on the booking table.
--
-- ── ⚠️⚠️ THE REAL REASON THIS MIGRATION MATTERS IS THE FILES, NOT THE DDL ──
-- `supabase/session-status-guard.sql` holds a copy of
-- `enforce_session_status_transition` that **predates 0070 by an entire
-- branch** — it has no `not_held` handling and no CV004 — while its own header
-- says *"This file is safe to re-run."*
--
-- **`report_not_held` (0070) does `update public.sessions set … status =
-- 'not_held'`.** The trigger is BEFORE UPDATE OF status, it fires for every role,
-- and it returns early only for admins and a null `auth.uid()`. So with the
-- pre-0070 copy restored, `new.status = 'not_held'` falls through to the `else`
-- branch and raises **"Illegal status transition accepted -> not_held"** —
-- breaking the "it did not happen" feature, which is moderation evidence, on
-- every single use.
--
-- ⚠️ MEASURED 9 Oct 2026: the LIVE guard is 0070's (it has the `not_held` branch
-- and CV004). **The database is correct; the FILE is the stale one.** Nothing is
-- broken today — the hazard is entirely that someone re-runs a file that
-- promises it is safe.
--
-- ✅ **SO THIS MIGRATION IS HALF DDL AND HALF DELETION.** It adopts the objects,
-- and then the second copies are stripped out of both hand-run files so there is
-- nothing left to go stale. Adoption without the strip would leave the
-- reversion loaded; the strip without adoption would leave a fresh database with
-- no triggers at all. Neither half works alone.
--
-- ── ⚠️ WHAT "VERBATIM" MEANS HERE: THE LIVE TEXT, NOT THE FILE'S ──────────
-- The live `reject_overlapping_session` differs from `booking-overlap-guard.sql`
-- in THREE ways, none of them behavioural:
--
--   1. **search_path** is `public, pg_temp`. The file says `public`; 0094
--      appended `pg_temp` (item 202). **So adopting verbatim means adopting what
--      0094 left**, and the file is stale in this respect too.
--   2. **It is reformatted** — the early return is one line, the `where` clause
--      is collapsed.
--   3. ⚠️ **Every explanatory comment is gone from the live body.** The half-open
--      overlap rule — *"09:00-10:00 and 10:00-11:00 do NOT clash"* — survives
--      ONLY in the hand-run file.
--
-- ✅ Which is why the strip keeps the prose: those comments are the only record
-- of WHY the comparison is half-open, and they are restated in
-- `comment on function` below so they live on the object rather than in a file
-- nobody runs.
--
-- ── ⚠️⚠️ THE STATUS FUNCTION IS ASSERTED, NOT RE-CREATED, AND THAT IS DELIBERATE
-- 0070 owns that body and checksum-locks it. Re-creating it here would put **two
-- migrations in charge of one function** — the two-copies fault this whole
-- exercise exists to remove, reintroduced inside the framework.
--
-- ✅ So 0096 asserts it: length 3182, md5 be5d87a28e9c7fcb2190095e276043f6, and
-- the `not_held` branch present. **That pins which version was live at the moment
-- the second copy was deleted**, which is exactly the fact the strip depends on,
-- and it needs no 3182-character literal.
--
-- ⚠️ IT ALSO MEANS 0096 DOES NOT NEED THAT BODY'S HEX AT ALL. Asked for it, I did
-- not take it: a 3182-character hand transcription is the failure that already
-- happened once on 0095's 308-character one, where a single dropped character
-- turned `)` into `i` and only the md5 caught it.
--
-- ── ⚠️ LINE ENDINGS: FOURTH AND FIFTH OBJECTS, AND THEY CLOSE DIFFERENTLY ──
--   set_consent_hash            CR=0  LF=12  opens 0a    closes `end ` no NL
--   reject_overlapping_session  CR=15 LF=15  opens 0d0a  closes 6e643b20 = `end; `
--                                                        + SPACE, no trailing NL
--   has_open_availability       CR=13 LF=13  opens 0d0a  closes 293b0d0a = `);`+CRLF
--   enforce_session_status_…    CR=72 LF=72  opens 0d0a  closes 643b0d0a
--
-- ⚠️ FIVE OBJECTS, FOUR SHAPES. Measured per object, never carried across. The
-- literal below is built from `chr(13) || chr(10)` because THIS object measured
-- CRLF, and it ends `'end; '` with the trailing space that no printed body shows.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- ===========================================================================
begin;

do $mig$
declare
  -- ⚠️ GENERATED FROM THE LIVE HEX, NOT RETYPED. 567 chars, CR=15, LF=15,
  -- md5 54eb50f0977885838aceafaa3d7c94af, and it ends with a SPACE after `end;`.
  v_ros text :=
    '' ||
    chr(13) || chr(10) || 'declare clash record;' ||
    chr(13) || chr(10) || 'begin' ||
    chr(13) || chr(10) || '  if new.status not in (''pending'', ''accepted'') then return new; end if;' ||
    chr(13) || chr(10) || '  select s.start_time, s.end_time into clash' ||
    chr(13) || chr(10) || '  from public.sessions s' ||
    chr(13) || chr(10) || '  where s.provider_id = new.provider_id and s.date = new.date and s.id <> new.id' ||
    chr(13) || chr(10) || '    and s.status in (''pending'', ''accepted'')' ||
    chr(13) || chr(10) || '    and s.start_time < new.end_time and s.end_time > new.start_time' ||
    chr(13) || chr(10) || '  limit 1;' ||
    chr(13) || chr(10) || '  if found then' ||
    chr(13) || chr(10) || '    raise exception ''This time overlaps an existing booking (%-%)'', clash.start_time, clash.end_time' ||
    chr(13) || chr(10) || '      using errcode = ''23505'';' ||
    chr(13) || chr(10) || '  end if;' ||
    chr(13) || chr(10) || '  return new;' ||
    chr(13) || chr(10) || 'end; ';
  -- The two triggers, exactly as pg_get_triggerdef renders them. ⚠️ The function
  -- names are UNQUALIFIED because that is how it renders; writing
  -- `public.reject_overlapping_session()` would make the comparison fail on a
  -- cosmetic difference (0092 hit this and says so).
  v_tros_want text :=
    'CREATE TRIGGER trg_reject_overlapping_session BEFORE INSERT OR UPDATE OF date, '
    'start_time, end_time, status, provider_id ON public.sessions FOR EACH ROW '
    'EXECUTE FUNCTION reject_overlapping_session()';
  v_tess_want text :=
    'CREATE TRIGGER trg_enforce_session_status BEFORE UPDATE OF status ON public.sessions '
    'FOR EACH ROW EXECUTE FUNCTION enforce_session_status_transition()';
  v_cfg_want text[] := array['search_path=public, pg_temp'];
  v_before  text;
  v_after   text;
  v_tros    text;
  v_tros2   text;
  v_tess    text;
  v_tess2   text;
  v_ess     text;
  v_sec     boolean;
  v_vol     "char";
  v_cfg     text[];
  v_n       integer;
begin
  -- (0) ⚠️ THIS FILE'S OWN LITERAL FIRST. If the paste altered it, every check
  -- below would blame the database (item 190; 0089 refused itself over this).
  if length(v_ros) <> 567 or md5(v_ros) <> '54eb50f0977885838aceafaa3d7c94af' then
    raise exception '%', '0096: THE LITERAL IN THIS FILE arrived len ' || length(v_ros)
      || ' md5 ' || md5(v_ros) || ', expected len 567 md5 54eb50f0977885838aceafaa3d7c94af. '
      || 'The paste altered it. THE DATABASE IS NOT THE PROBLEM. Re-copy with '
      || 'Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 <file>). Nothing changed.';
  end if;

  if not exists (select 1 from public.schema_migrations where version = '0095') then
    raise exception '0096: apply 0095 first.';
  end if;

  -- (a) ONE SIGNATURE EACH, or create-or-replace adds an overload.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('reject_overlapping_session', 'enforce_session_status_transition');
  if v_n <> 2 then
    raise exception '0096: expected exactly one signature of each guard function (2 rows); found %. Nothing changed.', v_n;
  end if;

  -- ═══ THE STATUS FUNCTION: ASSERTED, NEVER REPLACED ══════════════════════
  -- ⚠️ 0070 owns this body. This migration only records WHICH VERSION IS LIVE at
  -- the moment the hand-run copy is deleted, because that is the fact the
  -- deletion depends on.
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_ess, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_session_status_transition';
  if length(v_ess) <> 3182 or md5(v_ess) <> 'be5d87a28e9c7fcb2190095e276043f6' then
    raise exception '%', '0096: the live enforce_session_status_transition is len '
      || length(v_ess) || ' md5 ' || md5(v_ess) || ', not the measured len 3182 '
      || 'md5 be5d87a28e9c7fcb2190095e276043f6. ⚠️ THIS MIGRATION IS ABOUT TO BE FOLLOWED BY '
      || 'DELETING THE ONLY OTHER COPY OF THIS FUNCTION, so it refuses to proceed without knowing '
      || 'which version is live. Read it with pg_get_functiondef. Nothing changed.';
  end if;
  -- ⚠️ AND THE SAME FACT STATED AS BEHAVIOUR, NOT AS A HASH. A hash says "not the
  -- one I measured"; this says WHICH FEATURE WOULD BREAK.
  if v_ess not like '%not_held%' or v_ess not like '%CV004%' then
    raise exception '%', '0096: the live status guard has NO not_held branch, so it predates 0070 '
      || 'and report_not_held ALREADY raises "Illegal status transition" on every use. That is a '
      || 'LIVE DEFECT and it outranks this migration: re-apply 0070 before adopting anything. '
      || 'Nothing changed.';
  end if;
  if v_sec is not true or v_vol <> 'v' or v_cfg is distinct from v_cfg_want then
    raise exception '%', '0096: enforce_session_status_transition is definer=' || v_sec::text
      || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || ', expected definer, volatile, `public, pg_temp` as 0094 left it. Nothing changed.';
  end if;

  -- ═══ THE OVERLAP FUNCTION: ADOPTED VERBATIM ═════════════════════════════
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_before, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_overlapping_session';
  if v_before <> v_ros then
    raise exception '%', '0096: the live reject_overlapping_session body is NOT what this migration '
      || 'was written from, so adopting it would CHANGE the only guard against an overlapping '
      || 'booking. THE ADOPTION WAITS AND THE DIFFERENCE IS THE FINDING.'
      || chr(10) || 'live     len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || 'hex: ' || encode(convert_to(v_before, 'UTF8'), 'hex')
      || chr(10) || 'expected len=567 md5=54eb50f0977885838aceafaa3d7c94af';
  end if;
  if v_sec is not true or v_vol <> 'v' or v_cfg is distinct from v_cfg_want then
    raise exception '%', '0096: reject_overlapping_session is definer=' || v_sec::text
      || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || ', expected definer, volatile, `public, pg_temp` as 0094 left it. ⚠️ booking-overlap-guard.sql '
      || 'says `public`, which is what 0094 superseded. Nothing changed.';
  end if;

  -- (b) BOTH TRIGGERS MUST BE THERE, ENABLED, AND BE THE ONES DESCRIBED.
  -- ⚠️ tgenabled IS CHECKED, NOT JUST PRESENCE. `ALTER TABLE … DISABLE TRIGGER`
  -- leaves the row in pg_trigger doing nothing, which is item 195's class: the
  -- object exists and does not hold.
  select pg_get_triggerdef(t.oid) into v_tros
    from pg_trigger t
   where t.tgrelid = to_regclass('public.sessions')
     and t.tgname = 'trg_reject_overlapping_session' and not t.tgisinternal
     and t.tgenabled = 'O';
  if v_tros is distinct from v_tros_want then
    raise exception '%', '0096: trg_reject_overlapping_session is missing, DISABLED, or not the '
      || 'trigger this migration describes. Nothing changed.'
      || chr(10) || 'live:     ' || coalesce(v_tros, '(absent or disabled)')
      || chr(10) || 'expected: ' || v_tros_want;
  end if;
  select pg_get_triggerdef(t.oid) into v_tess
    from pg_trigger t
   where t.tgrelid = to_regclass('public.sessions')
     and t.tgname = 'trg_enforce_session_status' and not t.tgisinternal
     and t.tgenabled = 'O';
  if v_tess is distinct from v_tess_want then
    raise exception '%', '0096: trg_enforce_session_status is missing, DISABLED, or not the trigger '
      || 'this migration describes. ⚠️ If it is ABSENT, every status transition is unguarded right '
      || 'now and that outranks this migration. Nothing changed.'
      || chr(10) || 'live:     ' || coalesce(v_tess, '(absent or disabled)')
      || chr(10) || 'expected: ' || v_tess_want;
  end if;

  -- ── THE ADOPTION ────────────────────────────────────────────────────────
  -- ⚠️ Built from v_ros, so the body exists ONCE in this file and a paste cannot
  -- alter it. Header restated in full: create-or-replace rewrites it, it does
  -- not inherit.
  execute format(
    'create or replace function public.reject_overlapping_session() returns trigger '
    'language plpgsql security definer set search_path to %s as $f$%s$f$',
    'public, pg_temp', v_ros);

  -- ⚠️ `create or replace trigger` on BOTH, never drop-then-create: there is no
  -- instant, even inside a transaction, at which the booking table is without
  -- its overlap guard or its status guard. Needs PostgreSQL 14+; an older server
  -- fails loudly on the syntax, which is the right failure.
  create or replace trigger trg_reject_overlapping_session
    before insert or update of date, start_time, end_time, status, provider_id
    on public.sessions
    for each row execute function reject_overlapping_session();

  create or replace trigger trg_enforce_session_status
    before update of status on public.sessions
    for each row execute function enforce_session_status_transition();

  -- ── BEFORE vs AFTER ─────────────────────────────────────────────────────
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_after, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reject_overlapping_session';
  if v_after <> v_before or length(v_after) <> 567
     or md5(v_after) <> '54eb50f0977885838aceafaa3d7c94af' then
    raise exception '%', '0096: ADOPTION CHANGED THE OVERLAP GUARD''S BODY. Rolled back.'
      || chr(10) || 'before len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || 'after  len=' || length(v_after) || ' md5=' || md5(v_after)
      || chr(10) || 'hex: ' || encode(convert_to(v_after, 'UTF8'), 'hex');
  end if;
  if v_sec is not true or v_vol <> 'v' or v_cfg is distinct from v_cfg_want then
    raise exception '%', '0096: a property moved in the replace — definer=' || v_sec::text
      || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)') || '. Rolled back.';
  end if;

  select pg_get_triggerdef(t.oid) into v_tros2
    from pg_trigger t
   where t.tgrelid = to_regclass('public.sessions')
     and t.tgname = 'trg_reject_overlapping_session' and not t.tgisinternal
     and t.tgenabled = 'O';
  select pg_get_triggerdef(t.oid) into v_tess2
    from pg_trigger t
   where t.tgrelid = to_regclass('public.sessions')
     and t.tgname = 'trg_enforce_session_status' and not t.tgisinternal
     and t.tgenabled = 'O';
  if v_tros2 is distinct from v_tros or v_tess2 is distinct from v_tess then
    raise exception '%', '0096: a trigger definition changed. Rolled back.'
      || chr(10) || 'overlap before: ' || coalesce(v_tros, '(null)')
      || chr(10) || 'overlap after:  ' || coalesce(v_tros2, '(null)')
      || chr(10) || 'status  before: ' || coalesce(v_tess, '(null)')
      || chr(10) || 'status  after:  ' || coalesce(v_tess2, '(null)');
  end if;

  -- (c) ⚠️ AND THE STATUS FUNCTION MUST STILL BE UNTOUCHED. This migration
  -- replaces a trigger that POINTS at it; if the body moved, something here
  -- reached further than it claims and 0070's lock is broken.
  if (select length(prosrc) <> 3182 or md5(prosrc) <> 'be5d87a28e9c7fcb2190095e276043f6'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'enforce_session_status_transition') then
    raise exception '0096: enforce_session_status_transition''s body changed. This migration only replaces the TRIGGER that fires it, so that is impossible by design. Rolled back.';
  end if;

  -- (d) THE COUNT, NOT JUST THE NAMED CASES. Six triggers before, six after, all
  -- enabled — so nothing was added, dropped or disabled on the way through.
  select count(*) into v_n
    from pg_trigger t
   where t.tgrelid = to_regclass('public.sessions')
     and not t.tgisinternal and t.tgenabled = 'O';
  if v_n <> 6 then
    raise exception '%', '0096: public.sessions has ' || v_n || ' enabled triggers, expected 6 '
      || '(measured 9 Oct 2026). Rolled back.'
      || chr(10) || (select string_agg(t.tgname || ' [' || t.tgenabled::text || ']', ', '
                                        order by t.tgname)
                       from pg_trigger t
                      where t.tgrelid = to_regclass('public.sessions') and not t.tgisinternal);
  end if;
end $mig$;

comment on function public.reject_overlapping_session() is
  'BEFORE INSERT OR UPDATE OF date, start_time, end_time, status, provider_id on sessions. '
  'Refuses a pending/accepted booking that OVERLAPS another on the same provider and date, with '
  'errcode 23505 so the app''s existing slot-race branch handles it unchanged. '
  '⚠️ HALF-OPEN ON PURPOSE: s.start_time < new.end_time and s.end_time > new.start_time, so '
  'back-to-back 09:00-10:00 and 10:00-11:00 do NOT clash while 09:00-12:00 and 10:00-11:00 do. '
  'That sentence survived only in supabase/booking-overlap-guard.sql, whose copy 0096 removed, so '
  'it is recorded here instead. '
  '⚠️ IT IS NOT ATOMIC AND IS NOT A SUBSTITUTE FOR sessions_active_slot_uniq: it is a BEFORE '
  'trigger running a SELECT, which cannot see an uncommitted row in a concurrent transaction. The '
  'index catches exact collisions atomically; this catches overlap sequentially. NEITHER IS '
  'REDUNDANT, and 0090''s header calling the index "the only thing preventing a double booking" is '
  'corrected in 0093. ⚠️ A NULL end_time makes both comparisons NULL and evades this entirely — '
  'item 193. Adopted verbatim by 0096, item 199.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0096', 'the_last_two_unowned_guards_on_the_booking_table', 'fb9e4d817761344a279406b5687570ddc6bd39f3def895765a69695fe0692d69');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — `preflight0096.sql`, run 9 Oct 2026.
--
--   MEASURED: both functions owner=postgres, prokind=f, 1 signature each,
--   definer=true, volatility=v, config=search_path=public, pg_temp ·
--   reject_overlapping_session 567 chars md5 54eb50f0… CR=15 LF=15 opens 0d0a
--   closes 6e643b20 (`end; ` — trailing SPACE, no newline) ·
--   enforce_session_status_transition 3182 chars md5 be5d87a2… CR=72 LF=72
--   opens 0d0a closes 643b0d0a · row (h): the LIVE status guard IS 0070's —
--   not_held branch and CV004 present · six triggers on sessions, all enabled ·
--   both triggerdefs as asserted above · 0095 applied.
--
-- ⚠️ IT FAILED TO RUN ON THE FIRST ATTEMPT: `42725: operator is not unique:
-- text || "char"`, because `prokind` is "char". A repo-wide sweep then found
-- `tgenabled` uncast in two more places, one of them a row in 0093 that had
-- never run. Recorded in the verify-block conventions: any pg_catalog column of
-- type "char" needs ::text before it touches a string, or the whole block fails
-- having tested nothing.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION. Catalogue reads only, identical for every identity.
-- ⚠️ EVERY NUMBER IS MEASURED IN THIS BLOCK, and line 7 says which side of the
-- apply it is on rather than describing an outcome (item 188's ninth).
--
--   do $$
--   declare
--     r_ros  text := 'not run';
--     r_tros text := 'not run';
--     r_tess text := 'not run';
--     r_ess  text := 'not run';
--     r_cnt  text := 'not run';
--     r_file text := 'not run';
--     r_appl text := 'not run';
--     v_src  text;
--     v_n    integer;
--   begin
--     -- 1 the adopted body, byte for byte
--     select p.prosrc into v_src
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'reject_overlapping_session';
--     r_ros := case when v_src is null then 'FAIL  - reject_overlapping_session is gone'
--                   when length(v_src) = 567 and md5(v_src) = '54eb50f0977885838aceafaa3d7c94af'
--                     then 'pass  - 567 chars, md5 54eb50f0… as measured'
--                   else 'FAIL  - len ' || length(v_src) || ' md5 ' || md5(v_src) end;
--
--     -- 2 and 3 the triggers, COMPARED and checked for ENABLED, not just found
--     r_tros := coalesce((select case when pg_get_triggerdef(t.oid) =
--                   'CREATE TRIGGER trg_reject_overlapping_session BEFORE INSERT OR UPDATE OF '
--                   'date, start_time, end_time, status, provider_id ON public.sessions FOR EACH '
--                   'ROW EXECUTE FUNCTION reject_overlapping_session()'
--                        then 'pass  - BEFORE INSERT OR UPDATE OF 5 columns, enabled'
--                        else 'FAIL  - ' || pg_get_triggerdef(t.oid) end
--                   from pg_trigger t
--                  where t.tgrelid = to_regclass('public.sessions')
--                    and t.tgname = 'trg_reject_overlapping_session'
--                    and not t.tgisinternal and t.tgenabled = 'O'),
--                'FAIL  - absent or DISABLED; nothing refuses an overlapping booking');
--
--     r_tess := coalesce((select case when pg_get_triggerdef(t.oid) =
--                   'CREATE TRIGGER trg_enforce_session_status BEFORE UPDATE OF status ON '
--                   'public.sessions FOR EACH ROW EXECUTE FUNCTION '
--                   'enforce_session_status_transition()'
--                        then 'pass  - BEFORE UPDATE OF status, enabled'
--                        else 'FAIL  - ' || pg_get_triggerdef(t.oid) end
--                   from pg_trigger t
--                  where t.tgrelid = to_regclass('public.sessions')
--                    and t.tgname = 'trg_enforce_session_status'
--                    and not t.tgisinternal and t.tgenabled = 'O'),
--                'FAIL  - absent or DISABLED; EVERY status transition is unguarded');
--
--     -- 4 ⚠️ THE ONE THE FILE STRIP DEPENDS ON. Not a hash check for its own
--     -- sake: if this is the pre-0070 body, report_not_held is already broken.
--     select p.prosrc into v_src
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'enforce_session_status_transition';
--     r_ess := case
--       when v_src is null then 'FAIL  - the status guard function is gone'
--       when v_src not like '%not_held%' or v_src not like '%CV004%'
--         then 'FAIL  - PRE-0070 body: report_not_held raises "Illegal status transition"'
--       when length(v_src) = 3182 and md5(v_src) = 'be5d87a28e9c7fcb2190095e276043f6'
--         then 'pass  - 0070''s body, 3182 chars, md5 be5d87a2…, untouched by 0096'
--       else 'FAIL  - has not_held but is len ' || length(v_src) || ' md5 ' || md5(v_src) end;
--
--     -- 5 the count, not just the named cases
--     select count(*) into v_n from pg_trigger t
--      where t.tgrelid = to_regclass('public.sessions')
--        and not t.tgisinternal and t.tgenabled = 'O';
--     r_cnt := case when v_n = 6 then 'pass  - 6 enabled triggers on sessions, as measured'
--                   else 'FAIL  - ' || v_n || ' enabled triggers, expected 6: '
--                        || coalesce((select string_agg(t.tgname || ' [' || t.tgenabled::text || ']',
--                                                       ', ' order by t.tgname)
--                                       from pg_trigger t
--                                      where t.tgrelid = to_regclass('public.sessions')
--                                        and not t.tgisinternal), '(none)') end;
--
--     -- 6 ⚠️ THE CONTROL, AND IT IS A DIFFERENT QUESTION FROM 5. The count bounds
--     -- the blast radius; this proves the four triggers 0096 does NOT name are
--     -- still the ones their own migrations created.
--     select count(*) into v_n from pg_trigger t
--      where t.tgrelid = to_regclass('public.sessions') and not t.tgisinternal
--        and t.tgname in ('session_apply_gate', 'session_needs_consent_record',
--                         'session_price_snapshot', 'session_slot_authority')
--        and t.tgenabled = 'O';
--     r_file := case when v_n = 4
--                    then 'pass  - the 4 triggers 0096 does not name are present and enabled'
--                    else 'FAIL  - only ' || v_n || ' of the other 4 are present and enabled' end;
--
--     r_appl := case when exists (select 1 from public.schema_migrations where version = '0096')
--                    then 'info  - 0096 IS applied'
--                    else '⚠️ 0096 has NOT been applied (no row in schema_migrations). '
--                         || 'Nothing above describes a change that has happened.' end;
--
--     raise exception '%',
--       chr(10) || '=== 0096 VERIFY ==='
--       || chr(10) || '1  overlap body adopted   : ' || r_ros
--       || chr(10) || '2  overlap trigger        : ' || r_tros
--       || chr(10) || '3  status trigger         : ' || r_tess
--       || chr(10) || '4  status fn is 0070''s    : ' || r_ess
--       || chr(10) || '5  count, 6 enabled       : ' || r_cnt
--       || chr(10) || '6  control, other four    : ' || r_file
--       || chr(10) || '7  applied?               : ' || r_appl;
--   end $$;
--
--   EXPECT: 1-6 pass, 7 reports applied.
--
--   ⚠️ LINE 4 IS THE ONE THE FILE DELETION RESTS ON. 0096 strips the only other
--   copy of that function out of supabase/session-status-guard.sql. If line 4
--   ever fails, the body that copy would have restored is gone from the repo and
--   0070 is the place to look.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

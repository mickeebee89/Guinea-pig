-- ===========================================================================
-- 0093_the_framework_adopts_the_only_atomic_double_booking_guard
--
-- Item 189, second of four. ⚠️ Apply 0092 first. ⚠️ CHANGES NO BEHAVIOUR on a
-- database that already has the index — which is every database anyone has run
-- `supabase/booking-guard.sql` against.
--
-- Adopts the partial unique index `sessions_active_slot_uniq`, created only by
-- that hand-run file (`booking-guard.sql:31`), owned by no migration until now.
--
-- ===========================================================================
-- ⚠️⚠️ FIRST, A CORRECTION TO 0090'S HEADER, WHICH IS APPLIED AND CANNOT CHANGE
-- ===========================================================================
-- 0090 says this index is **"the only thing preventing a double booking"** —
-- twice, once inside a `raise` that tells the reader to stop everything and
-- investigate. **That is wider than the evidence, and a reader acting on it will
-- make a wrong decision.** The correction lives here because this is the file a
-- future reader of the index arrives at.
--
-- `public.sessions` carries SIX triggers (read 9 Oct 2026). One of them is
-- `trg_reject_overlapping_session` → `reject_overlapping_session`, from the
-- hand-run `supabase/booking-overlap-guard.sql`, which NO migration owns and
-- which had not come up once in this audit. What each guard actually does:
--
--   sessions_active_slot_uniq   EXACT collision on (provider_id, date,
--   (this index)                start_time) among pending|accepted.
--                               ✅ ATOMIC. A unique index is enforced by the
--                               index itself, so two concurrent inserts cannot
--                               both win.
--                               ❌ Blind to overlap: 10:00–11:00 and 10:00–10:30
--                               share a start_time and DO collide, but
--                               09:00–12:00 and 10:00–11:00 do not.
--
--   reject_overlapping_session  HALF-OPEN OVERLAP on the same provider+date
--   (hand-run, item 199)        among pending|accepted — `s.start_time <
--                               new.end_time and s.end_time > new.start_time`,
--                               so back-to-back 09:00–10:00 / 10:00–11:00 is
--                               allowed and 09:00–12:00 / 10:00–11:00 is refused,
--                               with errcode 23505.
--                               ✅ Covers the end_time case the index cannot see.
--                               ❌ NOT ATOMIC. It is a BEFORE trigger that runs a
--                               SELECT, which cannot see an uncommitted row in a
--                               concurrent transaction. Time-of-check/
--                               time-of-use, inside the database.
--
-- ⚠️ SO THE ACCURATE CLAIM IS NARROWER AND STILL SERIOUS: this index is the only
-- guard that prevents a double booking **atomically**, and the trigger is the
-- only guard that addresses **overlap at all**. Neither is redundant. If this
-- index were dropped, the trigger would still refuse a same-slot second booking
-- in ordinary sequential use — so 0090's "nothing in the database refuses the
-- second insert" is false — but the concurrent case would be unguarded.
--
-- ⚠️ AND WHAT PARTLY SAVES THE TRIGGER IS NOT IN THE TRIGGER. 0065's
-- `tg_session_slot_authority` takes `select … for update` on the availability
-- row, so two applications **for the same availability row** serialise and the
-- trigger's SELECT does see the winner. Two applications on **different**
-- availability rows take different row locks, do not serialise, and both pass.
-- The protection is therefore a property of three objects together, two of which
-- no migration owned until this one.
--
-- ── ⚠️⚠️ 0090'S REMEDY ADVICE IS WITHDRAWN, NOT JUST QUALIFIED ─────────────
-- 0090 says that if `slot_contention` reporting a 10:00–10:30 slot as contested
-- is ever unwanted, *"the thing to change is the INDEX (to include end_time)"*.
-- **Do not.** Adding end_time would stop that pair colliding on the key, which
-- REMOVES atomic protection from the one overlap shape the index does catch, to
-- quiet a cosmetic complaint. The instrument for overlap-under-concurrency is an
-- exclusion constraint, not a wider btree key:
--
--   alter table public.sessions add constraint sessions_no_overlap
--     exclude using gist (provider_id with =, date with =,
--                         timerange(start_time, end_time) with &&)
--     where (status in ('pending','accepted'));
--
-- ⚠⚠ AND THE DIVERGENCE IS A LIVE DEFECT, NOT A TIDINESS QUESTION — ITEM 198.
-- `slot_contention` tests exact collision; the database refuses OVERLAP. So the
-- slots it calls free are strictly more than the database will accept, and a model
-- can be offered a 10:00–11:00 slot against an existing 09:00–12:00 booking and
-- refused at the last step. Item 192's harm, by a different route. ⚠️ DO NOT FIX IT
-- BY MAKING THE FUNCTION TEST OVERLAP FIRST: the trigger is not atomic, so the
-- function would then promise something only a constraint can keep.
--
-- ⚠️ RECORDED AS THE END STATE, NOT DONE HERE, AND IT IS NOT FREE: it needs
-- btree_gist, a range type over `time`, and it would refuse every row with a
-- NULL start_time or end_time — so it cannot land before item 193's columns are
-- NOT NULL. It also makes this index redundant, which is a reason to do it
-- deliberately rather than as a side effect.
--
-- ── ⚠️ WHAT THIS ADOPTION DOES NOT CLOSE ───────────────────────────────────
-- **A btree unique index treats NULLs as DISTINCT**, and `sessions.date` and
-- `sessions.start_time` are both nullable (measured 9 Oct 2026, preflight row q).
-- A session with either one NULL collides with nothing here and is invisible to
-- `slot_contention` as well — item 193. Adopting this index does not make a
-- double booking impossible; it makes the guard that exists owned.
--
-- ⚠️ Measured the same day: 0 active collisions the index governs, 0 involving a
-- NULL, 0 active sessions with a NULL date or start_time. All three are "zero
-- today", not "cannot happen".
--
-- ── ⚠️⚠️ WHY THIS FILE NEVER WRITES `create index if not exists` ───────────
-- That is the obvious way to adopt an index and it is the trap.
--
-- An index has no `create or replace`, and drop-then-recreate is **forbidden
-- here**: on a live database the gap between the two statements is a window in
-- which a double booking is permitted. So the only safe DDL is a conditional
-- create — and `if not exists` **matches on the NAME ALONE**. Against a drifted
-- index, or an INVALID one, it is a silent no-op: the migration succeeds, the
-- framework records that it owns the guard, and the guard enforces nothing.
--
-- ⚠️ `indisvalid = false` IS NOT HYPOTHETICAL — it is what a failed
-- `CREATE INDEX CONCURRENTLY` leaves behind. Such an index is listed by
-- `pg_indexes`, shown by `\d`, and enforces no uniqueness at all. It is item
-- 195's class exactly: the constraint exists, is keyed correctly, and does not
-- hold.
--
-- ✅ So this migration branches on a MEASURED existence, creates unconditionally
-- on the absent branch, and asserts the end state on both. It never relies on a
-- create to establish anything.
--
-- ── ⚠️ ASSERTED STRUCTURALLY, NOT AS A RENDERED STRING ─────────────────────
-- The key columns come from `pg_get_indexdef(oid, n, true)` per position and the
-- statuses are PARSED out of the predicate, exactly as 0090's guard parses them.
-- A string compare against a remembered `pg_get_indexdef` would fail on a
-- whitespace or `ANY(ARRAY[…])`-vs-`IN` rendering difference and pass on an
-- added INCLUDE column. Structure is both stricter and stabler — and nothing
-- here is a constant I did not measure.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- ⚠️ ONE EXCEPTION, ON THE ABSENT BRANCH ONLY: `create unique index` takes a
-- lock that blocks writes to `public.sessions` while it builds. On a database
-- that already has the index — all of them, in practice — nothing is created and
-- nothing is locked.
-- ===========================================================================
begin;

do $mig$
declare
  v_oid      oid;
  v_cols     text;
  v_stat     text[];
  v_stat_want text[] := array['accepted', 'pending'];
  v_pred     text;
  v_dup      integer;
  v_nnd      boolean;
  v_flags    text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0092') then
    raise exception '0093: apply 0092 first.';
  end if;

  select c.oid into v_oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'sessions_active_slot_uniq'
     and c.relkind = 'i';

  -- ═══ THE ABSENT BRANCH ═══════════════════════════════════════════════════
  -- Reached only on a database nobody ran booking-guard.sql against. ⚠️ The
  -- duplicate check comes FIRST so the failure is a sentence rather than a bare
  -- 23505 from the index build naming rows the reader then has to go and find.
  if v_oid is null then
    select count(*) into v_dup from (
      select 1 from public.sessions
       where status in ('pending','accepted')
         and date is not null and start_time is not null
       group by provider_id, date, start_time having count(*) > 1) d;
    if v_dup > 0 then
      raise exception '%', '0093: sessions_active_slot_uniq is ABSENT and cannot be built: '
        || v_dup || ' provider+date+start_time group(s) already hold more than one active '
        || '(pending|accepted) session. THOSE ARE EXISTING DOUBLE BOOKINGS. Resolve them first — '
        || 'booking-guard.sql step 1 lists them, and the remedy is to cancel the loser, not to '
        || 'widen the index. Nothing changed.';
    end if;

    create unique index sessions_active_slot_uniq
      on public.sessions (provider_id, date, start_time)
      where status in ('pending','accepted');

    select c.oid into v_oid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'sessions_active_slot_uniq'
       and c.relkind = 'i';
  end if;

  -- ═══ THE END STATE, ASSERTED ON BOTH BRANCHES ════════════════════════════
  -- (a) It is on the right table. A same-named index elsewhere would otherwise
  -- satisfy every check below.
  if (select indrelid from pg_index where indexrelid = v_oid)
       is distinct from to_regclass('public.sessions') then
    raise exception '%', '0093: sessions_active_slot_uniq exists but is not on public.sessions. '
      || 'Rolled back.';
  end if;

  -- (b) ⚠️ THE FOUR FLAGS, AND indisvalid IS THE ONE THAT MATTERS. An invalid
  -- index is present, listed, and enforces nothing (item 195's class).
  select 'unique=' || indisunique::text || ' valid=' || indisvalid::text
      || ' ready=' || indisready::text || ' live=' || indislive::text
      || ' primary=' || indisprimary::text
    into v_flags
    from pg_index where indexrelid = v_oid;
  if (select not (indisunique and indisvalid and indisready and indislive)
             or indisprimary from pg_index where indexrelid = v_oid) then
    raise exception '%', '0093: sessions_active_slot_uniq is ' || v_flags
      || '. ⚠️ ALL FOUR OF unique/valid/ready/live MUST BE TRUE AND primary FALSE, or the index is '
      || 'listed by every catalogue query and enforces nothing — which is the only atomic guard '
      || 'against a double booking being absent while looking present. An invalid index is what a '
      || 'failed CREATE INDEX CONCURRENTLY leaves behind; it must be DROPPED and rebuilt, which '
      || 'this migration deliberately will not do on a live table. Rolled back.';
  end if;

  -- (c) THE KEY, BY POSITION. Three columns, in this order, and no INCLUDE
  -- columns — `indnatts > indnkeyatts` would mean payload columns were added.
  select string_agg(pg_get_indexdef(v_oid, k.ord::integer, true), ', ' order by k.ord)
    into v_cols
    from pg_index i, generate_series(1, i.indnkeyatts) as k(ord)
   where i.indexrelid = v_oid;
  if v_cols is distinct from 'provider_id, date, start_time'
     or (select indnatts <> indnkeyatts or indnkeyatts <> 3
           from pg_index where indexrelid = v_oid) then
    raise exception '%', '0093: sessions_active_slot_uniq is keyed on (' || coalesce(v_cols, 'nothing')
      || '), not (provider_id, date, start_time). ⚠️ slot_contention (0090) tests that exact key, so '
      || 'the function and the constraint would disagree about which slots are free — item 192, '
      || 'restored. ⚠️ AND IF end_time HAS BEEN ADDED, READ THIS FILE''S HEADER: that removes atomic '
      || 'protection from the one overlap shape this index catches. Rolled back.';
  end if;

  -- (d) PARTIAL, AND THE STATUS SET PARSED RATHER THAN PATTERN-MATCHED — so
  -- `IN (…)` vs `= ANY (ARRAY[…])` cannot make it pass by accident and an ADDED
  -- third status fails rather than being ignored. 0090's guard, same method.
  select pg_get_expr(indpred, indrelid) into v_pred
    from pg_index where indexrelid = v_oid;
  if v_pred is null then
    raise exception '%', '0093: sessions_active_slot_uniq is no longer PARTIAL. A full unique index '
      || 'on (provider_id, date, start_time) would refuse a SECOND BOOKING OF A SLOT WHOSE FIRST '
      || 'BOOKING WAS CANCELLED — the slot would never re-open. Rolled back.';
  end if;
  select array_agg(distinct m[1] order by m[1]) into v_stat
    from regexp_matches(v_pred, '''([a-z_]+)''', 'g') as m;
  if v_stat is distinct from v_stat_want then
    raise exception '%', '0093: the statuses in sessions_active_slot_uniq''s predicate are '
      || coalesce(array_to_string(v_stat, ','), '(none found)') || ', expected '
      || array_to_string(v_stat_want, ',') || '. ⚠️ This list must equal slot_contention''s: a '
      || 'status the index treats as occupying a slot which the function does not is a slot offered '
      || 'and then refused. Update BOTH or neither. Rolled back.'
      || chr(10) || 'live predicate: ' || v_pred;
  end if;

  -- (e) It must still be a bare index, not a constraint. A constraint-backed
  -- index has a second owner in pg_constraint and cannot be dropped by name.
  if exists (select 1 from pg_constraint where conindid = v_oid) then
    raise exception '%', '0093: sessions_active_slot_uniq is now backed by a constraint ('
      || (select string_agg(conname, ', ') from pg_constraint where conindid = v_oid)
      || '). That is a different object with a different owner; this migration describes a bare '
      || 'index. Read it before re-running. Rolled back.';
  end if;

  -- (f) ⚠️ NULLS NOT DISTINCT WOULD CHANGE WHAT THIS GUARD CATCHES, and it is
  -- read dynamically because the column only exists from PostgreSQL 15 — naming
  -- it directly would make this migration fail to run on an older server for a
  -- reason unrelated to its purpose.
  if exists (select 1 from pg_attribute
              where attrelid = 'pg_index'::regclass and attname = 'indnullsnotdistinct'
                and not attisdropped) then
    execute 'select indnullsnotdistinct from pg_index where indexrelid = $1'
       into v_nnd using v_oid;
    if v_nnd then
      raise exception '%', '0093: sessions_active_slot_uniq is NULLS NOT DISTINCT. That is a '
        || 'BEHAVIOUR CHANGE, not a detail: it makes two active sessions with a NULL date or '
        || 'start_time collide, which closes part of item 193''s hole. It may well be right — but it '
        || 'is not what booking-guard.sql:31 creates, so this migration would be adopting a '
        || 'different guard than it describes. Read it, then decide. Rolled back.';
    end if;
  end if;
end $mig$;

-- ⚠️ The correction to 0090 lives here too, because `\d+ sessions` and
-- pg_description are where somebody meets this index without reading a file.
comment on index public.sessions_active_slot_uniq is
  'One active (pending|accepted) session per provider+date+start_time. ⚠️ THE ONLY ATOMIC GUARD '
  'AGAINST A DOUBLE BOOKING — a unique index cannot be beaten by two concurrent inserts, which is '
  'why it is not redundant with the overlap trigger. ⚠️ BUT IT IS NOT "THE ONLY THING PREVENTING A '
  'DOUBLE BOOKING", WHICH IS WHAT 0090''S HEADER SAYS: trg_reject_overlapping_session '
  '(supabase/booking-overlap-guard.sql, hand-run, item 199) refuses OVERLAP on the same '
  'provider+date, covering the end_time case this index cannot see — but it is a BEFORE trigger '
  'running a SELECT, so it cannot see an uncommitted concurrent insert. Neither guard is redundant. '
  '⚠️ DO NOT ADD end_time TO THIS KEY (0090 suggests it): that removes atomic protection from the '
  'one overlap shape this index does catch. The instrument for overlap-under-concurrency is an '
  'EXCLUDE USING gist with &&, which cannot land until item 193 makes start_time and end_time NOT '
  'NULL. ⚠️ AND NULLS ARE DISTINCT IN A BTREE INDEX: a session with a NULL date or start_time '
  'collides with nothing here. Adopted verbatim from booking-guard.sql:31 by 0093, item 189.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0093', 'the_framework_adopts_the_only_atomic_double_booking_guard', '9d5447fc1a566786226b7d426fcefb759ae394dee72921682e145308f8f89b2b');

commit;


-- ===========================================================================
-- ⚠️ PREFLIGHT — run 9 Oct 2026, one block, read-only. Re-run if time has passed.
--
--   MEASURED: unique/valid/ready/live all true · definition matches
--   booking-guard.sql:31 · the index's status set and slot_contention's AGREE ·
--   0 active collisions governed, 0 involving a NULL, 0 active sessions with a
--   NULL date or start_time · date and start_time both NULLABLE · a bare index,
--   no backing constraint · six triggers on public.sessions.
--
--   with ix as (
--     select c.oid, t.relname as on_table, i.indisunique, i.indisvalid,
--            i.indisready, i.indislive, i.indpred, i.indrelid,
--            pg_get_userbyid(c.relowner) as owner
--       from pg_class c
--       join pg_index i     on i.indexrelid = c.oid
--       join pg_class t     on t.oid = i.indrelid
--       join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relname = 'sessions_active_slot_uniq'
--   ),
--   idx_stat as (
--     select array_agg(distinct m[1] order by m[1]) as s
--       from ix, regexp_matches(pg_get_indexdef(ix.oid), '''([a-z_]+)''', 'g') as m
--   ),
--   fn_stat as (
--     select array_agg(distinct m[1] order by m[1]) as s
--       from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace,
--            regexp_matches(p.prosrc, '''([a-z_]+)''', 'g') as m
--      where n.nspname = 'public' and p.proname = 'slot_contention'
--   )
--   select 'a. gate' as part, '0092 applied' as name,
--          ((select count(*) from public.schema_migrations where version = '0092') = 1)::text as detail
--   union all
--   select 'b. exists', 'the index itself',
--          coalesce((select 'on table=' || on_table || ' | owner=' || owner
--                        || ' | partial=' || (indpred is not null)::text from ix),
--                   '(MISSING — THE ONLY THING PREVENTING A DOUBLE BOOKING IS NOT THERE)')
--   union all
--   -- ⚠️ THE ROW THAT MATTERS MOST. indisvalid=false means the index exists, is
--   -- listed by every catalogue query, and ENFORCES NOTHING.
--   select 'c. VALIDITY', 'unique / valid / ready / live — all four must be true',
--          coalesce((select 'unique=' || indisunique::text || ' valid=' || indisvalid::text
--                        || ' ready=' || indisready::text || ' live=' || indislive::text from ix),
--                   '(MISSING)')
--   union all
--   select 'd. definition', 'live pg_get_indexdef — compare to booking-guard.sql:31',
--          coalesce((select pg_get_indexdef(oid) from ix), '(MISSING)')
--   union all
--   select 'e. predicate', 'the WHERE clause alone',
--          coalesce((select pg_get_expr(indpred, indrelid) from ix), '(none or MISSING)')
--   union all
--   select 'f. status set', 'parsed from the index, as 0090 parses it',
--          coalesce((select array_to_string(s, ', ') from idx_stat), '(none found)')
--   union all
--   select 'g. status set', 'parsed from slot_contention''s prosrc',
--          coalesce((select array_to_string(s, ', ') from fn_stat), '(MISSING)')
--   union all
--   -- ⚠️ THE TWO-OWNERS QUESTION, ANSWERED AS A VERDICT RATHER THAN TWO DUMPS.
--   -- 0090's guard asserted these are equal AT APPLY TIME and will never run again.
--   select 'h. agreement', 'do f and g match? (0090 asserted it once, at apply)',
--          case when (select s from idx_stat) is null or (select s from fn_stat) is null
--                 then 'CANNOT TELL — one side is missing'
--               when (select s from idx_stat) = (select s from fn_stat)
--                 then 'agree'
--               else 'DISAGREE — index=' || array_to_string((select s from idx_stat), ',')
--                    || ' function=' || array_to_string((select s from fn_stat), ',') end
--   union all
--   select 'i. is it a constraint?', 'pg_constraint backing this index',
--          coalesce((select string_agg(conname || ' ' || pg_get_constraintdef(oid), '; ')
--                      from pg_constraint where conindid = (select oid from ix)),
--                   '(no — a bare index, as `create unique index` makes)')
--   union all
--   select 'j. other indexes', 'every OTHER index on public.sessions',
--          coalesce((select string_agg(indexname || ' :: ' || indexdef, chr(10) order by indexname)
--                      from pg_indexes
--                     where schemaname = 'public' and tablename = 'sessions'
--                       and indexname <> 'sessions_active_slot_uniq'),
--                   '(none)')
--   union all
--   select 'k. other constraints', 'unique / primary / exclusion constraints on sessions',
--          coalesce((select string_agg(conname || ' ' || pg_get_constraintdef(oid), chr(10) order by conname)
--                      from pg_constraint
--                     where conrelid = to_regclass('public.sessions') and contype in ('u','p','x')),
--                   '(none)')
--   union all
--   -- ⚠️ TWO NUMBERS, NOT ONE, AND THE SECOND IS THE ONE THE INDEX CANNOT SEE.
--   -- GROUP BY treats NULLs as EQUAL; a btree unique index treats them as DISTINCT.
--   -- So the second count can be non-zero while the index is perfectly valid.
--   select 'l. duplicates now', 'active collisions the index DOES govern (date+start_time not null)',
--          (select count(*)::text from (
--             select 1 from public.sessions
--              where status in ('pending','accepted')
--                and date is not null and start_time is not null
--              group by provider_id, date, start_time having count(*) > 1) d)
--   union all
--   select 'm. duplicates now', 'active collisions involving a NULL date or start_time (item 193)',
--          (select count(*)::text from (
--             select 1 from public.sessions
--              where status in ('pending','accepted')
--                and (date is null or start_time is null)
--              group by provider_id, date, start_time having count(*) > 1) d)
--   union all
--   select 'n. the hole', 'active sessions with a NULL date or start_time at all (item 193)',
--          (select count(*)::text from public.sessions
--            where status in ('pending','accepted') and (date is null or start_time is null))
--   union all
--   -- ⚠⚠ FIXED 9 Oct 2026, AND THE FAULT WAS THE SHAPE OF THE PROBE, NOT A TYPO.
--   -- The first version asked for tgname = 'tg_session_slot_authority' — which is the
--   -- FUNCTION's name; the trigger is `session_slot_authority`. So it printed
--   -- (MISSING) for a trigger that is present and enabled, and `(MISSING)` could not
--   -- be told apart from "the probe guessed the wrong name" — on the guard that
--   -- derives six columns, which is the worst row in this block to be ambiguous
--   -- about. Item 200.
--   --
--   -- ✅ THE FIX IS TO STOP PROBING A NAME AND LIST WHAT IS THERE. Every trigger on
--   -- the table, each with BOTH names and its enabled flag, so a reader can see what
--   -- exists rather than confirm what was guessed. tgenabled: O=enabled, D=disabled,
--   -- R/A=replica — ⚠️ A DISABLED TRIGGER IS PRESENT AND DOES NOTHING, so the flag is
--   -- part of the answer, not decoration.
--   select 'o. all triggers', 'every trigger on sessions: name / function / enabled',
--          coalesce((select string_agg(t.tgname || '  →  ' || p.proname
--                                        || '  [' || t.tgenabled::text || ']', chr(10) order by t.tgname)
--                      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--                     where t.tgrelid = to_regclass('public.sessions') and not t.tgisinternal),
--                   '(NO TRIGGERS ON public.sessions — see item 193)')
--   union all
--   select 'p. status vocabulary', 'the CHECK, then every value actually present',
--          coalesce((select string_agg(pg_get_constraintdef(oid), ' / ') from pg_constraint
--                     where conrelid = to_regclass('public.sessions') and contype = 'c'
--                       and pg_get_constraintdef(oid) like '%status%'), '(no CHECK on status)')
--          || chr(10) || coalesce((select string_agg(st || '=' || n, ', ' order by st)
--               from (select status as st, count(*) as n from public.sessions group by status) q), '(no rows)')
--   union all
--   select 'q. key columns', 'types and nullability of the three key columns',
--          (select string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable,
--                             ', ' order by column_name)
--             from information_schema.columns
--            where table_schema = 'public' and table_name = 'sessions'
--              and column_name in ('provider_id','date','start_time'))
--    order by part;
--
--   ⚠⚠ AND THE REPLACEMENT ROW (o) ABOVE CARRIED A SECOND, UNTESTED FAULT until
--   9 Oct 2026: `'[' || t.tgenabled || ']'` with no `::text`. `tgenabled` is
--   "char", so that raises `42725: operator is not unique` and the WHOLE block
--   fails having tested nothing. **It never ran in this form** — the fix was
--   written after the preflight had already been run, so nothing exercised it.
--   ⚠️ A CORRECTION WRITTEN AFTER THE RUN IS UNTESTED CODE, and this one sat in an
--   applied migration. Found by the same fault failing in preflight0096.
--
--   ⚠️ AND ONE ROW OF THAT PREFLIGHT WAS WRONG IN A WAY WORTH KEEPING VISIBLE.
--   Row (o) probed `tgname = 'tg_session_slot_authority'` — the FUNCTION's name;
--   the trigger is `session_slot_authority`. It printed (MISSING) for a trigger
--   that is present and enabled, and `(MISSING)` could not be told apart from
--   "the probe guessed the wrong name" — on the guard that derives six columns.
--   Fixed by listing every trigger with BOTH names and `tgenabled` instead of
--   confirming one guess. Item 200.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION. Every line is a catalogue read or an aggregate, identical
-- for every identity, so there is no seat to get wrong (0090's verify was wrong
-- five times, every time because a block asked a question of a party that could
-- not answer it honestly).
--
--   do $$
--   declare
--     r_flag text := 'not run';
--     r_key  text := 'not run';
--     r_pred text := 'not run';
--     r_agree text := 'not run';
--     r_own  text := 'not run';
--     r_ctrl text := 'not run';
--     v_oid  oid;
--     v_cols text;
--     v_pred text;
--     v_is   text[];
--     v_fs   text[];
--   begin
--     select c.oid into v_oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relname = 'sessions_active_slot_uniq' and c.relkind = 'i';
--
--     r_flag := coalesce((select case when indisunique and indisvalid and indisready and indislive
--                                       and not indisprimary
--                                     then 'pass  - unique, valid, ready, live'
--                                     else 'FAIL  - unique=' || indisunique::text
--                                          || ' valid=' || indisvalid::text
--                                          || ' ready=' || indisready::text
--                                          || ' live='  || indislive::text end
--                           from pg_index where indexrelid = v_oid),
--                        'FAIL  - the index does not exist');
--
--     select string_agg(pg_get_indexdef(v_oid, k.ord::integer, true), ', ' order by k.ord)
--       into v_cols
--       from pg_index i, generate_series(1, i.indnkeyatts) as k(ord)
--      where i.indexrelid = v_oid;
--     r_key := case when v_cols = 'provider_id, date, start_time'
--                   then 'pass  - (provider_id, date, start_time), no INCLUDE columns'
--                   else 'FAIL  - keyed on (' || coalesce(v_cols, 'nothing') || ')' end;
--
--     select pg_get_expr(indpred, indrelid) into v_pred from pg_index where indexrelid = v_oid;
--     select array_agg(distinct m[1] order by m[1]) into v_is
--       from regexp_matches(coalesce(v_pred, ''), '''([a-z_]+)''', 'g') as m;
--     r_pred := case when v_pred is null then 'FAIL  - no longer partial; a cancelled slot would never re-open'
--                    when v_is = array['accepted','pending'] then 'pass  - partial on accepted, pending'
--                    else 'FAIL  - predicate statuses are ' || coalesce(array_to_string(v_is, ','), '(none)') end;
--
--     -- ⚠️ THE LINE 0090 CAN NO LONGER CHECK. Its guard asserted this at apply
--     -- time and will never run again; nothing standing watches it.
--     select array_agg(distinct m[1] order by m[1]) into v_fs
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
--            regexp_matches(p.prosrc, '''([a-z_]+)''', 'g') as m
--      where n.nspname = 'public' and p.proname = 'slot_contention';
--     r_agree := case when v_fs is null then 'FAIL  - slot_contention is missing'
--                     when v_is is not distinct from v_fs
--                       then 'pass  - index and slot_contention test the same statuses'
--                     else 'FAIL  - index=' || array_to_string(v_is, ',')
--                          || ' slot_contention=' || array_to_string(v_fs, ',') end;
--
--     r_own := case when (select count(*) from public.schema_migrations where version = '0093') = 1
--                   then 'pass  - 0093 recorded; the index is owned by a migration'
--                   else 'FAIL  - 0093 is not in schema_migrations' end;
--
--     -- THE CONTROL. ⚠️ 0093 names no other object, so the OTHER half of the
--     -- protection must be exactly as it was. A pass on everything above while
--     -- this fails would mean the overlap guard went while the index was adopted.
--     r_ctrl := coalesce((select 'pass  - trg_reject_overlapping_session still on sessions'
--                           from pg_trigger t
--                          where t.tgrelid = to_regclass('public.sessions')
--                            and t.tgname = 'trg_reject_overlapping_session'
--                            and not t.tgisinternal and t.tgenabled = 'O'),
--                        'FAIL  - trg_reject_overlapping_session is gone or DISABLED; nothing '
--                        || 'refuses an overlapping booking (item 199)');
--
--     raise exception '%',
--       chr(10) || '=== 0093 VERIFY ==='
--       || chr(10) || '1  flags, valid above all  : ' || r_flag
--       || chr(10) || '2  the key                 : ' || r_key
--       || chr(10) || '3  partial + statuses      : ' || r_pred
--       || chr(10) || '4  agrees with 0090''s fn   : ' || r_agree
--       || chr(10) || '5  owned by a migration    : ' || r_own
--       || chr(10) || '6  control, overlap guard  : ' || r_ctrl;
--   end $$;
--
--   EXPECT: all six pass. ⚠️ Line 1 outranks the rest — an invalid index passes
--   lines 2, 3 and 4 and enforces nothing. Line 6 is the half this migration does
--   NOT own; if it fails, read item 199 before anything else.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

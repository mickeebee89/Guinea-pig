-- ===========================================================================
-- 0090_two_models_cannot_both_be_told_a_slot_is_free
--
-- Item 192. ⚠️ Apply 0089 first.
--
-- ── THE DEFECT, AND ITS SEVERITY STATED PRECISELY ──────────────────────────
-- Two models can both see the same slot as free. The second works through
-- seven steps, possibly pays £4.99 to get there, and is refused at the last
-- one.
--
-- ⚠️ IT CANNOT PRODUCE A DOUBLE BOOKING. `sessions_active_slot_uniq`
-- (supabase/booking-guard.sql:31) rejects the second insert and
-- site/app/(app)/stylist/[id]/apply/actions.ts:306 catches 23505 with "That
-- slot has just been taken." **The harm is a wasted journey, not a
-- data-integrity failure.** Worth fixing for where it lands, not for what it
-- corrupts.
--
-- ── ⚠️⚠️ THE MECHANISM: A FAIL-CLOSED ARM THAT CANNOT FIRE ─────────────────
-- site/lib/queries/apply.ts:118 reads `sessions` to find slots with a pending
-- or accepted application, and guards itself:
--
--     booked = error ? new Set(everything) : new Set(rows)
--
-- with the comment "a failure here treats everything as taken rather than risk
-- offering a slot that is gone."
--
-- **The intention is right. The guard is blind to its actual failure mode.**
-- `"participants can read sessions"` is
-- `using (auth.uid() = model_user_id OR <provider owner>)`, so a model's read
-- returns ONLY HER OWN sessions. Another model's application is removed by RLS
-- — silently, with no error — so the set is systematically incomplete and the
-- fail-closed arm never runs.
--
-- ⚠️ RLS DOES NOT RAISE, IT FILTERS. A guard written for `error` cannot see a
-- guard written by a policy. Item 188's class in live product code, in the
-- booking path, and the sharpest instance found so far: every previous one was
-- in a check, this one is in the feature.
--
-- ── WHY A SECURITY DEFINER FUNCTION IS THE ONLY SOUND FIX ───────────────────
-- The thing that must stay hidden — WHOSE application it is — is exactly what
-- the RLS policy is right to hide. A model needs "unavailable", not "booked by
-- Sarah". So the answer cannot come from relaxing the policy; it has to come
-- from a function that knows more than the caller and says less.
--
-- ⚠️ THE RETURN TYPE IS THE PRIVACY BOUNDARY, STRUCTURALLY RATHER THAN BY
-- RULE. Two columns, neither an identity: no model_user_id, no count, no
-- timestamp, and it takes a PROVIDER id rather than a session id. There is
-- nothing to leak because there is nowhere to put it. ⚠️ Do not add a column
-- here. The moment it returns who or how many it becomes the way round
-- "participants can read sessions", which is the policy this function exists
-- to respect rather than circumvent.
--
-- ── ⚠️⚠️ THE KEY IS (provider_id, date, start_time), NOT availability_id ────
-- This is the whole reason to read the constraint rather than assume it, and a
-- first draft of this function got it wrong.
--
--   sessions_active_slot_uniq  on public.sessions (provider_id, date, start_time)
--                              where status in ('pending','accepted')
--
-- `availability`'s own unique index is (provider_id, date, start_time,
-- end_time) — so TWO AVAILABILITY ROWS CAN SHARE provider, date and
-- start_time with different end times. If one carries a pending session the
-- constraint refuses a booking on the other, and a function keyed on
-- availability_id would call that other slot FREE. **The defect, reintroduced
-- through a different door, and harder to find — it would present as a rare
-- insert failure rather than a systematic one.**
--
-- So the contested test keys exactly as the constraint does.
--
-- ⚠⚠ WHICH MEANS THIS FUNCTION REPORTS A SLOT AS CONTESTED WHEN A SESSION
-- COLLIDES ON (provider_id, date, start_time) EVEN THOUGH THAT SESSION SITS ON A
-- DIFFERENT availability ROW. **That is correct and it is not a bug.** It reports
-- what the CONSTRAINT WILL DO, not what a person would call "the same slot": a
-- 10:00–11:00 slot and a 10:00–10:30 slot are two availability rows and one
-- collision, because `sessions_active_slot_uniq` does not include end_time.
--
-- It will therefore look wrong to anyone who meets it cold — a free-looking slot
-- reported as taken — and the obvious "fix" is to narrow the test back to
-- availability_id, which reintroduces exactly the defect above. **Do not.** If
-- this behaviour is ever genuinely unwanted, the thing to change is the INDEX
-- (to include end_time), and then this function follows it, not the other way
-- round.
--
-- ⚠️ AND apply.ts HAS THE SAME MISMATCH TODAY: its `booked` set keys on
-- availability_id, so even with the RLS problem fixed it would still miss
-- same-start-time collisions. That is why the shared loader must call THIS
-- function rather than keep a session read of its own.
--
-- ── ⚠️ TWO COPIES OF THE STATUS LIST, AND WHY THAT IS ACCEPTABLE HERE ───────
-- `status in ('pending','accepted')` now appears in two places: this function
-- and the index predicate. Deriving it from one place is not practical in a
-- `language sql` body — an index predicate is not readable as a value at plan
-- time without making this function VOLATILE and dynamic, which costs more
-- than it buys.
--
-- **So the guard below asserts they are EQUAL, and each comment names the
-- other.** Two copies that cannot drift silently is acceptable; two copies
-- that can is not. The guard parses the statuses out of pg_get_indexdef and
-- compares the SET, rather than pattern-matching, so index normalisation
-- cannot make it pass by accident.
--
-- ⚠️ If you ever add a third occupying status, this migration's guard is what
-- will stop you forgetting one of the two.
--
-- ── ⚠️ current_date IS UTC AND THAT IS DELIBERATE, NOT AN OVERSIGHT ─────────
-- This project computes slot times in Europe/London — `tg_session_slot_authority`
-- uses `(date + start_time) at time zone 'Europe/London'`. `current_date` here
-- is UTC, so for up to an hour it can include a London date that has just
-- ended.
--
-- **That is OVER-INCLUSIVE, which is the harmless direction**: it can return a
-- row for a slot already past, never omit one that is still bookable. The real
-- boundary work is `withoutStartedSlots` in the shared loader (item 133), which
-- excludes slots whose start has passed. ⚠️ DO NOT "FIX" THIS TO LONDON TIME —
-- that would narrow a filter deliberately left wide, and a function that omits
-- a bookable slot is a worse failure than one that includes a dead slot the
-- loader then drops.
--
-- ── ⚠️ ITEM 190 APPLIES TO THIS FUNCTION'S FUTURE, NOT ITS CREATION ─────────
-- The SQL editor converts LF to CRLF on paste (item 190, measured). **Nothing
-- compares this body when it is created, so this migration needs no `format()`
-- and no `chr(10)`.** The rule binds the day someone REPLACES, ADOPTS or
-- ASSERTS it — as 0089 had to for `is_admin()`.
--
-- Said explicitly in both directions so nobody applies `format()`
-- superstitiously to a case that does not need it, and so nobody writes a
-- verify that asserts this body as a literal. **The VERIFY below asserts
-- BEHAVIOUR.**
--
-- ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────
-- It does not filter `is_taken` and it does not exclude started slots. It
-- answers ONE question — is this slot contested — and the shared loader
-- composes all three filters. ⚠️ Folding them in would make this a second
-- implementation of "bookable", which is the class this migration exists to
-- close.
--
-- It also ships no client change. The loader, the panel and item 186 follow
-- separately: this is a correctness fix that is wrong today whether or not any
-- UI is ever built on it, and bundling it into a feature would mean the fix
-- only ships if the feature does.
-- ===========================================================================
begin;

do $mig$
declare
  v_idx     text;
  v_stat    text[];
  v_want    text[] := array['accepted', 'pending'];
begin
  if not exists (select 1 from public.schema_migrations where version = '0089') then
    raise exception '0090: apply 0089 first.';
  end if;

  if to_regclass('public.sessions_active_slot_uniq') is null then
    raise exception '%', '0090: STOP. sessions_active_slot_uniq DOES NOT EXIST, WHICH MEANS '
      || 'THE ONLY THING PREVENTING A DOUBLE BOOKING DOES NOT EXIST. That outranks everything in '
      || 'this migration: right now two models can both be ACCEPTED for the same slot, and nothing '
      || 'in the database refuses the second insert. It is created by the hand-run '
      || 'supabase/booking-guard.sql, which no migration owns (item 189) — so it can be absent on a '
      || 'database nobody ran it against. Run booking-guard.sql, confirm the index exists, and '
      || 'investigate whether any double booking already happened, BEFORE applying this. '
      || 'Nothing changed.';
  end if;

  v_idx := pg_get_indexdef('public.sessions_active_slot_uniq'::regclass);

  -- (a) THE KEY. If the constraint collides on different columns than this
  -- function tests, the function offers slots the constraint refuses.
  if v_idx not like '%(provider_id, date, start_time)%' then
    raise exception '%', '0090: sessions_active_slot_uniq is not keyed on '
      || '(provider_id, date, start_time), so slot_contention would test a different key than '
      || 'the constraint enforces — which is the defect this migration fixes, through another door. '
      || 'Nothing changed.' || chr(10) || 'live definition:' || chr(10) || v_idx;
  end if;

  -- (b) THE STATUS LIST, AS A SET. Parsed rather than pattern-matched, so
  -- index normalisation (ANY(ARRAY[...]) vs IN) cannot make it pass by
  -- accident, and an ADDED third status fails rather than being ignored.
  select array_agg(distinct m[1] order by m[1]) into v_stat
    from regexp_matches(v_idx, '''([a-z_]+)''', 'g') as m;

  if v_stat is distinct from v_want then
    raise exception '%', '0090: the statuses in sessions_active_slot_uniq are '
      || coalesce(array_to_string(v_stat, ','), '(none found)')
      || ' but slot_contention tests ' || array_to_string(v_want, ',')
      || '. The two lists MUST match: a status the constraint treats as occupying a slot, which '
      || 'this function does not, is a slot offered and then refused. Update BOTH, or neither. '
      || 'Nothing changed.' || chr(10) || 'live definition:' || chr(10) || v_idx;
  end if;

  -- (c) The columns the function reads must exist on sessions, since the key
  -- above is an index definition rather than proof of the table's shape.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sessions'
                    and column_name = 'start_time')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'sessions'
                       and column_name = 'date')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'sessions'
                       and column_name = 'provider_id') then
    raise exception '0090: public.sessions is missing one of provider_id, date, start_time. Nothing changed.';
  end if;

  -- (d) There must not already be a slot_contention with a different
  -- signature: create-or-replace would add an overload rather than replace it,
  -- and callers would resolve to whichever matched their arguments.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'slot_contention') > 1 then
    raise exception '0090: more than one public.slot_contention already exists. Read them before applying. Nothing changed.';
  end if;
end $mig$;

-- ⚠️ THE STATUS LIST HERE IS THE SAME LIST AS sessions_active_slot_uniq's
-- PREDICATE (supabase/booking-guard.sql:31). The guard above asserts they are
-- equal. Change one and you must change the other; the next apply will refuse
-- if you do not.
--
-- ⚠️ THE KEY HERE IS THE SAME KEY AS THAT INDEX'S: (provider_id, date,
-- start_time). NOT availability_id. See the header for what goes wrong.
create or replace function public.slot_contention(p_provider_id uuid)
returns table (availability_id uuid, contested boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id,
         exists (select 1
                   from public.sessions s
                  where s.provider_id = a.provider_id
                    and s.date        = a.date
                    and s.start_time  = a.start_time
                    and s.status in ('pending', 'accepted'))
    from public.availability a
   where a.provider_id = p_provider_id
     and a.date >= current_date
$$;

comment on function public.slot_contention(uuid) is
  'For one stylist, every future availability row with whether a pending or accepted session '
  'occupies its slot. ⚠️ EXISTENCE ONLY, NEVER IDENTITY: a model needs "unavailable", not "booked '
  'by Sarah", and "participants can read sessions" is right to hide the rest. DO NOT ADD A COLUMN — '
  'returning who or how many would make this the way round that policy. SECURITY DEFINER because a '
  'model''s own read of sessions returns only her own rows, silently, which is item 192. '
  '⚠️ KEYED ON (provider_id, date, start_time) TO MATCH sessions_active_slot_uniq '
  '(supabase/booking-guard.sql) — NOT on availability_id, because two availability rows may share a '
  'start_time with different end_times and the constraint collides on the former. 0090, item 192. '
  '⚠️ SO IT REPORTS A SLOT AS CONTESTED WHEN A SESSION COLLIDES ON provider+date+start_time EVEN ON '
  'A DIFFERENT availability ROW. That is correct — it reports what the constraint will do, not what a '
  'person would call "the same slot". Narrowing it back to availability_id reintroduces item 192. If '
  'the behaviour is unwanted, change the INDEX to include end_time and let this follow. '
  '⚠️ It answers ONE question: it does NOT filter is_taken or started slots, and must not start to. '
  'The caller composes those; folding them in here would make this a second implementation of '
  '"bookable". current_date is UTC and deliberately over-inclusive — see 0090''s header.';

revoke all     on function public.slot_contention(uuid) from public, anon;
grant  execute on function public.slot_contention(uuid) to authenticated;

do $mig$
declare
  v_sec  boolean;
  v_vol  "char";
  v_cfg  text[];
  v_cols text;
begin
  select p.prosecdef, p.provolatile, p.proconfig into v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'slot_contention';

  if v_sec is null then
    raise exception '0090: slot_contention does not exist after creating it. Rolled back.';
  end if;
  -- ⚠️ MATCHED LOOSELY ON PURPOSE. proconfig's rendering of a search_path is a
  -- formatting detail of Postgres (quoting and spacing vary by version), and
  -- asserting it exactly would turn a formatting difference into a rollback.
  -- The CONTENT is what matters: both schemas present, in that order.
  if not v_sec or v_vol <> 's'
     or not exists (select 1 from unnest(coalesce(v_cfg, '{}'::text[])) c
                     where c like 'search_path=%public%pg_temp%') then
    raise exception '%', '0090: slot_contention has the wrong properties — definer=' || v_sec::text
      || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || '. Expected definer, stable, search_path=public, pg_temp. Rolled back.';
  end if;

  -- ⚠️ THE RETURN SHAPE IS THE PRIVACY BOUNDARY, SO IT IS ASSERTED. Two
  -- columns, exactly these. A third column added later fails here rather than
  -- quietly becoming a disclosure.
  select pg_get_function_result(p.oid) into v_cols
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'slot_contention';
  if lower(v_cols) <> 'table(availability_id uuid, contested boolean)' then
    raise exception '%', '0090: slot_contention returns ' || v_cols
      || ', expected TABLE(availability_id uuid, contested boolean). The return type is what makes '
      || 'the privacy guarantee structural rather than a rule. Rolled back.';
  end if;

  -- GRANTS: authenticated yes, anon and public no.
  if not has_function_privilege('authenticated', 'public.slot_contention(uuid)'::regprocedure, 'execute') then
    raise exception '0090: authenticated cannot execute slot_contention, so no client can use it. Rolled back.';
  end if;
  if has_function_privilege('anon', 'public.slot_contention(uuid)'::regprocedure, 'execute') then
    raise exception '0090: anon can execute slot_contention. The public pages show no slots and have no use for it. Rolled back.';
  end if;

  -- THE CONTROL. This migration must not have touched the policy it works
  -- around: a "fix" that relaxed sessions RLS would pass every behavioural
  -- test above and be the opposite of the intent.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'sessions'
       and policyname = 'participants can read sessions'
  ) then
    raise exception '0090: "participants can read sessions" is gone from public.sessions. This migration exists to RESPECT that policy, not to remove it. Rolled back.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0090', 'two_models_cannot_both_be_told_a_slot_is_free', '7e92c977f4505ceb4775bd0633a55878050105f4f1fa4e986b6449d7bf5b5822');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN BEFORE THIS MIGRATION. Read-only, one block.
--
--   ⚠⚠ THE `with ix as (...)` LOOKUP IS NOT STYLE. `'…'::regclass` RAISES when
--   the relation does not exist — it does not return null — so a first version of
--   this block, which wrote
--
--       coalesce(pg_get_indexdef('public.sessions_active_slot_uniq'::regclass), '(MISSING)')
--
--   could NEVER reach its own fallback: the case it was written for produced a
--   bare "relation does not exist" and took rows (b) to (f) down with it. The
--   reader would get a Postgres error about an object they have never heard of,
--   in the one situation where they most need the sentence. Item 188's class, in
--   the row that outranks every other row here. Micky's catch, 6 Oct 2026.
--
--   Looking the oid up in pg_class yields NULL for a missing index, which is what
--   makes the fallback reachable.
--
--   with ix as (
--     select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relname = 'sessions_active_slot_uniq'
--   )
--   select 'a. the constraint' as part, 'pg_get_indexdef, verbatim' as name,
--          coalesce((select pg_get_indexdef(oid) from ix),
--                   '(MISSING - it is hand-run, see booking-guard.sql)') as detail
--   union all
--   select 'b. the constraint', 'statuses parsed as a set (expect accepted,pending)',
--          coalesce((select array_to_string(array_agg(distinct m[1] order by m[1]), ',')
--                      from regexp_matches(
--                             (select pg_get_indexdef(oid) from ix),
--                             '''([a-z_]+)''', 'g') as m), '(none)')
--   union all
--   select 'c. the defect, measured',
--          'future slots offered as FREE while already contested',
--          (select count(*)::text from public.availability a
--            where a.date >= current_date
--              and exists (select 1 from public.sessions s
--                           where s.provider_id = a.provider_id and s.date = a.date
--                             and s.start_time = a.start_time
--                             and s.status in ('pending','accepted')))
--       || ' of '
--       || (select count(*)::text from public.availability where date >= current_date)
--   union all
--   select 'd. the key mismatch, measured',
--          'is the key mismatch live on today''s data, or only possible? (rows = pairs found)',
--          -- ⚠️ THIS coalesce IS DEAD CODE, kept and labelled rather than removed:
--          -- count(*) over a subquery returns 0, never null, so the fallback is
--          -- unreachable. It gives the right answer either way, which is exactly
--          -- why it is worth labelling — TWO unreachable coalesces were written
--          -- into this block, the one in (a) mattered and this one did not, and
--          -- the difference is not visible from the shape.
--          coalesce((select count(*)::text from (
--            select a.provider_id, a.date, a.start_time
--              from public.availability a where a.date >= current_date
--             group by 1,2,3 having count(*) > 1) x), '0')
--   union all
--   select 'e. gate', '0089 applied',
--          ((select count(*) from public.schema_migrations where version = '0089') = 1)::text
--   union all
--   select 'f. gate', 'slot_contention does not exist yet',
--          ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'public' and p.proname = 'slot_contention') = 0)::text
--    order by 1, 2;
--
--   EXPECT: (a) a definition keyed on (provider_id, date, start_time) ·
--           (b) accepted,pending · (c) and (d) are MEASUREMENTS, any value ·
--           (e) true · (f) true.
--
--   ⚠️ (c) IS THE DEFECT'S CURRENT SIZE. Every one of those slots is being
--   offered to somebody as free right now.
--
--   ⚠️ (d) IS WHETHER THE KEY MISMATCH IS LIVE OR ONLY POSSIBLE. A non-zero
--   answer means availability rows already share a provider, date and start_time
--   with different end times, so a function keyed on availability_id would be
--   wrong about REAL DATA TODAY rather than in principle.
--
--   ⚠️ A ZERO ON (d) DOES NOT MAKE THE KEY CHOICE OPTIONAL. Nothing stops a
--   stylist creating such a pair tomorrow — availability's own unique index
--   permits it, by including end_time where sessions_active_slot_uniq does not.
--   Zero means "not yet", not "cannot".
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Rolls itself back. ─────────────────
--
-- ⚠️ IT ASSERTS BEHAVIOUR, NEVER BODY TEXT (item 190: this function's body is
-- not compared by anything, and a verify that started comparing it would be
-- the first thing to break on a CRLF paste).
--
-- Results accumulate into variables; the Supabase SQL editor does not display
-- NOTICE. Every line starts at 'not run'. Ids are RESOLVED AND PRINTED, never
-- pasted (the 0089 lesson).
--
-- ⚠️ THE FIXTURE SESSION IS INSERTED AS THE OWNER, AND THAT IS ONLY POSSIBLE
-- BECAUSE 0086's CONSENT TRIGGER IS `DEFERRABLE INITIALLY DEFERRED` AND FIRES
-- AT COMMIT, WHICH NEVER COMES HERE. Used deliberately, not stumbled into.
-- **THIS IS NOT HOW PRODUCT CODE MAY CREATE A SESSION** — the only sanctioned
-- path is create_session_with_consent. Do not copy this insert anywhere.
--
--   do $$
--   declare
--     v_prov    uuid;
--     v_owner   uuid;
--     v_model   uuid;
--     v_slot    uuid;
--     v_sess    uuid;
--     v_treat   uuid;
--     v_direct  integer;
--     v_flag    boolean;
--     r_ids   text := 'not run';
--     r_fix   text := 'not run';
--     r_blind text := 'not run';
--     r_see   text := 'not run';
--     r_free  text := 'not run';
--     r_ctrl  text := 'not run';
--   begin
--     -- Resolve everything, and print it, so the output says what it tested.
--     select a.provider_id, a.id into v_prov, v_slot
--       from public.availability a
--      where a.date >= current_date and a.is_taken is not true
--        and not exists (select 1 from public.sessions s
--                         where s.provider_id = a.provider_id and s.date = a.date
--                           and s.start_time = a.start_time
--                           and s.status in ('pending','accepted'))
--      order by a.date, a.start_time limit 1;
--     if v_slot is null then
--       raise exception 'VERIFY: no free future slot exists to test with. Nothing was tested.';
--     end if;
--     select p.user_id into v_owner from public.providers p where p.id = v_prov;
--     select u.id into v_model from public.users u
--      where u.role = 'model' and u.id <> v_owner limit 1;
--     select t.id into v_treat from public.provider_treatments t where t.provider_id = v_prov limit 1;
--     if v_model is null or v_treat is null then
--       raise exception 'VERIFY: need a model account and one treatment on that provider. Nothing was tested.';
--     end if;
--     r_ids := 'provider=' || v_prov::text || ' slot=' || v_slot::text
--              || ' model=' || v_model::text;
--
--     -- A pending session from SOMEBODY ELSE on that slot's provider/date/time.
--     insert into public.sessions
--       (provider_id, model_user_id, model_id, availability_id, treatment_id,
--        date, start_time, end_time, status)
--     select v_prov, v_model, v_model, a.id, v_treat,
--            a.date, a.start_time, a.end_time, 'pending'
--       from public.availability a where a.id = v_slot
--     returning id into v_sess;
--     r_fix := case when v_sess is null then 'FAIL  - fixture session not created'
--                   else 'fixture pending session ' || v_sess::text end;
--
--     -- Now become a DIFFERENT model and ask both ways.
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     -- 1. THE DEFECT: a direct read sees nothing, and raises nothing.
--     select count(*) into v_direct from public.sessions s
--      where s.provider_id = v_prov and s.status in ('pending','accepted');
--
--     -- 2. THE FIX: the function sees it.
--     select c.contested into v_flag
--       from public.slot_contention(v_prov) c where c.availability_id = v_slot;
--
--     execute 'reset role';
--
--     r_blind := v_direct || ' row(s) from a direct read';
--     r_see   := case when v_flag is true then 'pass  - slot_contention says contested = true'
--                     when v_flag is false then 'FAIL  - slot_contention says FREE; the fix does not work'
--                     else 'FAIL  - slot_contention returned no row for that slot' end;
--
--     -- 3. A slot with no session must still read free, or the function is
--     --    just answering "true" to everything.
--     select bool_or(c.contested) into v_flag
--       from public.slot_contention(v_prov) c
--      where c.availability_id <> v_slot
--        and not exists (select 1 from public.sessions s
--                         join public.availability a2 on a2.id = c.availability_id
--                        where s.provider_id = a2.provider_id and s.date = a2.date
--                          and s.start_time = a2.start_time
--                          and s.status in ('pending','accepted'));
--     r_free := case when coalesce(v_flag, false) then 'FAIL  - an uncontested slot reads contested'
--                    else 'pass  - uncontested slots still read free' end;
--
--     -- 4. THE CONTROL. The policy must NOT have been weakened to achieve it.
--     r_ctrl := case when v_direct = 0
--                    then 'pass  - the direct read still returns 0; RLS intact'
--                    else 'FAIL  - the direct read returned ' || v_direct
--                         || ' row(s); sessions RLS is weaker than it was' end;
--
--     raise exception '%',
--       chr(10) || '=== 0090 VERIFY — ROLLED BACK ON PURPOSE ==='
--       || chr(10) || '0  ids used                 : ' || r_ids
--       || chr(10) || '0  fixture                  : ' || r_fix
--       || chr(10) || '1  direct read (the defect) : ' || r_blind
--       || chr(10) || '2  slot_contention (the fix): ' || r_see
--       || chr(10) || '3  uncontested still free   : ' || r_free
--       || chr(10) || '4  RLS untouched (control)  : ' || r_ctrl;
--   end $$;
--
--   EXPECT: 1 says "0 row(s)" · 2 pass · 3 pass · 4 pass.
--
--   ⚠️⚠️ LINES 1 AND 4 ARE THE POINT. "0 rows from a direct read" and
--   "contested = true" in the same transaction, for the same slot, as the same
--   caller, is the defect and the fix proved by CONTRAST rather than as two
--   separate claims. If line 1 ever reports a non-zero count, the test has
--   stopped proving anything — the caller can see the session directly and the
--   function is no longer the only way to know.
-- ===========================================================================

-- ===========================================================================
-- 0095_the_second_answer_to_is_this_slot_free_stops_disagreeing
--
-- Items 201 and 192. ⚠️ Apply 0094 first. ⚠️ THIS ONE CHANGES BEHAVIOUR, AND
-- SAYS SO — it is not an adoption that proves it changed nothing.
--
-- Adopts `public.has_open_availability(uuid)` — snapshot-only until now, no
-- migration ever owned it — and in the same body change fixes two things:
--
--   1. **THE KEY.** It keyed on `availability_id`. That is item 192's defect
--      VERBATIM: the same wrong key `site/lib/queries/apply.ts:118` had, which
--      0090's header spends thirty lines on.
--   2. **THE UNQUALIFIED RELATION NAMES** (`availability`, `sessions`) — item
--      201. 0094 already gave it `search_path = public, pg_temp`; this closes
--      the other half, so no future edit can reintroduce the hazard.
--
-- ⚠️ ONE MIGRATION FOR BOTH, deliberately: they are the same body, and splitting
-- them means writing the measured hex twice — two copies of one value where only
-- one survives a clipboard (item 190).
--
-- ── ⚠️⚠️ WHY THE KEY WAS WRONG, AND WHY THE FIX IS DELEGATION ──────────────
-- `availability`'s own unique index is `(provider_id, date, start_time,
-- end_time)` — it includes end_time, so **two availability rows can share a
-- provider, date and start_time with different end times.**
-- `sessions_active_slot_uniq` (0093) collides on the TRIPLE, without end_time.
-- So if one of those rows carries a pending session, the constraint refuses a
-- booking on the OTHER — and a function keyed on `availability_id` calls that
-- other row FREE.
--
-- ✅ **SO THE KEY IS NOT RE-IMPLEMENTED HERE. IT IS DELETED FROM HERE.** The new
-- body calls `slot_contention(p_provider_id)` (0090), which is the one object
-- that owns this test. Fixing the key in place would leave a second
-- implementation that is merely correct today; removing it leaves one.
--
-- ⚠️ THE TRADE-OFF, STATED: this function now depends on `slot_contention`. If
-- that is ever dropped, this breaks loudly — which is the behaviour to want. The
-- alternative (inline the corrected triple) keeps them independent and keeps two
-- copies of the key. **Four implementations of "is this slot bookable" is how
-- this divergence happened; this migration removes one of them.**
--
-- ── ⚠️ WHAT THIS DOES **NOT** FIX, STATED SO IT IS NOT MISTAKEN FOR COMPLETE ─
-- `has_open_availability` still does not filter `is_taken` and does not exclude
-- slots whose start time has passed. The authoritative loader
-- (`site/lib/queries/slots.ts`, item 186) applies FOUR filters: taken,
-- contested, no_treatment, started. **This function now agrees with one of
-- them.** It is not the booking path and must not become it — the comment in its
-- body says so.
--
-- ── ⚠️⚠️ SCOPE: 0 LIVE / 1 DORMANT. NOT A LIVE DEFECT. ─────────────────────
-- The only caller in any of the three apps is
-- `mobile/src/app/(app)/provider/[id].tsx:205`, and **mobile is mothballed**
-- (CLAUDE.md, 6 Oct 2026). Checked on the live side:
--
--   * `public_stylists.has_open_slots` is a plain `exists` over
--     `public.availability` with **no join to `sessions` at all** — so it does
--     not share this key mismatch, because it has no key. Deliberately coarser
--     (`public-web-views.sql:198`). ⚠️ And nothing reads it: the only reference
--     in `site/` is a type declaration at `supabase-public.ts:63`.
--   * The live "Slots open" badge comes from `site/lib/queries/browse.ts:186`,
--     which reads `availability` for `is_taken` and drops started slots, and
--     **never joins `sessions`** — so no key mismatch there either.
--
-- ⚠️ EXECUTE IS NOT GRANTED TO PUBLIC OR TO anon (measured 9 Oct 2026:
-- `postgres=X/postgres authenticated=X/postgres service_role=X/postgres`), so
-- PostgREST does not expose it to an anon key. Only a signed-in caller can reach
-- it, and `pg_temp` is session-local — so item 201's worst case was always "a
-- signed-in model can lie to herself in her own session".
--
-- ── ⚠️⚠️ THIS OBJECT'S LINE ENDINGS ARE ITS OWN. THIRD OBJECT, THIRD SHAPE. ─
--   set_consent_hash          CR=0,  LF=12, opens 0a,   closes `end ` + no NL
--   reject_overlapping_session CR=15,       opens 0d0a
--   has_open_availability     CR=13, LF=13, opens 0d0a, closes 293b0d0a
--
-- ⚠️ MEASURED PER OBJECT, NEVER CARRIED OVER. The OLD literal below is built
-- from `chr(13) || chr(10)` because that is what was measured; the NEW body is
-- built from `chr(10)` alone.
--
-- ✅ AND WRITING LF IS A CHOICE, NOT AN OVERSIGHT. The CRLF in the old body is
-- ITSELF item 190's fingerprint — somebody pasted this function into the SQL
-- editor and the editor converted every newline. It was never intended. The new
-- body is constructed from `chr(10)` in SQL rather than typed as literal
-- newlines, so pasting THIS file cannot put the CRs back.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- Same name, same single `uuid` argument, same `boolean` return.
-- ===========================================================================
begin;

do $mig$
declare
  -- ⚠️ GENERATED FROM THE LIVE HEX, NOT RETYPED. 308 chars, CR=13, LF=13,
  -- md5 6deef40c23c1260dab7485882ec7b6bf.
  --
  -- ⚠️⚠️ AND RETYPING IT IS NOT A HYPOTHETICAL FAILURE. On the first attempt I
  -- transcribed this hex by hand into a decoder and corrupted it — one dropped
  -- character turned `      )` into `      i`, and the md5 came out
  -- 69fc84eb… instead of 6deef40c…. The md5 check is what caught it. That is the
  -- entire reason the before-assertion names a measured md5 rather than only
  -- comparing two strings this file carries.
  v_old text :=
    '' ||
    chr(13) || chr(10) || '  select exists (' ||
    chr(13) || chr(10) || '    select 1' ||
    chr(13) || chr(10) || '    from availability a' ||
    chr(13) || chr(10) || '    where a.provider_id = p_provider_id' ||
    chr(13) || chr(10) || '      and a.date >= current_date' ||
    chr(13) || chr(10) || '      and not exists (' ||
    chr(13) || chr(10) || '        select 1' ||
    chr(13) || chr(10) || '        from sessions s' ||
    chr(13) || chr(10) || '        where s.availability_id = a.id' ||
    chr(13) || chr(10) || '          and s.status in (''pending'', ''accepted'')' ||
    chr(13) || chr(10) || '      )' ||
    chr(13) || chr(10) || '  );' ||
    chr(13) || chr(10) || '';
  -- The replacement. 426 chars, LF only, md5 612e636abf2712ba6ef5445de30f0b23.
  v_new text :=
    '' ||
    chr(10) || '  -- The key lives in slot_contention, NOT here. This read availability_id until' ||
    chr(10) || '  -- 0095 adopted it, which is item 192''s defect verbatim: two availability rows' ||
    chr(10) || '  -- can share provider+date+start_time with different end_times, and' ||
    chr(10) || '  -- sessions_active_slot_uniq collides on that triple. Do NOT inline the test.' ||
    chr(10) || '  select exists (' ||
    chr(10) || '    select 1' ||
    chr(10) || '    from public.slot_contention(p_provider_id) sc' ||
    chr(10) || '    where not sc.contested' ||
    chr(10) || '  );' ||
    chr(10) || '';
  v_before  text;
  v_after   text;
  v_base    text;
  v_recheck text;
  v_sc      text;
  v_code    text;
  v_sec     boolean;
  v_vol     "char";
  v_cfg     text[];
  v_n       integer;
begin
  -- (0) ⚠️ THIS FILE'S OWN LITERALS, BEFORE THE DATABASE IS READ. If the paste
  -- altered either, every check below would blame the database (item 190; 0089
  -- refused itself over exactly this).
  if length(v_old) <> 308 or md5(v_old) <> '6deef40c23c1260dab7485882ec7b6bf' then
    raise exception '%', '0095: THE OLD-BODY LITERAL IN THIS FILE arrived len ' || length(v_old)
      || ' md5 ' || md5(v_old) || ', expected len 308 md5 6deef40c23c1260dab7485882ec7b6bf. '
      || 'The paste altered it. THE DATABASE IS NOT THE PROBLEM. Re-copy with '
      || 'Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 <file>). Nothing changed.';
  end if;
  if length(v_new) <> 426 or md5(v_new) <> '612e636abf2712ba6ef5445de30f0b23' then
    raise exception '%', '0095: THE NEW-BODY LITERAL IN THIS FILE arrived len ' || length(v_new)
      || ' md5 ' || md5(v_new) || ', expected len 426 md5 612e636abf2712ba6ef5445de30f0b23. '
      || 'Nothing changed.';
  end if;

  if not exists (select 1 from public.schema_migrations where version = '0094') then
    raise exception '0095: apply 0094 first.';
  end if;

  -- (a) EXACTLY ONE SIGNATURE, or create-or-replace adds an overload instead of
  -- replacing, and callers resolve to whichever matches their argument.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_open_availability';
  if v_n <> 1 then
    raise exception '0095: expected exactly one public.has_open_availability; found %. Nothing changed.', v_n;
  end if;

  -- (b) ⚠️ slot_contention MUST EXIST AND MUST STILL KEY CORRECTLY, because the
  -- new body delegates the whole test to it. Matched on normalised whitespace so
  -- 0090's own spacing is not what this depends on.
  select p.prosrc into v_sc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'slot_contention';
  if v_sc is null then
    raise exception '0095: public.slot_contention does not exist, and the new body delegates to it. Apply 0090 first. Nothing changed.';
  end if;
  if not (v_sc ~ 's\.provider_id\s*=\s*a\.provider_id'
      and v_sc ~ 's\.date\s*=\s*a\.date'
      and v_sc ~ 's\.start_time\s*=\s*a\.start_time') then
    raise exception '%', '0095: slot_contention no longer keys on all three of provider_id, date and '
      || 'start_time, so delegating to it would NOT fix the key — it would move the defect. '
      || 'Read 0090''s header. Nothing changed.' || chr(10) || v_sc;
  end if;

  -- (c) THE GATE on the body being replaced. ⚠️ Unlike 0092 this migration
  -- CHANGES the body, so this is the only point at which the old one is proven.
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_before, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_open_availability';
  if v_before <> v_old then
    raise exception '%', '0095: the live has_open_availability body is NOT the one this migration '
      || 'was written from, so replacing it would discard a change nobody has read. '
      || 'THE FIX WAITS AND THE DIFFERENCE IS THE FINDING.'
      || chr(10) || 'live     len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || 'hex: ' || encode(convert_to(v_before, 'UTF8'), 'hex')
      || chr(10) || 'expected len=308 md5=6deef40c23c1260dab7485882ec7b6bf';
  end if;

  -- (d) The properties 0094 left it with. ⚠️ pg_temp must already be there; if
  -- it is not, 0094 has been reverted and item 201's other half is open again.
  if v_sec is not true then
    raise exception '0095: has_open_availability is not SECURITY DEFINER. Read it before replacing. Nothing changed.';
  end if;
  if v_vol <> 's' then
    raise exception '0095: has_open_availability volatility is %, expected s (STABLE). Nothing changed.', v_vol;
  end if;
  if v_cfg is distinct from array['search_path=public, pg_temp'] then
    raise exception '%', '0095: has_open_availability search_path is '
      || coalesce(array_to_string(v_cfg, ','), '(none)')
      || ', expected `public, pg_temp` as 0094 set it. Nothing changed.';
  end if;

  -- (e) THE BASELINE, CAPTURED BEFORE THE CHANGE.
  -- ⚠️⚠️ READ THE NEXT SENTENCE BEFORE TRUSTING THIS. It is a NO-REGRESSION
  -- CHECK AND IT IS NOT PROOF THE KEY FIX WORKS. The old and new keys agree
  -- today only because ZERO overlapping availability pairs exist (item 198,
  -- measured zero on 9 Oct 2026). A key fix is INVISIBLE to this baseline by
  -- construction: the data that would separate the two answers is absent. The
  -- post-condition that proves the fix is the STRUCTURAL one at (g).
  select string_agg(pr.id::text || '=' || coalesce(public.has_open_availability(pr.id)::text, 'null'),
                    ',' order by pr.id::text)
    into v_base from public.providers pr;

  -- ── THE CHANGE ──────────────────────────────────────────────────────────
  -- ⚠️ Built from v_new, so the body exists ONCE in this file and a paste cannot
  -- alter it. search_path and the rest restated explicitly: create-or-replace
  -- does NOT inherit them, it rewrites the whole header.
  execute format(
    'create or replace function public.has_open_availability(p_provider_id uuid) '
    'returns boolean language sql stable security definer '
    'set search_path to %s as $f$%s$f$',
    'public, pg_temp', v_new);

  -- (f) WHAT WAS WRITTEN IS WHAT WAS INTENDED.
  select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
    into v_after, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_open_availability';
  if v_after <> v_new then
    raise exception '%', '0095: the stored body is not the one this migration built. Rolled back.'
      || chr(10) || 'stored len=' || length(v_after) || ' md5=' || md5(v_after)
      || chr(10) || 'hex: ' || encode(convert_to(v_after, 'UTF8'), 'hex');
  end if;
  if v_sec is not true or v_vol <> 's'
     or v_cfg is distinct from array['search_path=public, pg_temp'] then
    raise exception '%', '0095: a property moved — definer=' || v_sec::text
      || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || '. Expected definer, stable, `public, pg_temp`. Rolled back.';
  end if;

  -- (g) ⚠️⚠️ THE POST-CONDITION THAT ACTUALLY PROVES THE FIX. Structural,
  -- because the baseline cannot see a key change (see (e)).
  --   * the wrong key is GONE from this body, and
  --   * the right key is reachable, because the body delegates to the object
  --     whose key was asserted at (b).
  -- ⚠⚠ COMMENTS STRIPPED FIRST, AND THE FIRST DRAFT OF THIS CHECK PROVED WHY.
  -- The new body's own comment contains the words `availability_id`, so a plain
  -- test for that string always matches. The draft exempted the comment with
  -- `and v_after not like '%read availability_id until%'` — which means a REAL
  -- availability_id reference added later, with the comment still present, would
  -- have PASSED. **A check that cannot fail in the one direction it exists for**,
  -- item 188, inside the post-condition of a migration about a wrong key.
  --
  -- ✅ `regexp_replace(… '--[^newline]*' …)` removes every line comment, the same
  -- normalisation 0086's verify uses on pg_get_functiondef. The test then reads
  -- CODE, which is the only thing that can contain a key.
  v_code := regexp_replace(v_after, '--[^' || chr(10) || ']*', '', 'g');

  if v_code like '%availability_id%' then
    raise exception '%', '0095: the new body''s CODE still references availability_id. That is the '
      || 'defect this migration exists to remove. Rolled back.' || chr(10) || v_code;
  end if;
  if v_code not like '%public.slot_contention(p_provider_id)%' then
    raise exception '0095: the new body does not delegate to public.slot_contention, so the key is not owned in one place. Rolled back.';
  end if;
  -- And no unqualified relation name survives — item 201's half. Every relation
  -- the body touches is now reached through a schema-qualified function call.
  -- ⚠️ `\y` (word boundary) not `\s`, so a name at the very end of the body with
  -- no trailing whitespace is still caught.
  if v_code ~ '\sfrom\s+(availability|sessions)\y' then
    raise exception '%', '0095: the new body still names a relation without its schema, which is '
      || 'item 201. Rolled back.' || chr(10) || v_code;
  end if;

  -- (h) THE NO-REGRESSION CHECK. ⚠️ Expected to pass and expected to prove
  -- little: see (e). It earns its place by catching a REGRESSION — a delegation
  -- that returned the wrong answer on data that exists today.
  select string_agg(pr.id::text || '=' || coalesce(public.has_open_availability(pr.id)::text, 'null'),
                    ',' order by pr.id::text)
    into v_recheck from public.providers pr;
  if v_recheck is distinct from v_base then
    raise exception '%', '0095: the answer CHANGED for at least one provider on today''s data. '
      || '⚠️ With zero overlapping availability pairs (item 198) the two keys cannot disagree, so '
      || 'this is a REGRESSION in the delegation, not the key fix showing itself. Rolled back.'
      || chr(10) || 'before: ' || coalesce(v_base, '(none)')
      || chr(10) || 'after:  ' || coalesce(v_recheck, '(none)');
  end if;
end $mig$;

comment on function public.has_open_availability(uuid) is
  'Whether a stylist has any future availability row that no pending/accepted session contests. '
  '⚠️ IT DELEGATES THE WHOLE TEST TO slot_contention (0090) AND MUST KEEP DOING SO. It keyed on '
  'availability_id until 0095 — item 192''s defect verbatim: two availability rows can share '
  'provider+date+start_time with different end_times, sessions_active_slot_uniq collides on that '
  'triple, so a session on one row makes the other unbookable while an availability_id test calls '
  'it free. ⚠️ DO NOT INLINE THE TEST to remove the dependency; four implementations of "is this '
  'slot bookable" is how the keys diverged. ⚠️ AND THIS IS NOT THE BOOKING PATH: it does NOT filter '
  'is_taken and does NOT exclude slots whose start time has passed. site/lib/queries/slots.ts '
  '(item 186) applies all four filters and is authoritative; this answers a coarser question for a '
  'screen badge. Adopted and fixed by 0095, items 201 and 192.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0095', 'the_second_answer_to_is_this_slot_free_stops_disagreeing', '43bed59e29e240a63c6a5cdccc7ba90a265ffc70cc747aa77af9adf95113a63d');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — `preflight0095.sql`, run 9 Oct 2026 AFTER 0094.
--
--   MEASURED: definer=true, volatility=s, config=search_path=public, pg_temp ·
--   308 chars, md5 6deef40c23c1260dab7485882ec7b6bf, CR=13, LF=13, opens 0d0a,
--   closes 293b0d0a · 1 signature · EXECUTE to postgres, authenticated,
--   service_role only — NOT PUBLIC, NOT anon · baseline rows (h) and the
--   schema-qualified restatement (i) AGREE for all three providers · 0 definer
--   functions in public still lacking pg_temp.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ NO IMPERSONATION. Catalogue reads and one aggregate, identical for every
-- identity.
--
-- ⚠️⚠️ AND EVERY NUMBER BELOW IS MEASURED IN THIS BLOCK, with line 6 saying
-- outright when 0095 is not applied rather than describing what it would have
-- done. Item 188's ninth instance was 0094's info line doing exactly that.
--
--   do $$
--   declare
--     r_body text := 'not run';
--     r_key  text := 'not run';
--     r_qual text := 'not run';
--     r_dele text := 'not run';
--     r_prop text := 'not run';
--     r_appl text := 'not run';
--     v_src  text;
--     v_sc   text;
--     v_code text;
--     v_sec  boolean;
--     v_vol  "char";
--     v_cfg  text[];
--   begin
--     select p.prosrc, p.prosecdef, p.provolatile, p.proconfig
--       into v_src, v_sec, v_vol, v_cfg
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'has_open_availability';
--
--     r_body := case when v_src is null then 'FAIL  - has_open_availability is missing'
--                    when length(v_src) = 426 and md5(v_src) = '612e636abf2712ba6ef5445de30f0b23'
--                      then 'pass  - body is 0095''s, len 426 md5 612e636a…'
--                    else 'FAIL  - body is len ' || length(v_src) || ' md5 ' || md5(v_src) end;
--
--     -- ⚠⚠ COMMENTS STRIPPED BEFORE EITHER TEST. The body's own comment contains
--     -- the words `availability_id` and `availability`, so testing the raw source
--     -- either always matches or needs an exemption — and an exemption is what
--     -- makes a check unable to fail. Same normalisation as 0086's verify.
--     v_code := regexp_replace(coalesce(v_src, ''), '--[^' || chr(10) || ']*', '', 'g');
--
--     -- ⚠️ THE ONE THAT PROVES THE FIX. The baseline cannot: with zero
--     -- overlapping availability pairs the two keys give the same answers.
--     r_key := case when v_src is null then 'FAIL  - missing'
--                   when v_code like '%availability_id%'
--                     then 'FAIL  - the CODE still references availability_id (item 192)'
--                   else 'pass  - no availability_id anywhere in the code' end;
--
--     r_qual := case when v_src is null then 'FAIL  - missing'
--                    when v_code ~ '\sfrom\s+(availability|sessions)\y'
--                      then 'FAIL  - still names a relation without its schema (item 201)'
--                    else 'pass  - no unqualified relation name' end;
--
--     -- ⚠️ DELEGATION IS CHECKED AT BOTH ENDS. That this body calls
--     -- slot_contention is worth nothing if slot_contention's own key has moved.
--     select p.prosrc into v_sc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'slot_contention';
--     r_dele := case
--       when v_src is null or v_code not like '%public.slot_contention(p_provider_id)%'
--         then 'FAIL  - the body does not delegate to slot_contention'
--       when v_sc is null then 'FAIL  - slot_contention is gone; this function cannot run'
--       when v_sc ~ 's\.provider_id\s*=\s*a\.provider_id' and v_sc ~ 's\.date\s*=\s*a\.date'
--            and v_sc ~ 's\.start_time\s*=\s*a\.start_time'
--         then 'pass  - delegates to slot_contention, which keys on all three columns'
--       else 'FAIL  - slot_contention no longer keys on provider_id, date and start_time' end;
--
--     r_prop := case when v_sec and v_vol = 's'
--                     and v_cfg is not distinct from array['search_path=public, pg_temp']
--                    then 'pass  - definer, stable, search_path = public, pg_temp'
--                    else 'FAIL  - definer=' || coalesce(v_sec::text, 'null')
--                         || ' volatility=' || coalesce(v_vol::text, 'null')
--                         || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)') end;
--
--     r_appl := case when exists (select 1 from public.schema_migrations where version = '0095')
--                    then 'info  - 0095 IS applied'
--                    else '⚠️ 0095 has NOT been applied (no row in schema_migrations). '
--                         || 'Nothing above describes a change that has happened.' end;
--
--     raise exception '%',
--       chr(10) || '=== 0095 VERIFY ==='
--       || chr(10) || '1  body is 0095''s         : ' || r_body
--       || chr(10) || '2  THE KEY, wrong one gone : ' || r_key
--       || chr(10) || '3  relations qualified     : ' || r_qual
--       || chr(10) || '4  delegation, both ends   : ' || r_dele
--       || chr(10) || '5  properties              : ' || r_prop
--       || chr(10) || '6  applied?                : ' || r_appl;
--   end $$;
--
--   EXPECT: 1-5 pass, 6 reports applied.
--
--   ⚠️ LINE 2 IS THE ONE THAT MATTERS AND NO BASELINE CAN REPLACE IT. The old
--   and new keys return identical answers on today's data, because zero
--   overlapping availability pairs exist (item 198). The fix is only visible
--   structurally until such a pair is created.
--
--   ⚠️ The block ends in `raise exception` so it rolls back, but it WRITES
--   NOTHING — the raise is only how a DO block returns text.
-- ===========================================================================

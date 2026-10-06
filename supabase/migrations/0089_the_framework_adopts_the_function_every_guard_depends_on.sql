-- ===========================================================================
-- 0089_the_framework_adopts_the_function_every_guard_depends_on
--
-- Two parts, both out of item 149. ⚠️ NEITHER FIXES A HOLE.
--
--   1. `revoke_verification` gets errcodes on its two raises.
--   2. `public.is_admin()` is ADOPTED into the migration framework, verbatim.
--
-- ⚠️ Apply 0088 first.
--
-- ── 149 CLOSED WITH NO HOLE, AND THAT IS THE FINDING ───────────────────────
-- All four admin DEFINER RPCs — `revoke_verification`, `admin_act_on_user`,
-- `admin_act_on_report`, `admin_act_on_provider` — check `is_admin()` as their
-- FIRST statement, before every read and every write. Their DECLARE blocks run
-- no queries, which was the subtle way this could have failed, since DECLARE
-- initialisers execute before `begin` and therefore before the guard. Confirmed
-- against the live bodies 6 Oct 2026.
--
-- **This migration is not a repair.** It removes a fragile shape and gives the
-- framework ownership of an object it never had. Recorded plainly because a
-- reader a year from now will otherwise assume a migration in this ledger fixed
-- something that was broken.
--
-- ═══════════════ PART 1 — TWO ERRCODES ON revoke_verification ══════════════
--
-- It raises `'revoke_verification is admin-only'` and `'… needs a reason of at
-- least 10 characters'` with NO `using errcode`, so both arrive as **P0001**.
-- Its three siblings use **42501** for admin-only, and
-- `_admin_apply_user_action` uses **22023** for the identical ten-character
-- reason rule (0062:123-125, and again at :144-147 and :199-203 for the message
-- version). So this function is the odd one of four.
--
-- ⚠️ AND IT BUYS NOTHING VISIBLE TODAY. BE CLEAR ABOUT THAT.
-- `adminErrorText` (admin/lib/adminActions.ts:98) branches on `CV002` and
-- otherwise falls through to `humanError(error.message)`. Nothing in any client
-- reads these codes. **This removes a fragile shape rather than fixing a present
-- bug:** a client that needs to tell "not an admin" from "reason too short" can
-- now branch on a code instead of matching prose, which is what
-- `site/app/(app)/shop/actions.ts` already has to do for a different guard and
-- already knows is brittle. No client change ships with this, and none is owed.
--
-- ⚠️ NO SECOND is_admin() GUARD, AND THE ARGUMENT FOR ONE DOES NOT SURVIVE
-- LOOKING AT WHY THE OTHER THREE HAVE ONE. Micky, 6 Oct 2026:
--
--   *"Their second check isn't depth, it's _admin_apply_user_action protecting
--    ITSELF from a future caller that forgets — 0039's comment says exactly
--    that. revoke_verification calls no such function, so a second is_admin() in
--    the same body would be the same check twice in the same place, and it
--    protects against nothing that the first one doesn't."*
--
-- The shared destructive helper it DOES call, `_withdraw_stylist`, is already
-- `revoke all … from public, anon, authenticated`. The protection is there. A
-- second call would look like depth and be theatre, and this record has spent
-- two days removing that. The test that would change the decision — a concrete
-- path where the first guard is bypassed and a second in the same body catches
-- it — neither of us can construct.
--
-- ═══════════════ PART 2 — ADOPTING is_admin() ══════════════════════════════
--
-- `public.is_admin()` exists ONLY in `schema-snapshot-2026-08-08.sql`. No
-- migration has ever created or replaced it. **So nothing in the repo asserts
-- the shape of the one function all four admin entry points depend on** — nor
-- the RLS policies on `users`, `providers` and others that call it.
--
-- This migration creates it verbatim from the LIVE body, so the repo adopts what
-- is actually running. ⚠️ Written from `pg_get_functiondef`, NOT from the
-- snapshot: if the two had drifted, writing from the snapshot would quietly
-- change behaviour on the highest-leverage object in the schema, which is the
-- exact failure the refusal below exists to catch.
--
-- ✅ CROSS-CHECK AGAINST THE SNAPSHOT, 6 Oct 2026: THE SQL IS IDENTICAL. The
-- snapshot differs only in whitespace — it collapses the header onto one line
-- and indents the body two spaces where the live object indents six. **Not
-- drift, not a behaviour difference, not item 158's territory.** It is how the
-- snapshot was written down.
--
-- ⚠️⚠️ WHY A REFUSAL AND NOT A WARNING. `is_admin()` is called by RLS policies
-- as well as by the four RPCs. `create or replace` preserves oid, owner and ACL,
-- so policies keep working — which also means that if the body DID differ and
-- this replaced it, EVERY POLICY'S BEHAVIOUR WOULD CHANGE AT ONCE, in one
-- statement, with no deploy and nothing to notice. There is no safe version of
-- "probably the same".
--
-- ── ⚠️ WHY THE COMPARISON IS ON prosrc AND NOT ON THE MIGRATION'S OWN TEXT ──
-- The instruction was to compare the live body against the snapshot character by
-- character before writing. **That comparison is unsound and would have proved
-- nothing.** `pg_get_functiondef` NORMALISES: it regenerates the header from
-- catalogue columns, emitting `LANGUAGE sql`, `AS $function$` and its own
-- layout. SQL written by hand will never be byte-identical to it even when the
-- behaviour is identical, so a hand comparison fails on formatting.
--
-- **`prosrc` is the only text stored verbatim** — everything between
-- `as $function$` and `$function$`. So that is what is compared, against an
-- explicit expected value, BEFORE the replace and AGAIN after it. Same string
-- both times, so a difference is a real difference.
--
-- ⚠️ WHICH IS WHY THE SIX-SPACE INDENTATION BELOW IS LOAD-BEARING AND MUST NOT
-- BE TIDIED. The live `prosrc` is a newline, six spaces, the select, a newline,
-- six spaces. Re-indent it and this migration refuses itself.
--
-- ── ⚠️ SET search_path TO 'public' — NO pg_temp, AND WHY THAT IS SAFE HERE ──
-- House style for a DEFINER function is `public, pg_temp`. This one pins only
-- `public`, and it is adopted that way because an adoption that changes
-- something is not an adoption.
--
-- It is safe **only because the single relation reference is schema-qualified**:
-- `public.admins`. With `pg_temp` absent from the path the temporary schema is
-- searched first for relations, so an unqualified `admins` could be shadowed by
-- a caller's own temp table — in a SECURITY DEFINER function that decides who
-- is an admin. ⚠️ **So the qualification is the guard, not the search_path.**
-- Anyone editing this body to say `admins` instead of `public.admins` opens
-- exactly that, and the body is two lines long, which is how it would happen.
--
-- ── ⚠⚠ THIS MIGRATION REFUSED ITSELF ON ITS FIRST RUN, 6 Oct 2026 ──────
-- `0089: ADOPTION CHANGED THE BODY. Rolled back.` Nothing applied. **The guard
-- was right and the implementation had the flaw the guard exists to catch.**
--
-- The body was written TWICE: once as the expected literal, once as literal SQL
-- inside the DDL. Preflight (c) returned true, so live prosrc DID equal the
-- expected literal — therefore the DDL was producing something else, and the two
-- copies had diverged in whitespace.
--
-- ⚠⚠ AND THE LIKELY CAUSE IS NOT IN THE FILE. The file is LF-only on disk and a
-- byte comparison of the two copies there MATCHED. What differs is what reaches
-- the DATABASE: `v_want` is built from `chr(10)` and is LF whatever happens to
-- the paste, while a literal multi-line body carries whatever newlines the
-- clipboard and the SQL editor deliver. **A paste that converts LF to CRLF makes
-- the two copies differ even though the file is correct.** Stated as the probable
-- cause rather than the proven one — the first refusal printed no lengths, no
-- md5 and no hex, so it could not say. It can now.
--
-- ⚠⚠ THE GENERAL FORM, WHICH OUTLIVES THIS MIGRATION: ANY migration that
-- creates a function whose body must match an exact string is exposed to
-- paste-time line-ending conversion. Build the body from `chr(10)` and pass it
-- through `format()`. Never write it as literal multi-line SQL and then compare
-- it against a constructed string — that is two sources of truth for one value,
-- and only one of them survives a clipboard.
--
-- ⚠️ THE BODY TEXT APPEARS THREE TIMES IN THIS FILE AND THAT IS CORRECT: once
-- in `v_want`, which is the only LIVE copy and the one the DDL is built from,
-- and once each in the PREFLIGHT and VERIFY blocks below. Those two are separate
-- pasteable blocks that cannot reference `v_want`, so a copy there is
-- unavoidable — but all three are built with `chr(10)`, so none of them carries
-- a literal newline, and a drift between them surfaces as a LOUD false mismatch
-- in the preflight rather than as a silent pass.
--
-- ── ⚠⚠ ONE FAULT CAUGHT IN THIS MIGRATION'S OWN DRAFT — IT IS ITEM 188's ──
-- Three property checks below were written `not (v_cfg @> array['search_path=
-- public'])`. **`NULL @> x` IS NULL AND `not NULL` IS NULL, SO THE `if` NEVER
-- FIRES** — the check for a MISSING search_path could not fire on the one case
-- where it is actually missing, which is `proconfig IS NULL`. A check that
-- cannot fail, in the migration that cites item 188 for precisely that class.
-- Coalesced to '{}'.
--
-- Named here and not only in the item because the next person reading these
-- blocks will copy them, and `@>` against a nullable array is the trap.
--
-- ── NO DEPLOY, NO TYPES, NO CLIENT CHANGE ──────────────────────────────────
-- Both signatures are unchanged and `create or replace` preserves grants, so
-- there is nothing to regenerate and nothing to ship. Unusual enough in this
-- ledger to say out loud rather than leave the reader looking for the step.
-- ===========================================================================
begin;

-- ═══════════════════════════ PART 1 ═══════════════════════════════════════
do $mig$
declare
  v_def   text;
  v_code  text;
  v_n1    integer;
  v_n2    integer;
  v_a1    text := 'raise exception ''revoke_verification is admin-only'';';
  v_a2    text := 'raise exception ''revoke_verification needs a reason of at least 10 characters'';';
begin
  if not exists (select 1 from public.schema_migrations where version = '0088') then
    raise exception '0089: apply 0088 first.';
  end if;

  if to_regprocedure('public.revoke_verification(uuid, text, text)') is null then
    raise exception '0089: public.revoke_verification(uuid, text, text) does not exist. Apply 0057 first. Nothing changed.';
  end if;

  v_def := pg_get_functiondef('public.revoke_verification(uuid, text, text)'::regprocedure);

  -- ⚠️ STRIP COMMENTS BEFORE COUNTING. pg_get_functiondef returns the body's
  -- own `--` comments, and matching prose instead of code is 0028's fault
  -- (recorded in scripts/migration-status.mjs). Neither anchor appears in a
  -- comment in this body, checked by eye 6 Oct 2026 — the strip is so that
  -- stays true if someone adds one.
  v_code := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  -- ⚠️ OCCURRENCE COUNTS, NOT position() OR LIKE. position() reads "absent" and
  -- "below" identically — the two-worlds flaw Micky caught in 0083 — and a LIKE
  -- pattern assuming one space before a token is how a probe returned a false
  -- negative against column-aligned assignments the same night (item 188).
  v_n1 := (length(v_code) - length(replace(v_code, v_a1, ''))) / length(v_a1);
  v_n2 := (length(v_code) - length(replace(v_code, v_a2, ''))) / length(v_a2);

  if v_n1 <> 1 or v_n2 <> 1 then
    raise exception '%', '0089: the live revoke_verification body is not the one this migration was written from. '
      || 'Expected each un-coded raise exactly once in CODE; found admin-only=' || v_n1
      || ' reason-length=' || v_n2 || '. Read the live body before applying. Nothing changed.';
  end if;
end $mig$;

create or replace function public.revoke_verification(
  p_user_id uuid,
  p_reason  text,
  p_message text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin     uuid := auth.uid();
  v_withdrawn jsonb;
  v_cancelled int;
  v_msg       text := nullif(btrim(coalesce(p_message, '')), '');
  v_body      text;
begin
  -- 0089: 42501, matching its three siblings. Was uncoded (P0001), so a client
  -- had to match prose to tell this from the reason-length refusal below.
  if not public.is_admin() then
    raise exception 'revoke_verification is admin-only' using errcode = '42501';
  end if;

  -- A reason is mandatory and is not a formality: this removes someone's
  -- ability to trade, and "an admin decided to" is not a record.
  -- 0089: 22023, the code _admin_apply_user_action already uses for this exact
  -- rule (0062). The same rule reported two different ways was the fragile part.
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'revoke_verification needs a reason of at least 10 characters'
      using errcode = '22023';
  end if;

  -- Clear verification. trg_unpublish_on_verification_lost unpublishes as a
  -- consequence, so this cannot leave a published-but-unverified shop.
  update public.users set is_verified = false where id = p_user_id;

  -- Let them resubmit: with no verification_requests row, /verify already
  -- offers the submit path. No new surface needed.
  delete from public.verification_requests where user_id = p_user_id;

  -- Cancel future bookings, and tell each model. NO OVERRIDE, on purpose:
  -- cancel wrongly and somebody rebooks; leave one standing wrongly and
  -- somebody meets a person we have just decided we cannot vouch for.
  v_withdrawn := public._withdraw_stylist(p_user_id);
  v_cancelled := coalesce((v_withdrawn->>'cancelled_bookings')::int, 0);

  -- ── AND TELL HER. Item 117. ────────────────────────────────────────────
  --
  -- Written to be readable by the person it happened to: what changed, what
  -- it did to her shop and her diary, what she can do next, and where to
  -- argue. The admin's MESSAGE appears if there is one; the admin's REASON
  -- never does.
  v_body :=
    'Your ID check has been removed, so your shop is hidden and isn''t taking '
    || 'new bookings.';

  if v_cancelled > 0 then
    v_body := v_body || chr(10) || chr(10)
      || case when v_cancelled = 1
              then 'One upcoming booking has been cancelled and the model has been told.'
              else v_cancelled || ' upcoming bookings have been cancelled and those models have been told.'
         end
      -- She should know what they were told, because they will ask her.
      || ' They were told the booking is off and that it was our decision, not yours.';
  end if;

  if v_msg is not null then
    v_body := v_body || chr(10) || chr(10) || v_msg;
  end if;

  v_body := v_body || chr(10) || chr(10)
    || 'You can do the ID check again whenever you''re ready — it''s under Verify. '
    || 'Your shop, treatments and times are all still there.'
    || chr(10) || chr(10)
    || 'If you think this is wrong, reply to this email or write to '
    || 'support@cavybeauty.com.';

  insert into public.notifications (user_id, type, title, body)
  values (p_user_id, 'verification', 'Your ID check has been removed', v_body);

  -- The audit row, last, so it records what actually happened.
  insert into public.moderation_actions (admin_id, target_user_id, action, reason)
  values (v_admin, p_user_id, 'revoke_verification', btrim(p_reason));

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'cancelled_bookings', v_cancelled,
    'message_sent', v_msg is not null
  );
end $$;

comment on function public.revoke_verification(uuid, text, text) is
  'Admin-only. Clears users.is_verified, unpublishes via '
  'trg_unpublish_on_verification_lost, deletes the verification_requests row so the '
  'account can resubmit, cancels every future pending/accepted booking with a '
  'notification to each model (via _withdraw_stylist since 0044, shared with suspend '
  'and ban), TELLS THE STYLIST (0057, item 117), and records a moderation_actions row. '
  'One transaction: a failure anywhere leaves none of it done. TWO TEXT FIELDS WITH '
  'DIFFERENT AUDIENCES: p_reason is mandatory moderation evidence, kept six years, seen '
  'only by admins and NEVER shown to anyone; p_message is optional, written for the '
  'stylist, and is the only part she reads. Do not merge them — a reason may name the '
  'person who reported her. There is deliberately no "keep the bookings" option. '
  'ERRCODES SINCE 0089: 42501 not an admin, 22023 reason shorter than 10 characters — '
  'the same codes its three sibling admin RPCs use, so a client need not match prose. '
  'ONE is_admin() CHECK ON PURPOSE (0089): its siblings get a second from '
  '_admin_apply_user_action, which guards ITSELF against a forgetful caller; this '
  'function calls no such thing, so a second check here would be the same check twice.';

-- ═══════════════════════════ PART 2 ═══════════════════════════════════════
-- ONE DO BLOCK, WITH THE DDL INSIDE IT, so the expected body is written ONCE.
-- Two blocks would need the same literal typed twice and could drift apart —
-- and a drifted expectation in a before/after comparison is a check that passes
-- for the wrong reason (item 188). 0084 set the precedent for DDL inside a
-- guarding DO block.
do $mig$
declare
  -- ⚠️ THE LIVE prosrc, EXACTLY. Newline, six spaces, the select, newline, six
  -- spaces. Built from chr(10) rather than written as a multi-line literal so
  -- the whitespace is explicit and cannot be "tidied" by an editor.
  v_want   text := chr(10)
    || '      select exists (select 1 from public.admins where user_id = auth.uid());'
    || chr(10) || '      ';
  v_before text;
  v_after  text;
  v_dbefore text;
  v_dafter  text;
  v_n      integer;
  v_sec    boolean;
  v_vol    "char";
  v_cfg    text[];
begin
  -- EXACTLY ONE SIGNATURE. An overload would make every read below ambiguous
  -- and the replace would create a second function rather than adopt the first.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_admin';
  if v_n <> 1 then
    raise exception '%', '0089: expected exactly one public.is_admin; found ' || v_n
      || '. An overload changes what every RLS policy and admin RPC resolves to. Nothing changed.';
  end if;

  select p.prosrc, pg_get_functiondef(p.oid), p.prosecdef, p.provolatile, p.proconfig
    into v_before, v_dbefore, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_admin';

  -- ⚠️ THE GATE. If the live body is not the one this migration was written
  -- from, the adoption WAITS and the difference is the finding.
  if v_before <> v_want then
    raise exception '%', '0089: the live public.is_admin() body is NOT what this migration was written '
      || 'from, so adopting it would CHANGE the function every RLS policy and all four admin RPCs '
      || 'depend on. THE ADOPTION WAITS AND THE DIFFERENCE IS THE FINDING.'
      || chr(10) || chr(10) || 'live     len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || '>>>' || v_before || '<<<'
      || chr(10) || 'hex: ' || encode(convert_to(v_before, 'UTF8'), 'hex')
      || chr(10) || chr(10) || 'expected len=' || length(v_want) || ' md5=' || md5(v_want)
      || chr(10) || '>>>' || v_want || '<<<'
      || chr(10) || 'hex: ' || encode(convert_to(v_want, 'UTF8'), 'hex');
  end if;

  if not v_sec or v_vol <> 's' or not (coalesce(v_cfg, '{}'::text[]) @> array['search_path=public']) then
    raise exception '%', '0089: live is_admin() has the right body but not the right properties — '
      || 'security_definer=' || v_sec::text || ' volatility=' || v_vol::text
      || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || '. Expected definer, stable, search_path=public. Nothing changed.';
  end if;

  -- ⚠️⚠️ THE DDL IS BUILT FROM v_want, SO THE BODY EXISTS ONCE IN THIS FILE.
  -- An earlier version wrote the body a second time as literal SQL and compared
  -- it against v_want. THEY DIVERGED AND THE MIGRATION REFUSED ITSELF — see the
  -- header. The single-copy argument was already written four lines above this
  -- one, applied to the COMPARISON and not to the DDL, and the gap between them
  -- is exactly where it failed.
  --
  -- %L quotes 'public' as a literal; %s inserts the body raw. The body contains
  -- no dollar-quote sequence, so $f$ cannot collide with it.
  execute format(
    'create or replace function public.is_admin() returns boolean '
    'language sql stable security definer set search_path to %L '
    'as $f$%s$f$',
    'public', v_want);

  select p.prosrc, pg_get_functiondef(p.oid), p.prosecdef, p.provolatile, p.proconfig
    into v_after, v_dafter, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_admin';

  -- BEFORE vs AFTER, same normaliser on both sides. prosrc is the stored text;
  -- pg_get_functiondef also catches a header change the body comparison cannot.
  -- ⚠️⚠️ THE DIAGNOSTICS ARE THE POINT OF THIS MESSAGE, NOT THE STRINGS.
  -- The first version printed only the two delimited bodies. It fired correctly
  -- on a real difference and then RENDERED THE TWO AS IDENTICAL, because the
  -- difference was invisible whitespace — unactionable, and item 188's class one
  -- step along: a check that fails informatively to itself and opaquely to its
  -- reader. length and md5 say THAT they differ; the hex says HOW, which for a
  -- stray 0d or a missing 0a is the only form anyone can act on.
  if v_after <> v_before then
    raise exception '%', '0089: ADOPTION CHANGED THE BODY. Rolled back.'
      || chr(10) || 'before len=' || length(v_before) || ' md5=' || md5(v_before)
      || chr(10) || '>>>' || v_before || '<<<'
      || chr(10) || 'hex: ' || encode(convert_to(v_before, 'UTF8'), 'hex')
      || chr(10) || chr(10) || 'after  len=' || length(v_after) || ' md5=' || md5(v_after)
      || chr(10) || '>>>' || v_after || '<<<'
      || chr(10) || 'hex: ' || encode(convert_to(v_after, 'UTF8'), 'hex');
  end if;
  if v_dafter <> v_dbefore then
    raise exception '%', '0089: prosrc matches but the full definition changed. Rolled back.'
      || chr(10) || 'before len=' || length(v_dbefore) || ' md5=' || md5(v_dbefore)
      || chr(10) || v_dbefore
      || chr(10) || chr(10) || 'after  len=' || length(v_dafter) || ' md5=' || md5(v_dafter)
      || chr(10) || v_dafter;
  end if;
  if not v_sec or v_vol <> 's' or not (coalesce(v_cfg, '{}'::text[]) @> array['search_path=public']) then
    raise exception '%', '0089: is_admin() lost a property in the replace — definer=' || v_sec::text
      || ' volatility=' || v_vol::text || ' config=' || coalesce(array_to_string(v_cfg, ','), '(none)')
      || '. Rolled back.';
  end if;
end $mig$;

comment on function public.is_admin() is
  'Is the CALLER an admin? SECURITY DEFINER so public.admins RLS cannot hide a row from it, '
  'STABLE because it is called repeatedly inside single statements by RLS policies. ADOPTED '
  'VERBATIM BY 0089 FROM THE LIVE OBJECT — it predates the migration framework and existed only '
  'in schema-snapshot-2026-08-08.sql, so nothing in the repo asserted the shape of the function '
  'every admin entry point and several RLS policies depend on. 0089 changed NO behaviour: it '
  'compared prosrc before and after and refuses on any difference. ⚠️ search_path pins public '
  'WITHOUT pg_temp, which is safe ONLY because the one relation reference is schema-qualified. '
  'Write `admins` instead of `public.admins` here and a caller''s temp table can shadow it in the '
  'function that decides who is an admin.';

-- ═══════════════════════════ POST-CONDITION ════════════════════════════════
do $mig$
declare
  v_def  text;
  v_code text;
  v_old  integer;
  v_new1 integer;
  v_new2 integer;
  v_sec  boolean;
  v_vol  "char";
  v_cfg  text[];
  v_a1   text := 'raise exception ''revoke_verification is admin-only'';';
  v_n1   text := 'using errcode = ''42501''';
  v_n2   text := 'using errcode = ''22023''';
begin
  select pg_get_functiondef(p.oid), p.prosecdef, p.provolatile, p.proconfig
    into v_def, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'revoke_verification';

  v_code := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');
  v_old  := (length(v_code) - length(replace(v_code, v_a1, ''))) / length(v_a1);
  v_new1 := (length(v_code) - length(replace(v_code, v_n1, ''))) / length(v_n1);
  v_new2 := (length(v_code) - length(replace(v_code, v_n2, ''))) / length(v_n2);

  if v_old <> 0 then
    raise exception '%', '0089: the uncoded admin-only raise is still present ' || v_old
      || ' time(s) in revoke_verification. Rolled back.';
  end if;
  if v_new1 <> 1 or v_new2 <> 1 then
    raise exception '%', '0089: revoke_verification should carry 42501 once and 22023 once; found '
      || v_new1 || ' and ' || v_new2 || '. Rolled back.';
  end if;

  -- ⚠️ A create-or-replace THAT LOST EITHER OF THESE WOULD BE SILENT, and an
  -- INVOKER revoke_verification would be refused by 0088's own grants rather
  -- than doing the admin's work. Micky's addition, 6 Oct 2026.
  if not v_sec then
    raise exception '0089: revoke_verification is no longer SECURITY DEFINER. Rolled back.';
  end if;
  if not (coalesce(v_cfg, '{}'::text[]) @> array['search_path=public']) then
    raise exception '%', '0089: revoke_verification lost its search_path — config is '
      || coalesce(array_to_string(v_cfg, ','), '(none)') || '. Rolled back.';
  end if;

  -- ⚠⚠ VOLATILITY, AND HERE THE REASON IS SHARPER THAN THE PLANNER ONE.
  -- Micky asked for this against is_admin(), where it is ALREADY asserted either
  -- side of the replace: a STABLE function turned VOLATILE is re-evaluated per
  -- row by the RLS policies that call it instead of once, which is silent and
  -- surfaces only as a slowdown nobody traces back to a two-line adoption. The
  -- gap was HERE, in part 1.
  --
  -- And the consequence here is worse than planning: revoke_verification
  -- performs FIVE WRITES. A plpgsql function declared STABLE or IMMUTABLE that
  -- writes is UNDEFINED BEHAVIOUR rather than merely mis-planned, and Postgres
  -- does not reliably refuse it. 0057 declared no volatility, so VOLATILE is
  -- correct and is what this asserts.
  if v_vol <> 'v' then
    raise exception '%', '0089: revoke_verification is no longer VOLATILE (provolatile='
      || v_vol::text || '). It performs five writes, and a non-volatile function that writes '
      || 'is undefined behaviour. Rolled back.';
  end if;

  -- GRANTS MUST BE UNTOUCHED. create-or-replace preserves the ACL; asserted
  -- because "preserves" is a claim about an object this migration rewrote.
  if not has_function_privilege('authenticated',
       'public.revoke_verification(uuid, text, text)'::regprocedure, 'execute') then
    raise exception '0089: authenticated can no longer execute revoke_verification; the admin console is its only caller. Rolled back.';
  end if;
  if has_function_privilege('anon',
       'public.revoke_verification(uuid, text, text)'::regprocedure, 'execute') then
    raise exception '0089: anon can execute revoke_verification. Rolled back.';
  end if;

  -- THE CONTROL: the three siblings must be untouched by a migration that names
  -- none of them, so a pass here cannot be a pass caused by breaking everything.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and p.proname::text in ('admin_act_on_user', 'admin_act_on_report',
                                 'admin_act_on_provider')) <> 3 then
    raise exception '0089: one of the three sibling admin RPCs is missing or is no longer DEFINER. This migration names none of them. Rolled back.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0089', 'the_framework_adopts_the_function_every_guard_depends_on', '7465ac3eeba8ae46e02c2538301403bd7bc5dd9e1ea4b8b00357bb9e1e3f676d');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN BEFORE THIS MIGRATION. Read-only, one block.
--
-- ⚠️ OWNERSHIP IS THE FIRST ROW ON PURPOSE. `create or replace function`
-- requires OWNING the function. Both of these predate the framework and their
-- owner is not visible from the repo. A replace that cannot succeed must fail
-- HERE, before anything else happens, rather than partway through.
--
--   select 'a. ownership' as part,
--          p.proname::text as subject,
--          'owner=' || pg_get_userbyid(p.proowner)
--       || ' | current_user=' || current_user
--       || ' | may replace=' || (pg_get_userbyid(p.proowner) = current_user
--                                or pg_has_role(current_user, p.proowner, 'USAGE'))::text as detail
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname::text in ('is_admin', 'revoke_verification')
--   union all
--   select 'b. is_admin body', 'prosrc between markers',
--          '>>>' || (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                     where n.nspname = 'public' and p.proname = 'is_admin') || '<<<'
--   union all
--   select 'c. is_admin body', 'matches what 0089 was written from',
--          ((select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'public' and p.proname = 'is_admin')
--           = chr(10) || '      select exists (select 1 from public.admins where user_id = auth.uid());'
--             || chr(10) || '      ')::text
--   union all
--   select 'd. is_admin', 'signatures (expect 1)',
--          (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname = 'is_admin')
--   union all
--   select 'e. revoke_verification', 'uncoded raises in CODE (expect 1 and 1)',
--          (with d as (select regexp_replace(
--                        pg_get_functiondef('public.revoke_verification(uuid, text, text)'::regprocedure),
--                        '--[^' || chr(10) || ']*', '', 'g') as c)
--           select ((length(c) - length(replace(c, 'raise exception ''revoke_verification is admin-only'';', ''))) /
--                    length('raise exception ''revoke_verification is admin-only'';'))::text
--               || ' and '
--               || ((length(c) - length(replace(c, 'raise exception ''revoke_verification needs a reason of at least 10 characters'';', ''))) /
--                    length('raise exception ''revoke_verification needs a reason of at least 10 characters'';'))::text
--             from d)
--   union all
--   select 'f. gate', '0088 applied',
--          ((select count(*) from public.schema_migrations where version = '0088') = 1)::text
--    order by 1, 2;
--
--   EXPECT: (a) may replace=true for BOTH · (b) the body, for your own eyes ·
--           (c) true · (d) 1 · (e) 1 and 1 · (f) true.
--
--   ⚠️ IF (c) IS FALSE, STOP AND DO NOT APPLY. The migration refuses anyway and
--   prints both strings, but the adoption waits either way and the difference is
--   a finding in its own right. (b) is printed so a false (c) can be read rather
--   than guessed at.
--
--   ⚠️ IF (a) SAYS false FOR EITHER, nothing in this migration can work. That is
--   a question about who owns pre-0000 objects, not about this change.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Rolls itself back. ─────────────────
--
-- Results accumulate into variables and are emitted by the final raise: the
-- Supabase SQL editor does not display NOTICE (item 188). Every line starts at
-- 'not run' so a block that dies early says so.
--
-- ⚠️ IT RUNS revoke_verification FOR REAL, AS AN ADMIN, AGAINST THE PROVIDER
-- TEST ACCOUNT, AND ROLLS BACK. Put YOUR admin id in v_admin — in the SQL
-- editor auth.uid() is NULL, so is_admin() is false and an admin-only function
-- refuses the owner of the database (0057's own correction, 24 Sep 2026).
--
--   do $$
--   declare
--     v_admin   uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_stylist uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     r_adm  text := 'not run';
--     r_rsn  text := 'not run';
--     r_ok   text := 'not run';
--     r_body text := 'not run';
--     r_sib  text := 'not run';
--     v_n    integer;
--   begin
--     -- 1. is_admin() ADOPTED WITHOUT CHANGE. The migration asserted this; this
--     --    is the record, read from the catalogue rather than from the ledger.
--     select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'is_admin'
--        and p.prosecdef and p.provolatile = 's'
--        and p.proconfig @> array['search_path=public']
--        and p.prosrc = chr(10) || '      select exists (select 1 from public.admins where user_id = auth.uid());'
--                       || chr(10) || '      ';
--     r_body := case when v_n = 1 then 'pass  - body, definer, stable and search_path all as adopted'
--                    else 'FAIL  - is_admin() is not the adopted shape' end;
--
--     -- 2. NOT AN ADMIN -> 42501, which is the point of part 1.
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_stylist, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     begin
--       perform public.revoke_verification(v_stylist, 'a reason long enough to pass the length rule');
--       r_adm := 'FAIL  - a NON-ADMIN was allowed to revoke verification';
--     exception when insufficient_privilege then r_adm := 'pass  - non-admin refused 42501';
--               when others then
--                 r_adm := 'FAIL  - refused with ' || sqlstate || ', not 42501: ' || sqlerrm;
--     end;
--     execute 'reset role';
--
--     -- 3. AS AN ADMIN: a short reason -> 22023, a good one -> it works.
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     if not public.is_admin() then
--       r_rsn := 'SKIPPED - v_admin is not in public.admins, so 3 and 4 prove nothing';
--       r_ok  := 'SKIPPED - same reason';
--     else
--       begin
--         perform public.revoke_verification(v_stylist, 'too short');
--         r_rsn := 'FAIL  - a 9-character reason was accepted';
--       exception when invalid_parameter_value then r_rsn := 'pass  - short reason refused 22023';
--                 when others then
--                   r_rsn := 'FAIL  - refused with ' || sqlstate || ', not 22023: ' || sqlerrm;
--       end;
--
--       begin
--         perform public.revoke_verification(v_stylist,
--           'VERIFY 0089: a reason of more than ten characters.',
--           'This is the message she reads.');
--         r_ok := 'pass  - a valid admin call still works end to end';
--       exception when others then
--         r_ok := 'FAIL  - a valid admin call broke: ' || sqlstate || ': ' || sqlerrm;
--       end;
--     end if;
--     execute 'reset role';
--
--     -- 4. THE CONTROL. This migration names none of the three siblings.
--     select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prosecdef
--        and p.proname::text in ('admin_act_on_user','admin_act_on_report','admin_act_on_provider');
--     r_sib := v_n || ' of 3 sibling admin RPCs still DEFINER';
--
--     raise exception '%',
--       chr(10) || '=== 0089 VERIFY — ROLLED BACK ON PURPOSE ==='
--       || chr(10) || '1  is_admin() adopted unchanged : ' || r_body
--       || chr(10) || '2  non-admin -> 42501           : ' || r_adm
--       || chr(10) || '3  short reason -> 22023        : ' || r_rsn
--       || chr(10) || '4  valid admin call works       : ' || r_ok
--       || chr(10) || '5  siblings (control)           : ' || r_sib;
--   end $$;
--
--   EXPECT: 1 pass · 2 pass · 3 pass · 4 pass · 5 "3 of 3".
--
--   ⚠️ A "SKIPPED" ON 3 OR 4 MEANS NEITHER WAS TESTED — v_admin was not in
--   public.admins. It is reported rather than raised so 1, 2 and 5 still run,
--   but a skip is not a pass. `select user_id from public.admins;` for the ids.
-- ===========================================================================

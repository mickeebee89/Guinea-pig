-- ===========================================================================
-- 0083_the_approval_notice_joins_the_decision
--
-- Stage E of item 144: the LAST client-side notification insert moves inside
-- the function that made the decision. After this and the admin deploy beside
-- it, no client in any of the three apps writes a `notifications` row — which
-- is the precondition stage F needs before the INSERT policy can be tightened.
--
-- ⚠️ Apply 0082 first.
--
-- ⚠️⚠️ DEPLOY ORDER, same as 0077 and for the same reason. Apply this FIRST,
-- then deploy admin. In the gap the RPC writes the notice AND the console still
-- inserts, so an approved member is told twice and emailed twice. The other
-- order tells them ZERO times, silently. A duplicate is visible and
-- self-correcting; a silent zero is the failure this whole item is about.
--
-- ── WHAT 0077 DEFERRED, AND TO WHAT ────────────────────────────────────────
-- 0077's own header: "The verification APPROVAL notice stays in the client
-- until 0078." 0078 became stage B. The promise pointed at a file about
-- something else, and that is the FIRST of item 155's three instances. This
-- file closes it — a week late, which is the measure of what a deferral naming
-- a number is worth.
--
-- The reason for deferring was real: the body branches on role, on whether each
-- shop is published, and on which of two requirements is missing. It is the
-- only notification copy in this system with actual logic in it. So it becomes
-- its own pure function, which can be tested on made-up input instead of by
-- approving somebody.
--
-- ── ⚠️ THE LIVE BODY IS NOT RETYPED — IT IS OPERATED ON ────────────────────
-- 0077 reproduced create_session_with_consent and admin_decide_verification
-- from their live definitions BY HAND. That is safe exactly once, and it is
-- precisely how a live edit nobody recorded gets silently reverted by the next
-- migration that touches the function.
--
-- So this one retypes nothing. It reads the live admin_decide_verification with
-- pg_get_functiondef, asserts the anchor appears exactly ONCE in the code and
-- never inside a comment, splices ONE line in after it, and executes the
-- result. Whatever is live stays live, byte for byte, apart from the line
-- added. Same technique 0082 used on the reconciler.
--
-- The cost of that is honest and worth stating: THIS FILE CANNOT TELL YOU WHAT
-- THE FUNCTION SAYS. The PREFLIGHT prints the live body's md5 so there is a
-- record of what was operated on, and the post-condition below proves the
-- splice landed rather than assuming it.
--
-- ── ⚠️ THE TITLE IS AN INTERFACE, NOT A LABEL ──────────────────────────────
-- send-email's copyFor() does this for type 'verification':
--
--     return /not approved/i.test(title) ? <rejection copy> : <approval copy>
--
-- So the EMAIL's subject and heading are chosen by regex-matching the
-- notification's TITLE. 0077 put the rejection title ('Verification not
-- approved') in the database; this puts the approval title there too. Both
-- sides of that regex are now in migrations, which is better than before — but
-- NOTHING CHECKS THEY STILL AGREE. Retitling the approval notice to anything
-- containing "not approved" would email a verified member a rejection, and no
-- test, type or constraint would notice.
--
-- The verify block pins today's titles to today's branches. That is a copy of
-- the predicate and it goes stale silently if copyFor's regex changes, so it is
-- a stopgap and is labelled one. Raised as item 160; the mechanism it needs is
-- an axis in check-email-type-coverage.mjs that reads BOTH sides, and it is
-- named by that condition rather than by a migration number (item 155).
--
-- ── AND A SECOND, UNRELATED THING RIDES ALONG ──────────────────────────────
-- Two COMMENT ON POLICY statements at the end, settling the pt_update name
-- collision from item 156. Unrelated to verification copy, and said so plainly
-- rather than filed under a heading it does not belong to.
-- ===========================================================================
begin;

do $$
declare
  v_def  text;
  v_bare text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0082') then
    raise exception '0083: apply 0082 first.';
  end if;

  if to_regprocedure('public._provider_shops_state(uuid)') is null then
    raise exception '0083: public._provider_shops_state(uuid) is missing — the copy below reads what it returns.';
  end if;

  v_def := pg_get_functiondef(
             'public.admin_decide_verification(uuid,text,text)'::regprocedure);
  -- Comments stripped for every "is it there" question. 0068's guard read this
  -- function's own PROSE and reported a change as already made; 0082 stripped
  -- for the same reason. The surgery below uses the UNSTRIPPED text, so the
  -- comments survive into the new body.
  v_bare := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  if v_bare like '%notify_verification_approved%' then
    raise exception '0083: admin_decide_verification already calls notify_verification_approved. This migration has run.';
  end if;
  if v_bare not like '%Verification not approved%' then
    raise exception '0083: the live admin_decide_verification has no rejection notice, so it is not 0077''s version. Read it with pg_get_functiondef before going further.';
  end if;
  if v_bare not like '%provider_fee_settled%' then
    raise exception '0083: the live admin_decide_verification does not call provider_fee_settled, so 0045''s fee gate has been undone. Nothing changed.';
  end if;
  if v_bare not like '%reviewed_by_source%' then
    raise exception '0083: the live admin_decide_verification does not write reviewed_by_source, which 0037''s paired CHECK requires. Nothing changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE COPY, AS A PURE FUNCTION
--
-- A faithful port of stylistApprovalBody(role, shops) from
-- admin/app/verification/page.tsx, which is deleted in the same commit. The
-- words do not change in a refactor; four branches in, four branches out.
--
-- ⚠️ `= 'false'`, NOT "is falsy". The console's own lib comment says it, and it
-- is the whole reason has_name is optional: a response from before 0041 does
-- not carry these keys, and `undefined` means "this did not say", which is NOT
-- the same as "no". `sh->>'has_name'` is SQL NULL when the key is absent, and
-- `NULL = 'false'` is not true — so an absent observation names nothing
-- missing, exactly as `=== false` does in the console. Tested directly.
--
-- ⚠️ `order by n` IS LOAD-BEARING. The console takes hidden[0] from an array
-- that _provider_shops_state built with `order by p.id`. jsonb_array_elements
-- has no guaranteed order without WITH ORDINALITY, so dropping it would pick an
-- arbitrary shop on any stylist with two hidden ones — the same shape as the
-- unordered actor pick that made an earlier verify block unable to fail.
--
-- IMMUTABLE and reads no table, so it can be exercised on invented jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.verification_approval_body(
  p_role text, p_shops jsonb)
returns text
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  -- jsonb_array_length raises on a non-array, and a jsonb 'null' is not SQL
  -- NULL, so coalesce alone would not catch it.
  v_arr     jsonb := case when jsonb_typeof(p_shops) = 'array'
                          then p_shops else '[]'::jsonb end;
  v_hidden  jsonb;
  v_missing text[];
begin
  -- Role FIRST, then shop count — the console's precedence, and it matters:
  -- a model can hold a providers row (Micky B does, and the console admin has
  -- a users row with role 'model'), so testing shops first would send a
  -- shop-publication sentence to somebody with no shop to publish.
  if p_role = 'model' or jsonb_array_length(v_arr) = 0 then
    return 'Your Cavy profile is now verified. Your badge is live!';
  end if;

  v_hidden := (select e.v
                 from jsonb_array_elements(v_arr) with ordinality as e(v, n)
                where (e.v->>'published') is distinct from 'true'
                order by e.n
                limit 1);

  if v_hidden is null then
    return 'Your identity check passed — your verified badge and your shop are now live.';
  end if;

  v_missing := array_remove(array[
    case when (v_hidden->>'has_name') = 'false'
         then 'a name' end,
    case when (v_hidden->>'has_categorised_treatment') = 'false'
         then 'at least one treatment with a category' end
  ], null);

  return 'Your identity check passed and your verified badge is live. '
    || case when array_length(v_missing, 1) > 0
            then 'Your shop is not public yet — it still needs '
                 || array_to_string(v_missing, ' and ')
                 || '. Add '
                 || case when array_length(v_missing, 1) > 1 then 'those' else 'that' end
                 || ' from your dashboard and it will go live.'
            -- Nothing observable is missing, so the rule is refusing for a
            -- reason this cannot see. Say that, rather than naming requirements
            -- already met: incomplete beats wrong in a message to a person who
            -- has no queue to check it against (0041).
            else 'Your shop is not public yet — open your dashboard to check it.'
       end;
end
$$;

comment on function public.verification_approval_body(text, jsonb) is
  'The words an approved member reads. A port of the console''s stylistApprovalBody, worded from '
  '_provider_shops_state rather than assumed — the old message told every approved stylist their '
  'shop was live, which was untrue whenever it could not publish (items 29, 40, 41). Pure and '
  'IMMUTABLE so the four branches can be tested without approving anyone. 0083, item 144.';

revoke all on function public.verification_approval_body(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE NOTICE
--
-- A separate function so the splice into the live body is ONE line. It is also
-- the only way the copy above gets tested without a verification request.
--
-- ⚠️ EXECUTE IS REVOKED FROM authenticated, AND is_admin() IS CHECKED ANYWAY.
-- Either alone would do today. Both, because the thing being prevented is
-- someone writing themselves a "You're verified!" row that notify_email sends
-- out as Cavy — which is the exact hole item 144 exists to close, and closing
-- it with one guard that a later `grant execute` could silently reopen is the
-- allowlist-by-omission shape 0079 replaced with deny-by-default.
--
-- It still works when called from admin_decide_verification: inside a SECURITY
-- DEFINER function the privilege context is the owner, which has EXECUTE
-- regardless of grants, while auth.uid() still reads the admin's JWT — so
-- is_admin() is true for the real caller and the grant is irrelevant to it.
--
-- ⚠️ TITLE: see the header. The emoji differ by role and NEITHER may contain
-- "not approved", or copyFor emails a verified member a rejection.
-- ---------------------------------------------------------------------------
create or replace function public.notify_verification_approved(
  p_user_id uuid, p_role text, p_shops jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'notify_verification_approved: only an admin can announce a verification'
      using errcode = '42501';
  end if;
  if p_user_id is null then
    return;                 -- nobody to tell; the caller decided that, not this
  end if;

  insert into public.notifications (user_id, type, title, body)
  values (
    p_user_id,
    'verification',
    case when p_role = 'model' then 'You''re verified! ✅' else 'You''re verified! 🎉' end,
    public.verification_approval_body(p_role, p_shops)
  );
end
$$;

comment on function public.notify_verification_approved(uuid, text, jsonb) is
  'Tells an approved member, from inside admin_decide_verification''s transaction. SECURITY DEFINER '
  'because the row is addressed to somebody else; EXECUTE revoked from authenticated AND is_admin() '
  'checked, so neither guard alone is load-bearing. The last of item 144''s fifteen client inserts. '
  '⚠️ The title is matched by send-email''s copyFor regex — see 0083''s header. 0083.';

revoke all on function public.notify_verification_approved(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE SPLICE
--
-- The anchor is the last statement of the `if p_decision = 'approved'` block,
-- so the call lands inside that block and needs no condition of its own, and
-- v_shops is already computed where it goes.
--
-- Position within the transaction does not affect atomicity: anything that
-- raises afterwards rolls the notice back with the decision, which is the
-- property stage A was for.
-- ---------------------------------------------------------------------------
do $$
declare
  v_anchor   text := 'v_shops := public._provider_shops_state(v_user);';
  v_def      text;
  v_bare     text;
  v_new      text;
  v_in_code  integer;
  v_in_def   integer;
begin
  v_def  := pg_get_functiondef('public.admin_decide_verification(uuid,text,text)'::regprocedure);
  v_bare := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  v_in_def  := (length(v_def)  - length(replace(v_def,  v_anchor, ''))) / length(v_anchor);
  v_in_code := (length(v_bare) - length(replace(v_bare, v_anchor, ''))) / length(v_anchor);

  -- Exactly once, and not inside a comment. A second occurrence would splice
  -- the call twice and send two notices; an occurrence only in a comment would
  -- splice it into prose, where it would do nothing at all and look done.
  if v_in_code <> 1 then
    raise exception '0083: the anchor appears % time(s) in the live code, not once. Read admin_decide_verification before going further; nothing changed.', v_in_code;
  end if;
  if v_in_def <> v_in_code then
    raise exception '0083: the anchor also appears inside a comment (% in the text, % in the code), so a textual splice could land in prose. Nothing changed.', v_in_def, v_in_code;
  end if;

  v_new := replace(v_def, v_anchor, v_anchor || chr(10) || chr(10)
    || '    -- ⚠️ ADDED 0083 (item 144), the last of the fifteen. The approval' || chr(10)
    || '    -- notice came from admin/app/verification/page.tsx until now, where' || chr(10)
    || '    -- it could fail while the approval stood. Its copy is' || chr(10)
    || '    -- verification_approval_body(role, shops) — worded from the shops' || chr(10)
    || '    -- state above, never assumed live.' || chr(10)
    || '    perform public.notify_verification_approved(v_user, v_role, v_shops);');

  execute v_new;

  -- The post-condition. Proves the splice landed in the live function rather
  -- than assuming replace() did what it was asked.
  if regexp_replace(
       pg_get_functiondef('public.admin_decide_verification(uuid,text,text)'::regprocedure),
       '--[^' || chr(10) || ']*', '', 'g') not like '%notify_verification_approved%' then
    raise exception '0083: the splice did not land — the live admin_decide_verification still does not call notify_verification_approved. Rolled back.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. pt_update — THE NAME COLLISION, SETTLED ON THE OBJECTS THEMSELVES
--
-- Item 156 recorded the fix as "a comment on the DEAD one saying which shape is
-- correct". Two things turned out to be wrong with that, and both are worth
-- writing down rather than quietly fixing.
--
-- ⚠️ CORRECTION 1 — NEITHER SHAPE IS WRONG. Item 158 lists patch_tests'
-- pt_update among the oddest objects in the schema because it compares
-- auth.uid() to a provider_id, "a shape used nowhere else". It is not odd:
-- schema-snapshot-2026-08-08.sql:263 says plainly that
-- patch_tests.provider_id REFERENCES auth.users, NOT providers.id, "unlike
-- every other provider_id in this schema. Easy source of a silent wrong join."
-- For a column holding an auth.users id, `auth.uid() = provider_id` is the only
-- correct predicate, and the subquery shape would be the broken one.
--
-- So the repo already knew, in a file written before 0000, and item 158 was
-- written without that line in hand. The odd thing is the COLUMN NAME, not the
-- policy.
--
-- ⚠️ CORRECTION 2 — THERE IS NO DEAD ONE TO COMMENT ON. Both policies are
-- correct for their own table. The hazard is not a wrong policy; it is that the
-- SAME NAME carries OPPOSITE predicates and the deciding fact is invisible from
-- either one — so copying "pt_update" is a coin toss, and the loser is a silent
-- wrong join rather than an error.
--
-- Hence a comment on BOTH, not on one, and attached to the policies rather than
-- written in a file: COMMENT ON POLICY travels with the object, so it is there
-- for whoever inspects the policy rather than for whoever happens to open the
-- right snapshot.
--
-- Nothing is rewritten. legal.ts states three times that no code writes
-- patch_tests and that the table is empty; rewriting a policy that guards
-- nothing would be work with no subject (item 156's conclusion, unchanged).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'patch_tests'
                    and policyname = 'pt_update') then
    raise exception '0083: no pt_update policy on public.patch_tests — read the policies before commenting on them.';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'provider_treatments'
                    and policyname = 'pt_update') then
    raise exception '0083: no pt_update policy on public.provider_treatments — read the policies before commenting on them.';
  end if;
end $$;

comment on policy pt_update on public.patch_tests is
  '⚠️ CORRECT AS WRITTEN, AND DO NOT COPY IT. `auth.uid() = provider_id` is right HERE because '
  'patch_tests.provider_id references auth.users, not providers.id — the only provider_id in this '
  'schema that does. A policy named pt_update ALSO exists on provider_treatments with the opposite '
  'predicate, and that one is right for ITS table. Before copying either, read what the target '
  'table''s provider_id references; getting it wrong gives a silent wrong join, not an error. '
  'Item 156. No code writes this table and it is empty (legal.ts), so nothing here is load-bearing yet.';

comment on policy pt_update on public.provider_treatments is
  '⚠️ CORRECT AS WRITTEN, AND DO NOT COPY IT BLIND. The provider_id IN (select providers.id …) shape '
  'is right HERE because provider_treatments.provider_id references providers.id. A policy named '
  'pt_update ALSO exists on patch_tests using `auth.uid() = provider_id`, which is right for ITS '
  'table because that column references auth.users. Same name, opposite shapes, and the deciding '
  'fact is in neither policy. Item 156.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0083', 'the_approval_notice_joins_the_decision', '2d4a81fe68181df075e5fb53c07ba0a33c296277fe59c5653974f81b96af69e6');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   with f as (
--     select pg_get_functiondef('public.admin_decide_verification(uuid,text,text)'::regprocedure) as def
--   ), g as (
--     select def,
--            regexp_replace(def, '--[^' || chr(10) || ']*', '', 'g') as bare,
--            'v_shops := public._provider_shops_state(v_user);'      as anchor
--       from f
--   )
--   select
--     (select count(*) from public.schema_migrations where version = '0082') = 1
--                                                      as v_0082_applied,
--     bare like     '%Verification not approved%'       as is_0077s_version,
--     bare not like '%notify_verification_approved%'    as not_already_run,
--     bare like     '%provider_fee_settled%'            as fee_gate_intact,
--     bare like     '%reviewed_by_source%'              as attribution_intact,
--     (length(bare) - length(replace(bare, anchor, ''))) / length(anchor) = 1
--                                                      as anchor_once_in_code,
--     (length(def)  - length(replace(def,  anchor, ''))) / length(anchor)
--       = (length(bare) - length(replace(bare, anchor, ''))) / length(anchor)
--                                                      as anchor_not_in_a_comment,
--     to_regprocedure('public._provider_shops_state(uuid)') is not null
--                                                      as shops_state_exists,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and policyname = 'pt_update'
--         and tablename in ('patch_tests', 'provider_treatments')) = 2
--                                                      as both_pt_updates_exist,
--     md5(bare)   as live_body_md5,
--     length(def) as live_def_chars,
--     coalesce(
--       (select c.conname || ' -> ' || c.confrelid::regclass::text
--          from pg_constraint c
--         where c.conrelid = 'public.patch_tests'::regclass
--           and c.contype = 'f'
--           and array_length(c.conkey, 1) = 1
--           and (select a.attname from pg_attribute a
--                 where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'provider_id'),
--       'NO FK CONSTRAINT on patch_tests.provider_id')
--       as patch_tests_provider_id_fk
--   from g;
--
--   All NINE booleans true. The last three columns are a RECORD, not a verdict:
--   this migration operates on a body it has never read, so live_body_md5 exists
--   so a future migration can tell whether it moved.
--
--   ⚠️ anchor_once_in_code and anchor_not_in_a_comment ARE THE GATE. The splice
--   is textual; those two are what stand between a one-line insertion and a
--   no-op that looks done.
--
--   ⚠️ COUNTS, NOT position(). `position(a) > position(b)` reads "a is below b"
--   and "b is absent" identically, because position() returns 0 for a missing
--   substring — Micky, on 0082's preflight, 4 Oct. A comparison whose false
--   branch covers two different worlds is the same shape as a check that cannot
--   fail. Occurrence counts have no such branch.
--
--   RESULT, 5 Oct 2026: all nine true, and
--   patch_tests_provider_id_fk = 'patch_tests_provider_id_fkey -> auth.users'.
--   That settles section 4's premise from the DATABASE rather than from a
--   snapshot file: the column genuinely holds an auth.users id, so pt_update on
--   patch_tests is correct and was never broken.
-- ===========================================================================
--
-- ── VERIFY — ONE BLOCK ──────────────────────────────────────────────────
--
--   Conventions (scripts/migration-status.mjs): one paste; sections in their own
--   begin/exception subtransactions; every variable declared; scalar subqueries
--   rather than `select … into`; read-backs prove the row is NEW; one `%` fed
--   one concatenated string.
--
--   ⚠️ CASE 7 CARRIES A FIX, AND THE FIRST RUN FAILED ON IT. `::` binds tighter
--   than `||`, so `'[{…},' || ' {…}]'::jsonb` casts ONLY THE SECOND LITERAL —
--   ' {"published":false,…}]' alone, which is not valid JSON. Parenthesise the
--   concatenation before the cast. Same family as 0076's bare `null` typing as
--   text: an operator doing something reasonable with the wrong operand.
--
--   ⚠️ AND THE SECTION HANDLER EARNED ITS KEEP. Case 7 reported
--   'SECTION ERRORED: invalid input syntax for type json' rather than letting an
--   unrun branch read as a pass. That is the whole difference between this and a
--   check that cannot fail.
--
--   begin;
--   do $v$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_model  uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_before uuid[];
--     v_n1     uuid;
--     v_n2     uuid;
--     v_t1     text;
--     v_t2     text;
--     v_fails  text := '';
--     r_a text := 'not run';
--     r_b text := 'not run';
--     r_c text := 'not run';
--     r_d text := 'not run';
--     r_e text := 'not run';
--     r_f text := 'not run';
--     c_body  constant text := 'Your identity check passed and your verified badge is live. ';
--   begin
--     begin
--       r_a := 'copy_fn=' || (case when to_regprocedure('public.verification_approval_body(text,jsonb)')
--                                       is not null then 'yes' else 'NO' end)
--           || ' notice_fn=' || (case when to_regprocedure('public.notify_verification_approved(uuid,text,jsonb)')
--                                       is not null then 'yes' else 'NO' end)
--           || ' spliced=' || (case when regexp_replace(
--                    pg_get_functiondef('public.admin_decide_verification(uuid,text,text)'::regprocedure),
--                    '--[^' || chr(10) || ']*', '', 'g') like '%notify_verification_approved%'
--                  then 'yes' else 'NO' end);
--     exception when others then r_a := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       if public.verification_approval_body('model', '[{"published":false,"has_name":false}]'::jsonb)
--          is distinct from 'Your Cavy profile is now verified. Your badge is live!'
--         then v_fails := v_fails || ' [1 model-beats-shops]'; end if;
--
--       if public.verification_approval_body('provider', '[]'::jsonb)
--          is distinct from 'Your Cavy profile is now verified. Your badge is live!'
--         then v_fails := v_fails || ' [2 no-shops]'; end if;
--
--       if public.verification_approval_body('provider', '[{"published":true}]'::jsonb)
--          is distinct from 'Your identity check passed — your verified badge and your shop are now live.'
--         then v_fails := v_fails || ' [3 all-live]'; end if;
--
--       if public.verification_approval_body('provider',
--            '[{"published":false,"has_name":false,"has_categorised_treatment":false}]'::jsonb)
--          is distinct from c_body || 'Your shop is not public yet — it still needs a name and at '
--            || 'least one treatment with a category. Add those from your dashboard and it will go live.'
--         then v_fails := v_fails || ' [4 both-missing/those]'; end if;
--
--       if public.verification_approval_body('provider',
--            '[{"published":false,"has_name":true,"has_categorised_treatment":false}]'::jsonb)
--          is distinct from c_body || 'Your shop is not public yet — it still needs at least one '
--            || 'treatment with a category. Add that from your dashboard and it will go live.'
--         then v_fails := v_fails || ' [5 one-missing/that]'; end if;
--
--       if public.verification_approval_body('provider', '[{"published":false}]'::jsonb)
--          is distinct from c_body || 'Your shop is not public yet — open your dashboard to check it.'
--         then v_fails := v_fails || ' [6 keys-absent-is-not-false]'; end if;
--
--       -- ⚠️ THE PARENTHESES. See the note above this block.
--       if public.verification_approval_body('provider',
--            ('[{"published":false,"has_name":false,"has_categorised_treatment":true},'
--          || ' {"published":false,"has_name":true,"has_categorised_treatment":false}]')::jsonb)
--          is distinct from c_body || 'Your shop is not public yet — it still needs a name. '
--            || 'Add that from your dashboard and it will go live.'
--         then v_fails := v_fails || ' [7 FIRST-hidden-shop]'; end if;
--
--       r_b := case when v_fails = '' then 'all 7 branches exact' else 'FAILED:' || v_fails end;
--     exception when others then r_b := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       v_before := array(select n.id from public.notifications n
--                          where n.user_id = v_model and n.type = 'verification');
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
--       perform public.notify_verification_approved(v_model, 'model',    '[]'::jsonb);
--       perform public.notify_verification_approved(v_model, 'provider', '[{"published":true}]'::jsonb);
--
--       v_n1 := (select n.id from public.notifications n
--                 where n.user_id = v_model and n.type = 'verification'
--                   and not (n.id = any (v_before)) and n.title like '%✅%');
--       v_n2 := (select n.id from public.notifications n
--                 where n.user_id = v_model and n.type = 'verification'
--                   and not (n.id = any (v_before)) and n.title like '%🎉%');
--       v_t1 := (select n.title from public.notifications n where n.id = v_n1);
--       v_t2 := (select n.title from public.notifications n where n.id = v_n2);
--
--       if v_n1 is null or v_n2 is null then
--         r_c := 'NO NEW ROW(S) — model=' || coalesce(v_n1::text, 'none')
--             || ' provider=' || coalesce(v_n2::text, 'none')
--             || '. An older verification row is NOT evidence.';
--       else
--         r_c := 'two new rows | model body: '
--             || (select case when n.body = 'Your Cavy profile is now verified. Your badge is live!'
--                             then 'exact' else 'WRONG: ' || n.body end
--                   from public.notifications n where n.id = v_n1);
--       end if;
--     exception when others then r_c := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       execute 'set local role authenticated';
--       begin
--         perform public.notify_verification_approved(v_model, 'model', '[]'::jsonb);
--         r_d := 'NOT REFUSED — authenticated can execute it, so the grant is open.';
--       exception when others then
--         r_d := case when sqlerrm like '%permission denied%'
--                     then 'refused on the GRANT (correct): ' || sqlerrm
--                     else 'refused for the WRONG reason: ' || sqlerrm end;
--       end;
--       execute 'reset role';
--     exception when others then r_d := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       r_e := 'model title -> ' || (case when coalesce(v_t1, '') ~* 'not approved'
--                 then 'REJECTION COPY (WRONG)' else 'approval copy' end)
--           || ' | provider title -> ' || (case when coalesce(v_t2, '') ~* 'not approved'
--                 then 'REJECTION COPY (WRONG)' else 'approval copy' end)
--           || ' | titles read from the rows, not retyped';
--     exception when others then r_e := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       r_f := 'commented pt_update policies: '
--           || (select count(*) from pg_policy pol
--                join pg_class c on c.oid = pol.polrelid
--               where pol.polname = 'pt_update'
--                 and c.relname in ('patch_tests', 'provider_treatments')
--                 and obj_description(pol.oid, 'pg_policy') is not null)::text
--           || ' of 2';
--     exception when others then r_f := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || '(a) objects + splice : ' || r_a || chr(10)
--       || '(b) copy branches    : ' || r_b || chr(10)
--       || '(c) notice writes    : ' || r_c || chr(10)
--       || '(d) grant closed     : ' || r_d || chr(10)
--       || '(e) title routing    : ' || r_e || chr(10)
--       || '(f) policy comments  : ' || r_f;
--   end $v$;
--   rollback;
--
--   RESULT, 5 Oct 2026 — all six pass:
--     (a) copy_fn=yes notice_fn=yes spliced=yes
--     (b) all 7 branches exact
--     (c) two new rows | model body: exact
--     (d) refused on the GRANT (correct): permission denied for function
--         notify_verification_approved
--     (e) model title -> approval copy | provider title -> approval copy
--     (f) commented pt_update policies: 2 of 2
--
--   ⚠️ (d) MATCHES sqlerrm TEXT, NOT SQLSTATE. The missing grant and the
--   is_admin() gate both raise 42501, so a sqlstate match would pass on a broken
--   grant (0079's test 5, same trap). The JWT claims are set to the real admin
--   precisely so the admin gate cannot be what refuses — leaving the grant as
--   the only thing that can.
--
--   ⚠️ WHAT THIS BLOCK DOES NOT PROVE. It proves the PARTS, not the PATH: that
--   the spliced line actually RUNS on approval is established textually in (a)
--   and nowhere else. One real approval in the console settles it — 🎉 in the
--   title and a body matching the shop's actual state. No email goes out from
--   the block itself: it rolls back, so pg_net never dispatches (item 152).
-- ===========================================================================

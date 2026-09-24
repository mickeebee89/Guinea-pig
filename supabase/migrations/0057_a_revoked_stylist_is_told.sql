-- ===========================================================================
-- 0057_a_revoked_stylist_is_told
--
-- The person it happened to finds out. Audit item 117.
--
-- ⚠️ Apply 0056 first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────
-- revoke_verification clears her verification, hides her shop, cancels every
-- upcoming booking and writes each of those models a carefully worded notice.
--
-- **It writes nothing to her.** Checked across 0027 and 0044: the only
-- notification inserts are to the MODEL (0027:218, 0044:347) and in the
-- 'warn' branch (0044:472). So her shop goes dark, her diary empties, every
-- model she was booked with hears from us — and she finds out by looking.
--
-- Nothing in 0027 records that as a decision. Its header argues at length
-- about what the MODEL should be told and never mentions her.
--
-- ── ⚠️ WHAT SHE IS TOLD, AND WHY IT IS NOT THE ADMIN'S REASON ───────────
-- She can reapply the moment this runs — deleting her verification_requests
-- row is what re-opens /verify for her. So "your verification has been
-- removed" and nothing else is not merely unkind, it is a LOOP: she
-- resubmits the same thing and is revoked again, learning nothing either time.
--
-- But the mandatory `p_reason` is written for an admin, as evidence, and may
-- name a third party — "a model reported that…". Publishing it verbatim would
-- disclose who reported her, which is the exact thing this product refuses
-- everywhere else: who blocked whom (0029:280), who cancelled under the
-- withdrawn notice (0044:329).
--
-- So there are TWO fields and they have different audiences:
--
--   p_reason   MANDATORY, ≥10 chars, unchanged. Moderation evidence, into
--              moderation_actions, six-year retention, seen by admins only.
--   p_message  OPTIONAL, written FOR HER, and the only thing she reads.
--
-- When p_message is null she still gets the fact, the consequences and a
-- route to support — never a reason invented on her behalf, and never
-- "we're not able to explain why", which is the model's sentence and is
-- wrong here: she is not a third party to her own revocation.
--
-- ── ⚠️ 'warn' HAS THE OPPOSITE PROBLEM, AND IT IS NOT FIXED HERE ────────
-- `_admin_apply_user_action`'s 'warn' branch puts the admin's raw p_reason
-- straight into the member's notification body (0044:472-478). Same field,
-- same evidence, published to the subject with no second pair of eyes. It has
-- the landmine this migration exists to avoid. Recorded as item 118.
--
-- ── IT EMAILS, AND THAT IS WHY THE TYPE IS 'verification' ───────────────
-- 0047 emails exactly: session_applied, session_accepted, session_declined,
-- session_cancelled, **verification**, payment_failed, admin_warning, and a
-- new chat message. `verification` is already on that list, so this reaches
-- her inbox with no change to the email trigger.
--
-- That is the right answer on merit too. Her shop is dark and her diary is
-- empty NOW; an in-app notification she opens on Thursday is not good enough
-- when every model she was booked with was emailed on Monday.
--
-- ── AND IT NAMES THE SHOP AND THE BOOKINGS ──────────────────────────────
-- She will notice both, so silence on them is its own message — and worse,
-- she might not connect an empty diary to this at all and go looking for a
-- fault. The count comes from _withdraw_stylist, so it is what actually
-- happened rather than what we expect to have happened.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  -- ⚠️ to_regprocedure, NOT to_regproc. 0056 refused itself on that mistake
  -- (item 108); the whole ledger uses to_regprocedure and so does this.
  if to_regprocedure('public.revoke_verification(uuid, text)') is null then
    raise exception '0057: revoke_verification(uuid, text) is missing. Apply 0044 first.';
  end if;
  if to_regprocedure('public.revoke_verification(uuid, text, text)') is not null then
    raise exception '0057: a three-argument revoke_verification already exists. Read it before applying.';
  end if;
  if to_regprocedure('public._withdraw_stylist(uuid)') is null then
    raise exception '0057: _withdraw_stylist(uuid) is missing. Apply 0044 first.';
  end if;
  if to_regclass('public.notifications') is null then
    raise exception '0057: public.notifications is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE OLD SIGNATURE GOES FIRST
--
-- ⚠️ NOT `create or replace` WITH A DEFAULTED THIRD ARGUMENT. That would leave
-- BOTH functions in place — the 2-argument one and a 3-argument one whose
-- third defaults — and a two-argument call would then be ambiguous and fail at
-- runtime, in the admin console, on a destructive action.
--
-- Dropping is safe: the only caller is the console, which this change updates
-- in the same commit, and nothing in the database references it.
-- ---------------------------------------------------------------------------
drop function public.revoke_verification(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. THE NEW ONE
--
-- 0044's body, carried verbatim, with one addition: the notification to her,
-- INSIDE the transaction.
--
-- Inside deliberately, following 0035's reasoning for 'warn': a revocation
-- whose notification failed would be exactly the state this migration exists
-- to end, and the audit row would say she was told when she was not.
-- ---------------------------------------------------------------------------
create function public.revoke_verification(
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
  if not public.is_admin() then
    raise exception 'revoke_verification is admin-only';
  end if;

  -- A reason is mandatory and is not a formality: this removes someone's
  -- ability to trade, and "an admin decided to" is not a record.
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'revoke_verification needs a reason of at least 10 characters';
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
  'person who reported her. There is deliberately no "keep the bookings" option.';

revoke execute on function public.revoke_verification(uuid, text, text) from public, anon;
grant  execute on function public.revoke_verification(uuid, text, text) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0057', 'a_revoked_stylist_is_told', '2adba8173e78db9aa0bb14132294d21c90c9af85be307c39635930116203ee12');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- The ASSERT is code and can be wrong; 0056's was (item 108). Every condition
-- it tests, as a SELECT that ANSWERS instead of raising. All four must be yes.
--
--   select 'revoke_verification(uuid,text) exists' as needs,
--          to_regprocedure('public.revoke_verification(uuid, text)') is not null as present
--   union all
--   select 'three-arg version does NOT exist yet',
--          to_regprocedure('public.revoke_verification(uuid, text, text)') is null
--   union all
--   select '_withdraw_stylist(uuid) exists',
--          to_regprocedure('public._withdraw_stylist(uuid)') is not null
--   union all
--   select 'notifications table exists',
--          to_regclass('public.notifications') is not null;
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   ⚠️ THE FUNCTION SIGNATURE CHANGES, so the console must go out with it.
--   The admin console is the only caller and passes three arguments from this
--   commit onward. A two-argument call after this migration fails.
--
--   1. Preflight above.
--   2. Apply this migration.
--   3. node scripts/gen-supabase-types.mjs
--   4. Build and deploy the admin console.
--   5. Blocks A and B below.
-- ===========================================================================
--
-- ⚠️ CORRECTED 24 Sep 2026, AFTER IT FAILED ON ITS FIRST RUN.
--
-- Both blocks below originally called revoke_verification with no JWT claim
-- set, and got:
--
--     ERROR: revoke_verification is admin-only
--
-- The function's FIRST line is `if not public.is_admin()`, and is_admin() is
-- `exists (select 1 from admins where user_id = auth.uid())`. In the SQL
-- editor **auth.uid() is NULL**, so is_admin() is false and an admin-only
-- function refuses the owner of the database.
--
-- Every other verify block in this ledger sets the claim first — 0054's B and
-- C, 0056's A and B — and these two were written without it. The blocks are
-- the part of a migration that gets no rehearsal, which is the same lesson
-- item 108 recorded about the ASSERT.
--
-- ⚠️ AND `reset role` HAS TO COME BEFORE THE SELECT. The function is SECURITY
-- DEFINER so its own writes bypass RLS, but the block's own read of
-- `notifications` would run as that admin — and notifications are readable by
-- their owner. Reading the STYLIST's row needs the owner's role back.
--
-- Put YOUR admin user id in v_admin. To see which ids qualify:
--
--     select user_id from public.admins;
--
-- ── BLOCK A — she is told, and the reason is not in it. Rolls back ───
--
--   Uses the provider test account. ⚠️ READ THE BODY. The admin's REASON must
--   not appear anywhere in it; the MESSAGE must.
--
--   do $$
--   declare
--     v_admin   uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';   -- must be in public.admins
--     v_stylist uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_note record;
--     v_leaked boolean;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     perform public.revoke_verification(
--       v_stylist,
--       'INTERNAL EVIDENCE: a model called Sarah reported this account.',
--       'The photo you sent did not match your profile picture.');
--
--     -- Back to the owner BEFORE reading: as the admin, RLS would hide the
--     -- stylist's own notification row.
--     reset role;
--
--     select title, body into v_note
--     from public.notifications
--     where user_id = v_stylist and type = 'verification'
--     order by created_at desc limit 1;
--
--     v_leaked := v_note.body ilike '%Sarah%' or v_note.body ilike '%INTERNAL%';
--
--     raise exception E'ROLLED BACK ON PURPOSE.\ntitle: %\n\nbody:\n%\n\nreason leaked into the body: %  (MUST be false)',
--       v_note.title, v_note.body, v_leaked;
--   end $$;
--
-- ── BLOCK B — with no message, she still gets the facts and a route ──────
--
--   do $$
--   declare
--     v_admin   uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_stylist uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_body text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     perform public.revoke_verification(
--       v_stylist, 'INTERNAL EVIDENCE: no message given on purpose.');
--
--     reset role;
--
--     select body into v_body from public.notifications
--     where user_id = v_stylist and type = 'verification'
--     order by created_at desc limit 1;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n%\n\nMust say: shop hidden, how to do the ID check again, and support. Must NOT say "we are not able to explain why" — that is the MODEL''s sentence.',
--       v_body;
--   end $$;
--
-- ── WHAT NEITHER BLOCK PROVES ────────────────────────────────────────────
-- That the email arrives. `verification` is on 0047's emailed list, so the
-- trigger fires — but the only proof is a real inbox, and revoking a real
-- stylist to get one is not a test worth running. Watch email_sends after the
-- first genuine revocation instead.
-- ===========================================================================

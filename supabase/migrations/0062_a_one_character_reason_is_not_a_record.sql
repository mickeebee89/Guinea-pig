-- ===========================================================================
-- 0062_a_one_character_reason_is_not_a_record
--
-- The evidence bar stops being three copies of one rule. Audit item 122.
--
-- ⚠️ Apply 0061 first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────
-- warn, suspend and ban each carried their own `coalesce(btrim(p_reason),'')
-- = ''` check. revoke_verification has wanted TEN characters since 0044, on
-- the argument that it removes someone's ability to trade and "an admin
-- decided to" is not a record.
--
-- So a reason of "x" passed three actions and failed the fourth. Suspending or
-- banning somebody is not a smaller act than un-verifying them — a ban is the
-- heaviest thing in the product — and a one-character reason is a six-year
-- retention obligation recording nothing.
--
-- ── ONE CHECK, NOT THREE ─────────────────────────────────
-- The three were copies of one rule, and copies of one rule drifting apart is
-- precisely how "x" came to pass three of them. Raising three numbers would
-- have fixed today's symptom and left the shape that produced it. The guard
-- moves above the `case`, where the action is already known, so there is one
-- place to read and one place to change.
--
-- ⚠️ revoke_verification keeps its OWN check. It is a different function with
-- a different signature, called from a different console path, and folding it
-- in would mean routing a revocation through _admin_apply_user_action for no
-- reason other than tidiness. Its bar is the same ten characters, and 0057's
-- comment explains why; this brings the others up to it rather than moving it.
--
-- ── WHAT AN ADMIN SEES ──────────────────────────────────
-- One sentence naming the action, the length, and what the field is for — the
-- last part because the whole confusion this series of migrations has been
-- unpicking is between the field written FOR THE RECORD and the field written
-- FOR THE MEMBER. The console disables Confirm below ten with a counter, so
-- in practice the exception is the backstop rather than the message anybody
-- reads.
--
-- ── HOW THE BODY GOT HERE ────────────────────────────────
-- Extracted from 0061's text, not retyped, and the ASSERT refuses to run
-- unless the LIVE body is the one 0061 installed.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- ⚠️ to_regprocedure, NOT to_regproc. 0056 refused itself on that (item 108).
  if to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is null then
    raise exception '0062: the five-argument _admin_apply_user_action is missing. Apply 0058 onwards first.';
  end if;

  v_def := pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure);

  if v_def not like '%admin_suspension%' then
    raise exception '0062: the live _admin_apply_user_action is not the 0061 body. Read it before applying.';
  end if;
  if v_def like '%needs a reason of at least 10 characters%' then
    raise exception '0062: the live body already requires ten characters. This migration has run.';
  end if;
  -- All three inline checks must still be there, or the body is not what this
  -- migration was built from and removing them would silently remove nothing.
  if v_def not like '%warn needs a reason%'
     or v_def not like '%suspend needs a reason%'
     or v_def not like '%ban needs a reason%' then
    raise exception '0062: one of the three per-action reason checks is already missing. Read the live body before applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 0061's BODY, CARRIED VERBATIM, WITH THREE CHECKS REPLACED BY ONE
-- ---------------------------------------------------------------------------
create or replace function public._admin_apply_user_action(
  p_user_id       uuid,
  p_action        text,
  p_reason        text,
  p_duration_days integer,
  p_message       text default null
) returns jsonb
language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare
  v_new       boolean;
  v_withdrawn jsonb;
  -- 0061. What the suspension notice needs to be true rather than assumed.
  v_cancelled int;
  v_until     timestamptz;
  v_title     text;
  v_notice    text;
  -- 0058. Empty string and whitespace are the same as absent; a UI that sends
  -- '' must not produce a notification body of ''.
  v_msg       text := nullif(btrim(coalesce(p_message, '')), '');
  v_told      boolean;
begin
  -- Checked again here, though every caller has checked it. Cheap, and it means
  -- a future caller that forgets cannot turn this into an unguarded path.
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'no user %', p_user_id using errcode = 'P0002';
  end if;

  -- ── THE EVIDENCE BAR, ONCE. 0062, audit item 122. ──────────────────
  --
  -- warn, suspend and ban each carried their own `= ''` check, so a reason of
  -- "x" satisfied all three. revoke_verification has wanted TEN characters
  -- since 0044, on the argument that it removes someone's ability to trade and
  -- "an admin decided to" is not a record. Suspending or banning someone is not
  -- a smaller act than un-verifying them, and a one-character reason is a
  -- six-year retention obligation recording nothing.
  --
  -- ONE check rather than three: they were three copies of one rule, and the
  -- bar drifting apart between them is how "x" passed three actions and failed
  -- the fourth in the first place.
  if p_action in ('warn', 'suspend', 'ban')
     and (p_reason is null or length(btrim(p_reason)) < 10) then
    raise exception '% needs a reason of at least 10 characters. It is the record of why this happened, kept for six years, and the member never sees it.',
      p_action using errcode = '22023';
  end if;

  case p_action

    -- ⚠️ INSIDE THE TRANSACTION, deliberately (0035's header). For a warning the
    -- notification is the whole action; outside, the audit row could say
    -- "warned" about a warning that never arrived. The push it triggers is
    -- queued by pg_net and only sent if this commits.
    --
    -- ⚠️ 0058: THE MESSAGE, NOT THE REASON. The reason is evidence and may name
    -- the person who reported them; this branch is emailed as well as shown, so
    -- it was the widest publication of the evidence field in the product.
    --
    -- And the message is mandatory here alone: a warning IS its notification, so
    -- one without a message tells someone they are in trouble and nothing else.
    when 'warn' then
      -- 0059 (item 121) made a reason mandatory here; 0062 (item 122) moved
      -- that check, and suspend's and ban's, above the case as one rule.
      if v_msg is null or length(v_msg) < 10 then
        raise exception 'a warning needs a message of at least 10 characters, written for the member to read. The reason is evidence and is never shown to them.'
          using errcode = '22023';
      end if;
      insert into public.notifications (user_id, type, title, body)
      values (p_user_id, 'admin_warning', 'Warning from Cavy', v_msg);
      v_told := true;

    -- Replace, not stack. suspensions has no unique constraint on user_id, and
    -- reinstate already deletes every row, so the table is current state;
    -- history is admin_audit_log. (0035.)
    --
    -- Since 0044 both also withdraw a stylist: shop hidden, upcoming bookings
    -- cancelled, each model notified. Same rule as revocation.
    --
    -- 0058: member_message is what my_suspension() returns to them. Optional —
    -- SuspensionGate's fixed sentence and date stand on their own.
    when 'suspend' then
      if p_duration_days is null or p_duration_days <= 0 then
        raise exception 'suspend needs a positive duration' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      v_until := now() + make_interval(days => p_duration_days);
      insert into public.suspensions (user_id, suspended_until, banned, reason, member_message)
      values (p_user_id, v_until, false, p_reason, v_msg);
      v_withdrawn := public._withdraw_stylist(p_user_id);
      v_told := true;

      -- ── AND TELL THEM. 0061, item 119. ─────────────────────────
      --
      -- The gate (item 120) only reaches somebody who comes back and opens the
      -- app. The likeliest next thing a suspended member does is try something,
      -- fail, and leave. This reaches them where they already are.
      v_title  := 'Your account is suspended';
      v_notice :=
        'Your account is suspended until ' || to_char(v_until, 'FMDD FMMonth YYYY')
        || '. Until then you can''t apply for treatments, send messages or leave '
        || 'reviews. You can still sign in and see your account.';
      v_notice := v_notice || public._withdrawn_sentence(v_withdrawn);
      if v_msg is not null then
        v_notice := v_notice || chr(10) || chr(10) || v_msg;
      end if;
      v_notice := v_notice || chr(10) || chr(10)
        || 'If you think this is wrong, reply to this email or write to support@cavybeauty.com.';

      insert into public.notifications (user_id, type, title, body)
      values (p_user_id, 'admin_suspension', v_title, v_notice);

    when 'ban' then
      -- 0061, audit item 119. MANDATORY HERE, OPTIONAL FOR SUSPEND.
      --
      -- A ban's notification is the last thing this product ever sends that
      -- person. A permanent closure with no reason at all is the worst version
      -- of that, and unlike a suspension there is no date and no end to fall
      -- back on. Same argument 0059 made for a warning, for a heavier action.
      if v_msg is null or length(v_msg) < 10 then
        raise exception 'a ban needs a message of at least 10 characters, written for the member to read. It is the last thing they hear from us, and the reason is evidence they never see.'
          using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason, member_message)
      values (p_user_id, null, true, p_reason, v_msg);
      v_withdrawn := public._withdraw_stylist(p_user_id);
      v_told := true;

      -- ⚠️ NO DATE, NO "UNTIL", AND NO PROMISE OF A ROUTE BACK. Saying "you can
      -- appeal and we'll reconsider" would be a sentence this product cannot
      -- keep. They can write to us, which is true, and that is all it claims.
      v_title  := 'Your account has been closed';
      v_notice :=
        'Your account has been closed following a review of activity on Cavy. '
        || 'You won''t be able to apply for treatments, send messages or leave reviews.';
      v_notice := v_notice || public._withdrawn_sentence(v_withdrawn);
      -- Mandatory above, so this is never the bare version.
      v_notice := v_notice || chr(10) || chr(10) || v_msg;
      v_notice := v_notice || chr(10) || chr(10)
        || 'If you think this is wrong, reply to this email or write to support@cavybeauty.com.';

      insert into public.notifications (user_id, type, title, body)
      values (p_user_id, 'admin_suspension', v_title, v_notice);

    -- Deletes the suspension and nothing else. The shop stays hidden: the
    -- stylist republishes it themselves (0044).
    when 'reinstate' then
      delete from public.suspensions where user_id = p_user_id;

    -- The auto-publish chain runs on false → true as it always has. This does
    -- not add an explicit publish: that is ⟨D1⟩, and it belongs to the
    -- verification decision, not to a bare "verify" button. What it adds is
    -- telling the caller what happened to the shops.
    --
    -- 0045 (item 56): a stylist whose fee is not settled cannot be verified
    -- here either, or this button would be the way round the queue's check.
    when 'verify' then
      if exists (select 1 from public.users u where u.id = p_user_id and u.role = 'provider')
         and not public.provider_fee_settled(p_user_id) then
        raise exception 'this stylist has not settled the £14.99 fee (no payment, not a Founding Provider, not fee-waived), so they cannot be verified. Nothing was changed.'
          using errcode = 'CV002';
      end if;
      update public.users set is_verified = true where id = p_user_id;
      return jsonb_build_object('shops', public._provider_shops_state(p_user_id));

    when 'flag' then
      update public.users set fraud_flagged = not fraud_flagged
      where id = p_user_id returning fraud_flagged into v_new;

    when 'waive' then
      update public.users set provider_fee_waived = not provider_fee_waived
      where id = p_user_id returning provider_fee_waived into v_new;

    when 'comp' then
      update public.users set subscription_waived = not subscription_waived
      where id = p_user_id returning subscription_waived into v_new;

    else
      raise exception 'unknown action %', p_action using errcode = '22023';
  end case;

  -- v_told is null for every action that says nothing to the member, and
  -- jsonb_strip_nulls drops it — so the key appears only where it means
  -- something, and the console can say whether they were told.
  return jsonb_strip_nulls(jsonb_build_object('new_value', v_new, 'member_told', v_told))
         || coalesce(v_withdrawn, '{}'::jsonb);
end
$function$;

comment on function public._admin_apply_user_action(uuid, text, text, integer, text) is
  'The single implementation of warn, suspend, ban, reinstate, verify, flag, waive '
  'and comp, shared by admin_act_on_user, admin_act_on_report and '
  'admin_act_on_provider so the three surfaces cannot behave differently. Writes no '
  'audit row — its callers do. SECURITY INVOKER and not executable by any client '
  'role. 0039; audit item 29. ⚠️ TWO TEXT FIELDS WITH DIFFERENT AUDIENCES since 0058 '
  '(item 118): p_reason is moderation evidence, kept six years, admin-only, and NEVER '
  'shown to the member; p_message is written FOR the member and is the only part they '
  'read. warn, suspend and ban all REQUIRE a reason of at least ten characters since '
  '0062 (item 122), matching revoke_verification. warn and ban also require a message '
  '— warn because it is nothing but its notification (0059), ban because it is the '
  'last thing we ever send (0061). All three notify, and all three are emailed.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0062', 'a_one_character_reason_is_not_a_record', '2f0d6add14f11e2f8c219f578b4bce6e002fe909f33f22450c67b1dc7b8d206b');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select 'the 5-arg _admin_apply_user_action exists' as needs,
--          to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is not null as present
--   union all
--   select 'the LIVE body is 0061''s',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure)
--            like '%admin_suspension%'
--   union all
--   select 'it does NOT already require ten characters',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure)
--            not like '%needs a reason of at least 10 characters%'
--   union all
--   select 'all three per-action checks are still present',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure) like '%warn needs a reason%'
--      and pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure) like '%suspend needs a reason%'
--      and pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure) like '%ban needs a reason%';
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   The signature does not change. Between the migration and the console
--   deploy, a short reason is refused by the database rather than by a disabled
--   button — ugly for one deploy, not harmful.
--
--   ⚠️ NOTHING IS RETROSPECTIVE. Suspensions and audit rows already carrying a
--   one-character reason keep it; this only stops new ones. There is no
--   migration that can put evidence into a row nobody wrote it for.
--
--   1. Preflight above.
--   2. Apply this migration.
--   3. node scripts/gen-supabase-types.mjs
--   4. Deploy admin.
--   5. Block A below.
-- ===========================================================================
--
-- ── BLOCK A — "x" is refused for all three, and ten is enough. Rolls back ──
--
--   do $blk$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_r      text := '';
--     v_ok     text := 'NO — A GOOD REASON WAS REFUSED, WHICH IS WRONG';
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     -- "x" must now fail for each of the three, with the SAME sentence.
--     foreach v_r in array array['warn', 'suspend', 'ban'] loop
--       declare v_msg text;
--       begin
--         begin
--           perform public.admin_act_on_user(v_member, v_r, 'x', 7,
--             'A message long enough to pass its own check.');
--           v_msg := 'NO — ACCEPTED, WHICH IS WRONG';
--         exception when others then v_msg := sqlerrm;
--         end;
--         raise notice '% -> %', v_r, v_msg;
--       end;
--     end loop;
--
--     -- And a real one is accepted.
--     begin
--       perform public.admin_act_on_user(v_member, 'suspend',
--         'Messaged two models after being asked to stop; third report this month.', 7,
--         'Messages to other members must stay about the appointment.');
--       v_ok := 'yes';
--     exception when others then v_ok := 'NO — REFUSED: ' || sqlerrm;
--     end;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nSee the NOTICEs above: all three must say "needs a reason of at least 10 characters".\n\na real reason was accepted: %   <-- MUST be yes', v_ok;
--   end $blk$;
--
--   ⚠️ The last assertion is the one that matters. A bar that refuses a genuine
--   reason is worse than the fault it fixes — the same reason 0060's Block A
--   ended by checking that a real bio passes.
-- ===========================================================================

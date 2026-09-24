-- ===========================================================================
-- 0059_a_warning_needs_evidence_too
--
-- The mirror of 0058. Audit item 121.
--
-- ⚠️ Apply 0058 first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────
-- 0058 split one field into two: p_reason, the evidence, and p_message, the
-- member's explanation. It made the message MANDATORY for a warning, because
-- a warning is nothing but its notification.
--
-- It left the other half open, and recorded it as 121 rather than widening a
-- drop-and-recreate of four moderation functions. suspend and ban have always
-- required a reason; warn never has, and admin_audit_log.admin_note is
-- nullable. So after 0058 a warning could be issued with a carefully written
-- sentence for the member and NOTHING for the record — the exact inverse of
-- the fault 0058 existed to fix, arrived at by fixing it.
--
-- ── ⚠️ THE BAR IS NON-EMPTY, NOT TEN CHARACTERS, AND THAT IS A CHOICE ───
-- Matching suspend and ban exactly, which is what was asked for and is the
-- right call for a one-line change to a function three console pages call.
--
-- But it leaves the ledger inconsistent, and that should be said here rather
-- than discovered later: revoke_verification requires TEN characters of
-- reason (0044), while suspend, ban and now warn accept one. A reason of "x"
-- passes all three. Raising that bar is a separate decision about three live
-- actions, not a detail to slip into this migration.
--
-- ── WHY THIS ONE CAN USE create or replace ──────────────────────
-- The signature does not change. 0058 had to drop four functions because a
-- fifth DEFAULTED argument would have left two candidates and made every
-- existing call ambiguous; nothing here adds an argument, so the trap does
-- not apply, and grants and dependencies are preserved.
--
-- ── HOW THE BODY GOT HERE ────────────────────────────────
-- Extracted from 0058's own text, not retyped, and the ASSERT below refuses
-- to run unless the LIVE body is the one 0058 installed. That is the check
-- 0044 used (pg_get_functiondef ... 'is not the 0039 body'), and it is what
-- makes carrying a body forward safe: a file cannot be trusted on its own,
-- but a file plus a proof that the database agrees with it can be.
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
    raise exception '0059: the five-argument _admin_apply_user_action is missing. Apply 0058 first.';
  end if;

  v_def := pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure);

  if v_def not like '%a warning needs a message of at least 10 characters%' then
    raise exception '0059: the live _admin_apply_user_action is not the 0058 body. Read it before applying.';
  end if;
  if v_def like '%warn needs a reason%' then
    raise exception '0059: the live body already requires a reason for warn. This migration has run.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 0058's BODY, CARRIED VERBATIM, WITH ONE GUARD ADDED
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
      -- 0059, audit item 121. The MIRROR of what 0058 fixed. 0058 gave the
      -- member an explanation and left the record with nothing: warn was the
      -- only one of the three that never required a reason, and
      -- admin_audit_log.admin_note is nullable, so a warning could be issued
      -- with a sentence for them and no evidence for anyone.
      --
      -- Same bar as suspend and ban: non-empty. Deliberately NOT the message's
      -- ten characters -- see the header.
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'warn needs a reason' using errcode = '22023';
      end if;
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
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'suspend needs a reason' using errcode = '22023';
      end if;
      if p_duration_days is null or p_duration_days <= 0 then
        raise exception 'suspend needs a positive duration' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason, member_message)
      values (p_user_id, now() + make_interval(days => p_duration_days), false, p_reason, v_msg);
      v_withdrawn := public._withdraw_stylist(p_user_id);
      v_told := v_msg is not null;

    when 'ban' then
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'ban needs a reason' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason, member_message)
      values (p_user_id, null, true, p_reason, v_msg);
      v_withdrawn := public._withdraw_stylist(p_user_id);
      v_told := v_msg is not null;

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
  'shown to the member — it may name the person who reported them; p_message is '
  'written FOR the member and is the only part they read. warn REQUIRES BOTH since '
  '0059 (item 121): the message because a warning is nothing but its notification, '
  'the reason because an action with no evidence is not a record.';

-- Grants are untouched: create or replace preserves them, and this function is
-- executable by no client role in any case.

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0059', 'a_warning_needs_evidence_too', '06083eaa30ff99a314e36b803c39c51601bfbd48d8343c35a6f5f98a3142e7d5');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- Every condition the ASSERT tests, as a SELECT that ANSWERS instead of
-- raising. All three must be yes.
--
--   select 'the 5-arg _admin_apply_user_action exists' as needs,
--          to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is not null as present
--   union all
--   select 'the LIVE body is 0058''s',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure)
--            like '%a warning needs a message of at least 10 characters%'
--   union all
--   select 'it does NOT already require a reason for warn',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure)
--            not like '%warn needs a reason%';
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   The signature does not change, so nothing breaks in either direction.
--   Between the migration and the console deploy, a warning submitted with an
--   empty reason is refused by the database with 'warn needs a reason' rather
--   than by a disabled button. Ugly for one deploy, not harmful.
--
--   1. Preflight above.
--   2. Apply this migration.
--   3. node scripts/gen-supabase-types.mjs — nothing should change, since no
--      signature moves. Run it anyway so the stamp matches, or the freshness
--      check fails the build.
--   4. Build and deploy the admin console.
--   5. Block A below.
-- ===========================================================================
--
-- ── BLOCK A — a warning needs both, and still publishes only one ─────────
--
--   ⚠️ Needs the admin claim set: in the SQL editor auth.uid() is NULL, so
--   is_admin() is false and an admin-only function refuses the owner of the
--   database. 0057's blocks failed on exactly this.
--
--   do $blk$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_no_reason  text := 'NO — IT WAS ACCEPTED, WHICH IS WRONG';
--     v_no_message text := 'NO — IT WAS ACCEPTED, WHICH IS WRONG';
--     v_body text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     -- A message but no reason: must now be refused. This is item 121.
--     begin
--       perform public.admin_act_on_user(v_member, 'warn', null, null,
--         'Please keep messages to arranging the appointment.');
--     exception when others then v_no_reason := 'yes: ' || sqlerrm;
--     end;
--
--     -- A reason but no message: must still be refused. This is 0058, re-proved
--     -- because a body carried forward is exactly where a guard goes missing.
--     begin
--       perform public.admin_act_on_user(v_member, 'warn',
--         'INTERNAL EVIDENCE: a model called Sarah reported this account.');
--     exception when others then v_no_message := 'yes: ' || sqlerrm;
--     end;
--
--     perform public.admin_act_on_user(v_member, 'warn',
--       'INTERNAL EVIDENCE: a model called Sarah reported this account.',
--       null,
--       'Please keep messages to arranging the appointment.');
--
--     reset role;   -- as the admin, RLS would hide the member's own row
--
--     select body into v_body from public.notifications
--     where user_id = v_member and type = 'admin_warning'
--     order by created_at desc, id desc limit 1;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nmessage but no reason refused: %\nreason but no message refused: %\n\nbody:\n%\n\nreason leaked: %   <-- MUST be false',
--       v_no_reason, v_no_message, v_body,
--       (v_body ilike '%Sarah%' or v_body ilike '%INTERNAL%');
--   end $blk$;
--
-- ── WHAT IT DOES NOT PROVE ─────────────────────────────────
-- That the audit row carries the reason. It always has — admin_act_on_user
-- writes admin_note from p_reason and 0059 does not touch that path. What
-- changes is that the column can no longer be null for a warning.
-- ===========================================================================

-- ===========================================================================
-- 0061_suspend_and_ban_say_so
--
-- The two heaviest actions in the product stop happening in silence.
-- Audit item 119.
--
-- ⚠️ Apply 0060 first, and run suspension-enforcement.sql (item 123) first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────
-- Of the eight admin actions, only 'warn' has ever written a notification.
-- Suspend and ban — which stop somebody applying, messaging and reviewing, and
-- for a stylist hide her shop and cancel every upcoming booking — have always
-- written the suspension row and said nothing to the person it is about.
--
-- Mobile's SuspensionGate explains it at the door, so on the app they find out
-- when they next open it. The web has no gate at all (item 120), so there they
-- meet RLS refusals with no explanation.
--
-- ── ⚠️ WHY THE NOTIFICATION AND NOT JUST THE GATE ─────────────────
-- A gate only works on somebody who comes back and opens the app. The likeliest
-- next thing a suspended member does is try something, fail, and leave — and a
-- BAN means they may never open it again at all. The notification reaches them
-- where they already are, and it is the only thing that does.
--
-- ── IT EMAILS, AND THAT NEEDS A NEW TYPE ───────────────────────
-- 0047 keeps the emailed list in the trigger's WHEN clause, so an unlisted type
-- never reaches the function: one place, checked by the database.
--
-- 'admin_suspension' is added to it. The alternative was to reuse
-- 'admin_warning', which is already emailed and needs no trigger change —
-- rejected because both clients render notifications BY TYPE, so a ban would
-- have arrived wearing a warning's icon and, on mobile, a warning's detail
-- layout. A type that misdescribes its row is how a list of eight events
-- becomes untrustworthy.
--
-- ── ⚠️ A BAN NOW REQUIRES A MESSAGE. A SUSPENSION DOES NOT. ─────────
-- A ban's notification is the last thing this product ever sends that person.
-- A permanent closure with no reason at all is the worst version of that, and
-- there is no date and no end to fall back on. A suspension has both, so its
-- message stays optional and the notice stands up without one.
--
-- As ever since 0058: the MESSAGE, never the REASON. The reason is evidence and
-- may name whoever reported them.
--
-- ── AND IT SAYS WHAT HAPPENED TO THE SHOP ──────────────────────
-- Since 0044 both actions call _withdraw_stylist: shop hidden, every upcoming
-- booking cancelled, each model told. She will notice all of that, so silence
-- about it is its own message — and worse, she might not connect an empty diary
-- to this and go looking for a fault. Same reasoning 0057 used for revocation,
-- and the count comes from what _withdraw_stylist actually did.
--
-- The sentence is a shared function rather than a third copy of it: 0057 has
-- one, and two of these drifting apart would mean two members being told
-- different things about the same event.
--
-- ── HOW THE BODY GOT HERE ────────────────────────────────
-- Extracted from 0059's text, not retyped, and the ASSERT refuses to run unless
-- the LIVE body is the one 0059 installed. 0044's check, and the reason 0053's
-- lesson has not had to be learned twice.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_con text;
begin
  -- ⚠️ to_regprocedure, NOT to_regproc. 0056 refused itself on that (item 108).
  if to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is null then
    raise exception '0061: the five-argument _admin_apply_user_action is missing. Apply 0058 and 0059 first.';
  end if;

  v_def := pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure);
  if v_def not like '%warn needs a reason%' then
    raise exception '0061: the live _admin_apply_user_action is not the 0059 body. Read it before applying.';
  end if;
  if v_def like '%admin_suspension%' then
    raise exception '0061: the live body already writes admin_suspension. This migration has run.';
  end if;

  if to_regprocedure('public._withdraw_stylist(uuid)') is null then
    raise exception '0061: _withdraw_stylist(uuid) is missing. Apply 0044 first.';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'notify_email'
                   and tgrelid = 'public.notifications'::regclass) then
    raise exception '0061: the notify_email trigger is missing. Apply 0047 first.';
  end if;

  -- ⚠️ A NEW TYPE VALUE IS ONLY SAFE IF NOTHING CONSTRAINS THE COLUMN. Nothing
  -- in the repo does, but notifications predates the migration ledger, so this
  -- asks the database rather than trusting that.
  select pg_get_constraintdef(c.oid) into v_con
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%type%'
  limit 1;

  if v_con is not null and v_con not like '%admin_suspension%' then
    raise exception '0061: notifications.type has a CHECK that does not allow admin_suspension: %. Widen it first.', v_con;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE SENTENCE ABOUT THE SHOP, IN ONE PLACE
--
-- 0057 writes this for a revocation. Suspend and ban need the same words for
-- the same event, and a second copy is how two members get told different
-- things about one thing. Returns '' when nothing was cancelled, so callers
-- can concatenate without a branch.
-- ---------------------------------------------------------------------------
create or replace function public._withdrawn_sentence(p_withdrawn jsonb)
returns text
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case
    when coalesce((p_withdrawn->>'cancelled_bookings')::int, 0) = 0 then ''
    when (p_withdrawn->>'cancelled_bookings')::int = 1 then
      chr(10) || chr(10) ||
      'Your shop is hidden, and one upcoming booking has been cancelled and the '
      || 'model has been told. They were told the booking is off and that it was '
      || 'our decision, not yours.'
    else
      chr(10) || chr(10) ||
      'Your shop is hidden, and ' || (p_withdrawn->>'cancelled_bookings')
      || ' upcoming bookings have been cancelled and those models have been told. '
      || 'They were told the booking is off and that it was our decision, not yours.'
  end;
$$;

comment on function public._withdrawn_sentence(jsonb) is
  'What a stylist is told about her shop and her diary after _withdraw_stylist has '
  'run, from its own return value rather than from what we expect it did. Shared by '
  'suspend and ban (0061) so two members cannot be told different things about the '
  'same event. Returns '''' when nothing was cancelled. Audit items 117, 119.';

revoke all on function public._withdrawn_sentence(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 0059's BODY, CARRIED VERBATIM, WITH THE TWO BRANCHES THAT WENT QUIET
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
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'ban needs a reason' using errcode = '22023';
      end if;
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
  'read. warn and ban REQUIRE a message — warn because it is nothing but its '
  'notification (0059), ban because it is the last thing we ever send (0061). '
  'warn, suspend and ban all notify since 0061, and all three are emailed.';

-- ---------------------------------------------------------------------------
-- 3. THE EMAILED LIST GAINS ONE
--
-- 0047 keeps it in the trigger's WHEN clause so an unlisted type never reaches
-- the function. A WHEN clause cannot be altered, so the trigger is dropped and
-- recreated with the same name, the same function and one more value.
-- ---------------------------------------------------------------------------
drop trigger notify_email on public.notifications;

create trigger notify_email after insert on public.notifications
  for each row
  when (new.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension'))
  execute function public.tg_notify_email();

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0061', 'suspend_and_ban_say_so', 'cb32abcd71a9b6d2e768a3e43d4f3133bd4700c5c802131d686801bb8e425f65');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select 'the 5-arg _admin_apply_user_action exists' as needs,
--          to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is not null as present
--   union all
--   select 'the LIVE body is 0059''s',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure)
--            like '%warn needs a reason%'
--   union all
--   select 'it does NOT already write admin_suspension',
--          pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer, text)'::regprocedure)
--            not like '%admin_suspension%'
--   union all
--   select '_withdraw_stylist exists',
--          to_regprocedure('public._withdraw_stylist(uuid)') is not null
--   union all
--   select 'the notify_email trigger exists',
--          exists (select 1 from pg_trigger where tgname = 'notify_email'
--                    and tgrelid = 'public.notifications'::regclass)
--   union all
--   select 'nothing CHECK-constrains notifications.type against a new value',
--          not exists (select 1 from pg_constraint c
--                      where c.conrelid = 'public.notifications'::regclass and c.contype = 'c'
--                        and pg_get_constraintdef(c.oid) ilike '%type%'
--                        and pg_get_constraintdef(c.oid) not like '%admin_suspension%');
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   The signature does not change, so the console keeps working throughout.
--   What changes for an admin: a BAN is refused until they write a message.
--   The console goes out with this so that refusal is a disabled button rather
--   than an error after the fact.
--
--   1. Preflight above.
--   2. Apply this migration.
--   3. node scripts/gen-supabase-types.mjs --applied 0061
--   4. Deploy admin (message now required for ban) and the clients.
--   5. Blocks A and B below.
-- ===========================================================================
--
-- ── BLOCK A — a suspension says so, with a date, and no evidence ────────
--
--   do $blk$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_n record;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     perform public.admin_act_on_user(v_member, 'suspend',
--       'INTERNAL EVIDENCE: a model called Sarah reported this account.',
--       7,
--       'Messages to other members must stay about the appointment.');
--
--     reset role;   -- as the admin, RLS would hide the member's own row
--
--     select type, title, body into v_n from public.notifications
--     where user_id = v_member order by created_at desc, id desc limit 1;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n\ntype: %   <-- MUST be admin_suspension\ntitle: %\n\nbody:\n%\n\nreason leaked: %   <-- MUST be false',
--       v_n.type, v_n.title, v_n.body,
--       (v_n.body ilike '%Sarah%' or v_n.body ilike '%INTERNAL%');
--   end $blk$;
--
--   ⚠️ READ THE DATE. It comes from to_char on a timestamptz, so it renders in
--   the SESSION's timezone. If it is ever a day out for a UK member, that is
--   where to look.
--
-- ── BLOCK B — a ban needs a message, and says nothing about a way back ───
--
--   do $blk$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_refused text := 'NO — IT WAS ACCEPTED, WHICH IS WRONG';
--     v_body text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     begin
--       perform public.admin_act_on_user(v_member, 'ban', 'INTERNAL EVIDENCE: enough.');
--     exception when others then v_refused := 'yes: ' || sqlerrm;
--     end;
--
--     perform public.admin_act_on_user(v_member, 'ban', 'INTERNAL EVIDENCE: enough.',
--       null, 'Repeated contact with members after being asked to stop.');
--
--     reset role;
--
--     select body into v_body from public.notifications
--     where user_id = v_member and type = 'admin_suspension'
--     order by created_at desc, id desc limit 1;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nmessageless ban refused: %\n\nbody:\n%\n\nsays "until": %   <-- MUST be false\nreason leaked: %   <-- MUST be false',
--       v_refused, v_body,
--       v_body ilike '%until%',
--       (v_body ilike '%enough%' or v_body ilike '%INTERNAL%');
--   end $blk$;
--
-- ── WHAT NEITHER PROVES ──────────────────────────────────
-- That the email arrives. Both roll back, so the trigger's pg_net call never
-- commits. 'admin_suspension' is in the WHEN clause above, which is the part
-- that was missing; the only proof of delivery is a real inbox. Watch
-- email_sends after the first genuine suspension.
-- ===========================================================================

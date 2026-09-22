-- ===========================================================================
-- 0044_suspension_withdraws_the_stylist
--
-- Suspending or banning a stylist now does what revoking their verification
-- does: their shop is hidden and their upcoming bookings are cancelled, with a
-- notice to each model. Audit item 66. Decision: Micky, 22 Sep 2026 — "option 2.
-- Suspending or banning a stylist works like revocation (0027)".
--
-- ⚠️ Apply 0043 first. Written against 0027/0028 (revoke_verification), 0030
-- (cancellation_notice), 0016 (publish_provider_if_eligible) and 0039
-- (_admin_apply_user_action). The ASSERT refuses to run if any live body is
-- not the one this was written from.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- Suspend and ban (0039:263-280) replaced the `suspensions` row and did nothing
-- else. Nothing that lists shops checks for a suspension — not public_stylists
-- (0034), not web or mobile browse, not the stylist profile — so a suspended
-- stylist stayed listed and bookable. A model could still apply
-- (sessions_not_suspended checks the APPLICANT), and the stylist, unable to
-- send messages, could not reply. Meanwhile providers_not_suspended stopped the
-- stylist hiding their own shop. Suspension took away the one control that
-- would have helped and left everything else running.
--
-- ── ONE RULE, NOT A SECOND COPY ─────────────────────────────────────────
-- revoke_verification's cancel-and-notify loop could not be reused as it
-- stood: it was inline in revoke_verification. It is extracted here into
-- `_withdraw_stylist(user)`, and BOTH revocation and suspend/ban call it:
--
--   1. Hide every LIVE shop of that user, stamping first_published_at if it is
--      null (see "no automatic republish" below).
--   2. Cancel every upcoming booking where they are the stylist — status
--      pending or accepted, dated today or later. That is the project's one
--      definition of a live booking (0015). Completed, declined and already
--      cancelled bookings are not selected, so they stay exactly as they are.
--   3. Notify each model through cancellation_notice, the one place
--      cancellation wording lives (0029, 0030), under a new fourth kind,
--      'withdrawn'.
--
-- Revocation's HIDE is still done by trg_unpublish_on_verification_lost, which
-- clears first_published_at so re-verification republishes automatically
-- (0040:363-395). That is revocation's intended recovery and it is unchanged:
-- revoke_verification clears is_verified FIRST, the trigger hides the shop,
-- and _withdraw_stylist's hide then finds nothing live and touches nothing.
--
-- ── THE NOTICE ──────────────────────────────────────────────────────────
-- 'withdrawn' is revocation's reviewed wording (0027, trimmed by 0028), moved
-- verbatim into cancellation_notice with two changes:
--
--   * It gains the time and treatment, as the other three kinds did in 0030.
--   * "you can report it from their profile" becomes "email us at
--     support@cavybeauty.com". A withdrawn stylist's shop is unpublished, and
--     the providers SELECT policy is published-or-own (policy snapshot
--     :163), so the profile a model was sent to no longer opens. INFERRED from
--     the snapshot and both profile screens (site/lib/queries/stylist.ts:67-73,
--     mobile/src/app/(app)/provider/[id].tsx:163-166); not tried live.
--
-- It says neither "suspended" nor "revoked", and it is word for word the same
-- for both, so a model cannot tell which happened, or why.
--
-- ── NO AUTOMATIC REPUBLISH WHEN A SUSPENSION ENDS ───────────────────────
-- Auto-publish fires only while first_published_at is null (0016:313-316).
-- The hide stamps it with coalesce(first_published_at, now()), so a shop
-- hidden by a suspension stays hidden when the suspension ends or is lifted,
-- until the stylist publishes it again with the web control. Reinstate is
-- deliberately unchanged: it deletes the suspension and nothing else.
--
-- And the automatic path now refuses a suspended stylist outright:
-- publish_provider_if_eligible gains `and not is_suspended(p.user_id)`.
-- Without that, a verified stylist whose shop had NEVER been live (stamp still
-- null) would go live DURING their suspension the moment they added a first
-- treatment, because provider_treatments has no suspension policy and
-- trg_treatment_maybe_publish runs as definer.
--
-- ── NOT COVERED, ON PURPOSE ─────────────────────────────────────────────
-- * An admin APPROVING the verification of a suspended stylist still publishes
--   their shop explicitly (admin_decide_verification, 0039:604-608). That is an
--   admin decision taken with the account in front of them; recorded in item
--   66, not changed here.
-- * Suspending a MODEL does nothing to their bookings. _withdraw_stylist only
--   selects bookings where the user is the STYLIST. Item 66 records it.
--
-- ── EXISTING SUSPENSIONS ────────────────────────────────────────────────
-- Section 6 applies the same withdrawal to every stylist suspended or banned
-- right now, so the state after this migration does not depend on when the
-- suspension was made. Each result is recorded in migration_findings. Run
-- Block E BEFORE applying to see who that is.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the live bodies this was written from.
--
-- Every function below is REPLACED in full, so a live body that has drifted
-- from the repo would be silently overwritten. Each check matches code, not
-- commentary (migration-status.mjs, "the thing from the commentary"): the
-- markers are string literals or expressions only the code contains.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- cancellation_notice, 0030's six-argument signature.
  if to_regprocedure('public.cancellation_notice(text, text, date, text, time, text)') is null then
    raise exception '0044: public.cancellation_notice(text, text, date, text, time, text) is missing. Apply 0030 first.';
  end if;
  v_def := pg_get_functiondef('public.cancellation_notice(text, text, date, text, time, text)'::regprocedure);
  if v_def not like '%won''''t be going ahead. Nothing %' or v_def like '%''withdrawn''%' then
    raise exception '0044: cancellation_notice is not the 0030 body (or already has a ''withdrawn'' kind). Read it before applying.';
  end if;

  -- revoke_verification, 0028's body: the inline loop with its own notice.
  if to_regprocedure('public.revoke_verification(uuid, text)') is null then
    raise exception '0044: public.revoke_verification(uuid, text) is missing. Apply 0027 and 0028 first.';
  end if;
  v_def := pg_get_functiondef('public.revoke_verification(uuid, text)'::regprocedure);
  if v_def not like '%''We''''ve cancelled your booking with ''%' or v_def like '%_withdraw_stylist%' then
    raise exception '0044: revoke_verification is not the 0028 body. Read it before applying.';
  end if;

  -- _admin_apply_user_action, 0039's body.
  if to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer)') is null then
    raise exception '0044: public._admin_apply_user_action is missing. Apply 0039 first.';
  end if;
  v_def := pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer)'::regprocedure);
  if v_def not like '%''suspend needs a positive duration''%'
     or v_def not like '%when ''comp'' then%'
     or v_def like '%_withdraw_stylist%' then
    raise exception '0044: _admin_apply_user_action is not the 0039 body. Read it before applying.';
  end if;

  -- publish_provider_if_eligible, 0016's body.
  if to_regprocedure('public.publish_provider_if_eligible(uuid)') is null then
    raise exception '0044: public.publish_provider_if_eligible(uuid) is missing. Apply 0016 first.';
  end if;
  v_def := pg_get_functiondef('public.publish_provider_if_eligible(uuid)'::regprocedure);
  if v_def not like '%p.first_published_at is null%'
     or v_def not like '%provider_shop_is_publishable(p.id)%'
     or v_def like '%is_suspended%' then
    raise exception '0044: publish_provider_if_eligible is not the 0016 body. Read it before applying.';
  end if;

  if to_regprocedure('public.is_suspended(uuid)') is null then
    raise exception '0044: public.is_suspended(uuid) is missing (suspension-enforcement.sql).';
  end if;

  -- sessions carries the 0029 cancellation columns this writes.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'cancelled_at'
  ) then
    raise exception '0044: sessions.cancelled_at is missing. Apply 0029 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE — who is suspended now and what they hold, before anything changes.
-- Counts only: no ids, no names.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0044', 'suspended_accounts_before', count(*)::text
from public.users u where public.is_suspended(u.id);

insert into public.migration_findings (version, item, value)
select '0044', 'suspended_stylists_live_shops_before', count(*)::text
from public.providers p where p.is_published is true and public.is_suspended(p.user_id);

insert into public.migration_findings (version, item, value)
select '0044', 'suspended_stylists_upcoming_bookings_before', count(*)::text
from public.sessions s join public.providers p on p.id = s.provider_id
where public.is_suspended(p.user_id)
  and s.status in ('pending', 'accepted') and s.date >= current_date;

-- ---------------------------------------------------------------------------
-- 1. cancellation_notice — a fourth kind, 'withdrawn'.
--
-- Same signature, so this REPLACES rather than overloads (0030's header). The
-- three existing kinds are copied unchanged from 0030.
-- ---------------------------------------------------------------------------
create or replace function public.cancellation_notice(
  p_kind       text,          -- 'block' | 'by_stylist' | 'by_model' | 'withdrawn'
  p_other_name text,
  p_date       date,
  p_reason     text default null,
  p_start_time time default null,
  p_treatment  text default null
) returns table (title text, body text)
-- STABLE, not IMMUTABLE: to_char() depends on lc_time.
language plpgsql stable
as $$
declare
  -- "16 September at 2:30pm", or "16 September" when there is no time on the
  -- row. On the hour reads as "2pm" rather than "2:00pm".
  v_time text := case
                   when p_start_time is null then ''
                   when extract(minute from p_start_time) = 0
                     then ' at ' || lower(to_char(p_start_time, 'FMHH12am'))
                   else ' at ' || lower(to_char(p_start_time, 'FMHH12:MIam'))
                 end;
  v_when text := to_char(p_date, 'FMDD FMMonth') || v_time;
  v_who  text := coalesce(nullif(btrim(coalesce(p_other_name, '')), ''), 'your stylist');
  v_what text := case
                   when nullif(btrim(coalesce(p_treatment, '')), '') is null then ''
                   else ' (' || btrim(p_treatment) || ')'
                 end;
  v_said text := case
                   when nullif(btrim(coalesce(p_reason, '')), '') is null then ''
                   else chr(10) || chr(10) || 'They said: "' || btrim(p_reason) || '"'
                 end;
begin
  if p_kind = 'block' then
    -- ⚠️ DO NOT ADD A REASON TO THIS ONE, AND DO NOT ADD "we can't explain why".
    --
    -- The recipient does not know a block happened and must not learn it from a
    -- notification. Any hint of cause narrows it to one person.
    --
    -- "We can't share why" is also wrong here, and not only for being coy: the
    -- platform did not decide anything. A person did. Implying an institutional
    -- judgement invites the reader to picture a file and a finding that do not
    -- exist. Silence about cause is the honest answer, not a withheld one.
    --
    -- The time and treatment are safe to add: they identify WHICH booking, and
    -- say nothing about why. That distinction is the test for anything else
    -- anyone ever wants to put in this branch.
    return query select
      'Your booking on ' || v_when || ' has been cancelled',
      'Your booking with ' || v_who || v_what || ' won''t be going ahead. Nothing '
      || 'about your account has changed.' || chr(10) || chr(10)
      || 'You can find another stylist in Browse.';

  elsif p_kind = 'by_stylist' then
    return query select
      v_who || ' cancelled your booking on ' || v_when,
      v_who || ' can no longer make this appointment' || v_what || '.' || v_said
      || chr(10) || chr(10)
      || 'That slot has been released. You can apply to another stylist in Browse.';

  elsif p_kind = 'by_model' then
    -- The identifying detail matters most here. A stylist with a 10am and a 3pm
    -- on the same day was being told only the date, and had to go and look.
    return query select
      v_who || ' cancelled their booking on ' || v_when,
      'That ' || v_when || v_what || ' slot is free again and back on your calendar.'
      || v_said;

  elsif p_kind = 'withdrawn' then
    -- The PLATFORM cancelled: a revocation, a suspension or a ban. ⚠️ ONE
    -- MESSAGE FOR ALL THREE, and it must stay that way. It must not name which
    -- one, and it must never take p_reason — the admin's reason is moderation
    -- evidence about the stylist, not something to publish to a model.
    --
    -- Unlike the block case, "our decision" and "we're not able to explain
    -- why" are TRUE here: the platform did decide. Wording from 0027/0028,
    -- where it was reviewed. The one sentence changed (0044) sent the model to
    -- report from the stylist's profile, which no longer opens once the shop is
    -- hidden; it now gives the support address.
    return query select
      'Your booking on ' || v_when || ' has been cancelled',
      'We''ve cancelled your booking with ' || v_who || v_what || '. This was our '
      || 'decision, not theirs and not yours — they can''t take bookings on Cavy at '
      || 'the moment.' || chr(10) || chr(10)
      || 'We''re not able to explain why. Nothing about your account has changed, and '
      || 'this isn''t a mark against you.' || chr(10) || chr(10)
      || 'If anything about this stylist has worried you, email us at '
      || 'support@cavybeauty.com — that reaches us whether or not they''re still on '
      || 'Cavy.' || chr(10) || chr(10)
      || 'Sorry for the disruption. You can find another stylist in Browse.';

  else
    raise exception 'cancellation_notice: unknown kind %', p_kind;
  end if;
end $$;

comment on function public.cancellation_notice(text, text, date, text, time, text) is
  'The only place the four cancellation messages are written. They must not '
  'converge: the block case is silent about CAUSE on purpose, and adding a reason '
  '"for consistency" would leak who blocked whom. ''withdrawn'' (0044) is the '
  'platform cancelling — revocation, suspension and ban share it word for word so '
  'a model cannot tell which happened, and it never carries the admin''s reason. '
  'Time and treatment are safe in all four — they identify which booking and say '
  'nothing about why, which is the test for anything else anyone wants to add here.';

-- ---------------------------------------------------------------------------
-- 2. _withdraw_stylist — the one rule. Hide, cancel, notify.
--
-- SECURITY INVOKER and executable by no client role, like
-- _admin_apply_user_action: it runs with its caller's privileges, and its only
-- callers are SECURITY DEFINER admin functions (and this migration's backfill).
-- It checks nothing about WHO is calling; its callers do.
--
-- The booking status guard (enforce_session_status_transition) lets these
-- cancellations through because the caller is an admin, or auth.uid() is null
-- in the backfill — the same two cases revoke_verification has always relied on.
-- ---------------------------------------------------------------------------
create function public._withdraw_stylist(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_hidden    int := 0;
  v_cancelled int := 0;
  v_sess      record;
  v_name      text;
  v_treat     text;
  v_notice    record;
begin
  -- 1. Hide. LIVE shops only: a shop the stylist had already hidden keeps its
  --    own state. The stamp is what stops auto-publish putting it back
  --    (0016:313-316), so a suspension that ends leaves the shop hidden until
  --    the stylist republishes it.
  update public.providers
     set is_published       = false,
         first_published_at = coalesce(first_published_at, now())
   where user_id = p_user_id
     and is_published is true;
  get diagnostics v_hidden = row_count;

  -- 2 and 3. Cancel upcoming bookings where they are the STYLIST, and tell each
  --    model. "Upcoming" is 0015's definition: pending or accepted, dated today
  --    or later. Completed bookings are never selected.
  for v_sess in
    select s.id, s.date, s.start_time, s.treatment_id, s.model_user_id, s.provider_id
    from public.sessions s
    join public.providers p on p.id = s.provider_id
    where p.user_id = p_user_id
      and s.status in ('pending', 'accepted')
      and s.date >= current_date
  loop
    -- cancelled_by stays NULL, as in a block cascade: the platform cancelled,
    -- and who acted is in admin_audit_log / moderation_actions, not here.
    update public.sessions
       set status = 'cancelled', cancelled_at = now()
     where id = v_sess.id;
    v_cancelled := v_cancelled + 1;

    select nullif(btrim(coalesce(p.name, '')), '') into v_name
    from public.providers p where p.id = v_sess.provider_id;
    select coalesce(nullif(btrim(coalesce(t.name, '')), ''), t.category) into v_treat
    from public.provider_treatments t where t.id = v_sess.treatment_id;

    select * into v_notice
    from public.cancellation_notice('withdrawn', v_name, v_sess.date, null,
                                    v_sess.start_time, v_treat);

    if v_sess.model_user_id is not null then
      insert into public.notifications (user_id, type, title, body, session_id)
      values (v_sess.model_user_id, 'session_cancelled', v_notice.title, v_notice.body, v_sess.id);
    end if;
  end loop;

  return jsonb_build_object('shops_hidden', v_hidden, 'cancelled_bookings', v_cancelled);
end
$$;

comment on function public._withdraw_stylist(uuid) is
  'The one rule for the platform withdrawing a stylist: hide every live shop '
  '(stamping first_published_at so auto-publish cannot put it back), cancel every '
  'upcoming booking where they are the stylist (pending/accepted, date >= today; '
  'completed ones untouched), and notify each model with cancellation_notice '
  '''withdrawn''. Called by revoke_verification and by suspend/ban in '
  '_admin_apply_user_action. SECURITY INVOKER; executable by no client role. '
  '0044; audit item 66.';

revoke all on function public._withdraw_stylist(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. revoke_verification — its loop replaced by the shared function.
--
-- Everything else is 0028's body. is_verified is cleared FIRST, so
-- trg_unpublish_on_verification_lost does revocation's own hide (clearing
-- first_published_at, 0040) before _withdraw_stylist runs; its hide then finds
-- nothing live. The notice models receive gains time and treatment, and the
-- profile sentence becomes the support address (see header).
-- ---------------------------------------------------------------------------
create or replace function public.revoke_verification(
  p_user_id uuid,
  p_reason  text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin     uuid := auth.uid();
  v_withdrawn jsonb;
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
  -- The shared rule since 0044, so suspension and ban cannot drift from it.
  v_withdrawn := public._withdraw_stylist(p_user_id);

  -- The audit row, last, so it records what actually happened.
  insert into public.moderation_actions (admin_id, target_user_id, action, reason)
  values (v_admin, p_user_id, 'revoke_verification', btrim(p_reason));

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'cancelled_bookings', (v_withdrawn->>'cancelled_bookings')::int
  );
end $$;

comment on function public.revoke_verification(uuid, text) is
  'Admin-only. Clears users.is_verified, unpublishes via '
  'trg_unpublish_on_verification_lost, deletes the verification_requests row so the '
  'account can resubmit, cancels every future pending/accepted booking with a '
  'notification to each model (via _withdraw_stylist since 0044, shared with '
  'suspend and ban), and records a moderation_actions row. One transaction: a '
  'failure anywhere leaves none of it done. There is deliberately no "keep the '
  'bookings" option — cancelling wrongly is recoverable, leaving a booking standing '
  'wrongly is not.';

-- ---------------------------------------------------------------------------
-- 4. _admin_apply_user_action — suspend and ban withdraw the stylist.
--
-- 0039's body, with two changes only: suspend and ban call _withdraw_stylist
-- after writing the suspension, and its counts are returned, so they reach
-- admin_audit_log.details through every caller's `|| v_result`. Reinstate is
-- unchanged on purpose: lifting a suspension does NOT republish (header).
--
-- For a model the call is harmless: no shop, no bookings as stylist, and the
-- result reads zero of each.
-- ---------------------------------------------------------------------------
create or replace function public._admin_apply_user_action(
  p_user_id       uuid,
  p_action        text,
  p_reason        text,
  p_duration_days integer
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new       boolean;
  v_withdrawn jsonb;
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
    when 'warn' then
      insert into public.notifications (user_id, type, title, body)
      values (
        p_user_id,
        'admin_warning',
        'Warning from Cavy',
        coalesce(nullif(btrim(p_reason), ''), 'You have received an official warning.')
      );

    -- Replace, not stack. suspensions has no unique constraint on user_id, and
    -- reinstate already deletes every row, so the table is current state;
    -- history is admin_audit_log. (0035.)
    --
    -- Since 0044 both also withdraw a stylist: shop hidden, upcoming bookings
    -- cancelled, each model notified. Same rule as revocation.
    when 'suspend' then
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'suspend needs a reason' using errcode = '22023';
      end if;
      if p_duration_days is null or p_duration_days <= 0 then
        raise exception 'suspend needs a positive duration' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason)
      values (p_user_id, now() + make_interval(days => p_duration_days), false, p_reason);
      v_withdrawn := public._withdraw_stylist(p_user_id);

    when 'ban' then
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'ban needs a reason' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason)
      values (p_user_id, null, true, p_reason);
      v_withdrawn := public._withdraw_stylist(p_user_id);

    -- Deletes the suspension and nothing else. The shop stays hidden: the
    -- stylist republishes it themselves (0044).
    when 'reinstate' then
      delete from public.suspensions where user_id = p_user_id;

    -- The auto-publish chain runs on false → true as it always has. This does
    -- not add an explicit publish: that is ⟨D1⟩, and it belongs to the
    -- verification decision, not to a bare "verify" button. What it adds is
    -- telling the caller what happened to the shops.
    when 'verify' then
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

  return jsonb_strip_nulls(jsonb_build_object('new_value', v_new))
         || coalesce(v_withdrawn, '{}'::jsonb);
end
$$;

comment on function public._admin_apply_user_action(uuid, text, text, integer) is
  'The single implementation of warn, suspend, ban, reinstate, verify, flag, waive '
  'and comp, shared by admin_act_on_user, admin_act_on_report and '
  'admin_act_on_provider so the three surfaces cannot behave differently. Since '
  '0044 suspend and ban also call _withdraw_stylist and return {shops_hidden, '
  'cancelled_bookings}; reinstate does not republish. Writes no audit row — its '
  'callers do. SECURITY INVOKER and not executable by any client role. 0039, 0044; '
  'audit items 29, 66.';

revoke all on function public._admin_apply_user_action(uuid, text, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. publish_provider_if_eligible — never for a suspended stylist.
--
-- 0016's body with one added condition. When the suspension ends, a shop that
-- was never live publishes on the next change that fires the triggers, exactly
-- as it would have; a shop that WAS live stays hidden, because of the stamp.
-- ---------------------------------------------------------------------------
create or replace function public.publish_provider_if_eligible(p_provider_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.providers p
     set is_published       = true,
         first_published_at = now()
   where p.id = p_provider_id
     and p.is_published is not true
     and p.first_published_at is null          -- once, ever. See 0016's header.
     and public.provider_shop_is_publishable(p.id)
     and exists (
       select 1 from public.users u
       where u.id = p.user_id and u.is_verified is true
     )
     -- 0044: a suspended or banned stylist is never published automatically.
     and not public.is_suspended(p.user_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. EXISTING SUSPENSIONS — the same withdrawal for everyone suspended now.
--
-- Only accounts with a shop. Each result goes to migration_findings under the
-- user id (no name, no email). Notifications sent here are real: a model with
-- an upcoming booking with a currently-suspended stylist is told it is
-- cancelled. Block E, run BEFORE applying, lists exactly who that is.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0044', 'backfill_' || u.user_id::text, public._withdraw_stylist(u.user_id)::text
from (
  select distinct p.user_id
  from public.providers p
  where public.is_suspended(p.user_id)
) u;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0044', 'suspension_withdraws_the_stylist', '31bc05d319d974b0557a3f5aca53c11ea2a519dd3cafd172c67a42cacdd1774e');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — one block at a time, in the Supabase SQL editor.
--
-- Blocks that act roll themselves back with ROLLED BACK ON PURPOSE; that error
-- IS the result. Admin-only paths set Micky B's claim first (ff06d568…, an
-- admin row) and print is_admin(), so a claim that did not carry reads as
-- false rather than as a confusing refusal later.
-- ===========================================================================
--
-- ── BLOCK E — RUN BEFORE APPLYING. Who section 6 will withdraw ──────────
--
-- Emails are printed; after item 64 the only accounts left are Micky's own.
--
--   select a.email,
--          (select count(*) from public.providers p
--            where p.user_id = a.id and p.is_published) as live_shops,
--          (select count(*) from public.sessions s
--             join public.providers p on p.id = s.provider_id
--            where p.user_id = a.id and s.status in ('pending','accepted')
--              and s.date >= current_date)                   as upcoming_bookings_as_stylist
--   from auth.users a
--   where public.is_suspended(a.id)
--     and exists (select 1 from public.providers p where p.user_id = a.id)
--   order by a.email;
--
--   Every row is a stylist section 6 will act on. upcoming_bookings_as_stylist
--   is how many models will get a 'withdrawn' notice at apply time.
--
-- ── BLOCK A — the definitions. Read-only ────────────────────────────────
--
--   select
--     pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer)'::regprocedure)
--       like '%v_withdrawn := public._withdraw_stylist(p_user_id);%'          as suspend_ban_call_it,
--     pg_get_functiondef('public.revoke_verification(uuid, text)'::regprocedure)
--       like '%v_withdrawn := public._withdraw_stylist(p_user_id);%'          as revoke_calls_it,
--     pg_get_functiondef('public.revoke_verification(uuid, text)'::regprocedure)
--       like '%''We''''ve cancelled your booking with ''%'                    as revoke_still_has_old_loop,
--     pg_get_functiondef('public.publish_provider_if_eligible(uuid)'::regprocedure)
--       like '%and not public.is_suspended(p.user_id)%'                       as autopublish_checks_suspension,
--     has_function_privilege('anon',          'public._withdraw_stylist(uuid)', 'execute') as anon_can_run,
--     has_function_privilege('authenticated', 'public._withdraw_stylist(uuid)', 'execute') as authed_can_run,
--     (select value from public.migration_findings
--       where version = '0044' and item = 'suspended_accounts_before')        as suspended_before;
--
--   Expect: true, true, false, true, false, false, and the count Block E
--   implied. The backfill results are the rows with item like 'backfill_%'.
--
-- ── BLOCK B — the four notices, side by side. Read-only ─────────────────
--
-- Printed for a person to READ, as 0029's Block A was: the defect 0030 fixed
-- was only visible with the messages next to each other.
--
--   select k.kind, n.title, n.body
--   from unnest(array['block', 'by_stylist', 'by_model', 'withdrawn']) as k(kind)
--   cross join lateral public.cancellation_notice(
--     k.kind, 'Sam', date '2026-10-16', 'A REASON THAT MUST NOT APPEAR IN block OR withdrawn',
--     time '14:30', 'Balayage') n;
--
--   Expect: the reason appears in by_stylist and by_model only. withdrawn says
--   neither "suspended" nor "revoked", and gives support@cavybeauty.com.
--
-- ── BLOCK C — suspend withdraws the stylist; reinstate does not republish.
--               Rolls itself back ──────────────────────────────────────────
--
-- Uses Micky B's own shop (the one live shop, published again on 22 Sep) and
-- his admin claim. He is suspended and reinstated inside the transaction; all
-- of it, including any model notifications, is rolled back.
--
--   do $$
--   declare
--     v_me   constant uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_res  jsonb; v_pub boolean; v_stamp timestamptz; v_up int; v_done_before int;
--     v_done_after int; v_ids uuid[]; v_notes_before int; v_notes int; v_log text := '';
--   begin
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_me), true);
--     v_log := format('is_admin=%s (must be true)', public.is_admin());
--
--     select is_published into v_pub from public.providers where user_id = v_me;
--     select count(*) into v_up from public.sessions s join public.providers p on p.id = s.provider_id
--      where p.user_id = v_me and s.status in ('pending','accepted') and s.date >= current_date;
--     select count(*) into v_done_before from public.sessions s join public.providers p on p.id = s.provider_id
--      where p.user_id = v_me and s.status = 'completed';
--     -- The upcoming bookings' ids, captured as a value now: re-running the
--     -- same query after the suspension would find none (migration-status.mjs,
--     -- "no subquery that the block's own write invalidates").
--     v_ids := array(select s.id from public.sessions s join public.providers p on p.id = s.provider_id
--                     where p.user_id = v_me and s.status in ('pending','accepted') and s.date >= current_date);
--     select count(*) into v_notes_before from public.notifications
--      where type = 'session_cancelled' and session_id = any(v_ids);
--     v_log := v_log || format(E'\nBEFORE: published=%s upcoming=%s completed=%s', v_pub, v_up, v_done_before);
--
--     v_res := public.admin_act_on_user(v_me, 'suspend', 'verify 0044, rolled back', 1);
--     select is_published, first_published_at into v_pub, v_stamp from public.providers where user_id = v_me;
--     select count(*) into v_up from public.sessions s join public.providers p on p.id = s.provider_id
--      where p.user_id = v_me and s.status in ('pending','accepted') and s.date >= current_date;
--     select count(*) into v_done_after from public.sessions s join public.providers p on p.id = s.provider_id
--      where p.user_id = v_me and s.status = 'completed';
--     select count(*) - v_notes_before into v_notes from public.notifications
--      where type = 'session_cancelled' and session_id = any(v_ids);
--     v_log := v_log || format(E'\nSUSPENDED: result=%s published=%s stamped=%s upcoming=%s completed=%s notices=%s',
--                              v_res, v_pub, v_stamp is not null, v_up, v_done_after, v_notes);
--
--     perform public.admin_act_on_user(v_me, 'reinstate', 'verify 0044, rolled back');
--     -- A no-op change fires trg_provider_maybe_publish's WHEN test.
--     update public.providers set name = name where user_id = v_me;
--     select is_published into v_pub from public.providers where user_id = v_me;
--     v_log := v_log || format(E'\nREINSTATED: published=%s  (must be false — no automatic republish)', v_pub);
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n%', v_log;
--   end $$;
--
--   Expect: is_admin true. SUSPENDED: shops_hidden 1, cancelled_bookings equal
--   to BEFORE's upcoming, published false, stamped true, upcoming 0,
--   completed unchanged, notices equal to cancelled_bookings. REINSTATED:
--   published false.
--
-- ── BLOCK D — auto-publish refuses a suspended stylist. Rolls itself back ─
--
-- nahitih259 (517c2853…) is suspended and hidden. Clearing its stamp makes it
-- look never-published, which is the only state auto-publish acts on.
--
--   do $$
--   declare
--     v_id constant uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_prov uuid; v_pub boolean; v_log text := '';
--   begin
--     select id into v_prov from public.providers where user_id = v_id;
--     v_log := format('suspended=%s verified=%s publishable=%s',
--                     public.is_suspended(v_id),
--                     (select is_verified from public.users where id = v_id),
--                     public.provider_shop_is_publishable(v_prov));
--     update public.providers set first_published_at = null where id = v_prov;
--     perform public.publish_provider_if_eligible(v_prov);
--     select is_published into v_pub from public.providers where id = v_prov;
--     v_log := v_log || format(E'\nafter auto-publish attempt: published=%s  (must be false)', v_pub);
--     raise exception E'ROLLED BACK ON PURPOSE.\n%', v_log;
--   end $$;
--
--   Expect suspended true. If verified or publishable reads false, the block
--   proves nothing about the new condition: the other rules would refuse
--   anyway. Say so rather than read it as a pass.

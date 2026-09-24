-- ===========================================================================
-- 0058_the_reason_is_evidence_not_an_explanation
--
-- The admin's evidence stops being shown to the person it is about. Item 118.
--
-- ⚠️ Apply 0057 first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────
-- One field, p_reason, has been doing two incompatible jobs: moderation
-- evidence kept for six years, and an explanation published to the member.
-- Three of the eight actions publish it:
--
--   warn      → straight into the notification body, in-app AND by email
--               ('admin_warning' is on 0047's emailed list)
--   suspend   → suspensions.reason
--   ban       → suspensions.reason
--
-- 0057 gave revoke_verification two fields for exactly this reason: a reason
-- written for an admin may name a third party — "a model called Sarah
-- reported this account" — and publishing it verbatim discloses who reported
-- them. That is the disclosure this product refuses everywhere else: who
-- blocked whom (0029:280), who cancelled under a withdrawn notice (0044:329).
-- 0057 fixed one function and recorded that the same landmine was still armed
-- in three more. This is that.
--
-- ── ⚠️ SUSPEND AND BAN ARE THE WORSE HALF, AND NOT FOR A UI REASON ──────
-- The reason does not reach a suspended member because a screen chose to
-- render it. my_suspension() is SECURITY DEFINER and RETURNS it, and mobile's
-- SuspensionGate prints it under a heading that says "Reason". Any client —
-- or anyone with the anon key and a session — gets the same string. Hiding it
-- in the app would have changed nothing, so the function changes shape here.
--
-- Checked, 24 Sep: suspensions has RLS enabled with ONE policy, susp_admin,
-- ALL/PERMISSIVE, qualified on is_admin(). The table grant to `authenticated`
-- exists but no policy grants a member any row, including their own, so RLS
-- denies by default. **my_suspension() is the only route the reason has ever
-- had to a member.** Closing it closes the whole route.
--
-- ── WHAT A MEMBER READS AFTER THIS ──────────────────────────────────────
-- Warned:     the admin's message, which is now mandatory (below).
-- Suspended:  the fixed sentence and the date that SuspensionGate already
--             shows — "suspended until 3 October. You won't be able to apply
--             for treatments, send messages or leave reviews until then" —
--             and, when there is one, the admin's message where the evidence
--             used to be. No new copy: the sentence exists and is already
--             right. A blank screen where the explanation was would be worse
--             than today, and a suspended member can act on nothing until it
--             expires.
--
-- ── ⚠️ A WARNING NOW REQUIRES A MESSAGE. TEN CHARACTERS. ────────────────
-- A warning is the one action whose ENTIRE effect is the notification. With
-- no message it sent "You have received an official warning." and nothing
-- else — which tells someone their account is in trouble and gives them no
-- idea what to stop doing. Mandatory here alone; suspend and ban keep it
-- optional, having a fixed sentence and a duration to fall back on.
--
-- ── ⚠️ A GAP THIS DOES NOT CLOSE, ON PURPOSE ────────────────────────────
-- 'warn' still does not require a REASON: suspend and ban do, warn never has,
-- and its admin_audit_log.admin_note may be null. So a warning can be issued
-- with an explanation for the member and no evidence for the record. That is
-- a real hole and it is not this migration's — widening scope inside a
-- drop-and-recreate of four moderation functions is how a change like this
-- goes wrong. Recorded as its own item.
--
-- ── ⚠️ WHY FOUR FUNCTIONS ARE DROPPED RATHER THAN REPLACED ──────────────
-- All four already default p_reason and p_duration_days. Adding a fifth
-- DEFAULTED argument with `create or replace` leaves BOTH functions in
-- place, and every existing four-argument call then matches two candidates
-- and fails as "function is not unique" — at runtime, in the admin console,
-- mid-suspension. 0057's trap, four times over.
--
-- Postgres does not track function-to-function dependencies (a plpgsql body
-- is not parsed at create time), so dropping the shared implementation while
-- its three callers reference it raises nothing and would simply break them
-- until they are recreated. All of it is one transaction, so no such window
-- exists.
--
-- ⚠️ A DROPPED FUNCTION LOSES ITS GRANTS AND ITS COMMENT. Every grant and
-- comment from 0039 is re-applied below. Without them the console cannot call
-- any of the three entry points at all — a silent, total failure of the
-- moderation surface.
--
-- ── WHAT IS CARRIED VERBATIM ────────────────────────────────────────────
-- Every body below was read from pg_get_functiondef on 24 Sep 2026, not from
-- 0039. 0044 and 0045 both replaced _admin_apply_user_action, so the file is
-- demonstrably not what runs — the mistake that cost 0053.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  -- ⚠️ to_regprocedure, NOT to_regproc. 0056 refused itself on that (item 108).
  if to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer)') is null then
    raise exception '0058: _admin_apply_user_action(uuid,text,text,integer) is missing. Apply 0039/0044/0045 first.';
  end if;
  if to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is not null then
    raise exception '0058: a five-argument _admin_apply_user_action already exists. Read it before applying.';
  end if;
  if to_regprocedure('public.admin_act_on_user(uuid, text, text, integer)') is null
     or to_regprocedure('public.admin_act_on_report(uuid, text, text, integer)') is null
     or to_regprocedure('public.admin_act_on_provider(uuid, text, text, integer)') is null then
    raise exception '0058: one of the three admin_act_on_* entry points is missing. Apply 0039 first.';
  end if;
  if to_regprocedure('public.admin_act_on_user(uuid, text, text, integer, text)') is not null
     or to_regprocedure('public.admin_act_on_report(uuid, text, text, integer, text)') is not null
     or to_regprocedure('public.admin_act_on_provider(uuid, text, text, integer, text)') is not null then
    raise exception '0058: a five-argument admin_act_on_* already exists. Read it before applying.';
  end if;
  if to_regprocedure('public.my_suspension()') is null then
    raise exception '0058: my_suspension() is missing.';
  end if;
  if to_regprocedure('public._withdraw_stylist(uuid)') is null
     or to_regprocedure('public._provider_shops_state(uuid)') is null
     or to_regprocedure('public.provider_fee_settled(uuid)') is null then
    raise exception '0058: a function the carried bodies call is missing. Apply 0044 and 0045 first.';
  end if;
  if to_regclass('public.suspensions') is null then
    raise exception '0058: public.suspensions is missing.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'suspensions'
               and column_name = 'member_message') then
    raise exception '0058: suspensions.member_message already exists. This migration has run.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE SECOND FIELD
--
-- reason stays exactly as it is, including NOT NULL — 0035:97 guards that and
-- its reason guard assumes it. What changes is that it stops being read by
-- anyone but an admin.
-- ---------------------------------------------------------------------------
alter table public.suspensions add column member_message text;

comment on column public.suspensions.reason is
  'MODERATION EVIDENCE. Admin-facing only, and may name the person who reported '
  'the member. NEVER return this to the member — that is what member_message is '
  'for. Reachable only through susp_admin (RLS) since 0058, audit item 118.';

comment on column public.suspensions.member_message is
  'Optional, written FOR the suspended member, and the only part of the row they '
  'read — my_suspension() returns this and not reason. 0058, audit item 118.';

-- ---------------------------------------------------------------------------
-- 2. my_suspension() — THE ACTUAL FIX
--
-- Dropped rather than replaced: a RETURNS TABLE column cannot be renamed or
-- retyped by `create or replace`.
--
-- ⚠️ GRANTS. There is no explicit grant on the old one anywhere in the ledger
-- — it predates the migrations and has been executable by PUBLIC by default.
-- Re-granted below to authenticated AND anon, which is what it effectively has
-- today: called before auth resolves it returns no rows, and turning that into
-- a permission error would be a new failure mode, not a fix.
-- ---------------------------------------------------------------------------
drop function public.my_suspension();

create function public.my_suspension()
returns table(banned boolean, suspended_until timestamp with time zone, message text)
language sql stable security definer set search_path to 'public' as $$
  select s.banned, s.suspended_until, s.member_message
  from public.suspensions s
  where s.user_id = auth.uid()
    and (s.banned = true
         or (s.suspended_until is not null and s.suspended_until > now()))
  order by s.banned desc, s.suspended_until desc nulls last
  limit 1;
$$;

comment on function public.my_suspension() is
  'The caller''s own active suspension or ban, for the gate that stops them at the '
  'door. SECURITY DEFINER because suspensions is readable only by admins under RLS. '
  '⚠️ RETURNS member_message, NOT reason: the reason is moderation evidence and may '
  'name the person who reported them. It returned reason until 0058 and mobile printed '
  'it under a heading saying "Reason" — audit item 118. Do not add reason back.';

revoke execute on function public.my_suspension() from public;
grant  execute on function public.my_suspension() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. THE OLD SIGNATURES GO, ALL FOUR
--
-- Callers first, then the implementation they call, so that at no point in
-- the script does a surviving function point at a missing one. Inside one
-- transaction that is presentation rather than protection, but the next
-- person to read it should not have to work that out.
-- ---------------------------------------------------------------------------
drop function public.admin_act_on_user(uuid, text, text, integer);
drop function public.admin_act_on_report(uuid, text, text, integer);
drop function public.admin_act_on_provider(uuid, text, text, integer);
drop function public._admin_apply_user_action(uuid, text, text, integer);

-- ---------------------------------------------------------------------------
-- 4. THE SHARED IMPLEMENTATION
--
-- The live body of 24 Sep 2026, carried verbatim, with three branches changed
-- and nothing else touched: warn publishes the message, suspend and ban store
-- it. SECURITY INVOKER as before — it is executable by no client role and
-- relies on its callers' definer rights.
-- ---------------------------------------------------------------------------
create function public._admin_apply_user_action(
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

-- ---------------------------------------------------------------------------
-- 5. THE THREE ENTRY POINTS
--
-- Live bodies of 24 Sep 2026, carried verbatim. Each gains p_message, passes
-- it to the implementation, and records it in the audit row — so the log says
-- what the member was TOLD as well as what the evidence was. It did not.
-- ---------------------------------------------------------------------------
create function public.admin_act_on_user(
  p_user_id       uuid,
  p_action        text,
  p_reason        text default null,
  p_duration_days integer default null,
  p_message       text default null
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_admin  uuid := auth.uid();
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_act_on_user: not an admin' using errcode = '42501';
  end if;
  -- Not redundant: admin_audit_log.admin_id still permits NULL.
  if v_admin is null then
    raise exception 'admin_act_on_user: no auth.uid(), so the action could not be attributed'
      using errcode = '42501';
  end if;

  v_result := public._admin_apply_user_action(p_user_id, p_action, p_reason, p_duration_days, p_message);

  insert into public.admin_audit_log (action, target_user_id, admin_id, admin_note, details)
  values (
    p_action,
    p_user_id,
    v_admin,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'duration_days',  p_duration_days,
      'member_message', nullif(btrim(coalesce(p_message, '')), ''),
      'via',            'admin_act_on_user'
    )) || v_result
  );

  return v_result;
end
$function$;

create function public.admin_act_on_report(
  p_report_id     uuid,
  p_action        text,
  p_reason        text default null,
  p_duration_days integer default null,
  p_message       text default null
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_admin    uuid := auth.uid();
  v_note     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status   text;
  v_reported uuid;
  v_result   jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_act_on_report: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_act_on_report: no auth.uid(), so the action could not be attributed'
      using errcode = '42501';
  end if;

  -- ⟨D4⟩ Locked, then checked, so two admins cannot both close it.
  select r.status, r.reported_id
    into v_status, v_reported
  from public.reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'admin_act_on_report: no report %', p_report_id using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'admin_act_on_report: this report is already %, so nothing was changed', v_status
      using errcode = '55000';
  end if;

  case p_action

    -- ⟨D2⟩ These act on the USER and leave the report open. The report is not
    -- stamped; the audit row below carries report_id.
    when 'warn', 'suspend', 'ban' then
      -- reported_id is ON DELETE SET NULL (0004). This runs as definer, so RLS
      -- cannot be what hid it: null here means the account is gone.
      if v_reported is null then
        raise exception
          'admin_act_on_report: the reported account has been deleted, so there is nobody to %. Resolve or dismiss the report instead.',
          p_action using errcode = '55000';
      end if;
      v_result := public._admin_apply_user_action(v_reported, p_action, p_reason, p_duration_days, p_message);

    -- ⟨D2⟩ Closing writes who, when and why — on dismiss as well as resolve.
    --
    -- ⚠️ 0058 leaves `resolution` reading from p_reason. It is the admin's
    -- evidence and no client reads it today — but it lives on a member's own
    -- report row, so if a reporter is ever shown the outcome, this is the third
    -- route item 118 was about. p_message is deliberately NOT written here:
    -- closing a report speaks to nobody.
    when 'dismiss' then
      update public.reports
         set status = 'dismissed', resolved_at = now(),
             reviewed_by = v_admin, resolution = v_note
       where id = p_report_id;

    when 'resolve' then
      update public.reports
         set status = 'actioned', resolved_at = now(),
             reviewed_by = v_admin, resolution = v_note
       where id = p_report_id;

    else
      raise exception 'admin_act_on_report: unknown action %', p_action using errcode = '22023';
  end case;

  -- Same labels the console writes today, so the audit-log page keeps reading them.
  insert into public.admin_audit_log (action, target_user_id, admin_id, admin_note, details)
  values (
    'report_' || p_action,
    v_reported,
    v_admin,
    v_note,
    jsonb_strip_nulls(jsonb_build_object(
      'report_id',      p_report_id,
      'duration_days',  p_duration_days,
      'member_message', nullif(btrim(coalesce(p_message, '')), ''),
      'via',            'admin_act_on_report'
    )) || v_result
  );

  return v_result;
end
$function$;

create function public.admin_act_on_provider(
  p_provider_id   uuid,
  p_action        text,
  p_reason        text default null,
  p_duration_days integer default null,
  p_message       text default null
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_admin  uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_owner  uuid;
  v_count  integer;
  v_urls   jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_act_on_provider: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_act_on_provider: no auth.uid(), so the action could not be attributed'
      using errcode = '42501';
  end if;

  select p.user_id into v_owner from public.providers p where p.id = p_provider_id;
  if not found then
    raise exception 'admin_act_on_provider: no provider %', p_provider_id using errcode = 'P0002';
  end if;

  case p_action

    when 'suspend', 'ban', 'verify' then
      v_result := public._admin_apply_user_action(v_owner, p_action, p_reason, p_duration_days, p_message);

    -- Rows only. The files stay in the portfolio-photos bucket — storage is
    -- deliberately kept out of this (settled 8 Sep) — so every URL removed is
    -- recorded in the audit row, which is the only place left that knows them.
    when 'remove_portfolio' then
      with gone as (
        delete from public.portfolio_items
        where provider_id = p_provider_id
        returning media_url
      )
      select count(*), coalesce(jsonb_agg(media_url), '[]'::jsonb)
        into v_count, v_urls
      from gone;
      v_result := jsonb_build_object('removed_count', v_count, 'orphaned_media_urls', v_urls);

    else
      raise exception 'admin_act_on_provider: unknown action %', p_action using errcode = '22023';
  end case;

  insert into public.admin_audit_log (action, target_user_id, target_provider_id, admin_id, admin_note, details)
  values (
    'provider_' || p_action,
    v_owner,
    p_provider_id,
    v_admin,
    v_note,
    jsonb_strip_nulls(jsonb_build_object(
      'duration_days',  p_duration_days,
      'member_message', nullif(btrim(coalesce(p_message, '')), ''),
      'via',            'admin_act_on_provider'
    )) || v_result
  );

  return v_result;
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. COMMENTS AND GRANTS — 0039's, RE-APPLIED
--
-- ⚠️ NOT OPTIONAL TIDYING. A dropped function takes its grants with it, and
-- without these three grants the console cannot call anything: every
-- moderation action fails with a permission error and no button works.
-- ---------------------------------------------------------------------------
comment on function public._admin_apply_user_action(uuid, text, text, integer, text) is
  'The single implementation of warn, suspend, ban, reinstate, verify, flag, waive '
  'and comp, shared by admin_act_on_user, admin_act_on_report and '
  'admin_act_on_provider so the three surfaces cannot behave differently. Writes no '
  'audit row — its callers do. SECURITY INVOKER and not executable by any client '
  'role. 0039; audit item 29. ⚠️ TWO TEXT FIELDS WITH DIFFERENT AUDIENCES since 0058 '
  '(item 118): p_reason is moderation evidence, kept six years, admin-only, and NEVER '
  'shown to the member — it may name the person who reported them; p_message is '
  'written FOR the member and is the only part they read. warn REQUIRES p_message, '
  'because a warning is nothing but its notification.';

comment on function public.admin_act_on_user(uuid, text, text, integer, text) is
  'One transaction for an action on a user and its admin_audit_log row. Since 0039 '
  'handles ''warn'', with the notification inside the transaction because it is the '
  'action. Returns {new_value} for toggles and {shops} for verify. Since 0058 takes '
  'p_message, the member-facing field, and records it in details.member_message. '
  'Audit items 27, 29, 118.';

comment on function public.admin_act_on_report(uuid, text, text, integer, text) is
  'One transaction for a report decision and its audit row. warn/suspend/ban act on '
  'the reported user and leave the report open; dismiss/resolve close it and write '
  'reviewed_by, resolved_at and resolution. Refuses a report that is not open. 0039. '
  'p_message (0058) is passed to the user action and is NOT written to '
  'reports.resolution — closing a report speaks to nobody.';

comment on function public.admin_act_on_provider(uuid, text, text, integer, text) is
  'One transaction for a provider action and its audit row. remove_portfolio deletes '
  'rows only and records every removed media_url in the audit row, because the '
  'files are left in storage. 0039. Takes p_message since 0058 for suspend and ban.';

revoke all on function public._admin_apply_user_action(uuid, text, text, integer, text) from public, anon, authenticated;

revoke all on function public.admin_act_on_user(uuid, text, text, integer, text)     from public, anon;
revoke all on function public.admin_act_on_report(uuid, text, text, integer, text)   from public, anon;
revoke all on function public.admin_act_on_provider(uuid, text, text, integer, text) from public, anon;

grant execute on function public.admin_act_on_user(uuid, text, text, integer, text)     to authenticated;
grant execute on function public.admin_act_on_report(uuid, text, text, integer, text)   to authenticated;
grant execute on function public.admin_act_on_provider(uuid, text, text, integer, text) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0058', 'the_reason_is_evidence_not_an_explanation', 'd1ca33d478b354671039d5697eb3e02ea9fe26650ce724add03cf02f5f836587');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- The ASSERT is code and can be wrong; 0056's was (item 108). Every condition
-- it tests, as a SELECT that ANSWERS instead of raising. All eight must be yes.
--
--   select '4-arg _admin_apply_user_action exists' as needs,
--          to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer)') is not null as present
--   union all
--   select '5-arg _admin_apply_user_action does NOT exist yet',
--          to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer, text)') is null
--   union all
--   select 'all three 4-arg admin_act_on_* exist',
--          to_regprocedure('public.admin_act_on_user(uuid, text, text, integer)') is not null
--      and to_regprocedure('public.admin_act_on_report(uuid, text, text, integer)') is not null
--      and to_regprocedure('public.admin_act_on_provider(uuid, text, text, integer)') is not null
--   union all
--   select 'no 5-arg admin_act_on_* exists yet',
--          to_regprocedure('public.admin_act_on_user(uuid, text, text, integer, text)') is null
--      and to_regprocedure('public.admin_act_on_report(uuid, text, text, integer, text)') is null
--      and to_regprocedure('public.admin_act_on_provider(uuid, text, text, integer, text)') is null
--   union all
--   select 'my_suspension() exists',
--          to_regprocedure('public.my_suspension()') is not null
--   union all
--   select 'the functions the bodies call all exist',
--          to_regprocedure('public._withdraw_stylist(uuid)') is not null
--      and to_regprocedure('public._provider_shops_state(uuid)') is not null
--      and to_regprocedure('public.provider_fee_settled(uuid)') is not null
--   union all
--   select 'suspensions table exists',
--          to_regclass('public.suspensions') is not null
--   union all
--   select 'suspensions.member_message does NOT exist yet',
--          not exists (select 1 from information_schema.columns
--                      where table_schema = 'public' and table_name = 'suspensions'
--                        and column_name = 'member_message');
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   ⚠️ FOUR SIGNATURES CHANGE AND my_suspension() CHANGES SHAPE, so both
--   clients go out with it. Between step 2 and step 4 the console's calls
--   still work — every argument it sends is named and p_message defaults —
--   EXCEPT 'warn', which starts refusing until the console sends a message.
--   That is the intended order: a warning with no message should not be
--   issuable, not even for one deploy.
--
--   Mobile is the other half: between step 2 and a new build, SuspensionGate
--   reads `reason` from a function that no longer returns it, so a suspended
--   member sees the fixed sentence and no box. Degraded, not broken, and it
--   fails in the safe direction — which is why the column went this way round
--   rather than keeping the old name.
--
--   1. Preflight above.
--   2. Apply this migration.
--   3. node scripts/gen-supabase-types.mjs
--   4. Build and deploy the admin console (message box on warn/suspend/ban).
--   5. Blocks A, B and C below.
--   6. Mobile build when convenient — see the note above.
-- ===========================================================================
--
-- ── BLOCK A — a warning publishes the message, never the reason. Rolls back ─
--
--   ⚠️ Needs the admin claim set: in the SQL editor auth.uid() is NULL, so
--   is_admin() is false and an admin-only function refuses the owner of the
--   database. 0057's blocks failed on exactly this.
--
--   do $$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';   -- must be in public.admins
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';   -- model test acct
--     v_body   text;
--     v_refused text := 'no';
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     -- A warning with no message must now be REFUSED.
--     begin
--       perform public.admin_act_on_user(v_member, 'warn',
--         'INTERNAL EVIDENCE: a model called Sarah reported this account.');
--       v_refused := 'NO — IT WAS ACCEPTED, WHICH IS WRONG';
--     exception when others then
--       v_refused := 'yes: ' || sqlerrm;
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
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nmessageless warning refused: %\n\nbody:\n%\n\nreason leaked: %   <-- MUST be false',
--       v_refused, v_body, (v_body ilike '%Sarah%' or v_body ilike '%INTERNAL%');
--   end $$;
--
-- ── BLOCK B — a suspension tells them the message and never the reason ─────
--
--   do $$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_seen   record;
--     v_stored text;
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
--     select reason into v_stored from public.suspensions where user_id = v_member;
--
--     -- Now read it AS THE MEMBER, which is what my_suspension() is for.
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
--     select * into v_seen from public.my_suspension();
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nwhat the MEMBER sees:\n  banned: %\n  until:  %\n  message: %\n\nwhat is STORED as evidence (admins only):\n  %\n\nevidence reached the member: %   <-- MUST be false',
--       v_seen.banned, v_seen.suspended_until, v_seen.message, v_stored,
--       coalesce(v_seen.message ilike '%Sarah%' or v_seen.message ilike '%INTERNAL%', false);
--   end $$;
--
-- ── BLOCK C — the member still cannot read the table directly ──────────────
--
--   Belt and braces on the RLS reading of 24 Sep. If this returns any row the
--   whole migration is beside the point.
--
--   do $$
--   declare
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_rows   int;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--     select count(*) into v_rows from public.suspensions;
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nrows a member can read from suspensions: %   <-- MUST be 0', v_rows;
--   end $$;
--
-- ── WHAT NONE OF THEM PROVES ───────────────────────────────────────────────
-- That the warning EMAIL carries the message rather than the reason. The
-- notification is the email's source and Block A reads it, so the body is
-- right — but 0047's trigger is the part no block here exercises. Watch
-- email_sends after the first genuine warning.
-- ===========================================================================

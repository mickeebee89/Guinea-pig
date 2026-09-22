-- ===========================================================================
-- 0045_verification_requires_the_fee
--
-- A stylist cannot be verified until the £14.99 fee is settled. Closes audit
-- item 56, "the database never enforces the £14.99 fee". Decision: Micky,
-- 19 Sep 2026 — "the intended fix is a fee check in the approve path", due
-- before onboarding stylists he does not personally know.
--
-- ⚠️ Apply 0044 first. Written against 0039 (admin_decide_verification) and
-- 0044 (_admin_apply_user_action). The ASSERT refuses to run if either live
-- body is not the one this was written from.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- Paying was required only by the screens. Nothing in the database asked. A
-- stylist could file a verification request without paying (vr_user_policy
-- lets any member insert their own row), and an admin could approve it: the
-- approval never read verification_payments, is_founding_provider or
-- provider_fee_waived (item 56). The only control was the reviewer noticing
-- "Unpaid" in the console, which is advice to a person, not a rule.
--
-- ── ONE RULE, ONE PLACE ─────────────────────────────────────────────────
-- provider_fee_settled(user) is the rule every client already applies, written
-- once:
--
--   a verification_payments row exists for them
--   OR users.is_founding_provider
--   OR users.provider_fee_waived
--
-- Any payment row counts, as it does in every client: rows are written only
-- once Stripe has confirmed the payment (stripe-payment/index.ts:325, and the
-- webhook backstop at stripe-webhook/index.ts:513).
--
-- ── WHERE IT IS ENFORCED: BOTH ADMIN PATHS TO is_verified ───────────────
-- A stylist becomes verified in exactly two ways, both admin-only:
--
--   1. admin_decide_verification(request, 'approved') — the verification queue.
--   2. _admin_apply_user_action(user, 'verify')       — the bare Verify button
--      on the Users and Providers pages (0039).
--
-- Gating only the first would leave item 56 open through the second, so both
-- refuse. A member cannot set their own is_verified: 0040's one permit is for
-- role <> 'provider' (0040:204-235), so no stylist path exists outside these two.
--
-- Only role = 'provider' is gated. A model's verification has no fee: their
-- £4.99 is a subscription, checked separately at apply time.
--
-- DECLINING IS NEVER GATED. The check runs only on 'approved'. A request from
-- an unpaid stylist can always be rejected.
--
-- ── THE ERROR ───────────────────────────────────────────────────────────
-- SQLSTATE CV002, custom like 0042's CV001, so the console can recognise it by
-- code and show plain words (admin/lib/adminActions.ts) instead of matching
-- message text. PostgREST returns it in error.code (INFERRED, as for CV001).
--
-- ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────
-- * It does not un-verify anyone already verified without the fee. MEASURE
--   counts them; nothing changes them.
-- * It does not stop an unpaid stylist FILING a request. That stays open by
--   decision, reported in item 56: a request is now harmless, because it
--   cannot be approved.
-- * CLAUDE.md said "Admin approve() unlocks unconditionally (free-account
--   override)". For a stylist that is no longer true. The free-account route is
--   now explicit: waive the fee (Users → Free fee), then approve.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the live bodies this was written from. Code markers only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if to_regprocedure('public.admin_decide_verification(uuid, text, text)') is null then
    raise exception '0045: public.admin_decide_verification(uuid, text, text) is missing. Apply 0039 first.';
  end if;
  v_def := pg_get_functiondef('public.admin_decide_verification(uuid, text, text)'::regprocedure);
  if v_def not like '%reviewed_by_source = ''recorded''%'
     or v_def not like '%public._provider_shops_state(v_user)%'
     or v_def like '%provider_fee_settled%' then
    raise exception '0045: admin_decide_verification is not the 0039 body. Read it before applying.';
  end if;

  if to_regprocedure('public._admin_apply_user_action(uuid, text, text, integer)') is null then
    raise exception '0045: public._admin_apply_user_action is missing. Apply 0039 and 0044 first.';
  end if;
  v_def := pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer)'::regprocedure);
  if v_def not like '%v_withdrawn := public._withdraw_stylist(p_user_id);%'
     or v_def like '%provider_fee_settled%' then
    raise exception '0045: _admin_apply_user_action is not the 0044 body. Apply 0044, or read it before applying.';
  end if;

  if to_regprocedure('public.provider_fee_settled(uuid)') is not null then
    raise exception '0045: public.provider_fee_settled(uuid) already exists. Read it before applying.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'provider_fee_waived'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'is_founding_provider'
  ) or to_regclass('public.verification_payments') is null then
    raise exception '0045: the fee rule''s three inputs are not all present.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The rule.
--
-- SECURITY INVOKER and executable by no client role for now: its callers are
-- the admin functions, which run as definer. Opening it to clients is a
-- separate decision (item 56 lists what each client copy would need).
-- ---------------------------------------------------------------------------
create function public.provider_fee_settled(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.verification_payments vp where vp.user_id = p_user_id)
      or coalesce((select coalesce(u.is_founding_provider, false) or coalesce(u.provider_fee_waived, false)
                     from public.users u where u.id = p_user_id), false);
$$;

comment on function public.provider_fee_settled(uuid) is
  'Has this stylist settled the £14.99 verification fee: a verification_payments row, or '
  'is_founding_provider, or provider_fee_waived. The one copy of the rule in the database; the '
  'clients each hold their own copy of the same three-way test (audit item 56). Gates both admin '
  'paths to is_verified for role = provider (0045). SECURITY INVOKER; not executable by clients.';

revoke all on function public.provider_fee_settled(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- MEASURE — how things stand before the gate exists. Counts only.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0045', 'verified_stylists_fee_unsettled', count(*)::text
from public.users u
where u.role = 'provider' and u.is_verified is true
  and not public.provider_fee_settled(u.id);

insert into public.migration_findings (version, item, value)
select '0045', 'pending_stylist_requests_fee_unsettled', count(*)::text
from public.verification_requests vr
join public.users u on u.id = vr.user_id
where vr.status = 'pending' and u.role = 'provider'
  and not public.provider_fee_settled(u.id);

-- ---------------------------------------------------------------------------
-- 2. admin_decide_verification — approving an unpaid stylist is refused.
--
-- 0039's body with one addition: the CV002 check, after the request is locked
-- and the role read, BEFORE any write. A refusal therefore leaves the request
-- pending and nothing changed; the admin can waive the fee and approve again.
-- ---------------------------------------------------------------------------
create or replace function public.admin_decide_verification(
  p_request_id uuid,
  p_decision   text,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin        uuid := auth.uid();
  v_note         text := nullif(btrim(coalesce(p_note, '')), '');
  v_user         uuid;
  v_status       text;
  v_role         text;
  v_was_verified boolean;
  v_shops        jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_decide_verification: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_decide_verification: no auth.uid(), so the decision could not be attributed'
      using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'admin_decide_verification: decision must be approved or rejected, not %', p_decision
      using errcode = '22023';
  end if;

  -- ⟨D4⟩
  select vr.user_id, vr.status
    into v_user, v_status
  from public.verification_requests vr
  where vr.id = p_request_id
  for update;

  if not found then
    raise exception 'admin_decide_verification: no request %', p_request_id using errcode = 'P0002';
  end if;
  if v_user is null then
    raise exception 'admin_decide_verification: request % has no user', p_request_id using errcode = '55000';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'admin_decide_verification: this request is already %, so nothing was changed', v_status
      using errcode = '55000';
  end if;

  select u.role, u.is_verified into v_role, v_was_verified
  from public.users u where u.id = v_user;

  -- 0045 (item 56). Approving only; a rejection is never gated. Before any
  -- write, so a refusal changes nothing and the request stays pending.
  if p_decision = 'approved' and v_role = 'provider'
     and not public.provider_fee_settled(v_user) then
    raise exception 'admin_decide_verification: this stylist has not settled the £14.99 fee (no payment, not a Founding Provider, not fee-waived), so they cannot be approved. Nothing was changed.'
      using errcode = 'CV002';
  end if;

  if p_decision = 'approved' then
    update public.users set is_verified = true where id = v_user;

    -- ⟨D1⟩ Publish explicitly, but only what the existing check passes — so the
    -- complete-profile trigger cannot refuse it while the two checks agree (see
    -- the header). coalesce keeps a first publish date that already exists.
    -- A shop that is not publishable is left alone and REPORTED, not raised:
    -- the stylist is still verified, and the caller is told why the shop is not
    -- live instead of the whole approval failing.
    update public.providers p
       set is_published       = true,
           first_published_at = coalesce(p.first_published_at, now())
     where p.user_id = v_user
       and p.is_published is not true
       and public.provider_shop_is_publishable(p.id);

    v_shops := public._provider_shops_state(v_user);
  end if;

  update public.verification_requests
     set status             = p_decision,
         notes              = v_note,
         reviewed_at        = now(),
         -- Written together: 0037's paired CHECK refuses one without the other.
         reviewed_by        = v_admin,
         reviewed_by_source = 'recorded'
   where id = p_request_id;

  insert into public.admin_audit_log (action, target_user_id, admin_id, admin_note, details)
  values (
    case p_decision when 'approved' then 'verification_approve' else 'verification_reject' end,
    v_user,
    v_admin,
    v_note,
    jsonb_strip_nulls(jsonb_build_object(
      'request_id',       p_request_id,
      'role',             v_role,
      'outcome',          p_decision,
      'reason',           case when p_decision = 'rejected' then v_note end,
      'already_verified', v_was_verified,
      'shops',            v_shops,
      'via',              'admin_decide_verification'
    ))
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'decision',         p_decision,
    'user_id',          v_user,
    'role',             v_role,
    'already_verified', v_was_verified,
    'shops',            v_shops
  ));
end
$$;

-- ---------------------------------------------------------------------------
-- 3. _admin_apply_user_action — the bare Verify button is gated the same way.
--
-- 0044's body with one addition, in the 'verify' branch.
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

  return jsonb_strip_nulls(jsonb_build_object('new_value', v_new))
         || coalesce(v_withdrawn, '{}'::jsonb);
end
$$;

comment on function public._admin_apply_user_action(uuid, text, text, integer) is
  'The single implementation of warn, suspend, ban, reinstate, verify, flag, waive '
  'and comp, shared by admin_act_on_user, admin_act_on_report and '
  'admin_act_on_provider so the three surfaces cannot behave differently. Since '
  '0044 suspend and ban also call _withdraw_stylist and return {shops_hidden, '
  'cancelled_bookings}; reinstate does not republish. Since 0045 verify refuses a '
  'stylist whose fee is not settled (CV002). Writes no audit row — its callers do. '
  'SECURITY INVOKER and not executable by any client role. 0039, 0044, 0045; audit '
  'items 29, 56, 66.';

revoke all on function public._admin_apply_user_action(uuid, text, text, integer) from public, anon, authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0045', 'verification_requires_the_fee', '75e0264d533c5c4748bd55028972ca82486f2e1e1fef22ce433e9d1da0cae922');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — one block at a time, in the Supabase SQL editor.
--
-- Blocks that act roll themselves back with ROLLED BACK ON PURPOSE; that error
-- IS the result.
-- ===========================================================================
--
-- ── BLOCK A — the definitions, and what MEASURE found. Read-only ─────────
--
--   select
--     pg_get_functiondef('public.admin_decide_verification(uuid, text, text)'::regprocedure)
--       like '%and not public.provider_fee_settled(v_user) then%'                as approve_gated,
--     pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer)'::regprocedure)
--       like '%and not public.provider_fee_settled(p_user_id) then%'             as verify_gated,
--     pg_get_functiondef('public._admin_apply_user_action(uuid, text, text, integer)'::regprocedure)
--       like '%v_withdrawn := public._withdraw_stylist(p_user_id);%'             as suspend_still_withdraws,
--     has_function_privilege('anon',          'public.provider_fee_settled(uuid)', 'execute') as anon_can_run,
--     has_function_privilege('authenticated', 'public.provider_fee_settled(uuid)', 'execute') as authed_can_run,
--     (select value from public.migration_findings
--       where version = '0045' and item = 'verified_stylists_fee_unsettled')        as verified_unpaid_before,
--     (select value from public.migration_findings
--       where version = '0045' and item = 'pending_stylist_requests_fee_unsettled') as pending_unpaid_before;
--
--   Expect true, true, true, false, false, and two counts. A non-zero
--   verified_unpaid_before is a stylist verified before this gate existed.
--   0045 leaves them verified; it is a list to look at, not a failure.
--
-- ── BLOCK B — the rule, per stylist. Read-only ──────────────────────────
--
-- Emails are printed; after item 64 the only accounts left are Micky's own.
--
--   select a.email,
--          exists (select 1 from public.verification_payments vp where vp.user_id = u.id) as has_payment,
--          u.is_founding_provider, u.provider_fee_waived,
--          public.provider_fee_settled(u.id) as settled
--   from public.users u join auth.users a on a.id = u.id
--   where u.role = 'provider'
--   order by a.email;
--
--   Expect settled = has_payment OR is_founding_provider OR provider_fee_waived
--   on every row.
--
-- ── BLOCK C — unpaid is refused; paid, founding and waived are approved;
--               declining an unpaid stylist works. Rolls itself back ─────────
--
-- Subject: the provider test account, nahitih259 (517c2853…). Micky B's admin
-- claim. Each case files a fresh pending request, with the same (user_id,
-- status) insert shape as 0040's Block C, and sets the fee inputs inside the
-- transaction. Nothing here survives.
--
-- The PAID case uses the account's own payment row if it has one. It never
-- inserts one: verification_payments' required columns are not in the repo,
-- and 0044's Block F showed what guessing costs. With no row, that case says
-- so and is skipped. The UNPAID case must remove the payment row, and does it
-- in a sub-block, so a table that refuses deletes reports that instead of
-- aborting.
--
--   do $$
--   declare
--     v_admin constant uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_id    constant uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_req uuid; v_res jsonb; v_log text := ''; v_has_pay boolean;
--   begin
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_admin), true);
--     if not public.is_admin() then
--       raise exception 'Block C: the admin claim did not carry. Nothing was tested.';
--     end if;
--     v_log := format('role=%s', (select role from public.users where id = v_id));
--
--     select exists (select 1 from public.verification_payments where user_id = v_id) into v_has_pay;
--
--     -- PAID: the account's own payment row, flags off.
--     update public.users set is_founding_provider = false, provider_fee_waived = false where id = v_id;
--     if v_has_pay then
--       delete from public.verification_requests where user_id = v_id;
--       insert into public.verification_requests (user_id, status) values (v_id, 'pending') returning id into v_req;
--       begin
--         v_res := public.admin_decide_verification(v_req, 'approved', 'verify 0045');
--         v_log := v_log || E'\npaid:     approved (correct)';
--       exception when others then
--         v_log := v_log || format(E'\npaid:     REFUSED %s (%s)  <-- WRONG', sqlstate, sqlerrm);
--       end;
--     else
--       v_log := v_log || E'\npaid:     SKIPPED — this account has no payment row to use';
--     end if;
--
--     -- UNPAID: remove the payment row, flags off.
--     begin
--       delete from public.verification_payments where user_id = v_id;
--     exception when others then
--       v_log := v_log || format(E'\nunpaid:   could not remove the payment row (%s) — unpaid case NOT tested', sqlerrm);
--     end;
--     if not public.provider_fee_settled(v_id) then
--       delete from public.verification_requests where user_id = v_id;
--       insert into public.verification_requests (user_id, status) values (v_id, 'pending') returning id into v_req;
--       begin
--         v_res := public.admin_decide_verification(v_req, 'approved', 'verify 0045');
--         v_log := v_log || E'\nunpaid:   APPROVED  <-- WRONG, the gate did not fire';
--       exception
--         when sqlstate 'CV002' then v_log := v_log || E'\nunpaid:   refused, CV002 (correct)';
--         when others then v_log := v_log || format(E'\nunpaid:   refused %s (%s)  <-- wrong code', sqlstate, sqlerrm);
--       end;
--       -- Same request, still pending after the refusal: declining must work.
--       begin
--         v_res := public.admin_decide_verification(v_req, 'rejected', 'verify 0045');
--         v_log := v_log || E'\ndecline:  rejected while unpaid (correct)';
--       exception when others then
--         v_log := v_log || format(E'\ndecline:  REFUSED %s (%s)  <-- WRONG', sqlstate, sqlerrm);
--       end;
--       -- The bare Verify button, same gate.
--       begin
--         perform public.admin_act_on_user(v_id, 'verify');
--         v_log := v_log || E'\nverify:   VERIFIED  <-- WRONG, the button walks round the gate';
--       exception
--         when sqlstate 'CV002' then v_log := v_log || E'\nverify:   refused, CV002 (correct)';
--         when others then v_log := v_log || format(E'\nverify:   refused %s (%s)  <-- wrong code', sqlstate, sqlerrm);
--       end;
--     end if;
--
--     -- WAIVED
--     update public.users set provider_fee_waived = true, is_founding_provider = false where id = v_id;
--     delete from public.verification_requests where user_id = v_id;
--     insert into public.verification_requests (user_id, status) values (v_id, 'pending') returning id into v_req;
--     begin
--       v_res := public.admin_decide_verification(v_req, 'approved', 'verify 0045');
--       v_log := v_log || E'\nwaived:   approved (correct)';
--     exception when others then
--       v_log := v_log || format(E'\nwaived:   REFUSED %s (%s)  <-- WRONG', sqlstate, sqlerrm);
--     end;
--
--     -- FOUNDING
--     update public.users set provider_fee_waived = false, is_founding_provider = true where id = v_id;
--     delete from public.verification_requests where user_id = v_id;
--     insert into public.verification_requests (user_id, status) values (v_id, 'pending') returning id into v_req;
--     begin
--       v_res := public.admin_decide_verification(v_req, 'approved', 'verify 0045');
--       v_log := v_log || E'\nfounding: approved (correct)';
--     exception when others then
--       v_log := v_log || format(E'\nfounding: REFUSED %s (%s)  <-- WRONG', sqlstate, sqlerrm);
--     end;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n%', v_log;
--   end $$;
--
--   Expect role=provider, then: paid approved (or SKIPPED, said as such),
--   unpaid refused CV002, decline rejected, verify refused CV002, waived
--   approved, founding approved. An "unpaid case NOT tested" line means the
--   gate was not exercised at all — do not read the other lines as a pass for
--   it.

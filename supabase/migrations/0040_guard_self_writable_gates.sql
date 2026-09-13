-- ===========================================================================
-- 0040_guard_self_writable_gates
--
-- Stop an account granting itself verification, free membership, a waived fee,
-- Founding Provider status, a cleared fraud flag or a different role.
-- Audit item 40. THIS CLOSES A LIVE HOLE.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- public.users carries two permissive UPDATE policies: "admins update any user"
-- (is_admin()) and "users can update own row" (auth.uid() = id). The second has
-- no column restriction, and RLS CANNOT impose one — column-level control in
-- Postgres is a GRANT, not a policy. No such GRANT exists and no guard trigger
-- existed, so "update your own row" meant every column of it.
--
-- Proven 10 Sep 2026 by a rolled-back probe run as the provider test account
-- with role `authenticated`, is_admin() false, against its OWN row. All seven
-- returned 1 row(s):
--
--   is_verified · is_founding_provider · provider_fee_waived
--   subscription_waived · subscription_status · fraud_flagged · role
--
-- And separately: a user can INSERT their own verification_requests row already
-- marked 'approved' (vr_user_policy is PERMISSIVE for ALL commands on their own
-- rows; status has no CHECK constraint). So the row the app reads before setting
-- is_verified is a row the user can create.
--
-- ── THE SHAPE OF THE DEFECT, BECAUSE IT DECIDES THE FIX ─────────────────
-- Every gate in this product is RECORDED from real evidence and READ from a
-- derived flag:
--
--   provider £14.99  recorded in verification_payments, inserted only by
--                    stripe-payment/index.ts:231 under the service role
--   model £4.99/mo   recorded in subscriptions + users.subscription_status,
--                    written only by the Stripe edge functions and
--                    apply_subscription_state
--   identity         recorded in verification_requests, decided by an admin
--
-- No client writes any of those records, and the money paths were audited and
-- fixed in 7a898fb. The hole is that nothing READS them: the gates read flags,
-- and the flags were writable by the person they describe. No amount of care in
-- the payment code could have closed this.
--
-- ── WHAT THIS MIGRATION IS, AND WHAT IT IS NOT ──────────────────────────
-- ⚠️ THIS IS A STOPGAP, AND IT IS MEANT TO BECOME REDUNDANT. DO NOT REMOVE IT
--    AS DUPLICATE PROTECTION BEFORE READING THE NEXT PARAGRAPH.
--
-- The correct fix is column-level: revoke update on public.users from
-- authenticated, then grant update (profile_pic_url, date_of_birth,
-- instagram_handle, latitude, longitude) — the only columns a user's own session
-- legitimately writes, swept across all three apps on 10 Sep 2026. That cannot
-- land yet, because a GRANT is role-wide: revoking table UPDATE from
-- `authenticated` also blocks the admin console, whose is_verified / fraud_flagged
-- / waive / comp writes are ordinary authenticated updates gated only by the
-- admin RLS policy. Those must move to 0035/0039's SECURITY DEFINER functions
-- first, which is a console change across five surfaces.
--
-- So this migration closes the hole TODAY with triggers, and when the GRANT
-- lands the triggers stop mattering. They do not need unpicking. Until then they
-- are the only thing standing between any signed-in account and the identity
-- gate, so they are written to refuse loudly rather than to return early.
--
-- ── THE THREE CONSTRAINTS THIS WAS WRITTEN UNDER (Micky, 10 Sep) ────────
--   1. It permits exactly two things: is_admin(), and the one model case at
--      mobile/src/app/(app)/verify-payment.tsx:119. No convenience exceptions.
--      If a legitimate write turns out blocked, that is a finding about a path
--      nobody knew existed — not a reason to widen the trigger.
--   2. It says why it exists and what makes it redundant, so whoever finds it
--      later does not delete it before the GRANT lands.
--   3. It must not silently permit. A blocked write RAISES; it never returns
--      early and lets the write through.
--
-- ── WHO IS EXEMPT, AND WHY THAT TEST ────────────────────────────────────
-- The guards apply to END USERS only, defined as auth.uid() IS NOT NULL AND NOT
-- is_admin(). Everything else passes through:
--
--   * the service role (Stripe edge functions writing subscription_status,
--     purge-selfies nulling selfie_url) — a service-role request carries no
--     `sub` claim, so auth.uid() is null;
--   * the SQL editor, migrations and cron — no JWT claims at all;
--   * admins, by is_admin().
--
-- Triggers fire for EVERY role, including service_role, which bypasses RLS but
-- not triggers. Getting this test wrong would have broken live payments, so it
-- is stated rather than assumed: no client anywhere calls an RPC that writes any
-- protected column (every .rpc() call in all three apps was read on 10 Sep —
-- stripe_webhook_health, report_subject_history, my_suspension,
-- cancel_sessions_for_block, cancel_booking, nearby_models,
-- has_open_availability, taken_slots, create_session_with_consent).
--
-- ── ⚠️ THE TWO GUARDS INTERLOCK. NEITHER IS SAFE ALONE ──────────────────
-- The users guard permits the model case when an ADMIN-APPROVED verification
-- request exists. That permit is only worth anything because the second guard
-- makes 'approved' admin-only. Remove the verification_requests guard and the
-- users guard becomes a door with a lock the visitor holds the key to.
--
-- ── AND ONE PROTECTION THAT WORKS BY ACCIDENT IS MADE DELIBERATE ────────
-- The self-approve-by-UPDATE path was found to be blocked on 10 Sep — but by
-- verification_requests_reviewed_by_source_paired, 0037's CHECK, which exists to
-- stop a reviewer being stored without provenance and has nothing to do with
-- self-approval. Fill reviewed_by_source and it passes. An incidental block is
-- not a guard: anyone revising 0037's design would remove it without knowing it
-- was load-bearing somewhere else. This migration replaces the accident with a
-- rule that says what it is for.
--
-- ── ALSO IN HERE: THE REVOKE → RE-VERIFY DEAD END (audit item 29) ───────
-- unpublish_on_verification_lost hides a shop but keeps first_published_at, and
-- publish_provider_if_eligible only auto-publishes when that column is null. So
-- a revoked stylist could never be auto-published again by ANY path. It has a
-- real victim: Jojo B, revoked 7 Sep 19:56 as a test of the revocation
-- mechanism, re-verified through the users page two minutes later, and hidden
-- ever since — three days, found only by reading. Fixed here at the cause, so
-- that every path benefits, including paths nobody has found yet.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the shape this migration was written against. Read from the live
-- database on 10 Sep 2026, not from migration files. 0023 guessed at columns
-- twice and hit a NOT NULL both times; these fail loudly instead.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0040: public.is_admin() is missing — every permit in this migration gates on it.';
  end if;

  if to_regprocedure('public.publish_provider_if_eligible(uuid)') is null then
    raise exception '0040: public.publish_provider_if_eligible(uuid) is missing — the Jojo B repair relies on it.';
  end if;

  -- The seven protected columns must all still exist, or the guard silently
  -- stops protecting whichever one was renamed.
  select string_agg(c, ', ') into v_missing
  from unnest(array['is_verified', 'is_founding_provider', 'provider_fee_waived',
                    'subscription_waived', 'subscription_status', 'fraud_flagged', 'role']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = c
  );
  if v_missing is not null then
    raise exception '0040: public.users is missing protected column(s): %', v_missing;
  end if;

  select string_agg(c, ', ') into v_missing
  from unnest(array['status', 'reviewed_by', 'reviewed_by_source', 'reviewed_at', 'notes']) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verification_requests' and column_name = c
  );
  if v_missing is not null then
    raise exception '0040: public.verification_requests is missing column(s): %', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'providers' and column_name = 'first_published_at'
  ) then
    raise exception '0040: providers.first_published_at is missing — the revoke dead end is about that column.';
  end if;

  -- The repair below relies on this trigger republishing her, rather than on an
  -- explicit publish. If it is gone, the repair would silently do nothing.
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_provider_maybe_publish' and not tgisinternal
  ) then
    raise exception '0040: trg_provider_maybe_publish is missing — the repair depends on the normal publish path.';
  end if;

  -- 'revoke_verification' is a label on the moderation_action_type enum; the
  -- model permit compares against the last one recorded.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'moderation_action_type' and e.enumlabel = 'revoke_verification'
  ) then
    raise exception '0040: moderation_action_type has no revoke_verification label — the model permit reads it.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE USERS GUARD.
--
-- BEFORE UPDATE so it refuses before anything is written, and before the two
-- AFTER triggers on this table can react to a change that should not happen.
-- ---------------------------------------------------------------------------
create or replace function public.guard_users_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_changed text;
begin
  -- Not an end user: service role, SQL editor, cron, or an admin. See the
  -- header for why this is the test.
  if v_uid is null or public.is_admin() then
    return new;
  end if;

  -- ── THE ONE PERMIT ───────────────────────────────────────────────────
  -- mobile/src/app/(app)/verify-payment.tsx:119 — a member whose verification
  -- request an ADMIN approved sets their own is_verified. That write is how the
  -- product works today and it is not a hole, because:
  --
  --   * only an admin can set a request to 'approved' (guard 2, below), and
  --   * the approval must post-date the last revocation, so a revoked account
  --     cannot re-verify itself from a stale approval.
  --
  -- The second condition is deliberately NOT left to revoke_verification
  -- deleting the request row (0027:202), even though it does. A permit that is
  -- safe because of something another function happens to do is exactly the
  -- accident this migration exists to replace.
  --
  -- role <> 'provider' rather than role = 'model' on purpose: the screen reads
  -- `isProvider = userRole === 'provider'`, so a 'both' account takes the model
  -- path. The permit mirrors the client rather than a tidier idea of it.
  if new.is_verified is true
     and old.is_verified is not true
     and new.role is distinct from 'provider'
     and exists (select 1 from public.verification_requests vr
                  where vr.user_id = new.id
                    and vr.status = 'approved'
                    and coalesce(vr.reviewed_at, vr.created_at) >
                        coalesce((select max(ma.created_at) from public.moderation_actions ma
                                   where ma.target_user_id = new.id
                                     and ma.action = 'revoke_verification'),
                                 '-infinity'::timestamptz))
  then
    -- Permitted, but ONLY is_verified. Fall through to the check below so this
    -- cannot be used as cover for changing anything else in the same statement.
    null;
  elsif new.is_verified is distinct from old.is_verified then
    raise exception
      'You cannot change your own verification status. Identity verification is decided by a person, '
      'not by the account being verified. (0040, audit item 40.)'
      using errcode = '42501';
  end if;

  -- ── EVERYTHING ELSE: NO PERMIT EXISTS ────────────────────────────────
  select string_agg(c, ', ') into v_changed
  from (
    select 'is_founding_provider' as c where new.is_founding_provider is distinct from old.is_founding_provider
    union all
    select 'provider_fee_waived'      where new.provider_fee_waived  is distinct from old.provider_fee_waived
    union all
    select 'subscription_waived'      where new.subscription_waived  is distinct from old.subscription_waived
    union all
    select 'subscription_status'      where new.subscription_status  is distinct from old.subscription_status
    union all
    select 'fraud_flagged'            where new.fraud_flagged        is distinct from old.fraud_flagged
    union all
    select 'role'                     where new.role                 is distinct from old.role
  ) t;

  if v_changed is not null then
    raise exception
      'You cannot change % on your own account. These record what was paid, decided or found, '
      'and they are set by the system or by an admin. (0040, audit item 40.)', v_changed
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.guard_users_protected_columns() is
  'STOPGAP for audit item 40, and meant to become redundant — do not remove it as duplicate '
  'protection until the column-level GRANT lands (revoke update on public.users from authenticated, '
  'granting back only profile_pic_url, date_of_birth, instagram_handle, latitude, longitude), which '
  'cannot happen until the admin console stops writing this table directly and calls 0035/0039 '
  'instead. Until then this trigger is the only thing stopping any signed-in account setting its own '
  'is_verified, subscription_status, fee waivers, Founding Provider status, fraud flag or role. '
  'Permits exactly two callers: anything that is not an end user (service role, SQL editor, cron, '
  'admins), and a member claiming verification an admin already approved. That second permit is only '
  'safe because guard_verification_decision() makes ''approved'' admin-only: the two are interlocked.';

revoke all on function public.guard_users_protected_columns() from public, anon;

drop trigger if exists trg_guard_users_protected_columns on public.users;
create trigger trg_guard_users_protected_columns
  before update on public.users
  for each row execute function public.guard_users_protected_columns();

-- ---------------------------------------------------------------------------
-- 2. THE VERIFICATION DECISION GUARD.
--
-- vr_user_policy permits ALL commands on your own rows, which is right for
-- submitting and resubmitting and wrong for deciding. This separates the two:
-- a member may still create a request and delete their own (the resubmit path
-- in both clients deletes then inserts), but the DECISION fields are an admin's.
-- ---------------------------------------------------------------------------
create or replace function public.guard_verification_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Both clients insert exactly (user_id, selfie_url, status: 'pending').
    if new.status is distinct from 'pending'
       or new.reviewed_by is not null
       or new.reviewed_by_source is not null
       or new.reviewed_at is not null
    then
      raise exception
        'A verification request can only be created as pending, with no decision on it. '
        '(0040, audit item 40.)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE. selfie_url stays writable: purge-selfies nulls it under the service
  -- role, and a member replacing their photo is not deciding anything. notes is
  -- guarded because it holds the ADMIN's words, shown to the member on
  -- rejection — a member rewriting them rewrites the record of why.
  if new.status             is distinct from old.status
     or new.reviewed_by     is distinct from old.reviewed_by
     or new.reviewed_by_source is distinct from old.reviewed_by_source
     or new.reviewed_at     is distinct from old.reviewed_at
     or new.notes           is distinct from old.notes
  then
    raise exception
      'You cannot decide your own verification request. Approval, the reviewer and the review note '
      'are set by an admin. To submit a new photo, delete this request and create a new one, which is '
      'what the app does. (0040, audit item 40.)'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.guard_verification_decision() is
  'STOPGAP for audit item 40. Members may create a pending verification request and delete their own '
  '(the resubmit path in both clients deletes then inserts); only an admin may set status, '
  'reviewed_by, reviewed_by_source, reviewed_at or notes. Before this, a member could INSERT their own '
  'row already marked ''approved'' — proven 10 Sep 2026 — and the UPDATE route was blocked only by '
  'accident, by 0037''s reviewed_by_source_paired CHECK, which exists for an unrelated reason and '
  'passes once provenance is filled in. guard_users_protected_columns() permits a member to claim '
  'verification an admin approved, and that permit depends entirely on this function. The two are '
  'interlocked: removing this one silently widens that one.';

revoke all on function public.guard_verification_decision() from public, anon;

drop trigger if exists trg_guard_verification_decision on public.verification_requests;
create trigger trg_guard_verification_decision
  before insert or update on public.verification_requests
  for each row execute function public.guard_verification_decision();

-- ---------------------------------------------------------------------------
-- 3. THE REVOKE → RE-VERIFY DEAD END (audit item 29).
--
-- Replaces 0027's version. The only change is `first_published_at = null`.
--
-- Why that is the cause rather than a symptom: publish_provider_if_eligible
-- publishes only when first_published_at is null, so that column is what tells
-- "this shop has never been live" from "the stylist turned it off". Hiding a
-- shop on revocation while keeping the column made a revoked stylist look like
-- one who chose to hide, permanently, to every path in the product.
--
-- ⚠️ `and is_published is true` is load-bearing and was already here: this only
-- ever touches shops that were LIVE at the moment verification was lost. A
-- stylist who had already hidden their own shop keeps their first_published_at
-- and stays hidden when re-verified, which is their decision and not ours.
--
-- Cost: a revoked shop loses its original first-publish date. Nothing in any of
-- the three apps reads that column — swept 10 Sep 2026; only the publish rule
-- in the database does.
-- ---------------------------------------------------------------------------
create or replace function public.unpublish_on_verification_lost()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.is_verified is true and new.is_verified is not true then
    update public.providers
       set is_published       = false,
           first_published_at = null
     where user_id = new.id and is_published is true;
  end if;
  return new;
end $$;

comment on function public.unpublish_on_verification_lost() is
  'Unpublishes a stylist''s shop when verification is lost, and clears first_published_at so that '
  're-verification republishes it by the normal automatic path (0040). Only touches shops that were '
  'live at that moment: a stylist who had hidden their own shop keeps first_published_at and stays '
  'hidden. Before 0040 the column was kept, which made a revoked stylist indistinguishable from one '
  'who chose to hide and left them permanently unpublishable by every automatic path — audit item 29, '
  'found via Jojo B, hidden for three days by a test of the revocation mechanism itself.';

revoke all on function public.unpublish_on_verification_lost() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. THE ONE STYLIST THAT DEFECT ALREADY CAUGHT.
--
-- Jojo B, provider c42537d1-0b26-49b1-8770-a390b048ef9e. Read 10 Sep 2026:
-- is_verified true, is_published false, first_published_at 2026-09-07 14:31:05,
-- one revoke_verification at 07 Sep 19:56, no verification_requests row, and
-- publishable on today's rules.
--
-- She is repaired BY THE NORMAL PATH rather than by a hand-written publish:
-- clearing first_published_at fires trg_provider_maybe_publish, which calls
-- publish_provider_if_eligible, which applies the same eligibility rules as
-- every other publish in the product. If she is not eligible, nothing happens
-- and this says so — that is the correct outcome, not a failure.
--
-- Guarded on the state that was actually observed. If the row has moved since —
-- fixed by hand, hidden deliberately, published already — this does nothing and
-- reports why, rather than acting on a description that has gone stale.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id      constant uuid := 'c42537d1-0b26-49b1-8770-a390b048ef9e';
  v_rows    integer;
  v_pub     boolean;
  v_matched boolean;
begin
  select exists (
    select 1
    from public.providers p
    join public.users u on u.id = p.user_id
    where p.id = v_id
      and p.is_published is not true
      and p.first_published_at is not null
      and u.is_verified is true
      and exists (select 1 from public.moderation_actions ma
                   where ma.target_user_id = p.user_id
                     and ma.action = 'revoke_verification')
  ) into v_matched;

  if not v_matched then
    raise notice '0040: Jojo B is not in the state recorded on 10 Sep (verified, hidden, previously published, revoked). Nothing changed — check her by hand.';
    return;
  end if;

  update public.providers set first_published_at = null where id = v_id;
  get diagnostics v_rows = row_count;

  select is_published into v_pub from public.providers where id = v_id;

  if v_pub is true then
    raise notice '0040: Jojo B republished by the normal path (% row cleared).', v_rows;
  else
    raise notice '0040: Jojo B''s first_published_at was cleared, but she did not auto-publish — she is not currently eligible (name + at least one categorised treatment + verified). That is the publish rule working, not this migration failing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. THE TWO MONEY TABLES ARE PROTECTED BY OMISSION. MAKE IT DELIBERATE.
--
-- subscriptions and verification_payments have SELECT policies only, so writes
-- are refused because nothing permits them — not because anything denies them.
-- That holds exactly until someone adds a permissive ALL policy for a read they
-- need, at which point both money tables become client-writable in one stroke,
-- and nothing in either table says that was ever a risk.
--
-- RESTRICTIVE policies AND with permissive ones, so these keep denying whatever
-- is added later. Reads are untouched. The service role bypasses RLS entirely,
-- so the Stripe edge functions that write these tables are unaffected.
--
-- Micky's observation, 10 Sep, and it is the same shape as 0037's CHECK doing
-- security work it was never asked to do.
-- ---------------------------------------------------------------------------
drop policy if exists no_client_insert on public.subscriptions;
drop policy if exists no_client_update on public.subscriptions;
drop policy if exists no_client_delete on public.subscriptions;
create policy no_client_insert on public.subscriptions as restrictive for insert to authenticated with check (false);
create policy no_client_update on public.subscriptions as restrictive for update to authenticated using (false);
create policy no_client_delete on public.subscriptions as restrictive for delete to authenticated using (false);

drop policy if exists no_client_insert on public.verification_payments;
drop policy if exists no_client_update on public.verification_payments;
drop policy if exists no_client_delete on public.verification_payments;
create policy no_client_insert on public.verification_payments as restrictive for insert to authenticated with check (false);
create policy no_client_update on public.verification_payments as restrictive for update to authenticated using (false);
create policy no_client_delete on public.verification_payments as restrictive for delete to authenticated using (false);

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0040', 'guard_self_writable_gates', '858df98d23da38ee35e5dc0468a6eb6f85243b8be6ee7899617422c9dbb9497f');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ── BLOCK A — the hole is closed, all seven ───────────────────────
--
-- ⚠️ EVERY WRITE HERE IS A REAL TRANSITION, AND THAT IS THE WHOLE POINT.
--
-- The first version of this block reused the probe that FOUND the hole, which
-- wrote absolute values (`fraud_flagged = false`, `provider_fee_waived = true`).
-- That was the right instrument for the probe and the wrong one here, and it
-- reported two of the seven columns as still open on 11 Sep when they were not:
--
--   * privileges and RLS do not look at values, so writing a column its own
--     current value still proves the column is in the caller's writable set —
--     which is what the probe was for;
--   * a TRIGGER does look at values. Writing false over false changes nothing,
--     so the guard has nothing to refuse and the row count is 1.
--
-- fraud_flagged is NOT NULL DEFAULT false, so `= false` is a no-op on any
-- account that was never flagged. Same for `provider_fee_waived = true` on an
-- account that already had the fee waived. Booleans are therefore flipped with
-- `not`, and the current values are printed first so a surprising line can be
-- read against the state it started from.
--
--   do $$
--   declare
--     n integer; v_log text := '';
--     v_id uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_ver boolean; v_found boolean; v_fee boolean; v_waived boolean;
--     v_sub text; v_fraud boolean; v_role text;
--   begin
--     select is_verified, is_founding_provider, provider_fee_waived, subscription_waived,
--            subscription_status, fraud_flagged, role
--       into v_ver, v_found, v_fee, v_waived, v_sub, v_fraud, v_role
--     from public.users where id = v_id;
--     v_log := format('BEFORE: is_verified=%s founding=%s fee_waived=%s sub_waived=%s sub_status=%s fraud=%s role=%s',
--                     v_ver, v_found, v_fee, v_waived, v_sub, v_fraud, v_role);
--
--     perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_id), true);
--     set local role authenticated;
--     v_log := v_log || format(E'\nis_admin=%s (must be false)', public.is_admin());
--
--     begin update public.users set is_verified = not is_verified where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nis_verified:          %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nis_verified:          blocked'; end;
--
--     begin update public.users set is_founding_provider = not is_founding_provider where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nis_founding_provider: %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nis_founding_provider: blocked'; end;
--
--     begin update public.users set provider_fee_waived = not provider_fee_waived where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nprovider_fee_waived:  %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nprovider_fee_waived:  blocked'; end;
--
--     begin update public.users set subscription_waived = not subscription_waived where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nsubscription_waived:  %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nsubscription_waived:  blocked'; end;
--
--     -- a value it cannot already hold, whatever the account's state
--     begin update public.users set subscription_status =
--             case when subscription_status = 'active' then 'none' else 'active' end where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nsubscription_status:  %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nsubscription_status:  blocked'; end;
--
--     begin update public.users set fraud_flagged = not fraud_flagged where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nfraud_flagged:        %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nfraud_flagged:        blocked'; end;
--
--     begin update public.users set role = case when role = 'both' then 'model' else 'both' end where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nrole:                 %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nrole:                 blocked'; end;
--
--     begin insert into public.verification_requests (user_id, status) values (auth.uid(), 'approved');
--       get diagnostics n = row_count; v_log := v_log || format(E'\nself-approved insert: %s row(s)  <-- STILL OPEN', n);
--     exception when others then v_log := v_log || E'\nself-approved insert: blocked'; end;
--
--     -- CONTROL. Writing a column its own value changes nothing, so the guard
--     -- permits it and 1 row is the CORRECT answer. If this one says blocked,
--     -- the guard is refusing writes that alter nothing, which would break
--     -- ordinary profile saves that happen to include an unchanged column.
--     begin update public.users set provider_fee_waived = provider_fee_waived where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nno-op control:        %s row(s)  (1 is correct here)', n);
--     exception when others then v_log := v_log || E'\nno-op control:        blocked  <-- WRONG, see above'; end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\n%', v_log;
--   end $$;
--
--   Expect: eight "blocked" lines, then the no-op control at 1 row, is_admin
--   false. A row count on any of the eight is a column the guard is not
--   covering; read it against the BEFORE line before concluding anything.
--
-- ── BLOCK B — the things that must STILL work ──────────────────────────
--
-- The constraint was "no convenience exceptions", which makes the false-refusal
-- risk real. This checks the legitimate paths in the same way, and each of
-- these must say `1 row(s)`.
--
--   do $$
--   declare n integer; v_log text := ''; v_id uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--   begin
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_id), true);
--     set local role authenticated;
--
--     begin update public.users set profile_pic_url = profile_pic_url where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nown profile_pic_url:  %s row(s)', n);
--     exception when others then v_log := v_log || format(E'\nown profile_pic_url:  BLOCKED (%s)', sqlerrm); end;
--
--     begin update public.users set latitude = latitude, longitude = longitude where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nown coordinates:      %s row(s)', n);
--     exception when others then v_log := v_log || format(E'\nown coordinates:      BLOCKED (%s)', sqlerrm); end;
--
--     begin update public.users set instagram_handle = instagram_handle where id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nown instagram_handle: %s row(s)', n);
--     exception when others then v_log := v_log || format(E'\nown instagram_handle: BLOCKED (%s)', sqlerrm); end;
--
--     begin insert into public.verification_requests (user_id, selfie_url, status)
--             values (auth.uid(), auth.uid()::text || '/selfie.jpg', 'pending');
--       get diagnostics n = row_count; v_log := v_log || format(E'\nsubmit a request:     %s row(s)', n);
--     exception when others then v_log := v_log || format(E'\nsubmit a request:     BLOCKED (%s)', sqlerrm); end;
--
--     begin delete from public.verification_requests where user_id = auth.uid();
--       get diagnostics n = row_count; v_log := v_log || format(E'\nresubmit (delete own):%s row(s)', n);
--     exception when others then v_log := v_log || format(E'\nresubmit (delete own):BLOCKED (%s)', sqlerrm); end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\n%', v_log;
--   end $$;
--
--   Any BLOCKED line here is a path nobody knew existed, or a mistake in this
--   migration. Per constraint 1 it is investigated, not widened around.
--
-- ── BLOCK C — the model permit still works, end to end ──────────────────
--
-- The one thing the guard is allowed to let through. Uses the model test
-- account. Everything rolls back, including the approval.
--
--   do $$
--   declare v_model uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'; n integer; v_log text := '';
--   begin
--     -- As nobody (SQL editor): stand in for the admin approving a request.
--     delete from public.verification_requests where user_id = v_model;
--     -- reviewed_by/reviewed_by_source left null: 0037's paired CHECK permits both
--     -- null, and a member standing in as their own reviewer is not a row shape
--     -- worth copying out of a verify block later.
--     insert into public.verification_requests (user_id, status, reviewed_at)
--       values (v_model, 'approved', now());
--     update public.users set is_verified = false where id = v_model;
--
--     -- Now as the member themselves, exactly as verify-payment.tsx:119 does.
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_model), true);
--     set local role authenticated;
--     update public.users set is_verified = true where id = auth.uid();
--     get diagnostics n = row_count;
--     v_log := format('member claims an approved verification: %s row(s) — must be 1', n);
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\n%', v_log;
--   end $$;
--
--   Then the same again with the insert changed to status 'rejected': the claim
--   must be refused. That pair is the permit and its boundary.
--
-- ── BLOCK D — Jojo B ────────────────────────────────────────────────────
--
--   select p.name, p.is_published, p.first_published_at, u.is_verified
--   from public.providers p join public.users u on u.id = p.user_id
--   where p.id = 'c42537d1-0b26-49b1-8770-a390b048ef9e';
--
--   Expect is_published true and a fresh first_published_at — she was
--   republished by the normal path when the migration cleared the column. The
--   NOTICE raised during the run says which outcome happened.
--
-- ── BLOCK E — the money tables deny rather than omit ────────────────────
--
--   select tablename, policyname, cmd, permissive
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('subscriptions', 'verification_payments')
--   order by tablename, policyname;
--
--   Expect three RESTRICTIVE policies per table alongside the existing SELECT
--   ones. Reads must still work from both clients — the subscription state on
--   Settings and the fee check on the verify screen are the two to look at.
-- ===========================================================================


-- ===========================================================================
-- ⚠️ STAMP BEFORE YOU APPLY — NOT AFTER
--
--   node scripts/migration-status.mjs --stamp     <- BEFORE pasting this file
--   (paste the whole file into the Supabase SQL editor)
--   node scripts/migration-status.mjs             <- confirm: applied, no drift
--
-- WHY THE ORDER MATTERS. A new file's footer says PENDING_CHECKSUM, and
-- --stamp replaces it with the real checksum. Apply first and the database
-- records the literal string PENDING_CHECKSUM, which the checksum written
-- afterwards can never match, so the ledger reads DRIFTED from then on. 0040
-- was applied that way on 11 Sep 2026 and needed a reconcile by hand.
--
-- This block used to say "LAST STEP, EVERY TIME" and name only the status
-- report. That was correct about the report and SILENT about stamping — which
-- is how a migration written by copying the nearest file gets applied
-- unstamped. Swept across every migration on 13 Sep 2026, audit item 41.
--
-- The status report is still worth running last. It catches what no verify
-- block can: a migration written, committed, and never applied at all. 0009 sat
-- in that state for a day and was noticed by eye. A check that depends on
-- someone noticing is not a check. It needs the service-role key in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
--
-- Editing this block on an APPLIED migration is safe, and that is measured
-- rather than assumed: it sits BELOW the MIGRATION FOOTER line, the checksum
-- covers only what is above that line, and every body checksum in this
-- directory was recomputed before and after the sweep.
-- ===========================================================================

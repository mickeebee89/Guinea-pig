-- ===========================================================================
-- 0039_admin_decisions_are_atomic
--
-- The other four admin decisions get what 0035 gave users: one transaction for
-- the decision and the record of it. And 'warn' joins admin_act_on_user.
-- Audit item 29.
--
-- ── ⚠️ THESE THREE SENTENCES ARE WHY THIS EXISTS ────────────────────────
-- Quoted in 0035 too. They are in admin/app/verification/page.tsx, written by
-- someone who understood the problem exactly and mitigated it in copy because
-- there was nowhere else to put it:
--
--   "Couldn't verify this user: {err}\n\nNothing else was changed."
--
--   "The user was verified, but their shop could not be published: {err}
--    \n\nThe request has been left pending — try again."
--
--   "This user is verified{ and published}, but the request could not be
--    closed: {err}\n\nIt will still show as pending — approve it again to
--    clear it."
--
-- Only the first describes a clean failure. The other two describe a system
-- left HALF CHANGED. After this migration, none of them can happen: each
-- function below either does all of its writes, or none.
--
-- ── WHAT IS HERE ────────────────────────────────────────────────────────
--   admin_act_on_user           REPLACED: now handles 'warn', returns jsonb
--   admin_act_on_report         warn · suspend · ban · dismiss · resolve
--   admin_act_on_provider       suspend · ban · verify · remove_portfolio
--   admin_decide_verification   approved · rejected
--   admin_decide_status_post    approved · rejected
--
--   _admin_apply_user_action    the ONE copy of suspend/ban/reinstate/verify/
--                               warn/flag/waive/comp, used by the first three
--   _provider_shops_state       what a user's shops look like after a decision
--
-- Every column was read from information_schema on 8–10 Sep 2026 (item 29's
-- dumps), not from a migration file. The ASSERT block re-checks them.
--
-- ⚠️ NOTHING CALLS THESE YET. The console is repointed in a separate change,
-- all five surfaces together — repointing some and not others is what creates
-- the seam item 29 warns about. RLS lockdown of suspensions and admin_audit_log
-- comes after that, not here.
--
-- ── DECISIONS THIS FILE ENCODES — CONFIRM BEFORE APPLYING ─────────────────
--
-- Settled 8 Sep, not reopened:
--   * Notifications sit OUTSIDE the transaction — except 'warn', where the
--     notification IS the action (0035's header), so it sits inside.
--   * Toggles read and flip inside the function.
--   * reports.reviewed_by is written by the function; resolution gets the
--     typed reason; removed portfolio files are logged, storage is left alone.
--
-- New in this file, proposed 10 Sep, each marked ⟨D1⟩–⟨D4⟩ where it lives:
--
--   ⟨D1⟩ APPROVAL PUBLISHES EXPLICITLY, IF THE SHOP IS PUBLISHABLE.
--        The earlier plan was to rely on the trigger chain
--        (trg_user_verified_maybe_publish → publish_provider_if_eligible).
--        Reading 0016 and 0027 on 10 Sep changed that. The chain publishes only
--        where first_published_at IS NULL (confirmed in the live body), and
--        revoke_verification unpublishes WITHOUT clearing it (repo copies of
--        0027 and 0016; live bodies requested). So a stylist who is revoked,
--        resubmits and is approved would never be published by the chain — and
--        today's console, which publishes explicitly, does publish them.
--        So: publish where provider_shop_is_publishable() says so, using the same
--        check the trigger enforces, and report what happened either way.
--
--   ⟨D2⟩ A REPORT'S reviewed_by / resolution / resolved_at ARE WRITTEN WHEN IT
--        IS CLOSED (dismiss, resolve), and dismiss now sets resolved_at too.
--        warn/suspend/ban act on the user and leave the report open — the
--        console says so in its own help text — so they do not stamp the report;
--        their audit row carries report_id instead.
--
--   ⟨D3⟩ SUSPEND AND BAN REPLACE RATHER THAN STACK ON EVERY SURFACE.
--        0035 decided this for the users page. The reports and providers pages
--        still insert a second live suspensions row today. One shared helper
--        means one behaviour, and one copy of it.
--
--   ⟨D4⟩ A DECISION ON SOMETHING ALREADY DECIDED IS REFUSED: a verification
--        request that is not pending, a report that is not open, a status post
--        that is not pending or has expired. The row is locked first, so two
--        admins acting at once cannot both succeed. This replaces "approve it
--        again to clear it", which only existed because of the half-state.
--
-- ── ⚠️ THE PUBLISH CHECK EXISTS TWICE, AND NOTHING KEEPS THE COPIES IN STEP ──
-- provider_shop_is_publishable() (0016) and the trigger function
-- enforce_publish_requires_complete_profile() (0016) test the same two things.
-- Word for word, 10 Sep:
--
--   function:  and coalesce(btrim(p.name), '') <> ''
--   trigger:   if coalesce(btrim(new.name), '') = '' then ... 'a name'
--
-- plus the same "at least one provider_treatments row with a category" test.
-- They agree today. ⟨D1⟩ leans on that: it publishes only rows the function
-- passes, so the trigger cannot refuse them. If the TRIGGER ever gains a
-- condition the function lacks, an approval of that stylist rolls back with
-- 23514 — loudly, with nothing half done, which is the right way to fail — and
-- so does every profile edit or new treatment that fires the auto-publish
-- chain, which is not. Recorded on both functions below, so it is found by
-- whoever edits either one.
--
-- ── STILL TRUE AFTER THIS, AND FOR THE CONSOLE CHANGE TO HANDLE ───────────
-- An approval that does not publish tells nobody unless the caller says so.
-- admin_decide_verification returns each shop's state for exactly that. The
-- console's approval notification currently tells a provider "your verified
-- badge and profile are now live" — false whenever shops[].published is false.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the shape these functions were written against.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0039: public.is_admin() is missing — every function here gates on it.';
  end if;
  if to_regprocedure('public.admin_act_on_user(uuid,text,text,integer)') is null then
    raise exception '0039: admin_act_on_user is missing — apply 0035 first.';
  end if;
  if to_regprocedure('public.provider_shop_is_publishable(uuid)') is null
     or to_regprocedure('public.enforce_publish_requires_complete_profile()') is null then
    raise exception '0039: a publish check from 0016 is missing — see the header.';
  end if;

  -- Every column written or read below.
  select string_agg(w.want, ', ') into v_missing
  from (values
    ('reports.status'), ('reports.reported_id'), ('reports.resolved_at'),
    ('reports.reviewed_by'), ('reports.resolution'),
    ('status_posts.moderation_status'), ('status_posts.expires_at'),
    ('status_posts.provider_id'), ('status_posts.reviewed_at'),
    ('status_posts.reviewed_by'), ('status_posts.review_note'),
    ('verification_requests.user_id'), ('verification_requests.status'),
    ('verification_requests.notes'), ('verification_requests.reviewed_at'),
    ('verification_requests.reviewed_by'), ('verification_requests.reviewed_by_source'),
    ('portfolio_items.provider_id'), ('portfolio_items.media_url'),
    ('providers.user_id'), ('providers.is_published'), ('providers.first_published_at'),
    ('notifications.user_id'), ('notifications.type'), ('notifications.title'),
    ('notifications.body'),
    ('admin_audit_log.target_provider_id'), ('admin_audit_log.details')
  ) as w(want)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name   = split_part(w.want, '.', 1)
      and c.column_name  = split_part(w.want, '.', 2)
  );
  if v_missing is not null then
    raise exception '0039: column(s) missing: %. Nothing has been changed.', v_missing;
  end if;

  -- The values written must still be ones the CHECKs allow.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_status_check'
      and pg_get_constraintdef(oid) like '%''dismissed''%'
      and pg_get_constraintdef(oid) like '%''actioned''%'
  ) then
    raise exception '0039: reports_status_check no longer allows dismissed/actioned.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'status_posts_moderation_status_check'
      and pg_get_constraintdef(oid) like '%''approved''%'
      and pg_get_constraintdef(oid) like '%''rejected''%'
  ) then
    raise exception '0039: status_posts_moderation_status_check no longer allows approved/rejected.';
  end if;

  -- All three reviewer columns must point at auth.users: the acting admin is an
  -- auth.users id, and a key to public.users would refuse it (0036).
  if (select count(*) from pg_constraint
      where conname in ('reports_reviewed_by_fkey',
                        'status_posts_reviewed_by_fkey',
                        'verification_requests_reviewed_by_fkey')
        and confrelid = 'auth.users'::regclass) <> 3 then
    raise exception '0039: a reviewed_by foreign key does not reference auth.users.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- HELPER — what a user's shops look like, read after a decision.
--
-- Returns FACTS, not a reason: whether each shop is published, whether it could
-- be (by the existing check — not a third copy of it), and whether it has ever
-- been published (so "not republished" can be told from "not ready").
-- ---------------------------------------------------------------------------
create or replace function public._provider_shops_state(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider_id',    p.id,
           'published',      coalesce(p.is_published, false),
           'publishable',    public.provider_shop_is_publishable(p.id),
           'ever_published', p.first_published_at is not null
         ) order by p.id), '[]'::jsonb)
  from public.providers p
  where p.user_id = p_user_id;
$$;


-- ---------------------------------------------------------------------------
-- HELPER — the one copy of every action taken against a user.
--
-- The users, reports and providers pages each had their own suspend and ban.
-- Three copies is how the reports and providers pages still stack suspensions
-- after 0035 stopped the users page doing it. ⟨D3⟩
--
-- SECURITY INVOKER, and nobody but the functions in this file can execute it:
-- it has no privilege of its own and runs with whatever its caller has. It
-- writes NO audit row — its callers do, because only they know which surface
-- the decision came from.
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
  v_new boolean;
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

    when 'ban' then
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'ban needs a reason' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason)
      values (p_user_id, null, true, p_reason);

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

  return jsonb_strip_nulls(jsonb_build_object('new_value', v_new));
end
$$;


-- ---------------------------------------------------------------------------
-- admin_act_on_user — REPLACED.
--
-- Dropped and re-created because the return type changes (void → jsonb), which
-- CREATE OR REPLACE cannot do. Safe: nothing calls it yet (0035's header).
-- ---------------------------------------------------------------------------
drop function if exists public.admin_act_on_user(uuid, text, text, integer);

create function public.admin_act_on_user(
  p_user_id       uuid,
  p_action        text,
  p_reason        text    default null,
  p_duration_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  v_result := public._admin_apply_user_action(p_user_id, p_action, p_reason, p_duration_days);

  insert into public.admin_audit_log (action, target_user_id, admin_id, admin_note, details)
  values (
    p_action,
    p_user_id,
    v_admin,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'duration_days', p_duration_days,
      'via',           'admin_act_on_user'
    )) || v_result
  );

  return v_result;
end
$$;


-- ---------------------------------------------------------------------------
-- admin_act_on_report
-- ---------------------------------------------------------------------------
create or replace function public.admin_act_on_report(
  p_report_id     uuid,
  p_action        text,
  p_reason        text    default null,
  p_duration_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      v_result := public._admin_apply_user_action(v_reported, p_action, p_reason, p_duration_days);

    -- ⟨D2⟩ Closing writes who, when and why — on dismiss as well as resolve.
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
      'report_id',     p_report_id,
      'duration_days', p_duration_days,
      'via',           'admin_act_on_report'
    )) || v_result
  );

  return v_result;
end
$$;


-- ---------------------------------------------------------------------------
-- admin_act_on_provider
-- ---------------------------------------------------------------------------
create or replace function public.admin_act_on_provider(
  p_provider_id   uuid,
  p_action        text,
  p_reason        text    default null,
  p_duration_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      v_result := public._admin_apply_user_action(v_owner, p_action, p_reason, p_duration_days);

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
      'duration_days', p_duration_days,
      'via',           'admin_act_on_provider'
    )) || v_result
  );

  return v_result;
end
$$;


-- ---------------------------------------------------------------------------
-- admin_decide_verification
--
-- Was five separate client writes: users.is_verified, providers.is_published,
-- verification_requests, a notification, the audit row. Now the first three and
-- the audit row are one transaction. The notification stays with the caller
-- (settled 8 Sep) — and the caller must word it from `shops`, not assume.
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
-- admin_decide_status_post
-- ---------------------------------------------------------------------------
create or replace function public.admin_decide_status_post(
  p_post_id  uuid,
  p_decision text,
  p_note     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin    uuid := auth.uid();
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_status   text;
  v_expires  timestamptz;
  v_provider uuid;
  v_owner    uuid;
begin
  if not public.is_admin() then
    raise exception 'admin_decide_status_post: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_decide_status_post: no auth.uid(), so the decision could not be attributed'
      using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'admin_decide_status_post: decision must be approved or rejected, not %', p_decision
      using errcode = '22023';
  end if;
  -- The console's rule, now enforced where it cannot be skipped: the stylist is
  -- shown this note, and "not published" with no reason is why the queue exists.
  if p_decision = 'rejected' and v_note is null then
    raise exception 'admin_decide_status_post: a rejection needs a reason — the stylist is shown it'
      using errcode = '22023';
  end if;

  -- ⟨D4⟩
  select sp.moderation_status, sp.expires_at, sp.provider_id
    into v_status, v_expires, v_provider
  from public.status_posts sp
  where sp.id = p_post_id
  for update;

  if not found then
    raise exception 'admin_decide_status_post: no status post %', p_post_id using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'admin_decide_status_post: this post is already %, so nothing was changed', v_status
      using errcode = '55000';
  end if;
  if v_expires <= now() then
    raise exception 'admin_decide_status_post: this post expired at %, so a decision would publish or tell nobody anything',
      v_expires using errcode = '55000';
  end if;

  -- screen_status_post() skips an UPDATE that leaves body unchanged, so this
  -- decision is not re-screened and overwritten (0032).
  update public.status_posts
     set moderation_status = p_decision,
         reviewed_at       = now(),
         reviewed_by       = v_admin,
         review_note       = v_note
   where id = p_post_id;

  select p.user_id into v_owner from public.providers p where p.id = v_provider;

  insert into public.admin_audit_log (action, target_provider_id, admin_id, details)
  values (
    'status_post_' || p_decision,
    v_provider,
    v_admin,
    jsonb_strip_nulls(jsonb_build_object(
      'post_id', p_post_id,
      'note',    v_note,
      'via',     'admin_decide_status_post'
    ))
  );

  -- notify_user_id so the caller can send the rejection notice without a second
  -- read that can fail on its own.
  return jsonb_strip_nulls(jsonb_build_object(
    'decision',       p_decision,
    'provider_id',    v_provider,
    'notify_user_id', v_owner
  ));
end
$$;


-- ---------------------------------------------------------------------------
-- WHERE BOTH PUBLISH CHECKS LIVE — appended to any existing comment, never
-- replacing it, and only once.
-- ---------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'DUPLICATED, AND NOTHING KEEPS THE COPIES IN STEP';
  v_body   constant text :=
    'The same two conditions — a non-blank name (coalesce(btrim(name), '''')) and at '
    'least one provider_treatments row with a category — are tested by BOTH '
    'provider_shop_is_publishable() and the providers trigger function '
    'enforce_publish_requires_complete_profile(). They agreed word for word on '
    '10 Sep 2026. If the function gains a condition the trigger lacks, fewer shops '
    'publish, silently. If the TRIGGER gains one the function lacks, '
    'publish_provider_if_eligible() and admin_decide_verification() issue updates '
    'the trigger refuses: an approval rolls back with 23514, and so does any '
    'profile edit or new treatment that fires the auto-publish chain. Change both '
    'together. 0039; audit item 29.';
  v_fn     text;
  v_old    text;
begin
  foreach v_fn in array array[
    'public.provider_shop_is_publishable(uuid)',
    'public.enforce_publish_requires_complete_profile()'
  ] loop
    v_old := obj_description(to_regprocedure(v_fn), 'pg_proc');
    if position(v_marker in coalesce(v_old, '')) = 0 then
      execute format(
        'comment on function %s is %L',
        v_fn,
        concat_ws(E'\n\n', v_old, '⚠️ ' || v_marker || '. ' || v_body)
      );
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 0036's column comment, corrected.
--
-- It said the primary admin is "a console-only account" — false: it has a
-- public.users row (items 34, 35). And that every earlier request has
-- reviewed_by NULL — true when written, false since 0037 backfilled them.
-- 0036 is applied and is not edited; the comment is replaced here instead.
-- ---------------------------------------------------------------------------
comment on column public.verification_requests.reviewed_by is
  'The admin who approved or rejected this request (auth.users id). References '
  'auth.users so any admin can be recorded whether or not they have an app '
  'profile. (0036''s comment gave the reason as the primary admin being a '
  'console-only account; it is not — audit items 34 and 35.) The console did not '
  'write this column before 10 Sep 2026: the 25 requests reviewed before then were '
  'reconstructed from admin_audit_log by 0037 and carry reviewed_by_source = '
  '''reconstructed''. Written by admin_decide_verification from 0039.';


-- ---------------------------------------------------------------------------
-- Comments and grants.
-- ---------------------------------------------------------------------------
comment on function public._provider_shops_state(uuid) is
  'Each of a user''s shops as {provider_id, published, publishable, ever_published}, '
  'read after an admin decision so the caller can say what happened to the shop '
  'rather than assume. Uses provider_shop_is_publishable(), not a copy of it. '
  'Internal: executable only by the admin functions. 0039.';

comment on function public._admin_apply_user_action(uuid, text, text, integer) is
  'The single implementation of warn, suspend, ban, reinstate, verify, flag, waive '
  'and comp, shared by admin_act_on_user, admin_act_on_report and '
  'admin_act_on_provider so the three surfaces cannot behave differently. Writes no '
  'audit row — its callers do. SECURITY INVOKER and not executable by any client '
  'role. 0039; audit item 29.';

comment on function public.admin_act_on_user(uuid, text, text, integer) is
  'One transaction for an action on a user and its admin_audit_log row. Since 0039 '
  'handles ''warn'', with the notification inside the transaction because it is the '
  'action. Returns {new_value} for toggles and {shops} for verify. Audit items 27, 29.';

comment on function public.admin_act_on_report(uuid, text, text, integer) is
  'One transaction for a report decision and its audit row. warn/suspend/ban act on '
  'the reported user and leave the report open; dismiss/resolve close it and write '
  'reviewed_by, resolved_at and resolution. Refuses a report that is not open. 0039.';

comment on function public.admin_act_on_provider(uuid, text, text, integer) is
  'One transaction for a provider action and its audit row. remove_portfolio deletes '
  'rows only and records every removed media_url in the audit row, because the '
  'files are left in storage. 0039.';

comment on function public.admin_decide_verification(uuid, text, text) is
  'One transaction for a verification decision: users.is_verified, publishing any '
  'shop provider_shop_is_publishable() passes, the request, and the audit row. '
  'Returns shops[] so the caller can say whether the shop went live — an approval '
  'that does not publish must not be announced as one. Refuses a request that is not '
  'pending. Notification is the caller''s. 0039; audit item 29.';

comment on function public.admin_decide_status_post(uuid, text, text) is
  'One transaction for a status-post decision and its audit row. A rejection needs a '
  'note, which the stylist is shown. Refuses a post that is not pending or has '
  'expired. Returns notify_user_id for the caller''s rejection notice. 0039.';

revoke all on function public._provider_shops_state(uuid)                          from public, anon, authenticated;
revoke all on function public._admin_apply_user_action(uuid, text, text, integer)  from public, anon, authenticated;

revoke all on function public.admin_act_on_user(uuid, text, text, integer)         from public, anon;
revoke all on function public.admin_act_on_report(uuid, text, text, integer)       from public, anon;
revoke all on function public.admin_act_on_provider(uuid, text, text, integer)     from public, anon;
revoke all on function public.admin_decide_verification(uuid, text, text)          from public, anon;
revoke all on function public.admin_decide_status_post(uuid, text, text)           from public, anon;

grant execute on function public.admin_act_on_user(uuid, text, text, integer)      to authenticated;
grant execute on function public.admin_act_on_report(uuid, text, text, integer)    to authenticated;
grant execute on function public.admin_act_on_provider(uuid, text, text, integer)  to authenticated;
grant execute on function public.admin_decide_verification(uuid, text, text)       to authenticated;
grant execute on function public.admin_decide_status_post(uuid, text, text)        to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0039', 'admin_decisions_are_atomic', '7340b8ea5c56aa294053d66fa2184e63321818a2ca71e66e3ddf154c8ed1845b');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Each block is one statement; run them one at a time.
--
-- ── BLOCK A — the seven functions, and who can call them ────────────────
--
--   select p.proname,
--          p.prosecdef                                            as security_definer,
--          array_to_string(p.proconfig, ' ')                      as settings,
--          has_function_privilege('anon',          p.oid, 'execute') as anon_can,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('admin_act_on_user', 'admin_act_on_report', 'admin_act_on_provider',
--                       'admin_decide_verification', 'admin_decide_status_post',
--                       '_admin_apply_user_action', '_provider_shops_state')
--   order by p.proname;
--
--   Expect 7 rows. Every row: settings contains search_path=public, pg_temp, and
--   anon_can false.
--     the five admin_* rows:  security_definer true,  authenticated_can true
--     the two _ helpers:      security_definer false, authenticated_can false
--
-- ── BLOCK B — the notes landed where both checks live ───────────────────
--
--   select p.proname,
--          position('NOTHING KEEPS THE COPIES IN STEP' in obj_description(p.oid, 'pg_proc')) > 0
--            as has_duplication_note,
--          (select count(*) from regexp_matches(obj_description(p.oid, 'pg_proc'),
--             'NOTHING KEEPS THE COPIES IN STEP', 'g'))            as times
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('provider_shop_is_publishable', 'enforce_publish_requires_complete_profile');
--
--   Expect 2 rows, has_duplication_note true, times 1.
--
--   select position('from 0039' in col_description(
--            'public.verification_requests'::regclass,
--            (select attnum from pg_attribute
--              where attrelid = 'public.verification_requests'::regclass
--                and attname = 'reviewed_by'))) > 0 as reviewer_comment_corrected;
--
--   Expect true. ("from 0039" appears only in the new comment.)
--
-- ── BLOCK C — the functions, exercised as an admin, then ROLLED BACK ─────
--
--   One DO block, so the admin claim and every call share one transaction. It
--   ends by raising an error ON PURPOSE: that is what throws every change away,
--   and the error message IS the result. Nothing in it is kept.
--
--   It uses real rows (the first pending verification request, the first
--   actioned report, the model test account) because a function tested only
--   against ids that do not exist has only had its guards tested.
--
--   do $$
--   declare
--     v_log text := '';
--     v_req uuid;
--     v_rep uuid;
--     r     jsonb;
--   begin
--     perform set_config('request.jwt.claims',
--       '{"sub":"ff06d568-8936-45fa-ad5f-0b88c150ec30","role":"authenticated"}', true);
--     v_log := v_log || E'\n1 is_admin: ' || public.is_admin();
--
--     select id into v_req from public.verification_requests
--      where status = 'pending' order by created_at limit 1;
--     if v_req is null then
--       v_log := v_log || E'\n2 approve: no pending request to test with';
--     else
--       begin
--         r := public.admin_decide_verification(v_req, 'approved', 'verify block C');
--         v_log := v_log || E'\n2 approve: ' || r::text
--           || E'\n  request now: ' || (select status || ' by ' || reviewed_by || ' (' || reviewed_by_source || ')'
--                                        from public.verification_requests where id = v_req)
--           || E'\n  audit rows for it: ' || (select count(*) from public.admin_audit_log
--                                             where details->>'request_id' = v_req::text
--                                               and details->>'via' = 'admin_decide_verification');
--       exception when others then v_log := v_log || E'\n2 approve FAILED: ' || sqlerrm;
--       end;
--       begin
--         r := public.admin_decide_verification(v_req, 'approved');
--         v_log := v_log || E'\n3 approve twice: NOT REFUSED ' || r::text;
--       exception when others then v_log := v_log || E'\n3 approve twice refused: ' || sqlerrm;
--       end;
--     end if;
--
--     select id into v_rep from public.reports where status = 'actioned' limit 1;
--     begin
--       r := public.admin_act_on_report(v_rep, 'dismiss', 'verify block C');
--       v_log := v_log || E'\n4 closed report: NOT REFUSED';
--     exception when others then v_log := v_log || E'\n4 closed report refused: ' || sqlerrm;
--     end;
--
--     begin
--       r := public.admin_act_on_user('b0df9c2f-02c5-4fef-afb0-9b184c3b9130', 'warn', 'verify block C');
--       v_log := v_log || E'\n5 warn: notification rows now '
--         || (select count(*) from public.notifications
--              where user_id = 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'
--                and type = 'admin_warning' and body = 'verify block C')
--         || ', audit rows '
--         || (select count(*) from public.admin_audit_log
--              where action = 'warn' and details->>'via' = 'admin_act_on_user'
--                and target_user_id = 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'
--                and admin_note = 'verify block C');
--     exception when others then v_log := v_log || E'\n5 warn FAILED: ' || sqlerrm;
--     end;
--
--     begin
--       r := public.admin_act_on_provider('00000000-0000-0000-0000-000000000000', 'ban', 'x');
--       v_log := v_log || E'\n6 missing provider: NOT REFUSED';
--     exception when others then v_log := v_log || E'\n6 missing provider refused: ' || sqlerrm;
--     end;
--
--     raise exception E'ROLLED BACK ON PURPOSE — nothing in this block was kept.%', v_log;
--   end $$;
--
--   Expect an ERROR whose text reads:
--     1 is_admin: true            (if false, the claim did not carry — stop)
--     2 approve: {"decision":"approved", ... "shops":[...]} with the request
--       "approved by ff06d568… (recorded)" and 1 audit row — or "no pending
--       request to test with"
--     3 approve twice refused: ... already approved ...
--     4 closed report refused: ... already actioned ...
--     5 warn: notification rows now 1, audit rows 1
--     6 missing provider refused: ... no provider ...
--
--   Then confirm nothing was kept:
--
--   select
--     (select count(*) from public.admin_audit_log where admin_note = 'verify block C') as audit_kept,
--     (select count(*) from public.notifications   where body = 'verify block C')       as notices_kept;
--
--   Expect 0 and 0.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs --stamp
--   node scripts/migration-status.mjs
-- ===========================================================================

-- ===========================================================================
-- 0053_deleting_a_stylist_withdraws_them
--
-- A stylist who deletes their account gives their models the same neutral
-- cancellation notice a suspension does. Audit item 85. Decision: Micky,
-- 23 Sep 2026 (option A).
--
-- ⚠️ Apply 0052 first.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- delete_account_data collects every session where the member is the model OR
-- the provider (account-deletion-fix.sql:311-315) and deletes them, with the
-- notifications attached. So a stylist deleting their account **silently
-- deleted their models' bookings**. The model was told nothing: the
-- appointment simply stopped existing in her diary.
--
-- Defensible as erasure. Indefensible as a surprise — and the same shape as
-- item 66, which was decided the other way for suspension.
--
-- ── ONE RULE, NOT A SECOND COPY ─────────────────────────────────────────
-- It calls `_withdraw_stylist` (0044), the function suspension and revocation
-- already use: hide every live shop, cancel every upcoming booking where they
-- are the stylist, notify each model with `cancellation_notice('withdrawn')`.
--
-- **The notice must not say deletion, suspension, or why**, and it does not:
-- 'withdrawn' is one neutral wording for every way the platform removes a
-- stylist, which is the whole reason that function exists.
--
-- ── ⚠️ THE ORDER, AND THE TRAP INSIDE IT ────────────────────────────────
-- The notices have to be written BEFORE the data is deleted, or there is
-- nothing left to write them from — no provider name, no treatment, no date.
--
-- But the notices carry `session_id`, and those sessions are deleted seconds
-- later by this same function. Whatever the FK does — cascade, set null, or
-- refuse — the notice the model was just sent is destroyed or blocks the
-- delete. **The email has already gone out by then** (0047 sends on the
-- notification INSERT), so she would have an email about a cancellation and
-- no record of it in the app.
--
-- So the new notices are de-referenced before the sessions go: session_id is
-- nulled on exactly the rows `_withdraw_stylist` just created. The body
-- already names the date, the time and the treatment (0030), so nothing
-- readable is lost — only a deep link to a booking that no longer exists.
--
-- They are identified by DIFFERENCE, not by timestamp: the notification ids
-- for those sessions are captured before the call, and anything new afterwards
-- is ours. A clock comparison would be a guess.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
--
-- ⚠️ This REPLACES a function that exists in no numbered migration — it lives
-- in supabase/account-deletion-fix.sql. So the live definition is checked for
-- two landmarks from that version before overwriting it. Replacing a function
-- that turned out to be something else is how an account deletion becomes a
-- partial wipe, which is the exact bug that file was written to end.
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if to_regprocedure('public._withdraw_stylist(uuid)') is null then
    raise exception '0053: _withdraw_stylist(uuid) is missing — apply 0044 first. There would be no shared rule to call.';
  end if;

  if to_regprocedure('public.delete_account_data(uuid)') is null then
    raise exception '0053: delete_account_data(uuid) is missing. Read supabase/account-deletion-fix.sql before continuing.';
  end if;

  v_def := pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure);

  if v_def not like '%delete_account_data requires a user id%'
     or v_def not like '%v_report_ids%' then
    raise exception
      '0053: the live delete_account_data is not the version this migration was written against. Read it with pg_get_functiondef before replacing it.';
  end if;

  if v_def like '%_withdraw_stylist%' then
    raise exception '0053: delete_account_data already calls _withdraw_stylist. This migration has effectively been applied.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE FUNCTION, REPRODUCED FROM account-deletion-fix.sql:296-356 WITH TWO
-- ADDITIONS AND NOTHING ELSE CHANGED.
--
-- The additions are marked `-- 0053:`. Everything else — the order of the
-- deletes, the audit-trail nulling, the comments — is the existing body
-- verbatim, because a rewrite of this function is a rewrite of account
-- deletion.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account_data(p_user uuid)
returns jsonb language plpgsql security definer
set search_path to 'public' as $$
declare
  v_provider_ids uuid[];
  v_session_ids  uuid[];
  v_report_ids   uuid[];
  v_pre_notices  uuid[];   -- 0053
  v_withdrawn    jsonb;    -- 0053
  v_result       jsonb;
begin
  if p_user is null then
    raise exception 'delete_account_data requires a user id';
  end if;

  select coalesce(array_agg(id), '{}') into v_provider_ids
    from public.providers where user_id = p_user;

  select coalesce(array_agg(distinct id), '{}') into v_session_ids
    from public.sessions
   where model_user_id = p_user
      or model_id = p_user
      or provider_id = any(v_provider_ids);

  select coalesce(array_agg(distinct id), '{}') into v_report_ids
    from public.reports
   where reporter_id = p_user
      or reported_id = p_user
      or session_id = any(v_session_ids);

  -- 0053: tell this stylist's models before anything is destroyed.
  --
  -- Only when they ARE a stylist: for a model this is a no-op, because
  -- _withdraw_stylist keys on providers.user_id. The notices it writes are for
  -- OTHER people and must outlive this transaction's deletes.
  if cardinality(v_provider_ids) > 0 then
    select coalesce(array_agg(id), '{}') into v_pre_notices
      from public.notifications where session_id = any(v_session_ids);

    v_withdrawn := public._withdraw_stylist(p_user);

    -- De-reference the notices just created, so the session deletes below
    -- cannot take them with them. The body still names the date, the time and
    -- the treatment; only the link to a now-deleted booking is dropped.
    update public.notifications
       set session_id = null
     where session_id = any(v_session_ids)
       and user_id <> p_user
       and id <> all(v_pre_notices);
  end if;

  -- Preserve the audit trail; drop only the pointers into deleted rows.
  update public.admin_audit_log set target_user_id     = null where target_user_id     = p_user;
  update public.admin_audit_log set target_provider_id = null where target_provider_id = any(v_provider_ids);
  update public.admin_audit_log set target_session_id  = null where target_session_id  = any(v_session_ids);
  update public.verification_requests set reviewed_by  = null where reviewed_by        = p_user;

  -- reports.reviewed_by is NO ACTION -> auth.users and blocks the auth delete
  -- where this user reviewed someone else's report as an admin.
  -- (moderation_actions.related_report_id also pointed at reports we delete
  -- below; that FK is severed in section 1, since the row is immutable and the
  -- pointer could not be nulled.)
  update public.reports set reviewed_by = null where reviewed_by = p_user;

  delete from public.reviews       where reviewer_id = p_user
                                      or reviewee_id = p_user
                                      or session_id  = any(v_session_ids);
  delete from public.messages      where sender_id  = p_user or session_id = any(v_session_ids);
  delete from public.notifications where user_id    = p_user or session_id = any(v_session_ids);
  delete from public.reports       where id = any(v_report_ids);
  delete from public.sessions      where id = any(v_session_ids);
  delete from public.providers     where user_id = p_user;

  -- public.users has NO FK to auth.users, so the auth delete does not cascade
  -- it. Deleting it here fires its own CASCADE children (blocks, favourites,
  -- model_attributes, model_photos, subscriptions, verification_*, ...).
  delete from public.users where id = p_user;

  v_result := jsonb_build_object(
    'providers', cardinality(v_provider_ids),
    'sessions',  cardinality(v_session_ids),
    'reports',   cardinality(v_report_ids),
    'withdrawn', coalesce(v_withdrawn, 'null'::jsonb));   -- 0053
  return v_result;
end $$;

-- Unchanged, and restated because a CREATE OR REPLACE does not alter grants —
-- said out loud so nobody assumes it might have.
revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;

comment on function public.delete_account_data(uuid) is
  'Deletes one account''s data in ONE transaction. Since 0053 it first calls _withdraw_stylist '
  'when the member is a stylist, so their models get the same neutral cancellation notice a '
  'suspension gives, and de-references those notices before the sessions are deleted. '
  'session_consents and moderation_actions survive by design. service_role only.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0053', 'deleting_a_stylist_withdraws_them', 'c6d2f4ece78d7cba90a36e8a20a60840331c459e2d5603c6c4b9a72f809a8f66');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   1. Apply this migration.
--   2. Push the site (the Settings panel that reaches this).
--   3. Blocks A and B below. ⚠️ Block B DELETES AN ACCOUNT and rolls it back —
--      read it before running it.
-- ===========================================================================
--
-- ── BLOCK A — the shape. Read-only ──────────────────────────────────────
--
--   select
--     pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure)
--       like '%_withdraw_stylist%'                                        as calls_withdraw,
--     pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure)
--       like '%set session_id = null%'                                    as dereferences_notices,
--     has_function_privilege('authenticated',
--       'public.delete_account_data(uuid)', 'execute')                    as client_may_call;
--
--   Expect true, true, FALSE. client_may_call true would mean any signed-in
--   member could erase any account by id.
--
-- ── BLOCK B — ⭐ a stylist's model is told, and the notice survives.
--    Rolls itself back ─────────────────────────────────────────────────────
--
-- Builds a booking between the model test account and a stylist, deletes the
-- STYLIST's data, and checks what the model is left holding. Everything is
-- rolled back, including the deletion.
--
-- ⚠️ The stylist it deletes is chosen as one that is NOT Micky B and NOT the
-- console admin, and the block refuses if it cannot find one — deleting the
-- only real stylist, even inside a rollback, would be a bad way to find out
-- the transaction did not roll back.
--
--   do $$
--   declare
--     v_model constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_keep1 constant uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';  -- Micky B
--     v_prov uuid; v_prov_user uuid; v_treat uuid; v_slot uuid; v_sess uuid;
--     v_notice_count int; v_notice record; v_sessions_left int;
--   begin
--     select p.id, p.user_id, t.id into v_prov, v_prov_user, v_treat
--     from public.providers p
--     join public.provider_treatments t on t.provider_id = p.id
--     where p.user_id is not null
--       and p.user_id <> v_keep1
--       and p.user_id not in (select user_id from public.admins)
--     limit 1;
--
--     if v_prov is null then
--       raise exception 'ROLLED BACK. No deletable test stylist with a treatment exists. Not deleting a real one to prove a point.';
--     end if;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments)
--     values (v_prov, current_date + 10, '09:00', '10:00', array[v_treat::text])
--     returning id into v_slot;
--
--     insert into public.sessions (provider_id, model_id, model_user_id, availability_id, treatment_id,
--                                  date, start_time, end_time, scheduled_at, duration_minutes,
--                                  location_type, status)
--     values (v_prov, v_model, v_model, v_slot, v_treat, current_date + 10, '09:00', '10:00',
--             (current_date + 10)::timestamptz + interval '9 hours', 60, 'provider', 'accepted')
--     returning id into v_sess;
--
--     perform public.delete_account_data(v_prov_user);
--
--     select count(*) into v_sessions_left from public.sessions where id = v_sess;
--
--     select count(*) into v_notice_count
--     from public.notifications
--     where user_id = v_model and type = 'session_cancelled' and session_id is null;
--
--     select title, body into v_notice
--     from public.notifications
--     where user_id = v_model and type = 'session_cancelled' and session_id is null
--     order by created_at desc limit 1;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\nbooking rows left: %  (must be 0)\nnotices to the model that survived the deletes: %  (must be at least 1)\ntitle: %\nbody:  %',
--       v_sessions_left, v_notice_count, coalesce(v_notice.title, '(none)'), coalesce(v_notice.body, '(none)');
--   end $$;
--
--   ⚠️ READ THE BODY IT PRINTS. It must not contain the words "deleted",
--   "suspended", "banned" or any reason. If it does, the neutral wording has
--   been lost and every withdrawal route is affected, not just this one.

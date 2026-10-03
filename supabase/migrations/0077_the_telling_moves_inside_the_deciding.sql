-- ===========================================================================
-- 0077_the_telling_moves_inside_the_deciding
--
-- Stage A of item 144: three of the fifteen client-side notification inserts
-- move inside the function that already made the decision.
--
-- ⚠️ Apply 0076 first.
--
-- ⚠️⚠️ THE DEPLOY ORDER IS PART OF THIS MIGRATION. Apply this FIRST, then
-- deploy site + admin. For the few minutes between, the RPC writes the
-- notification AND the client still inserts, so a member can be told TWICE —
-- and for session_applied and verification that means two identical emails.
-- The other order tells them ZERO times, silently. A duplicate is visible and
-- self-correcting; a silent zero is the failure this whole item is about.
-- Mobile is unreleased and does not take part.
--
-- ── WHY ────────────────────────────────────────────────
-- The `notifications` INSERT policy is `with check (auth.uid() is not null)`:
-- any signed-in account can write any notification to anyone, and notify_email
-- will then send that text as Cavy (item 144). It cannot be tightened until
-- every cross-user insert runs inside a definer function, because all fifteen
-- write to somebody other than the caller.
--
-- Reading the clients showed the pattern: the notification was bolted on
-- OUTSIDE the function that made the decision, every time. That is two faults —
-- the open policy, and a state change that can half-fail while the telling does
-- not. 0039 settled this for the admin side and called it *admin decisions are
-- atomic*. Three of them become atomic here.
--
-- ── WHAT IS NOT HERE, AND WHY ──────────────────────────
-- The verification APPROVAL notice stays in the client until 0078. Its body
-- comes from stylistApprovalBody(role, shops), which branches on role, on
-- whether each shop is published, and on which fields are missing. The live
-- definition shows admin_decide_verification already computes
-- `_provider_shops_state(v_user)`, so it IS portable — but it is real logic and
-- belongs in a migration that can be reviewed on its own.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0076') then
    raise exception '0077: apply 0076 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. session_applied
--
-- ⚠️ create_session_with_consent IS NOT SECURITY DEFINER. The live definition
-- has `SET search_path TO 'public'` and nothing else, so it runs as the caller.
-- Folding the insert into it directly would NOT close the hole — it would still
-- be the model writing a row addressed to the stylist under the open policy.
--
-- So the notice gets its own definer function and the booking function calls
-- it. The session and consent inserts stay under RLS exactly as they are:
-- making the whole thing SECURITY DEFINER to move one notification would remove
-- a safety net to fix a different one.
-- ---------------------------------------------------------------------------
create or replace function public.notify_session_applied(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model    uuid;
  v_provider uuid;
  v_owner    uuid;
  v_date     date;
  v_start    time;
  v_treat    text;
begin
  select s.model_user_id, s.provider_id, s.date, s.start_time,
         coalesce(nullif(btrim(t.name), ''), nullif(btrim(t.category), ''), 'a treatment')
    into v_model, v_provider, v_date, v_start, v_treat
    from public.sessions s
    left join public.provider_treatments t on t.id = s.treatment_id
   where s.id = p_session_id;

  if v_model is null then
    return;                         -- no such session; nothing to announce
  end if;

  -- ⚠️ THE AUTHORISATION. Only the model on the booking may announce it. This
  -- is the rule the open policy does not have, and the reason this function
  -- exists rather than a direct insert.
  if v_model is distinct from auth.uid() then
    raise exception 'notify_session_applied: only the model on this booking can announce it'
      using errcode = '42501';
  end if;

  select p.user_id into v_owner from public.providers p where p.id = v_provider;
  if v_owner is null then
    return;                         -- no stylist to tell; the caller logged it
  end if;

  -- ⚠️ DATE AND TIME COME FROM THE ROW, NOT FROM ARGUMENTS. 0065's
  -- session_slot_authority fills them from the availability row, and
  -- create_session_with_consent's own p_date/p_start_time are dead arguments
  -- that it passes as null. Reading them back is the only correct source.
  --
  -- FMDD strips the leading zero so this reads '3 Oct 2026', matching what
  -- members see today. The copy does not change in a refactor.
  insert into public.notifications (user_id, type, title, body, session_id)
  values (
    v_owner,
    'session_applied',
    'New treatment application',
    'A model has applied for ' || v_treat
      || ' on ' || to_char(v_date, 'FMDD Mon YYYY')
      || ' at ' || to_char(v_start, 'HH24:MI'),
    p_session_id
  );
end
$$;

comment on function public.notify_session_applied(uuid) is
  'Tells the stylist a model has applied. SECURITY DEFINER because the row is addressed to somebody '
  'else; authorises on the caller being the model ON that booking. Called by '
  'create_session_with_consent, which is SECURITY INVOKER and could not write it. 0077, item 144.';

revoke all on function public.notify_session_applied(uuid) from public, anon;
grant execute on function public.notify_session_applied(uuid) to authenticated;

-- The booking function, reproduced from its LIVE definition with one line
-- added. Security properties deliberately unchanged: still INVOKER, still
-- `search_path = public`.
create or replace function public.create_session_with_consent(
  p_provider_id uuid, p_availability_id uuid, p_date date,
  p_start_time time without time zone, p_end_time time without time zone,
  p_scheduled_at timestamp with time zone, p_duration_minutes integer,
  p_treatment_id uuid, p_location_type text, p_note text, p_photo_urls text[],
  p_consent_document_id uuid, p_consent_version integer, p_content_hash text,
  p_acknowledgements jsonb, p_category_id uuid default null::uuid)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_me         uuid := auth.uid();
  v_session_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if p_consent_document_id is null or p_content_hash is null or p_acknowledgements is null then
    raise exception 'Consent is required to book' using errcode = '23502';
  end if;

  -- The booking. A 23505 from sessions_active_slot_uniq is deliberately NOT
  -- caught: it propagates unchanged so the app's slot-race branch still fires.
  --
  -- ⚠️ NULLS FOR THE FOUR TIME COLUMNS. session_slot_authority fills them from
  -- the availability row before any constraint is checked. p_date,
  -- p_start_time, p_end_time and p_scheduled_at are dead arguments (0065).
  insert into public.sessions (
    provider_id, model_user_id, model_id, availability_id,
    date, start_time, end_time, scheduled_at, duration_minutes,
    treatment_id, location_type, note, photo_urls, status
  ) values (
    p_provider_id, v_me, v_me, p_availability_id,
    null, null, null, null, p_duration_minutes,
    p_treatment_id, p_location_type, p_note, p_photo_urls, 'pending'
  )
  returning id into v_session_id;

  -- The consent. Any failure here aborts the whole function, so the booking
  -- above is rolled back with it. There is no path to a confirmed booking
  -- without a consent record.
  insert into public.session_consents (
    session_id, user_id, category_id,
    consent_document_id, consent_version, content_hash,
    acknowledgements, agreed_at
  ) values (
    v_session_id, v_me, p_category_id,
    p_consent_document_id, p_consent_version, p_content_hash,
    p_acknowledgements, now()
  );

  -- ⚠️ ADDED 0077 (item 144). The stylist is told HERE, in the transaction that
  -- made the booking, instead of by a best-effort insert the client ran
  -- afterwards and logged on failure. An application nobody is told about is
  -- the same silence as a booking that never saved.
  perform public.notify_session_applied(v_session_id);

  return v_session_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 2. verification — REJECTION only (approval is 0078)
--
-- Reproduced from the live definition with one block added. v_note is already
-- in scope, so the copy the client builds is rebuilt here from the same input;
-- there is no preview of it in the console, so nothing can drift.
-- ---------------------------------------------------------------------------
create or replace function public.admin_decide_verification(
  p_request_id uuid, p_decision text, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- ⚠️ ADDED 0077 (item 144). REJECTION ONLY — the approval notice still comes
  -- from the console until 0078, because its copy branches on shop state.
  -- Same words the console built, from the same v_note it already passed in.
  -- "a rejected person who is never told is the silent failure" — the console's
  -- own comment, and now it cannot happen separately from the decision.
  if p_decision = 'rejected' then
    insert into public.notifications (user_id, type, title, body)
    values (
      v_user,
      'verification',
      'Verification not approved',
      case when v_note is not null
           then 'Your verification was not approved: ' || v_note
           else 'Your verification was not approved. Please resubmit with a clearer photo.' end
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'decision',         p_decision,
    'user_id',          v_user,
    'role',             v_role,
    'already_verified', v_was_verified,
    'shops',            v_shops
  ));
end
$function$;

-- ---------------------------------------------------------------------------
-- 3. admin_decide_status_post — DROP AND RECREATE for a new argument
--
-- ⚠️ `create or replace` cannot add a parameter: a defaulted argument makes an
-- OVERLOAD, and the two-argument and three-argument forms then make every call
-- ambiguous. 0058 added a fifth parameter to four functions this same way.
--
-- ⚠️ AND THE MESSAGE IS PASSED IN, NOT REBUILT HERE — the one place in stage A
-- where the copy stays in the console. The admin is shown that exact string in
-- a confirm() before the call, and the console's own comment says the message
-- is built ONCE "so what is previewed cannot drift from what is sent".
-- Composing it here instead would create a second copy of that text and break
-- the property the preview exists for. This is the admin's own words, not an
-- event, so event-only is the wrong rule for it.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_decide_status_post(uuid, text, text);

create function public.admin_decide_status_post(
  p_post_id uuid, p_decision text, p_note text default null::text,
  p_member_message text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_admin    uuid := auth.uid();
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_message  text := nullif(btrim(coalesce(p_member_message, '')), '');
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

  -- ⚠️ ADDED 0077 (item 144). Only when a message was supplied, which keeps
  -- this behaviour-identical to the console's `if (stylistMessage && ...)`.
  -- An approval stays deliberately silent: the post simply appears, which is
  -- what the stylist expected when they wrote it.
  if v_message is not null and v_owner is not null then
    insert into public.notifications (user_id, type, title, body)
    values (v_owner, 'admin_message', 'Your update wasn’t published', v_message);
  end if;

  -- notify_user_id so the caller can send the rejection notice without a second
  -- read that can fail on its own. ⚠️ Kept in the return although the function
  -- now sends it itself: the console still reads it, and removing a field from
  -- a return shape is a separate change from adding a behaviour.
  return jsonb_strip_nulls(jsonb_build_object(
    'decision',       p_decision,
    'provider_id',    v_provider,
    'notify_user_id', v_owner
  ));
end
$function$;

revoke all on function public.admin_decide_status_post(uuid, text, text, text) from public, anon;
grant execute on function public.admin_decide_status_post(uuid, text, text, text) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0077', 'the_telling_moves_inside_the_deciding', '77582c6b87f0d4a7ba441fceb1293a997bd2dc0ab81d4134be0a3b0911bbb043');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   -- (i) the state this migration assumes
--   select
--     (select count(*) from public.schema_migrations where version = '0076') = 1
--       as v_0076_applied,
--     (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname='public' and p.proname='create_session_with_consent')
--       as booking_fn_is_definer_SHOULD_BE_FALSE,
--     to_regprocedure('public.admin_decide_status_post(uuid,text,text)') is not null
--       as three_arg_form_exists,
--     to_regprocedure('public.admin_decide_status_post(uuid,text,text,text)') is null
--       as four_arg_form_is_new;
--
--   Expect true, FALSE, true, true. The second is not a typo: this migration
--   relies on the booking function being INVOKER, which is why the notice needs
--   its own definer helper.
--
--   -- (ii) ⚠️ THE GRANTS ON THE FUNCTION BEING DROPPED. A drop takes its grants
--   --      with it, and this migration re-grants only `authenticated`. If this
--   --      returns anything else, tell me BEFORE applying.
--   select r.rolname, has_function_privilege(r.rolname,
--            'public.admin_decide_status_post(uuid,text,text)', 'execute') as can_execute
--     from pg_roles r
--    where r.rolname in ('anon','authenticated','service_role','public');
--
--   Expect authenticated true; anon and public false.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the shapes, read from the catalogue
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('notify_session_applied','create_session_with_consent',
--                        'admin_decide_verification','admin_decide_status_post')
--    order by p.proname;
--
--   Expect FOUR rows and no more — a fifth would mean an unintended overload.
--   notify_session_applied: (uuid), prosecdef t.
--   create_session_with_consent: prosecdef f (unchanged on purpose).
--   admin_decide_status_post: four args ending `p_member_message text`.
--
--   -- (b) the notice is REFUSED to someone who is not the model on the booking.
--   --     This is the authorisation the open policy does not have, so it is the
--   --     one thing worth proving rather than reading.
--   begin;
--   do $v$
--   declare
--     v_sid uuid; v_model uuid; v_other uuid; v_got text := 'NO ERROR — THE GUARD DID NOT FIRE';
--   begin
--     select s.id, s.model_user_id into v_sid, v_model
--       from public.sessions s where s.model_user_id is not null order by s.created_at desc limit 1;
--     select u.id into v_other from public.users u
--      where u.id is distinct from v_model limit 1;
--     if v_sid is null or v_other is null then
--       raise exception 'ROLLED BACK, TESTED NOTHING. Need one session and one other user.';
--     end if;
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
--     begin
--       perform public.notify_session_applied(v_sid);
--     exception when others then
--       v_got := sqlerrm;
--     end;
--     raise exception 'ROLLED BACK ON PURPOSE. as a non-model: %', v_got;
--   end $v$;
--   rollback;
--
--   Expect the message to contain "only the model on this booking can announce
--   it". If it says THE GUARD DID NOT FIRE, the authorisation is missing and
--   this migration has made things no safer than the direct insert.
--
--   -- (c) a rejection now writes its own notification. Rolled back.
--   --     Pick a PENDING request or this tests nothing.
--   begin;
--   do $v$
--   declare
--     v_req uuid; v_admin uuid; v_user uuid; v_before int; v_after int;
--   begin
--     select vr.id, vr.user_id into v_req, v_user
--       from public.verification_requests vr where vr.status = 'pending' limit 1;
--     select user_id into v_admin from public.admins limit 1;
--     if v_req is null or v_admin is null then
--       raise exception 'ROLLED BACK, TESTED NOTHING. Need a pending request and an admin.';
--     end if;
--     select count(*) into v_before from public.notifications
--      where user_id = v_user and type = 'verification';
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
--     perform public.admin_decide_verification(v_req, 'rejected', 'the photo is blurred');
--
--     select count(*) into v_after from public.notifications
--      where user_id = v_user and type = 'verification';
--     raise exception 'ROLLED BACK ON PURPOSE. verification notices before=% after=% (expect +1)',
--       v_before, v_after;
--   end $v$;
--   rollback;
--
--   ⚠️ Run this on a REAL pending request only if you are content to roll it
--   back — the rollback undoes the decision too. If there is no pending request,
--   it says TESTED NOTHING rather than passing.
-- ===========================================================================

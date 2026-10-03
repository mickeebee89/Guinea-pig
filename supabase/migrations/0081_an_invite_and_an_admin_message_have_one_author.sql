-- ===========================================================================
-- 0081_an_invite_and_an_admin_message_have_one_author
--
-- Stages C and D of item 144: the last four client-side notification inserts
-- that write to somebody else move behind definer functions.
--
-- ⚠️ Apply 0080 first.
--
-- ⚠️ INERT UNTIL THE CLIENTS DEPLOY, like 0078 and unlike 0077. It only adds
-- two functions; nothing calls them yet. Applying it changes nothing.
--
-- ── STAGE E RESOLVED: IT WAS NEVER A FOURTH CATEGORY ───
-- `provider-dashboard.tsx:789` sat in the plan as "unclassified, needs reading
-- not guessing". Read: it is `handleInvite`, writing `stylist_invite`. **So it
-- is stage C, and stage C is THREE sites rather than two.** Stage E is closed
-- by having read the thing instead of by building anything.
--
-- ── ⚠️ AND THE INVITE COPY HAD DRIFTED, TOO ────────────
--   web  salon-floor      '{name} would like you as a model'
--                         'Open their shop to see what they do and when they are free.'
--   mobile model/[id]     '{name} wants you as their model'
--   mobile provider-dash  'Tap to view their shop'
--
-- `stylist_invite` is in notify_email's allowlist (0073), so **both variants
-- reach inboxes**. And 'Tap to view their shop' is the same device-verb body
-- item 143 found on `new_availability` — "tap" is mobile's word, on a
-- notification that is also an email, read on a desktop as often as not.
--
-- **The web wording wins, and that is a lookup rather than a judgement:**
-- copyFor's `stylist_invite` case already sends the subject *'A stylist would
-- like you as a model'*. Choosing the mobile title would have left the email's
-- own subject disagreeing with the body underneath it.
--
-- `data.shop_handle` is dropped: mobile wrote it, nothing anywhere reads it
-- from a notification — checked across all three apps. `provider_id` stays,
-- because routeForNotification deep-links on it.
--
-- ── THE RATE LIMIT, STILL NONE ─────────────────────────
-- Decided 2 Oct: a stylist may invite whoever she likes, as often as she
-- likes. Unchanged here. Moving the insert behind a function makes a limit
-- possible later in one place, which it was not before.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0080') then
    raise exception '0081: apply 0080 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STAGE C — the invite. Three client sites.
--
-- ⚠️ THE TARGET IS A PARAMETER AND THE AUTHOR IS NOT. The caller's provider is
-- derived from auth.uid(), exactly as 0075 does, so a caller cannot invite
-- somebody *as* another stylist. The model being invited must be a parameter,
-- because the whole point is choosing her.
-- ---------------------------------------------------------------------------
create or replace function public.invite_model(p_model_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider uuid;
  v_name     text;
begin
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider, v_name
    from public.providers p
   where p.user_id = auth.uid();

  if v_provider is null then
    raise exception 'invite_model: only a stylist can invite someone'
      using errcode = '42501';
  end if;

  if p_model_user_id is null or p_model_user_id = auth.uid() then
    raise exception 'invite_model: that is your own account'
      using errcode = '22023';
  end if;

  -- ⚠️ ONE WORDING, and it is the web's because copyFor's stylist_invite
  -- subject already says 'A stylist would like you as a model'. The body says
  -- what she gets by going, rather than telling her to tap — "tap" is a
  -- mobile verb on a notification that is also an email (item 143).
  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_model_user_id,
    'stylist_invite',
    v_name || ' would like you as a model',
    'Open their shop to see what they do and when they are free.',
    jsonb_build_object('provider_id', v_provider)
  );
end
$$;

comment on function public.invite_model(uuid) is
  'A stylist invites a model. SECURITY DEFINER because the row is addressed to her; the inviting '
  'provider comes from auth.uid() so it cannot be sent as somebody else. One wording, replacing three '
  'client copies that had drifted into two variants, both of which reached inboxes. No rate limit, '
  'decided 2 Oct 2026. 0081, audit item 144 stage C.';

revoke all on function public.invite_model(uuid) from public, anon;
grant execute on function public.invite_model(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- STAGE D — the admin's own message. One client site.
--
-- ⚠️ FREE TEXT IS CORRECT HERE, and that is not an exception to the event-only
-- rule — it is the rule's boundary. Event-only exists so a MEMBER cannot put
-- chosen words in front of another member. This is an admin writing to a
-- member deliberately, from a screen whose entire job is to do that, and the
-- words are the point. Same reasoning as the moderation message in 0077.
--
-- What changes is not the text but who may send it: `is_admin()`, in the
-- database, rather than the open INSERT policy.
-- ---------------------------------------------------------------------------
create or replace function public.notify_as_admin(
  p_user_id uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not public.is_admin() then
    raise exception 'notify_as_admin: not an admin' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'notify_as_admin: no recipient' using errcode = '22023';
  end if;
  -- The console already refuses to send an empty one. Enforced here too,
  -- because the console is not the only possible caller once this exists.
  if v_title is null or v_body is null then
    raise exception 'notify_as_admin: a message needs a title and a body'
      using errcode = '22023';
  end if;

  insert into public.notifications (user_id, type, title, body)
  values (p_user_id, 'admin_message', v_title, v_body);
end
$$;

comment on function public.notify_as_admin(uuid, text, text) is
  'An admin writes to a member. SECURITY DEFINER, gated on is_admin(). Free text deliberately: the '
  'event-only rule exists so a MEMBER cannot choose words shown to another member, and this is the '
  'boundary of that rule, not an exception to it. 0081, audit item 144 stage D.';

revoke all on function public.notify_as_admin(uuid, text, text) from public, anon;
grant execute on function public.notify_as_admin(uuid, text, text) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0081', 'an_invite_and_an_admin_message_have_one_author', '0e0693eebe1312f5c40e92d7148407609eab896366c6bcbae856085076b47203');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0080') = 1
--       as v_0080_applied,
--     to_regprocedure('public.invite_model(uuid)') is null        as invite_is_new,
--     to_regprocedure('public.notify_as_admin(uuid,text,text)') is null
--                                                                 as admin_fn_is_new,
--     (select count(*) from public.providers p
--       where p.user_id = 'ff06d568-8936-45fa-ad5f-0b88c150ec30') = 1
--       as test_stylist_exists;
--
--   Expect all four true.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   Conventions: every variable in `declare`, one `%` fed one concatenated
--   string, scalar subqueries rather than `select ... into`.
--
--   -- (a) the shapes
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('invite_model','notify_as_admin')
--    order by p.proname;
--
--   Expect both prosecdef **t**.
--
--   -- (b) A NON-STYLIST CANNOT INVITE, and the model's own copy is written.
--   --     Rolled back. The model account is used as the actor BECAUSE she is
--   --     not a stylist — that is the thing being tested, not a convenience.
--   begin;
--   do $v$
--   declare
--     v_model uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_other uuid;
--     v_got   text := 'NO ERROR — THE GUARD DID NOT FIRE';
--   begin
--     v_other := (select u.id from public.users u
--                  where u.id is distinct from v_model limit 1);
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     if auth.uid() is null then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. auth.uid() is null.';
--     end if;
--     if exists (select 1 from public.providers p where p.user_id = auth.uid()) then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. The chosen actor IS a stylist, so the guard is meant to let her through.';
--     end if;
--     begin
--       perform public.invite_model(v_other);
--     exception when others then v_got := sqlstate || ' ' || sqlerrm; end;
--     execute 'reset role';
--     raise exception '%', 'ROLLED BACK ON PURPOSE. as a non-stylist: ' || v_got;
--   end $v$;
--   rollback;
--
--   Expect "only a stylist can invite someone", 42501.
--
--   -- (c) A STYLIST CAN, with the one wording. Rolled back.
--   begin;
--   do $v$
--   declare
--     v_stylist uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_model   uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_title text; v_body text; v_pid text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_stylist::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     perform public.invite_model(v_model);
--     execute 'reset role';
--     v_title := (select title from public.notifications
--                  where user_id = v_model and type = 'stylist_invite'
--                  order by created_at desc limit 1);
--     v_body  := (select body from public.notifications
--                  where user_id = v_model and type = 'stylist_invite'
--                  order by created_at desc limit 1);
--     v_pid   := (select data->>'provider_id' from public.notifications
--                  where user_id = v_model and type = 'stylist_invite'
--                  order by created_at desc limit 1);
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || 'title: ' || coalesce(v_title,'null') || chr(10)
--       || 'body:  ' || coalesce(v_body,'null')  || chr(10)
--       || 'data.provider_id: ' || coalesce(v_pid,'null')
--       || ' (expected 49d40aae-a830-41d1-bca8-0fbdb2695455)';
--   end $v$;
--   rollback;
--
--   Expect the title to end 'would like you as a model' — NOT 'wants you as
--   their model' — the body to be the sentence rather than 'Tap to view their
--   shop', and provider_id to MATCH, since routeForNotification deep-links on
--   it and a null there is item 143 again.
--
--   -- (d) A NON-ADMIN CANNOT SEND AN ADMIN MESSAGE. Rolled back.
--   begin;
--   do $v$
--   declare
--     v_model uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_got   text := 'NO ERROR — THE GUARD DID NOT FIRE';
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     if public.is_admin() then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. The chosen actor IS an admin.';
--     end if;
--     begin
--       perform public.notify_as_admin(v_model, 'Test', 'Test');
--     exception when others then v_got := sqlstate || ' ' || sqlerrm; end;
--     execute 'reset role';
--     raise exception '%', 'ROLLED BACK ON PURPOSE. as a non-admin: ' || v_got;
--   end $v$;
--   rollback;
--
--   Expect "notify_as_admin: not an admin", 42501.
-- ===========================================================================

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
-- ── VERIFY — ONE BLOCK, FOUR SECTIONS ───────────────────────────────────
--
--   Conventions (scripts/migration-status.mjs): one paste, not a numbered set;
--   each section in its own begin/exception subtransaction so one failure does
--   not lose the others; every variable in `declare`; one `%` fed one
--   concatenated string; scalar subqueries rather than `select ... into`.
--
--   ⚠️ AND TWO HAZARDS THAT ONLY EXIST BECAUSE THE SECTIONS SHARE A
--   TRANSACTION — neither applied when these were four separate pastes:
--
--     * `created_at` defaults to `now()`, which is CONSTANT for the whole
--       transaction. Rows written by different sections TIE, so
--       `order by created_at desc limit 1` picks arbitrarily. Section (c)
--       therefore excludes a set of ids captured BEFORE the call, and never
--       orders by time. `notifications.id` is a random uuid, so ordering by id
--       is not a substitute either.
--     * A read-back must prove the row is NEW. (c) captures what exists first
--       and looks only outside that set, so "the function errored and an older
--       invite was already there" cannot read as a pass.
--
--   begin;
--   do $v$
--   declare
--     v_stylist uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_model   uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_other   uuid;
--     v_before  uuid[];
--     v_new     uuid;
--     v_title   text;
--     v_body    text;
--     v_pid     text;
--     r_a text := 'not run';
--     r_b text := 'not run';
--     r_c text := 'not run';
--     r_d text := 'not run';
--   begin
--     -- (a) the shapes
--     begin
--       r_a := coalesce((
--         select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid)
--                           || ') secdef=' || p.prosecdef, ' | ' order by p.proname)
--           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname = 'public'
--            and p.proname in ('invite_model', 'notify_as_admin')
--       ), 'NEITHER FUNCTION EXISTS');
--     exception when others then r_a := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     -- (b) a NON-STYLIST cannot invite. The model is the actor BECAUSE she is
--     --     not a stylist — that is the subject, not a convenience.
--     begin
--       v_other := (select u.id from public.users u
--                    where u.id is distinct from v_model limit 1);
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       if auth.uid() is null then
--         r_b := 'TESTED NOTHING: auth.uid() is null';
--       elsif exists (select 1 from public.providers p where p.user_id = auth.uid()) then
--         r_b := 'TESTED NOTHING: the chosen actor IS a stylist, so the guard should let her through';
--       elsif v_other is null then
--         r_b := 'TESTED NOTHING: no second user to invite';
--       else
--         begin
--           perform public.invite_model(v_other);
--           r_b := 'NO ERROR — THE GUARD DID NOT FIRE';
--         exception when others then r_b := sqlstate || ' ' || sqlerrm; end;
--       end if;
--       execute 'reset role';
--     exception when others then r_b := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     -- (c) a STYLIST can, and the one wording is read back from a row proven NEW
--     begin
--       v_before := array(select n.id from public.notifications n
--                          where n.user_id = v_model and n.type = 'stylist_invite');
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_stylist::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       perform public.invite_model(v_model);
--       execute 'reset role';
--
--       v_new := (select n.id from public.notifications n
--                  where n.user_id = v_model and n.type = 'stylist_invite'
--                    and not (n.id = any (v_before)));
--       if v_new is null then
--         r_c := 'NO NEW ROW — the function wrote nothing. Any older invite is NOT evidence.';
--       else
--         v_title := (select title from public.notifications where id = v_new);
--         v_body  := (select body  from public.notifications where id = v_new);
--         v_pid   := (select data->>'provider_id' from public.notifications where id = v_new);
--         r_c := 'title=[' || coalesce(v_title, 'null') || '] body=[' || coalesce(v_body, 'null')
--                || '] provider_id=' || coalesce(v_pid, 'null');
--       end if;
--     exception when others then r_c := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     -- (d) a NON-ADMIN cannot send an admin message
--     begin
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       if public.is_admin() then
--         r_d := 'TESTED NOTHING: the chosen actor IS an admin';
--       else
--         begin
--           perform public.notify_as_admin(v_model, 'Test', 'Test');
--           r_d := 'NO ERROR — THE GUARD DID NOT FIRE';
--         exception when others then r_d := sqlstate || ' ' || sqlerrm; end;
--       end if;
--       execute 'reset role';
--     exception when others then r_d := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || '(a) shapes        : ' || r_a || chr(10)
--       || '(b) non-stylist   : ' || r_b || chr(10)
--       || '(c) stylist/copy  : ' || r_c || chr(10)
--       || '(d) non-admin     : ' || r_d;
--   end $v$;
--   rollback;
--
--   EXPECT:
--     (a) invite_model(uuid) secdef=true | notify_as_admin(uuid,text,text) secdef=true
--     (b) 42501 … only a stylist can invite someone
--     (c) title ending 'would like you as a model' — NOT 'wants you as their
--         model'; body the sentence, NOT 'Tap to view their shop'; provider_id
--         = 49d40aae-a830-41d1-bca8-0fbdb2695455. ⚠️ A null provider_id is item
--         143 again: routeForNotification deep-links on it.
--     (d) 42501 … notify_as_admin: not an admin
--
--   ⚠️ ANY "TESTED NOTHING" IS NOT A PASS. It means the premise failed and that
--   section exercised nothing — report it rather than reading past it.
--
--   ⚠️ (c) WRITES A REAL stylist_invite AND ROLLS BACK, so it queues an email.
--   Item 152 established that a rolled-back transaction cannot deliver one —
--   net.wake() takes no arguments, so the queue row is the only channel and an
--   uncommitted row is invisible to the worker. (c) is the first block to rely
--   on that conclusion rather than on the mitigation alone. The recipient is
--   Micky's own test account either way.
-- ===========================================================================

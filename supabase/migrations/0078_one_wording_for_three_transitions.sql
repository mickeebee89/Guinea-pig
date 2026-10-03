-- ===========================================================================
-- 0078_one_wording_for_three_transitions
--
-- Stage B of item 144: accept, decline and complete move into one function,
-- and their wording stops existing six times.
--
-- ⚠️ Apply 0077 first.
--
-- ⚠️⚠️ THE DEPLOY CONSTRAINT IS THE OPPOSITE OF 0077'S. This migration is
-- INERT: it only adds two functions, and nothing calls them until the clients
-- deploy. There is no duplicate window and applying it changes nothing. The
-- risk is entirely in the client deploy, and it is larger in kind than stage
-- A's — if these functions are wrong, no booking can be accepted, declined or
-- completed, which is the core of the product rather than one notification.
--
-- Rollback is a Vercel revert, and it works ONLY because stage F has not run:
-- a direct UPDATE on sessions is still legal, so reverting restores a path
-- that still functions. **Stage B stops being reversible the moment the
-- notifications INSERT policy tightens**, which is an argument for leaving F
-- until this has had real traffic.
--
-- ── WHY ────────────────────────────────────────────────
-- Six client call sites each held their own copy of the same three
-- notifications, and they had already drifted three ways:
--
--   * completed title:  'Treatment complete' (web) vs 'Treatment completed ✓'
--   * completed body:   web asks 'Leave a review?', mobile never mentions it
--   * THE DATE, on all six: web renders 'Friday 3 October', both mobile sites
--     render 'Fri 3 Oct' — and session_accepted and session_declined are both
--     in notify_email's allowlist, so that difference reached inboxes.
--
-- The third was the one nobody had noticed, and it is the widest. Mobile also
-- holds three identical copies of that date formatter.
--
-- ── THE COPY, DECIDED BY MICKY 3 Oct 2026 ──────────────
-- Date:            'Friday 3 October' everywhere — to_char(d, 'FMDay FMDD FMMonth').
--                  The long form wins because these arrive by email and are read
--                  days later out of context, and a spelt-out weekday is what
--                  stops a misread day. Mobile's 'Fri 3 Oct' goes.
-- Completed title: 'Treatment complete'. No tick.
-- Completed body:  keeps 'Leave a review?'. Dropping a working product
--                  behaviour inside a refactor is not what a refactor is for.
--                  Both clients route it: /bookings/[sessionId]/review on web,
--                  leave-review on mobile.
--
-- ── ⚠️ WHY INVOKER, STATED AT THE RIGHT STRENGTH ───────
-- transition_session is SECURITY INVOKER for REVIEW COST, NOT SAFETY.
--
-- An earlier draft of this header claimed a definer version would bypass the
-- actor rule. **That is false and was corrected before it shipped.**
-- enforce_session_status_transition is a BEFORE UPDATE OF status trigger: it
-- fires regardless of SECURITY DEFINER, and auth.uid() survives definer
-- because it reads the request-scoped JWT claim rather than the role. A definer
-- version would have been refused by the trigger just the same.
--
-- Invoker is still the right choice, for the smaller reason: RLS and the
-- trigger both apply exactly as they do today, so there is less to reason about
-- and nothing is re-expressed. It also matches 0077, where invoker was forced
-- by create_session_with_consent already being invoker.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0077') then
    raise exception '0078: apply 0077 first.';
  end if;
  if to_regprocedure('public.notify_session_applied(uuid)') is null then
    raise exception '0078: 0077 did not leave notify_session_applied behind; stage A is not in place.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The notice. DEFINER, because the row is addressed to the model.
--
-- ⚠️ ITS AUTHORISATION MIRRORS THE TRIGGER RATHER THAN INVENTING A SECOND
-- RULE: provider-for-this-session, OR is_admin() — which is exactly the pair
-- enforce_session_status_transition allows for these three statuses. One rule,
-- expressed twice only because a notification and an UPDATE are checked in
-- different places.
--
-- It also refuses to announce something that is not true: the session's status
-- must ALREADY equal p_to. So this cannot be used to tell a model her booking
-- was confirmed when it was not.
--
-- ⚠️ KNOWN RESIDUE, NOT CLOSED HERE. Because transition_session is invoker,
-- the CALLER needs EXECUTE on this helper, so a client can call it directly and
-- re-announce a transition that genuinely happened — duplicate notifications,
-- though never false ones. That is far narrower than today's open INSERT policy
-- (anyone, any text, any recipient) and it closes properly at stage F. It is
-- NOT suppressed here by an "already notified" guard, because that needs the
-- full status-transition matrix to be safe — if a booking can legitimately
-- return to 'accepted', suppressing would lose a real notice. Said plainly
-- rather than guessed at.
-- ---------------------------------------------------------------------------
create or replace function public.notify_session_transition(p_session_id uuid, p_to text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model       uuid;
  v_date        date;
  v_status      text;
  v_is_provider boolean;
  v_when        text;
begin
  if p_to not in ('accepted', 'declined', 'completed') then
    raise exception 'notify_session_transition: % is not an announceable transition', p_to
      using errcode = '22023';
  end if;

  select s.model_user_id, s.date, s.status,
         exists (select 1 from public.providers p
                  where p.id = s.provider_id and p.user_id = auth.uid())
    into v_model, v_date, v_status, v_is_provider
    from public.sessions s
   where s.id = p_session_id;

  if v_model is null then
    return;                      -- no such booking; nothing to announce
  end if;

  if not (v_is_provider or public.is_admin()) then
    raise exception 'notify_session_transition: only the provider can announce %', p_to
      using errcode = '42501';
  end if;

  if v_status is distinct from p_to then
    raise exception 'notify_session_transition: this booking is %, not % — nothing announced',
      coalesce(v_status, 'null'), p_to using errcode = '55000';
  end if;

  -- 'Friday 3 October'. FMDay and FMMonth strip the blank padding Postgres
  -- otherwise pads those names to; FMDD strips the leading zero.
  v_when := to_char(v_date, 'FMDay FMDD FMMonth');

  insert into public.notifications (user_id, type, title, body, session_id)
  values (
    v_model,
    'session_' || p_to,
    case p_to
      when 'accepted'  then 'Treatment accepted! 🎉'
      when 'declined'  then 'Treatment update'
      else                  'Treatment complete'
    end,
    case p_to
      when 'accepted'  then 'Your booking for ' || v_when || ' has been confirmed.'
      -- ⚠️ 'was not confirmed', never 'declined'. Mobile's wording, kept
      -- deliberately: the model is not told she was turned down in those words.
      when 'declined'  then 'Your booking for ' || v_when || ' was not confirmed.'
      else                  'Your treatment on ' || v_when
                            || ' is marked complete. Leave a review?'
    end,
    p_session_id
  );
end
$$;

comment on function public.notify_session_transition(uuid, text) is
  'Tells the model her booking was accepted, not confirmed, or completed. SECURITY DEFINER because '
  'the row is addressed to her; authorises on provider-or-admin, mirroring enforce_session_status_'
  'transition, and refuses to announce a status the booking does not already have. Replaces six '
  'client-side copies which had drifted three ways. 0078, item 144.';

revoke all on function public.notify_session_transition(uuid, text) from public, anon;
grant execute on function public.notify_session_transition(uuid, text) to authenticated;
grant execute on function public.notify_session_transition(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The transition. INVOKER — see the header for why, and for what that does
-- and does not buy.
-- ---------------------------------------------------------------------------
create or replace function public.transition_session(p_session_id uuid, p_to text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_me       uuid := auth.uid();
  v_existing text;
  v_changed  boolean := false;
begin
  if v_me is null then
    raise exception 'transition_session: not signed in' using errcode = '42501';
  end if;
  if p_to not in ('accepted', 'declined', 'completed') then
    raise exception 'transition_session: % is not a transition this function makes', p_to
      using errcode = '22023';
  end if;

  -- ⚠️⚠️ THE NO-OP IS ABSORBED HERE, AND THE TRIGGER WILL NOT DO IT FOR YOU.
  -- enforce_session_status_transition's THIRD statement is
  --
  --     if new.status is not distinct from old.status then return new; end if;
  --
  -- so a provider who double-clicks Accept gets a clean, permitted second
  -- UPDATE. The six client sites that used to do this notified on every click,
  -- which since 0047 means a second REAL EMAIL for one accept.
  --
  -- `status is distinct from p_to` in the WHERE is what absorbs it: the second
  -- call updates no row, so nothing is announced. **Do not remove this as
  -- redundant** — the trigger permits the no-op by design, and this is the only
  -- place it is stopped. Found by reading the trigger body, 3 Oct 2026.
  --
  -- Doing it in the WHERE rather than by comparing a previously-read status
  -- also removes the race: two concurrent clicks cannot both see 'pending'.
  update public.sessions
     set status = p_to
   where id = p_session_id
     and status is distinct from p_to;

  v_changed := found;

  if not v_changed then
    -- Three different reasons for zero rows, and they are not the same answer.
    -- RLS hides a booking you are not party to, so a null read here is "not
    -- yours OR not there" and must not claim to know which.
    select s.status into v_existing from public.sessions s where s.id = p_session_id;

    if v_existing is null then
      return jsonb_build_object('ok', false, 'changed', false, 'reason', 'not_found_or_not_yours');
    elsif v_existing = p_to then
      -- The double-click. Not an error: the booking IS what the caller asked
      -- for. ok true, changed false, and deliberately no notification.
      return jsonb_build_object('ok', true, 'changed', false, 'status', v_existing);
    else
      return jsonb_build_object('ok', false, 'changed', false, 'reason', 'refused', 'status', v_existing);
    end if;
  end if;

  -- Only on a real change. If the trigger refused the UPDATE above, this line
  -- is never reached, because the exception aborts the whole function — which
  -- is the atomicity the six client sites did not have: every one of them said
  -- "best-effort, deliberately" and could leave a booking accepted with the
  -- model never told.
  perform public.notify_session_transition(p_session_id, p_to);

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_to);
end
$$;

comment on function public.transition_session(uuid, text) is
  'Accept, decline or complete a booking and tell the model, in one transaction. SECURITY INVOKER, so '
  'the sessions RLS policy and enforce_session_status_transition both apply unchanged — that is a '
  'review-cost choice, NOT a safety one: the trigger fires regardless of definer and auth.uid() '
  'survives it. Absorbs the no-op the trigger permits, so a double-click cannot send two emails. '
  '0078, item 144.';

revoke all on function public.transition_session(uuid, text) from public, anon;
grant execute on function public.transition_session(uuid, text) to authenticated;

-- ⚠️⚠️ THIS FUNCTION DEPENDS ON A TABLE GRANT, AND THAT GRANT IS ABOUT TO BE
-- NARROWED. Being INVOKER, the UPDATE above runs with the CALLER's privileges,
-- so `authenticated` must hold **UPDATE on sessions.status**. Today it holds
-- table-wide UPDATE on all 26 columns of public.sessions (item 147), which is
-- far more than this needs and is being scoped down.
--
-- **When that grant becomes column-scoped, `status` MUST stay in the list** or
-- every accept, decline and complete stops working — and because the clients
-- call this through PostgREST, the failure would be a permission error on a
-- member's screen rather than anything a check would catch.
--
-- If keeping `status` writable by `authenticated` turns out to be undesirable,
-- the alternative is making this function SECURITY DEFINER, which the record
-- now establishes is safe for the actor rule: enforce_session_status_transition
-- is a trigger, it fires regardless of definer, and auth.uid() survives it. The
-- invoker choice here is review cost, not safety, so it is the cheaper thing to
-- trade away. Noted here so the decision is available at the point it is made.

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0078', 'one_wording_for_three_transitions', '0a2849e24df393d3ac9f41b85add3039503d7843aad9bd4522ab2b03bd73f9fa');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0077') = 1
--       as v_0077_applied,
--     to_regprocedure('public.notify_session_applied(uuid)') is not null
--       as stage_a_in_place,
--     to_regprocedure('public.transition_session(uuid,text)') is null
--       as transition_is_new,
--     to_regprocedure('public.notify_session_transition(uuid,text)') is null
--       as notifier_is_new,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.sessions'::regclass
--         and tgname = 'trg_enforce_session_status') = 1
--       as the_actor_rule_still_exists;
--
--   Expect all five true. The last one is not a formality: this migration
--   deliberately does NOT re-express the provider-only rule, so if that trigger
--   is ever dropped these functions enforce nothing about who may accept.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   ⚠️ WRITTEN TO THREE CONVENTIONS LEARNED THE HARD WAY ON 0079, all three
--   now in scripts/migration-status.mjs:
--
--     1. NO `select ... into` inside a `do` block. The Supabase editor reads it
--        as SELECT INTO <table>, which is CREATE TABLE AS, and splices
--        `ALTER TABLE v_x ENABLE ROW LEVEL SECURITY` into the block, breaking
--        the dollar quoting. Every assignment below is `v := (select …)`.
--        `get diagnostics` is safe and is left alone.
--     2. ONE `%` fed one concatenated string. `%%` is an escaped literal
--        percent, not two placeholders, so a fifteen-field raise written with
--        `%%` dies with "too many parameters specified for RAISE".
--     3. EVERY variable in the `declare` section. A block with declarations in
--        a footnote does not compile as pasted, and a block that has to be
--        repaired before it runs is a block that gets skipped.
--
--   ⚠️ AND EVERY BLOCK ASSERTS ITS PREMISE, because the trigger's third
--   statement is `if auth.uid() is null or is_admin() then return new; end if;`
--   and ff06d568 is both a provider and an admin.
--
--   -- (a) the shapes. Plain select: it neither switches role nor rolls back.
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('transition_session','notify_session_transition')
--    order by p.proname;
--
--   Expect notify_session_transition prosecdef **t**, transition_session **f**.
--
--   -- (b) THE MODEL CANNOT ACCEPT HER OWN BOOKING.
--   begin;
--   do $v$
--   declare
--     v_sid   uuid;
--     v_model uuid;
--     v_got   text := 'NO ERROR — THE GUARD DID NOT FIRE';
--   begin
--     v_sid := (select s.id from public.sessions s
--                where s.status = 'pending' and s.model_user_id is not null
--                order by s.created_at desc limit 1);
--     if v_sid is null then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. No pending booking to try.';
--     end if;
--     v_model := (select s.model_user_id from public.sessions s where s.id = v_sid);
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     if auth.uid() is null then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. auth.uid() is null — the trigger returns at its first check.';
--     end if;
--     if public.is_admin() then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. The model is an admin, so the trigger bypasses before the provider check.';
--     end if;
--     if exists (select 1 from public.providers p
--                 join public.sessions s on s.provider_id = p.id
--                where s.id = v_sid and p.user_id = auth.uid()) then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. The model also owns this booking''s shop, so she IS the provider.';
--     end if;
--
--     begin
--       perform public.transition_session(v_sid, 'accepted');
--     exception when others then
--       v_got := sqlstate || ' ' || sqlerrm;
--     end;
--     execute 'reset role';
--     raise exception '%', 'ROLLED BACK ON PURPOSE. as the model: ' || v_got;
--   end $v$;
--   rollback;
--
--   Expect "Only the provider can set a session to accepted". THE GUARD DID NOT
--   FIRE means the actor rule is not reaching this path.
--
--   ⚠️ 'accepted' is correct HERE and was wrong in 0079's test 5, for a reason
--   worth keeping straight: this block picks a **pending** row, so accepted is a
--   real transition. 0079's picked an already-accepted row, so the same value
--   was a no-op that returned before any check. The target status must differ
--   from the row's current one, whatever the test.
--
--   -- (c) THE PROVIDER CAN, EXACTLY ONE NOTICE IS WRITTEN, AND THE SAME CALL
--   --     AGAIN WRITES NONE. The second half is the no-op the trigger permits
--   --     and transition_session absorbs; without it a double-click sends a
--   --     second real email.
--   begin;
--   do $v$
--   declare
--     v_sid   uuid;
--     v_owner uuid;
--     v_n0 int; v_n1 int; v_n2 int;
--     v_r1 jsonb; v_r2 jsonb;
--     v_body text;
--   begin
--     v_sid := (select s.id from public.sessions s
--                 join public.providers p on p.id = s.provider_id
--                where s.status = 'pending' and p.user_id is not null
--                order by s.created_at desc limit 1);
--     if v_sid is null then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. No pending booking with a shop owner.';
--     end if;
--     v_owner := (select p.user_id from public.providers p
--                   join public.sessions s on s.provider_id = p.id
--                  where s.id = v_sid);
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     if auth.uid() is null then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. auth.uid() is null.';
--     end if;
--     if public.is_admin() then
--       raise exception '%', 'ROLLED BACK, TESTED NOTHING. The provider is also an admin, so the trigger bypasses and this proves nothing about the provider branch.';
--     end if;
--
--     v_n0 := (select count(*) from public.notifications
--               where session_id = v_sid and type = 'session_accepted');
--     v_r1 := public.transition_session(v_sid, 'accepted');
--     v_n1 := (select count(*) from public.notifications
--               where session_id = v_sid and type = 'session_accepted');
--     v_r2 := public.transition_session(v_sid, 'accepted');
--     v_n2 := (select count(*) from public.notifications
--               where session_id = v_sid and type = 'session_accepted');
--     v_body := (select body from public.notifications
--                 where session_id = v_sid and type = 'session_accepted'
--                 order by created_at desc limit 1);
--     execute 'reset role';
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || 'first:  ' || coalesce(v_r1::text, 'null') || chr(10)
--       || 'second: ' || coalesce(v_r2::text, 'null') || chr(10)
--       || 'notices: ' || v_n0 || ' -> ' || v_n1 || ' -> ' || v_n2 || chr(10)
--       || 'body: ' || coalesce(v_body, 'null');
--   end $v$;
--   rollback;
--
--   Expect first `{"ok":true,"changed":true,…}`, second
--   `{"ok":true,"changed":false,…}`, notices n -> n+1 -> **n+1**, and a body
--   reading 'Your booking for Friday 3 October has been confirmed.' with the
--   weekday and month spelt out. **n+2 means the no-op absorption is not
--   working and a double-click sends two emails.**
-- ===========================================================================

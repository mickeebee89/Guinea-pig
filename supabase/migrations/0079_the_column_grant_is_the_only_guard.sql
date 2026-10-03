-- ===========================================================================
-- 0079_the_column_grant_is_the_only_guard
--
-- Narrows UPDATE on public.sessions to the one column the clients write.
-- Audit item 147. Completes item 133, whose fix was insert-only.
--
-- ⚠️ Apply 0078 first? **NO — this does not depend on 0078 and should not wait
-- for it.** Current clients write only `status`, so this is behaviour-neutral
-- today, and 0078's transition_session needs exactly UPDATE (status) as an
-- INVOKER function. Applying this first closes a CONFIRMED hole with a smaller
-- migration. 0077 is the real prerequisite, and only for ordering.
--
-- ── THE FAULT, CONFIRMED NOT INFERRED ──────────────────
-- `authenticated` and `anon` held table-wide UPDATE on all 26 columns of
-- public.sessions. The only narrowing was the `participants can update
-- sessions` policy, which is USING-only — so either party to a booking could
-- rewrite it.
--
-- Proved 3 Oct 2026 as model b0df9c2f on accepted session 60c22f40, every test
-- rolled back, under a harness first shown to be enforcing RLS:
--
--   licence  relrowsecurity=t, relforcerowsecurity=f, and a WITH CHECK control
--            on the same table/command/role was refused 42501 — so the four
--            results below are not vacuous
--   test 1   MOVE      rows=1  date and start_time rewritten to 2027-08-13 04:17
--   test 2   PRICE     rows=1  price_pence null -> 0
--   test 3   REASSIGN  rows=1  provider_id 09c6d70c -> 49d40aae
--   test 4   NOT_HELD  rows=1  not_held_provider_at set BY THE MODEL
--
-- ⚠️ TEST 3 IS THE CONSEQUENTIAL ONE: provider_id changed while status stayed
-- 'accepted', so a stylist who never saw the application had a confirmed
-- booking in her diary and was never notified. Test 1 is next: the appointment
-- moved with no notification, because trg_enforce_session_status is
-- BEFORE UPDATE **OF status** and never fired.
--
-- ⚠️⚠️ WHY THE COLUMN GRANT IS THE ONLY THING THAT CAN GUARD THESE COLUMNS.
-- All three of the table's protective triggers are INSERT-time:
--
--   tg_session_apply_gate       BEFORE INSERT
--   tg_session_price_snapshot   BEFORE INSERT
--   tg_session_slot_authority   BEFORE INSERT
--
-- So nothing in the database watches an UPDATE to date, start_time, end_time,
-- price_pence, provider_id or either not_held timestamp. There is no trigger to
-- add a guard to and no policy that distinguishes columns. **The grant is the
-- mechanism. Widening it back for convenience re-opens all four tests above.**
--
-- ── IT COMPLETES ITEM 133 ──────────────────────────────
-- 0065 made the availability row the authority for WHEN an appointment is, via
-- tg_session_slot_authority — correct for the path it guards, and insert-only.
-- The update path stayed open, so the slot was authoritative at booking and
-- rewritable afterwards. A guard with a door beside it, which is the phrase
-- used when item 144 was scoped. 133 and 147 are the same fault at two ends of
-- one row's life, and each should be findable from the other.
--
-- ── anon ───────────────────────────────────────────────
-- anon held the grant too and gets nothing back. Behaviour-neutral by
-- construction: no UPDATE policy names anon, so it was latent, never live.
-- Revoked because a grant nothing uses is a grant nobody will notice being
-- used.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0077') then
    raise exception '0079: apply 0077 first.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sessions'::regclass) then
    raise exception '0079: RLS is OFF on public.sessions. Narrowing the grant would leave the policy inert and every row writable — stop and fix that first.';
  end if;
end $$;

-- ⚠️ UPDATE ONLY. INSERT is deliberately untouched: create_session_with_consent
-- is SECURITY INVOKER, so the model's own grant is what lets her book at all.
-- SELECT and DELETE are untouched for the same class of reason — this migration
-- is about one verb.
revoke update on public.sessions from authenticated;
revoke update on public.sessions from anon;

-- The whole client surface, measured rather than assumed: eight call sites
-- across site/ and mobile/, every one of them `{ status: ... }` and nothing
-- else. Found by searching for the table name, which is also how the count
-- went from six to eight — the earlier figure came from a notification-based
-- list and missed two sites that change status without notifying.
--
-- ⚠️⚠️ AND THE COLUMN LIST HERE MUST BE DERIVED FROM LIVE FUNCTION
-- DEFINITIONS, NOT FROM A SEARCH OVER THIS REPO. Here is why, from the first
-- run of this migration's own PREFLIGHT (ii):
--
--   public._withdraw_stylist is SECURITY INVOKER and writes TWO session
--   columns:  set status = 'cancelled', cancelled_at = now()
--
-- My inventory said it wrote `status` alone. The regex that produced that
-- inventory required a column name to follow `set` or a comma at the START of a
-- line, and `cancelled_at = now()` shares a line with `set status = …`, so it
-- was never seen. The repo file was not stale — **my parse of it was wrong**,
-- which is a failure mode no amount of re-reading the file would have caught.
--
-- So PREFLIGHT (ii) is not a formality and must be run every time this grant is
-- narrowed further. **The next person will run the same repo search and get the
-- same wrong answer.**
--
-- ── ⚠️ THE ONE EXEMPTION, AND WHAT WOULD END IT ────────
-- `_withdraw_stylist` writes `status` AND `cancelled_at`, so `status` alone
-- would appear to break it. It does not, and the reason is reachability rather
-- than privilege:
--
--   _withdraw_stylist           INVOKER   authenticated CANNOT execute,
--                                         acl {postgres, service_role}, no PUBLIC
--     <- _admin_apply_user_action  INVOKER   authenticated CANNOT execute
--          <- revoke_verification       DEFINER
--          <- admin_act_on_provider     DEFINER
--          <- admin_act_on_report       DEFINER
--          <- admin_act_on_user         DEFINER
--     <- delete_account_data       DEFINER
--     <- revoke_verification       DEFINER
--
-- The whole closure was walked. **No node is INVOKER and executable by
-- `authenticated`.** So every route into _withdraw_stylist crosses a DEFINER
-- boundary first, it always runs as the function owner, and this grant never
-- applies to it.
--
-- ⚠️⚠️ **THE EXEMPTION IS NOT A PROPERTY OF _withdraw_stylist. IT IS A
-- PROPERTY OF THAT CLOSURE, AND IT CAN BE ENDED FROM A DIFFERENT FILE.**
-- If anyone grants EXECUTE on `_admin_apply_user_action` to `authenticated`, or
-- makes any of `revoke_verification`, `admin_act_on_provider`,
-- `admin_act_on_report` or `admin_act_on_user` SECURITY INVOKER, then
-- _withdraw_stylist starts running as a member and **stylist withdrawal breaks
-- on a permission error in the middle of an admin action** — a verification
-- revocation on a live account. Nothing in this file would change, and nothing
-- would warn.
--
-- If you need that, add `cancelled_at` to the grant below in the same
-- migration, and read the note above about why granting it to members is a
-- smaller version of the hole this closes.
grant update (status) on public.sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 0070's comment becomes TRUE, so it is strengthened rather than corrected.
--
-- It said: "the row can never say it did not happen without saying who said
-- so". That was wider than its mechanism — the guard enforces it for the
-- actor's own timestamp ON A STATUS CHANGE, and test 4 above set
-- not_held_provider_at in an update that never touched status, so the trigger
-- never ran and the row could be made to say the stylist agreed.
--
-- The grant above closes that. **So the sentence stays and now names what
-- enforces it**, because a comment that says which mechanism holds a property
-- is what stops the next person removing the wrong half. Reproduced from the
-- live definition; the only change is the comment.
-- ---------------------------------------------------------------------------
create or replace function public.report_not_held(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me         uuid := auth.uid();
  v_date       date;
  v_status     text;
  v_model      uuid;
  v_provider   uuid;
  v_is_model   boolean;
  v_other      uuid;
  v_who        text;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select s.date, s.status, s.model_user_id, p.user_id
    into v_date, v_status, v_model, v_provider
  from public.sessions s
  join public.providers p on p.id = s.provider_id
  where s.id = p_session_id
  for update of s;

  if not found then
    raise exception 'No such booking' using errcode = 'CV004';
  end if;

  v_is_model := (v_me = v_model);
  if not (v_is_model or v_me = v_provider) then
    raise exception 'Not a participant of this booking' using errcode = '42501';
  end if;

  -- The remaining conditions are enforced by the guard on the UPDATE below.
  -- They are not repeated here: one implementation, and the guard is the one
  -- that cannot be gone round.
  if v_is_model then
    update public.sessions
       set not_held_model_at = coalesce(not_held_model_at, now()),
           status = 'not_held'
     where id = p_session_id;
    v_other := v_provider;
    select coalesce(u.first_name, 'The model') into v_who
    from public.users u where u.id = v_me;
  else
    update public.sessions
       set not_held_provider_at = coalesce(not_held_provider_at, now()),
           status = 'not_held'
     where id = p_session_id;
    v_other := v_model;
    select coalesce(p.name, 'The stylist') into v_who
    from public.providers p where p.user_id = v_me;
  end if;

  -- ⚠️ THE OTHER PARTY IS TOLD, NEUTRALLY, AND ONLY ONCE. It is the only way
  -- they learn there is something to agree with or dispute. The sentence
  -- reports a statement and characterises nobody: "X has recorded that…", not
  -- "X says you did not turn up".
  --
  -- Suppressed when they have already said it themselves — telling somebody
  -- you agree with them is not news, and would arrive as a second
  -- notification about a thing they started.
  --
  -- ⚠️ THE ROW CAN NEVER SAY IT DID NOT HAPPEN WITHOUT SAYING WHO SAID SO —
  -- AND SINCE 0079 THE THING THAT MAKES THAT TRUE IS THE **COLUMN GRANT**, NOT
  -- THIS GUARD. authenticated holds UPDATE on `status` alone, so
  -- not_held_model_at and not_held_provider_at are writable only in here.
  -- Before 0079 a model could set not_held_provider_at directly in an update
  -- that never touched status, so trg_enforce_session_status never fired and
  -- the row could be made to say the stylist agreed (item 147, test 4).
  --
  -- **Do not widen that grant.** The trigger cannot defend these columns: it is
  -- BEFORE UPDATE OF status and an update that leaves status alone is invisible
  -- to it.
  if v_other is not null and (
       (v_is_model     and (select not_held_provider_at from public.sessions where id = p_session_id) is null)
    or (not v_is_model and (select not_held_model_at    from public.sessions where id = p_session_id) is null)
  ) then
    insert into public.notifications (user_id, type, title, body, session_id)
    values (
      v_other, 'session_not_held', 'Booking marked as not held',
      v_who || ' has recorded that your appointment on '
            || to_char(v_date, 'FMDD FMMonth') || ' did not go ahead. '
            || 'If that is not right, you can say so on the booking.',
      p_session_id);
  end if;
end $function$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0079', 'the_column_grant_is_the_only_guard', '2a5343e732bcfa9d8bb7152bb57341f287ae62b3374b56ee06b860b8f6f1cdec');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   -- (i) the state this assumes, and the fault still being present
--   select
--     (select count(*) from public.schema_migrations where version = '0077') = 1
--       as v_0077_applied,
--     (select relrowsecurity from pg_class where oid = 'public.sessions'::regclass)
--       as rls_is_on_MUST_BE_TRUE,
--     has_table_privilege('authenticated', 'public.sessions', 'update')
--       as authed_has_table_wide_update_NOW,
--     has_column_privilege('authenticated', 'public.sessions', 'price_pence', 'update')
--       as authed_can_write_price_NOW,
--     has_table_privilege('authenticated', 'public.sessions', 'insert')
--       as authed_can_insert_MUST_STAY_TRUE;
--
--   Expect true, true, true, true, true. The third and fourth are the fault;
--   the fifth must still be true AFTER the migration — booking depends on it,
--   because create_session_with_consent is SECURITY INVOKER.
--
--   -- (ii) ⚠️ EVERY FUNCTION THAT UPDATES sessions, AND WHICH COLUMNS, READ
--   --      FROM THE LIVE BODIES. A SECURITY INVOKER function runs with the
--   --      CALLER's privileges, so one writing a column other than `status`
--   --      would break the moment this migration applies.
--   --
--   --      My own inventory of this came from a regex over repo files and
--   --      found public._withdraw_stylist as INVOKER writing sessions.status.
--   --      Repo files are not the database — confirm it here.
--   select p.proname,
--          case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
--          regexp_replace(
--            substring(pg_get_functiondef(p.oid)
--                      from 'update[[:space:]]+public\.sessions.*?(?:where|;)'),
--            '[[:space:]]+', ' ', 'g') as the_update
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and pg_get_functiondef(p.oid) ~* 'update[[:space:]]+public\.sessions'
--    order by p.prosecdef, p.proname;
--
--   -- (iii) ⚠️ WHO OWNS THOSE DEFINER FUNCTIONS. The exemption above assumes
--   --       they run as a role that still holds UPDATE after the revoke. If one
--   --       is owned by a role that gets UPDATE only by inheriting
--   --       `authenticated`, the revoke cuts it off and withdrawal breaks
--   --       regardless of the call chain. Answers rather than raises.
--   select p.proname,
--          pg_get_userbyid(p.proowner) as owner,
--          has_table_privilege(pg_get_userbyid(p.proowner), 'public.sessions', 'update')
--            as owner_has_update,
--          pg_has_role(pg_get_userbyid(p.proowner), 'authenticated', 'MEMBER')
--            as owner_inherits_authenticated,
--          (select pg_get_userbyid(relowner) from pg_class
--            where oid = 'public.sessions'::regclass) as sessions_owner
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('_withdraw_stylist', '_admin_apply_user_action',
--                        'delete_account_data', 'revoke_verification',
--                        'admin_act_on_provider', 'admin_act_on_report',
--                        'admin_act_on_user')
--    order by p.proname;
--
--   ACCEPTABLE ANSWER: seven rows, every `owner_has_update` **true** and every
--   `owner_inherits_authenticated` **false** — and ideally `owner` equal to
--   `sessions_owner`, because the table owner holds every privilege implicitly
--   and cannot be cut off by a revoke aimed at `authenticated`.
--
--   ⚠️ STOP IF: any `owner_inherits_authenticated` is true, or any
--   `owner_has_update` is false. Either means this migration would break
--   stylist withdrawal through the owner rather than through the call chain,
--   which is a different fault from the one the chain analysis cleared.
--
--   ⚠️ READ THE **INVOKER** ROWS. Each one must write `status` and nothing else.
--   A DEFINER row is unaffected — it runs as its owner. If an INVOKER function
--   writes any other column, STOP: either it needs that column granted, or it
--   needs to become DEFINER, and neither decision belongs inside this migration.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   ⚠️ IT RE-RUNS ITEM 147'S FOUR TESTS AND EXPECTS THEM TO FAIL — and then
--   tests that a STATUS update still SUCCEEDS. Without that last part a grant
--   of nothing at all would pass every other check while accept and decline
--   were broken for every member. Test the thing that must still work, not only
--   the things that must stop.
--
--   Use the SAME model and session as the original run, or a pair from the
--   locator query (an accepted session whose model is neither an admin nor the
--   owner of that booking's shop).
--
--   begin;
--   do $v$
--   declare
--     v_sid   uuid := '60c22f40-cd0f-430d-927c-477d3aa587d0';
--     v_model uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_other uuid; v_rows int;
--     r1 text := 'NO ERROR — STILL WRITABLE';
--     r2 text := 'NO ERROR — STILL WRITABLE';
--     r3 text := 'NO ERROR — STILL WRITABLE';
--     r4 text := 'NO ERROR — STILL WRITABLE';
--     r5 text := 'not reached';
--   begin
--     -- Scalar subquery: the workaround for the editor rewrite that hit THIS
--     -- block on 3 Oct. ⚠️ `into` is not established as the cause — other
--     -- blocks used it the same evening and ran. See migration-status.mjs.
--     v_other := (select p.id from public.providers p
--                  where p.id is distinct from
--                        (select provider_id from public.sessions where id = v_sid)
--                  limit 1);
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--
--     -- the premises, in the order the trigger checks them
--     if auth.uid() is null then
--       raise exception 'ROLLED BACK, TESTED NOTHING. auth.uid() is null.';
--     end if;
--     if public.is_admin() then
--       raise exception 'ROLLED BACK, TESTED NOTHING. The actor is an admin and bypasses the trigger.';
--     end if;
--
--     begin update public.sessions set date = date + 400 where id = v_sid;
--     exception when others then r1 := sqlstate || ' ' || sqlerrm; end;
--
--     begin update public.sessions set price_pence = 0 where id = v_sid;
--     exception when others then r2 := sqlstate || ' ' || sqlerrm; end;
--
--     begin update public.sessions set provider_id = v_other where id = v_sid;
--     exception when others then r3 := sqlstate || ' ' || sqlerrm; end;
--
--     begin update public.sessions set not_held_provider_at = now() where id = v_sid;
--     exception when others then r4 := sqlstate || ' ' || sqlerrm; end;
--
--     -- ⚠️⚠️ THE ONE THAT MUST STILL WORK — AND IT **MUST NOT** BE DECIDED
--     -- ON SQLSTATE. Both outcomes are 42501:
--     --
--     --     grant correct  42501  Only the provider can set a session to accepted
--     --     grant WRONG    42501  permission denied for table sessions
--     --
--     -- enforce_session_status_transition raises with `using errcode = '42501'`
--     -- and a missing column privilege is insufficient_privilege, which is also
--     -- 42501. **A check keyed on sqlstate passes in both cases, including the
--     -- one where every accept and decline in the product is broken.** So the
--     -- verdict below compares sqlerrm TEXT.
--     --
--     -- DO NOT SIMPLIFY THIS TO A SQLSTATE MATCH. That is the exact shape this
--     -- record keeps logging: a check that passes without testing its claim.
--     -- ⚠️ 'declined', NOT 'accepted'. ON ITS FIRST RUN THIS TEST PROVED
--     -- NOTHING. The session under test is already 'accepted', so a write of
--     -- 'accepted' hit the trigger's FIRST line —
--     --     if new.status is not distinct from old.status then return new;
--     -- — and succeeded as a permitted no-op BEFORE any actor check ran.
--     -- Result: "NO ERROR, rows=1", verdict UNEXPECTED. Benign, but the test
--     -- never reached the thing it was written to prove.
--     --
--     -- From 'accepted', 'declined' is a REAL transition, the model is not the
--     -- provider, and the trigger refuses — which is the message the verdict
--     -- below looks for. Choose a target status the row is NOT already in.
--     begin
--       update public.sessions set status = 'declined' where id = v_sid;
--       get diagnostics v_rows = row_count;
--       r5 := 'NO ERROR, rows=' || v_rows;
--     exception when others then r5 := sqlstate || ' ' || sqlerrm; end;
--
--     if r5 like '%permission denied%' then
--       v5 := 'FAIL — THE GRANT IS WRONG. accept and decline are broken product-wide.';
--     elsif r5 like '%Only the provider can set%' then
--       v5 := 'PASS — reached the trigger, so status is still writable.';
--     elsif r5 like 'NO ERROR%' then
--       -- The fourth branch, added after the first run hit it.
--       v5 := 'NO-OP — the column IS writable, but the actor check never ran: '
--             || 'the trigger returns early when new.status equals old.status. '
--             || 'This row was already in the target status. Re-run against a '
--             || 'status it is NOT in. Proves the grant, proves nothing about the guard.';
--     else
--       v5 := 'UNEXPECTED — read r5 by hand before concluding anything.';
--     end if;
--     execute 'reset role';
--
--     -- ── TEST 6: THE REAL PRODUCTION PATH, POSITIVE ────────────────────────
--     -- Test 5 is a proxy: the model can never successfully write status, so
--     -- her refusal only proves the statement REACHED the trigger. This proves
--     -- the path members actually use.
--     --
--     -- ⚠️ ITS PREMISE IS REPORTED, NOT ASSERTED AWAY. For a POSITIVE test an
--     -- admin bypass does not invalidate the result — the UPDATE still needs
--     -- the column privilege either way — it only changes which branch let it
--     -- through. So is_admin() is printed and the reason it passed is on the
--     -- record, rather than the block refusing to run. That is the opposite of
--     -- the negative tests, where an admin bypass makes the result meaningless.
--     v_owner := (select p.user_id from public.providers p
--                   join public.sessions s on s.provider_id = p.id
--                  where s.id = v_sid);
--     if v_owner is null then
--       r6 := 'ROLLED BACK, TESTED NOTHING. This booking has no shop owner.';
--     else
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       if auth.uid() is null then
--         r6 := 'ROLLED BACK, TESTED NOTHING. auth.uid() is null for the provider.';
--       else
--         v6_admin := public.is_admin();
--         begin
--           update public.sessions set status = 'accepted' where id = v_sid;
--           get diagnostics v_rows = row_count;
--           v6_now := (select status from public.sessions where id = v_sid);
--           r6 := 'rows=' || v_rows || ' status now ' || coalesce(v6_now, 'null')
--                 || ' | provider is_admin=' || v6_admin;
--         exception when others then
--           r6 := sqlstate || ' ' || sqlerrm || ' | provider is_admin=' || v6_admin;
--         end;
--       end if;
--       execute 'reset role';
--     end if;
--
--     raise exception 'ROLLED BACK ON PURPOSE.%  1 move: %%  2 price: %%  3 reassign: %%  4 not_held: %%  5 STATUS as model: %%     verdict: %%  6 STATUS as PROVIDER: %',
--       chr(10), chr(10), r1, chr(10), r2, chr(10), r3, chr(10), r4,
--       chr(10), r5, chr(10), v5, chr(10), r6;
--   end $v$;
--   rollback;
--
--   Declare alongside the others:
--     v_owner uuid; v6_now text; v6_admin boolean;
--     v5 text := 'not reached'; r6 text := 'not reached';
--
--   EXPECT:
--     1-4  42501 **permission denied for table sessions** — the grant took.
--          Any "STILL WRITABLE" means it did not.
--     5    verdict PASS. A FAIL verdict means the grant is wrong and the
--          one-line revert is: grant update (status) on public.sessions
--          to authenticated;
--     6    rows=1 and status now 'accepted'. This is the test that proves
--          members can still be served. If 5 passes and 6 fails, the column
--          is writable but something else refuses the real path — read r6.
-- ===========================================================================

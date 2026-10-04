-- ===========================================================================
-- 0085_only_a_definer_function_may_tell_anyone_anything
--
-- STAGE F. Item 144's last stage, and the one the other five existed to make
-- possible. `authenticated` and `anon` lose the ability to write a
-- `notifications` row at all — by policy AND by grant.
--
-- ⚠️ Apply 0084 first.
--
-- ── THE HOLE, AND WHY IT COULD NOT BE CLOSED FIRST ─────────────────────────
-- `public.notifications`' INSERT policy has been:
--
--     "authenticated can create notifications"  with check (auth.uid() is not null)
--
-- **Any signed-in account could write any notification to anyone**, and
-- `notify_email` then sends that text as Cavy — a phishing vector using the
-- product's own verified sender. Read from `pg_policies`, not inferred.
--
-- It could not be closed by tightening the policy, because every client-side
-- notification insert was cross-user: closing it first would have broken
-- fifteen real tellings. Stages A–E moved all fifteen inside the function that
-- already made the decision. **Measured 5 Oct 2026: no client in any of the
-- three apps inserts a `notifications` row.** Four spellings searched
-- (`from('notifications')`, the double-quoted and template-literal forms, and
-- raw `into notifications`); everything left is a `.select()` or an `.update()`.
--
-- ── ⚠️ THIS MAKES STAGE B IRREVERSIBLE ────────────────────────────────────
-- Until now, rolling back a client deploy restored a working product, because
-- the old client's direct inserts still passed the policy. After this they do
-- not. **A Vercel revert past stage B's client half will stop accept, decline
-- and complete from telling anyone anything.** That is the whole reason F went
-- last and the reason it is a decision rather than a step. Taken by Micky,
-- 5 Oct 2026.
--
-- ── ⚠️ THE CATASTROPHIC FAILURE MODE, AND THE THREE READS THAT PREVENT IT ──
-- Every notification in the product is now written by a SECURITY DEFINER
-- function. Those bypass RLS **only because the function's owner is the table's
-- owner** — a table owner is exempt from its own policies unless the table has
-- FORCE ROW LEVEL SECURITY. So a restrictive `with check (false)` would, under
-- the wrong conditions, lock out the very functions that do all the telling,
-- and the product would go silent on every path at once.
--
-- The guard therefore refuses unless all three hold:
--
--   (i)   `notifications` has RLS enabled and **NOT forced**. Forced RLS
--         applies policies to the owner too, so a restrictive false would stop
--         every DEFINER writer.
--   (ii)  every DEFINER function that inserts into `notifications` is owned by
--         the **same role that owns the table**. A DEFINER function owned by
--         anyone else is subject to RLS and would be blocked.
--   (iii) `service_role` still holds INSERT. `stripe-webhook` writes
--         `payment_failed` on that key, and it is not revoked from.
--
-- ── ⚠️ AND THE CALL-GRAPH PROPERTY 0079 WROTE DOWN ────────────────────────
-- Two INVOKER functions insert into `notifications`: `_admin_apply_user_action`
-- and, through it, `_withdraw_stylist`. An INVOKER function runs with the
-- CALLER's privileges, so after this migration it could only write if its
-- caller were a member — and it would then fail.
--
-- It does not fail, because `authenticated` cannot EXECUTE either one, so every
-- route into them crosses a DEFINER boundary first and the privilege context
-- becomes the owner's. 0079 recorded the important half of that:
--
--   *"THE EXEMPTION IS NOT A PROPERTY OF `_withdraw_stylist`. IT IS A property
--   of the call graph. If anyone grants EXECUTE on `_admin_apply_user_action`
--   to `authenticated` … it starts running as a member and stylist withdrawal
--   breaks."*
--
-- So the guard asserts it rather than trusting it: **no INVOKER function that
-- inserts into `notifications` may be executable by `authenticated` or `anon`.**
-- That is a condition, checkable forever, and not a note about today.
--
-- ── WHAT STAYS, AND WHY THE VERIFY NAMES IT ────────────────────────────────
-- Members keep SELECT, UPDATE and DELETE on their own notifications — reading
-- them, marking them read, and clearing them. ⚠️ Those are named explicitly in
-- the guard and re-checked in the verify, because **a section that proves a
-- change happened says nothing about whether it was bounded** (Micky, 5 Oct, on
-- 0084). A slip that revoked all of `notifications` from `authenticated` would
-- satisfy every "is it locked" check in this file while making the
-- notifications tab permanently empty.
-- ===========================================================================
begin;

do $$
declare
  v_tbl        oid := 'public.notifications'::regclass;
  v_owner      oid;
  v_rls        boolean;
  v_forced     boolean;
  v_bad_owner  text := '';
  v_invoker    text := '';
  v_missing    text := '';
  v_pol        text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0084') then
    raise exception '0085: apply 0084 first.';
  end if;

  select c.relowner, c.relrowsecurity, c.relforcerowsecurity
    into v_owner, v_rls, v_forced
    from pg_class c where c.oid = v_tbl;

  -- (i) RLS on, and NOT forced.
  if not v_rls then
    raise exception '0085: RLS is not enabled on public.notifications, so policies decide nothing and the grant would be the only guard. Read the table before locking it. Nothing changed.';
  end if;
  if v_forced then
    raise exception '0085: public.notifications has FORCE ROW LEVEL SECURITY, so policies apply to the table OWNER too. A restrictive `with check (false)` would block every SECURITY DEFINER function that writes a notification — the whole product goes silent at once. Nothing changed.';
  end if;

  -- (ii) Every DEFINER inserter owned by the table's owner, or it is subject to
  -- RLS and would be blocked by the restrictive policy added below.
  v_bad_owner := coalesce((
    select string_agg(p.proname || ' (owned by ' || p.proowner::regrole::text || ')', ', ')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and p.prosecdef
       and pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public\.)?notifications'
       and p.proowner <> v_owner
  ), '');
  if v_bad_owner <> '' then
    raise exception '0085: SECURITY DEFINER function(s) insert into notifications but are NOT owned by the table owner (%): %. A DEFINER function owned by another role is still subject to RLS, so the restrictive policy below would block it. Nothing changed.',
      v_owner::regrole::text, v_bad_owner;
  end if;

  -- (iii) service_role keeps INSERT — stripe-webhook writes payment_failed.
  if not has_table_privilege('service_role', 'public.notifications', 'INSERT') then
    raise exception '0085: service_role does not hold INSERT on public.notifications, yet stripe-webhook writes payment_failed on that key. Read the grants before narrowing anything. Nothing changed.';
  end if;

  -- ── THE CALL-GRAPH PROPERTY, ASSERTED ────────────────────────────────
  v_invoker := coalesce((
    select string_agg(p.proname, ', ')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not p.prosecdef
       and pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public\.)?notifications'
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'))
  ), '');
  if v_invoker <> '' then
    raise exception '0085: SECURITY INVOKER function(s) insert into notifications AND are executable by authenticated or anon: %. Such a function runs as the member, so after this migration it would be refused — this is 0079''s call-graph property, which is about the GRANT and not about the function. Either revoke its EXECUTE or make it DEFINER. Nothing changed.', v_invoker;
  end if;

  -- ── WHAT MUST SURVIVE, NAMED BEFORE IT IS PUT AT RISK ────────────────
  -- If any of these is already absent, this migration is not the thing to
  -- apply: members cannot read their own notifications and that is a bigger
  -- problem than the hole being closed.
  foreach v_pol in array array['read own notifications',
                               'update own notifications',
                               'delete own notifications'] loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'notifications'
                      and policyname = v_pol) then
      v_missing := v_missing || ' "' || v_pol || '"';
    end if;
  end loop;
  if v_missing <> '' then
    raise exception '0085: these policies are missing from public.notifications:%. Members would be unable to read or clear their own notifications, and locking INSERT is not the next thing to do about that. Nothing changed.', v_missing;
  end if;

  -- ── THE HOLE ITSELF, CONFIRMED BEFORE IT IS REMOVED ──────────────────
  -- Removing a policy that is not the one described in this header would be
  -- closing something else. The qual is matched, not just the name.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'notifications'
       and policyname = 'authenticated can create notifications'
       and cmd = 'INSERT'
       and coalesce(with_check, '') like '%auth.uid() IS NOT NULL%'
  ) then
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'notifications'
                  and cmd = 'INSERT' and permissive = 'RESTRICTIVE') then
      raise exception '0085: a RESTRICTIVE INSERT policy already exists on notifications. This migration has run.';
    end if;
    raise exception '0085: the permissive INSERT policy "authenticated can create notifications" with check (auth.uid() IS NOT NULL) is not there as described. Read pg_policies before removing anything — dropping a different policy closes a different hole. Nothing changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE PERMISSIVE POLICY GOES
-- ---------------------------------------------------------------------------
drop policy "authenticated can create notifications" on public.notifications;

-- ---------------------------------------------------------------------------
-- 2. A RESTRICTIVE REFUSAL TAKES ITS PLACE
--
-- ⚠️ WHY A POLICY AT ALL, WHEN DROPPING THE PERMISSIVE ONE ALREADY DENIES.
-- With RLS on and no permissive INSERT policy, an insert is already refused.
-- But that is denial by ABSENCE, and the next person who adds a permissive
-- INSERT policy for any reason reopens the hole without touching this file. A
-- RESTRICTIVE policy ANDs with every permissive one, so `false` cannot be
-- overridden by addition — only by deliberately dropping this.
--
-- That is the same deny-by-default-versus-allowlist-by-omission choice 0079
-- made for `sessions`, and the reason it is made again here rather than
-- re-derived later.
--
-- ⚠️ `to authenticated, anon` AND NOT `to public`. A restrictive policy on
-- `public` would also apply to `service_role`, which is NOT the table owner —
-- and whether it would still get through depends on `service_role` carrying
-- the BYPASSRLS attribute. Naming the two roles that must be refused makes the
-- outcome independent of a role attribute nobody here has read.
-- ---------------------------------------------------------------------------
create policy notifications_insert_denied on public.notifications
  as restrictive for insert to authenticated, anon
  with check (false);

comment on policy notifications_insert_denied on public.notifications is
  '⚠️ STAGE F of item 144. Only a SECURITY DEFINER function may write a notification; the member '
  'roles may not, at all. Before 0085 the policy was `with check (auth.uid() is not null)` — any '
  'signed-in account could write any notification to anyone, and notify_email would send that text '
  'as Cavy. RESTRICTIVE rather than merely absent so that adding a permissive INSERT policy later '
  'cannot reopen it. The matching INSERT grant is revoked too: the policy and the grant are two '
  'guards and neither is load-bearing alone. 0085.';

-- ---------------------------------------------------------------------------
-- 3. AND THE GRANT, BECAUSE A POLICY IS NOT THE ONLY GUARD
--
-- 0079's title was "the column grant is the only guard" and its lesson was the
-- reverse of what it sounds like: grants are checked BEFORE policies, so a
-- revoked grant refuses earlier and more loudly than a policy that matches no
-- rows. Doing both means neither is the single point of failure.
--
-- ⚠️ service_role and the table owner are deliberately not named. DEFINER
-- functions run as the owner, which holds INSERT as owner; stripe-webhook runs
-- as service_role, proven above to hold it directly.
-- ---------------------------------------------------------------------------
revoke insert on public.notifications from authenticated;
revoke insert on public.notifications from anon;

-- ---------------------------------------------------------------------------
-- 4. THE POST-CONDITIONS — BOTH HALVES
--
-- Half one: the hole is shut. Half two: ⚠️ THE BOUNDS. Members must still be
-- able to read, mark-read and clear their own notifications, and service_role
-- must still be able to write. A migration that locked all four would pass
-- every "is it shut" check in this file.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.notifications', 'INSERT') then
    raise exception '0085: authenticated can still INSERT into notifications after the revoke, so the privilege is reachable by a route this migration did not account for (PUBLIC, or role membership). Rolled back.';
  end if;
  if has_table_privilege('anon', 'public.notifications', 'INSERT') then
    raise exception '0085: anon can still INSERT into notifications after the revoke. Rolled back.';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'notifications'
                    and policyname = 'notifications_insert_denied'
                    and permissive = 'RESTRICTIVE') then
    raise exception '0085: the restrictive refusal is not in place, or is not restrictive. Rolled back.';
  end if;

  -- THE BOUNDS.
  if not has_table_privilege('service_role', 'public.notifications', 'INSERT') then
    raise exception '0085: service_role lost INSERT on notifications — stripe-webhook can no longer tell anyone a payment failed. Rolled back.';
  end if;
  if not has_table_privilege('authenticated', 'public.notifications', 'SELECT') then
    raise exception '0085: authenticated lost SELECT on notifications — the notifications tab would be permanently empty. Rolled back.';
  end if;
  if not has_table_privilege('authenticated', 'public.notifications', 'UPDATE') then
    raise exception '0085: authenticated lost UPDATE on notifications — nothing could be marked as read. Rolled back.';
  end if;
  if not has_table_privilege('authenticated', 'public.notifications', 'DELETE') then
    raise exception '0085: authenticated lost DELETE on notifications — nothing could be cleared (0008). Rolled back.';
  end if;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0085', 'only_a_definer_function_may_tell_anyone_anything', '4af79ab3983852b759251d90dd22746542cb8ae2751109e9112aeeee3f421089');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- ⚠️ THIS IS THE IRREVERSIBLE ONE. After it, a Vercel revert past stage B's
-- client half stops accept / decline / complete telling anyone anything.
--
--   with f as (
--     select p.oid, p.proname::text as fname, p.prosecdef, p.proowner,
--            pg_get_functiondef(p.oid) as def
--       from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prokind in ('f', 'p')
--   ), ins as (
--     select * from f
--      where def ~* 'insert[[:space:]]+into[[:space:]]+(public\.)?notifications'
--   )
--   select
--     (select count(*) from public.schema_migrations where version = '0084') = 1
--       as v_0084_applied,
--     (select c.relrowsecurity from pg_class c where c.oid = 'public.notifications'::regclass)
--       as rls_enabled,
--     (select not c.relforcerowsecurity from pg_class c where c.oid = 'public.notifications'::regclass)
--       as rls_not_forced,
--     exists (select 1 from pg_policies
--              where schemaname = 'public' and tablename = 'notifications'
--                and policyname = 'authenticated can create notifications'
--                and cmd = 'INSERT'
--                and coalesce(with_check, '') like '%auth.uid() IS NOT NULL%')
--       as the_hole_is_as_described,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'notifications'
--         and policyname in ('read own notifications', 'update own notifications',
--                            'delete own notifications')) = 3
--       as members_keep_their_own,
--     has_table_privilege('authenticated', 'public.notifications', 'INSERT')
--       as auth_can_insert_now,
--     has_table_privilege('service_role', 'public.notifications', 'INSERT')
--       as svc_keeps_insert,
--     (select count(*) from ins where prosecdef) as definer_writers,
--     coalesce((select string_agg(fname || ' (owned by ' || proowner::regrole::text || ')', ', ')
--                 from ins
--                where prosecdef
--                  and proowner <> (select c.relowner from pg_class c
--                                    where c.oid = 'public.notifications'::regclass)),
--              'none') as definer_writers_not_owned_by_table_owner,
--     coalesce((select string_agg(fname, ', ') from ins
--                where not prosecdef
--                  and (has_function_privilege('authenticated', oid, 'EXECUTE')
--                       or has_function_privilege('anon', oid, 'EXECUTE'))),
--              'none') as invoker_writers_a_member_can_call,
--     coalesce((select string_agg(fname, ', ' order by fname) from ins where not prosecdef),
--              'none') as invoker_writers_at_all;
--
--   EXPECT: v_0084_applied, rls_enabled, rls_not_forced,
--   the_hole_is_as_described, members_keep_their_own, auth_can_insert_now and
--   svc_keeps_insert all TRUE; definer_writers a NUMBER (around a dozen);
--   definer_writers_not_owned_by_table_owner 'none';
--   invoker_writers_a_member_can_call 'none'.
--
--   invoker_writers_at_all is EXPECTED to be non-empty —
--   `_admin_apply_user_action` and `_withdraw_stylist`. That is fine and is the
--   point: they are INVOKER, they insert notifications, and `authenticated`
--   cannot EXECUTE either, so every route into them crosses a DEFINER boundary
--   first. ⚠️ The column that matters is the one before it.
--
--   ⚠️ rls_not_forced IS THE ONE THAT WOULD HURT MOST IF FALSE. Forced RLS
--   applies policies to the table OWNER, so the restrictive refusal would block
--   every DEFINER writer and the product would go silent on every notification
--   path at once.
--
--   ⚠️ auth_can_insert_now TRUE is what proves this migration does anything. If
--   it is already false the hole is shut by some other route and this file is
--   not the thing to apply.
-- ===========================================================================
--
-- ── VERIFY — ONE BLOCK ──────────────────────────────────────────────────
--
-- ⚠️ (c) AND (d) ARE THE WHOLE OF STAGE F, FROM THE SAME ROLE. A direct insert
-- as `authenticated` must be REFUSED, and the DEFINER route must still WORK for
-- that same `authenticated` session. (d) is deliberately run with
-- `set local role authenticated` rather than as postgres: calling a DEFINER
-- function as the owner proves the function, not the path, and the path is what
-- this migration changes.
--
-- ⚠️ (e) IS THE BOUNDS CONTROL — Micky's section on 0084. Every other section
-- here proves INSERT is shut. None of them would notice if SELECT, UPDATE or
-- DELETE had been shut with it, which would leave the notifications tab
-- permanently empty while reading as a clean pass.
--
--   begin;
--   do $v$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_model  uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_before uuid[];
--     v_new    uuid;
--     v_seen   integer;
--     v_marked integer;
--     r_a text := 'not run';
--     r_b text := 'not run';
--     r_c text := 'not run';
--     r_d text := 'not run';
--     r_e text := 'not run';
--   begin
--     begin
--       r_a := 'permissive hole: '
--           || (case when exists (select 1 from pg_policies
--                                  where schemaname = 'public' and tablename = 'notifications'
--                                    and policyname = 'authenticated can create notifications')
--                    then 'STILL THERE' else 'gone' end)
--           || ' | restrictive refusal: '
--           || coalesce((select permissive from pg_policies
--                         where schemaname = 'public' and tablename = 'notifications'
--                           and policyname = 'notifications_insert_denied'), 'MISSING');
--     exception when others then r_a := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       r_b := 'INSERT auth=' || has_table_privilege('authenticated', 'public.notifications', 'INSERT')::text
--           || ' anon=' || has_table_privilege('anon', 'public.notifications', 'INSERT')::text
--           || ' service_role=' || has_table_privilege('service_role', 'public.notifications', 'INSERT')::text
--           || ' | auth keeps SELECT=' || has_table_privilege('authenticated', 'public.notifications', 'SELECT')::text
--           || ' UPDATE=' || has_table_privilege('authenticated', 'public.notifications', 'UPDATE')::text
--           || ' DELETE=' || has_table_privilege('authenticated', 'public.notifications', 'DELETE')::text;
--     exception when others then r_b := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       begin
--         execute format(
--           'insert into public.notifications (user_id, type, title, body) values (%L, %L, %L, %L)',
--           v_model, 'admin_message', '0085 direct', 'Should never be written.');
--         r_c := 'NOT REFUSED — a member wrote a notification directly. STAGE F HAS NOT CLOSED THE HOLE.';
--       exception when others then
--         r_c := case when sqlerrm like '%permission denied%'
--                     then 'refused on the GRANT: ' || sqlerrm
--                     when sqlerrm like '%row-level security%' or sqlerrm like '%violates row-level%'
--                     then 'refused on the POLICY: ' || sqlerrm
--                     else 'refused for a DIFFERENT reason: ' || sqlerrm end;
--       end;
--       execute 'reset role';
--     exception when others then r_c := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       v_before := array(select n.id from public.notifications n
--                          where n.user_id = v_model and n.type = 'admin_message');
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       perform public.notify_as_admin(v_model, '0085 verify', 'Via the definer route.');
--       execute 'reset role';
--       v_new := (select n.id from public.notifications n
--                  where n.user_id = v_model and n.type = 'admin_message'
--                    and not (n.id = any (v_before)));
--       r_d := case when v_new is null
--                   then 'NO NEW ROW — the DEFINER route is broken and nothing can tell anyone anything.'
--                   else 'new row via notify_as_admin called AS authenticated: yes' end;
--     exception when others then r_d := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       v_seen := (select count(*) from public.notifications n where n.user_id = v_model);
--       update public.notifications set read_at = now()
--        where user_id = v_model and read_at is null;
--       get diagnostics v_marked = row_count;
--       execute 'reset role';
--       r_e := 'the member still reads ' || v_seen || ' of their own and marked '
--           || v_marked || ' as read';
--     exception when others then r_e := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || '(a) policies      : ' || r_a || chr(10)
--       || '(b) grants        : ' || r_b || chr(10)
--       || '(c) direct insert : ' || r_c || chr(10)
--       || '(d) definer route : ' || r_d || chr(10)
--       || '(e) bounds        : ' || r_e;
--   end $v$;
--   rollback;
--
--   EXPECT: (a) `gone` and `RESTRICTIVE`. (b) INSERT auth=false anon=false
--   service_role=true, and SELECT/UPDATE/DELETE all true. (c) refused — on the
--   GRANT, since grants are checked before policies, so the policy half is
--   belt to the grant's braces and will not be what reports. (d) `yes`.
--   (e) a non-zero read count.
--
--   ⚠️ (c) MATCHES sqlerrm TEXT, NOT SQLSTATE, and distinguishes the two
--   refusals rather than accepting either. insufficient_privilege is 42501 and
--   so is every hand-raised refusal in this schema (0079's test 5).
--
--   ⚠️ (e)'s UPDATE COUNT MAY LEGITIMATELY BE 0 — it only marks rows that were
--   unread. The read count is the assertion; the update is there to prove the
--   privilege, and `get diagnostics` is used because an RLS failure on UPDATE
--   raises nothing and matches zero rows (0079).
--
--   ⚠️ NOTHING IS EMAILED BY THIS BLOCK. (d) writes an admin_message, which
--   0082 put in all three email lists — but pg_net dispatches after COMMIT and
--   this rolls back, so the queue row never becomes visible to the worker
--   (item 152).
-- ===========================================================================

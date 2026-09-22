-- ===========================================================================
-- 0048_a_booking_lets_you_see_who_it_is_with
--
-- A member who has a booking with a stylist can read that stylist's row, even
-- when the shop is hidden. Audit item 76. Decision: Micky, 22 Sep 2026.
--
-- ⚠️ Apply 0047 first.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- The SELECT policy was `is_published = true OR auth.uid() = user_id`. Hide a
-- shop — or get suspended, which hides it for you (0044:312) — and the model
-- who already has a booking with you stops being able to read the row. She
-- keeps the booking and loses the person: the profile 404s, the bookings list
-- and the message thread both say "Stylist", block and report have no subject
-- because the user id came off that row, and the review page 404s.
--
-- Hiding a shop is a marketing action. It should stop new people finding you.
-- It should not erase you from someone you already owe a treatment — and for
-- a suspension, removing the model's ability to see or report the stylist
-- punishes the wrong person and deletes the trail she would report FROM.
--
-- ── WHY A SECURITY DEFINER HELPER AND NOT A SUBQUERY ────────────────────
-- ⚠️ An inline `exists (select 1 from sessions …)` in this policy DEADLOCKS
-- THE TWO POLICIES AGAINST EACH OTHER. `participants can read sessions`
-- already reads `providers` (policy snapshot 8 Aug, :193). Postgres would
-- evaluate providers' policy, which reads sessions, whose policy reads
-- providers, and raise "infinite recursion detected in policy for relation".
--
-- A SECURITY DEFINER function runs as its owner and so does not apply RLS to
-- the tables it reads. The recursion cannot start. This is the same shape as
-- is_admin() and is_suspended(), for the same reason.
--
-- ── WHAT IT DOES NOT WIDEN ──────────────────────────────────────────────
-- Nothing about anon: the public website reads `public_stylists`, which is
-- untouched, and this policy is `to authenticated`. Nobody gains a row they
-- could not already see unless they personally hold a session with that
-- provider. A stranger still gets nothing, so /stylist/<id> still 404s for
-- them and cannot be used to ask whether an id exists.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.providers') is null or to_regclass('public.sessions') is null then
    raise exception '0048: providers or sessions is missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'model_user_id'
  ) then
    raise exception '0048: sessions.model_user_id is missing — the helper keys on it.';
  end if;

  -- If this is not the policy being replaced, stop and read what is there.
  -- Widening the wrong one, or adding a second permissive SELECT policy beside
  -- an unknown one, is how a table quietly becomes readable to everybody.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'providers'
      and policyname = 'providers readable when published'
  ) then
    raise exception
      '0048: the policy "providers readable when published" is not on public.providers. Read the current SELECT policies before applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE HELPER
--
-- "Does the caller have a booking with this stylist?" Every status counts,
-- cancelled included: a booking that was cancelled is exactly when someone
-- needs to know who it was with, and a cancellation is also when a report is
-- most likely.
-- ---------------------------------------------------------------------------
create or replace function public.has_session_with_provider(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.sessions s
    where s.provider_id = p_provider_id
      and s.model_user_id = auth.uid()
  );
$$;

-- Callable by signed-in members only. `public` would hand it to anon, and it
-- would answer questions about other people's bookings if it ever took a user
-- id — it does not, and must not: the caller is always auth.uid().
revoke all on function public.has_session_with_provider(uuid) from public;
grant execute on function public.has_session_with_provider(uuid) to authenticated;

comment on function public.has_session_with_provider(uuid) is
  'True when the CALLER (auth.uid()) is the model on at least one session with this provider. '
  'SECURITY DEFINER so it does not apply sessions RLS, which reads providers and would recurse. '
  'Used by the providers SELECT policy. 0048, audit item 76.';

-- The policy calls this once per candidate row, so make the lookup an index
-- hit rather than a scan.
create index if not exists sessions_provider_model
  on public.sessions (provider_id, model_user_id);

-- ---------------------------------------------------------------------------
-- 2. THE POLICY
--
-- Renamed, because the old name would now be a lie in the one place people
-- look to find out who can read this table.
-- ---------------------------------------------------------------------------
drop policy if exists "providers readable when published" on public.providers;

create policy "providers readable when published or booked" on public.providers
  for select to authenticated
  using (
    is_published = true
    or auth.uid() = user_id
    or public.has_session_with_provider(id)
  );

comment on table public.providers is
  'Stylist shops. Readable by a signed-in member when the shop is published, when it is their '
  'own, or when they hold a booking with it (0048). The public website reads public_stylists, '
  'not this table.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0048', 'a_booking_lets_you_see_who_it_is_with', '19bce2e68bb5fed2760256b3bc406ed5df43ee1af92c1252f98c80cc9138513b');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   1. Apply this migration.
--   2. Push the site (the profile page needs `is_published` to render the
--      "not taking new bookings" line). Wait for the Vercel production
--      deploy, or /stylist/<id> renders from the old build.
--   3. Blocks A to D below, one at a time.
-- ===========================================================================
--
-- ── BLOCK A — the shape. Read-only ──────────────────────────────────────
--
--   select
--     p.prosecdef                                             as security_definer,
--     p.proconfig                                             as search_path_pinned,
--     has_function_privilege('authenticated',
--       'public.has_session_with_provider(uuid)', 'execute')  as authenticated_may_call,
--     has_function_privilege('anon',
--       'public.has_session_with_provider(uuid)', 'execute')  as anon_may_call,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'providers' and cmd = 'SELECT') as select_policies,
--     (select string_agg(policyname, ', ') from pg_policies
--       where schemaname = 'public' and tablename = 'providers' and cmd = 'SELECT') as which
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'has_session_with_provider';
--
--   Expect: true, {search_path=public,\ pg_temp}, true, FALSE, 2,
--   'providers readable when published or booked, providers_select_admin'.
--   anon_may_call MUST be false. select_policies must be 2 — a third one
--   nobody knows about is the thing to stop and read.
--
-- ── BLOCK B — ⭐ THE ONE THAT MATTERS. A member with a booking can read the
--    row; a member without one cannot. Rolls itself back ─────────────────
--
-- Uses real data and writes nothing. It finds a session, becomes that model,
-- counts what she can see, then becomes a member who has NO session with that
-- provider and counts again. `set local role` + `request.jwt.claims` is what
-- makes RLS apply at all — item 66's Block B ran as the owner and therefore
-- tested nothing about row security. Both numbers come from the same query.
--
--   do $$
--   declare
--     v_provider uuid; v_model uuid; v_stranger uuid;
--     v_seen_by_model int; v_seen_by_stranger int; v_published boolean;
--   begin
--     select s.provider_id, s.model_user_id into v_provider, v_model
--     from public.sessions s
--     join public.providers p on p.id = s.provider_id
--     where p.is_published is not true          -- the case this migration is for
--     limit 1;
--
--     if v_provider is null then
--       raise exception 'ROLLED BACK. No session against an unpublished provider exists, so this cannot be tested on real data. Hide a test shop that has a booking, or use Block C.';
--     end if;
--
--     select is_published into v_published from public.providers where id = v_provider;
--
--     select u.id into v_stranger
--     from public.users u
--     where u.id <> v_model
--       and not exists (select 1 from public.sessions s
--                        where s.provider_id = v_provider and s.model_user_id = u.id)
--     limit 1;
--
--     execute format('set local role authenticated');
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_model, 'role', 'authenticated')::text);
--     select count(*) into v_seen_by_model from public.providers where id = v_provider;
--
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_stranger, 'role', 'authenticated')::text);
--     select count(*) into v_seen_by_stranger from public.providers where id = v_provider;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nprovider is_published: %\nseen by the model who booked: %  (must be 1)\nseen by a member with no booking: %  (must be 0)',
--       v_published, v_seen_by_model, v_seen_by_stranger;
--   end $$;
--
--   Expect: false, 1, 0.
--   1 and 1 would mean the row is readable by anyone — stop and re-read the
--   policy. 0 and 0 means the helper is not being reached.
--
-- ── BLOCK C — the same proof without needing existing data. Rolls back ──
--
-- Creates a booking between the model test account and a hidden provider,
-- proves the read, and rolls the lot back. Use it if Block B says there is no
-- such pair. Column list from 0044's Block F (audit item 66).
--
--   do $$
--   declare
--     v_model    constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_provider uuid; v_avail uuid; v_before int; v_after int;
--   begin
--     select id into v_provider from public.providers where is_published is not true limit 1;
--     if v_provider is null then
--       raise exception 'ROLLED BACK. No unpublished provider to test with.';
--     end if;
--
--     execute format('set local role authenticated');
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_model, 'role', 'authenticated')::text);
--     select count(*) into v_before from public.providers where id = v_provider;
--     reset role;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments, is_taken)
--     values (v_provider, current_date + 7, '10:00', '11:00', '{}', true)
--     returning id into v_avail;
--
--     insert into public.sessions (provider_id, model_id, model_user_id, availability_id,
--                                  date, start_time, end_time, status)
--     values (v_provider, v_model, v_model, v_avail,
--             current_date + 7, '10:00', '11:00', 'accepted');
--
--     execute format('set local role authenticated');
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_model, 'role', 'authenticated')::text);
--     select count(*) into v_after from public.providers where id = v_provider;
--     reset role;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\nbefore the booking: %  (must be 0)\nafter the booking:  %  (must be 1)',
--       v_before, v_after;
--   end $$;
--
-- ── BLOCK D — nothing else widened. Rolls itself back ───────────────────
--
-- A member with no bookings at all sees exactly the published shops, and no
-- more. If this number moves, the policy is wider than it was meant to be.
--
--   do $$
--   declare v_nobody uuid; v_visible int; v_published int;
--   begin
--     select u.id into v_nobody from public.users u
--     where not exists (select 1 from public.sessions s where s.model_user_id = u.id)
--     limit 1;
--     if v_nobody is null then
--       raise exception 'ROLLED BACK. Every member has a booking, so this cannot be measured.';
--     end if;
--
--     select count(*) into v_published from public.providers where is_published is true;
--
--     execute format('set local role authenticated');
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_nobody, 'role', 'authenticated')::text);
--     select count(*) into v_visible from public.providers;
--     reset role;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\npublished shops: %\nvisible to a member with no bookings: %  (must match, unless they own one)',
--       v_published, v_visible;
--   end $$;

-- ============================================================================
-- SUSPENSION / BAN ENFORCEMENT (DB layer)
-- ----------------------------------------------------------------------------
-- WHY
--   Admins can suspend or ban a user (admin console -> users / reports / providers,
--   writing to public.suspensions), but NOTHING in the app ever checked that table:
--   a banned user carried on applying, messaging, reviewing and publishing as normal.
--   Locking the table under RLS (rls-lockdown.sql) stopped tampering; it did not
--   stop the banned user acting.
--
--   Enforcing in the DB means a modified client can't bypass it. The app also shows a
--   blocking screen, but that is UX — this is the actual control.
--
-- SUSPENSION SHAPE (per the admin console):
--   banned = true                      -> permanent
--   suspended_until > now()            -> temporary
--   row deleted                        -> lifted ("unsuspend" deletes the row)
--
-- PATTERN: RESTRICTIVE policies AND with the permissive ones (same approach as the
--   existing *_not_blocked policies). A RESTRICTIVE policy only ever subtracts, so
--   these cannot accidentally grant anything.
-- ============================================================================

-- Helper. SECURITY DEFINER so it can read `suspensions`, which is admin-only under RLS.
create or replace function public.is_suspended(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.suspensions s
    where s.user_id = uid
      and (s.banned = true
           or (s.suspended_until is not null and s.suspended_until > now()))
  );
$$;

grant execute on function public.is_suspended(uuid) to authenticated;

-- Block the actions that affect other people. Reads stay allowed so the app can
-- render the "you're suspended" screen and the user can still see their own data.

-- Can't apply for / create bookings.
drop policy if exists sessions_not_suspended on public.sessions;
create policy sessions_not_suspended on public.sessions
  as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

-- Can't send messages.
drop policy if exists messages_not_suspended on public.messages;
create policy messages_not_suspended on public.messages
  as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

-- Can't leave reviews.
drop policy if exists reviews_not_suspended on public.reviews;
create policy reviews_not_suspended on public.reviews
  as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

-- Can't change their shop (incl. re-publishing). Admins are unaffected: an admin is
-- not suspended, so the check passes for them.
drop policy if exists providers_not_suspended on public.providers;
create policy providers_not_suspended on public.providers
  as restrictive for update to authenticated
  using (not public.is_suspended(auth.uid()));

-- The app must be able to TELL the user they're suspended, but `suspensions` is
-- admin-only under RLS. Rather than open the table, this returns only the caller's
-- own active suspension (SECURITY DEFINER, scoped to auth.uid()).
create or replace function public.my_suspension()
returns table (banned boolean, suspended_until timestamptz, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select s.banned, s.suspended_until, s.reason
  from public.suspensions s
  where s.user_id = auth.uid()
    and (s.banned = true
         or (s.suspended_until is not null and s.suspended_until > now()))
  order by s.banned desc, s.suspended_until desc nulls last
  limit 1;
$$;

grant execute on function public.my_suspension() to authenticated;

-- ============================================================================
-- VERIFY
--   select public.is_suspended('<user_id>');            -- false normally
--   -- suspend that user in the admin console, then re-run: true
--   -- as that user, applying / messaging / reviewing must fail with 42501
--   -- unsuspend (admin console deletes the row) -> actions work again
--
--   Normal users must be unaffected: apply, message, review, edit shop all still work.
-- ============================================================================

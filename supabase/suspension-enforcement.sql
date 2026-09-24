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

-- MIGRATION-OWNS: my_suspension 0058 — kept in step by hand, 24 Sep 2026.
--
-- The app must be able to TELL the user they're suspended, but `suspensions` is
-- admin-only under RLS. Rather than open the table, this returns only the caller's
-- own active suspension (SECURITY DEFINER, scoped to auth.uid()).
--
-- ⚠️ IT RETURNS member_message, NOT reason, SINCE 0058 (audit item 118).
-- `reason` is moderation evidence and may name the person who reported them.
-- This function was the ONLY route it ever had to a member, and mobile printed
-- it under a heading saying "Reason". Do not put it back.
--
-- ⚠️ AND THIS FILE HELD THE OLD DEFINITION UNTIL 24 Sep, WHICH IS ITS OWN
-- LESSON (item 123). This is a hand-run file, so it is not applied by anything
-- and nothing told us it had gone stale. Re-running it would have failed —
-- `create or replace` cannot rename a RETURNS TABLE column — and the obvious
-- way to "fix" that error is to drop the function and re-run, which would have
-- reinstated the leak 0058 exists to close. It failed safe by luck, not design.
--
-- DROP then CREATE, matching what every policy in this file already does, so
-- the file is re-runnable from any prior state rather than only from the right
-- one. In a transaction because a dropped function is a window.
--
-- ⚠️ Needs 0058 applied: without suspensions.member_message the CREATE below
-- fails on an unknown column, which is the correct loud failure.
begin;

drop function if exists public.my_suspension();

create function public.my_suspension()
returns table (banned boolean, suspended_until timestamptz, message text)
language sql
stable
security definer
set search_path = public
as $$
  select s.banned, s.suspended_until, s.member_message
  from public.suspensions s
  where s.user_id = auth.uid()
    and (s.banned = true
         or (s.suspended_until is not null and s.suspended_until > now()))
  order by s.banned desc, s.suspended_until desc nulls last
  limit 1;
$$;

comment on function public.my_suspension() is
  'The caller''s own active suspension or ban, for the gate that stops them at the '
  'door. SECURITY DEFINER because suspensions is readable only by admins under RLS. '
  '⚠️ RETURNS member_message, NOT reason: the reason is moderation evidence and may '
  'name the person who reported them. It returned reason until 0058 and mobile printed '
  'it under a heading saying "Reason" — audit item 118. Do not add reason back.';

-- anon as well as authenticated, matching 0058: called before auth resolves it
-- returns no rows, and turning that into a permission error would be a new
-- failure mode rather than a fix.
revoke execute on function public.my_suspension() from public;
grant  execute on function public.my_suspension() to authenticated, anon;

commit;

-- ============================================================================
-- VERIFY
--   select public.is_suspended('<user_id>');            -- false normally
--   -- suspend that user in the admin console, then re-run: true
--   -- as that user, applying / messaging / reviewing must fail with 42501
--   -- unsuspend (admin console deletes the row) -> actions work again
--
--   Normal users must be unaffected: apply, message, review, edit shop all still work.
-- ============================================================================

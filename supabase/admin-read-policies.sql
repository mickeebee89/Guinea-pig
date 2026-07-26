-- ============================================================================
-- ADMIN READ POLICIES — let the moderation console actually see what it moderates
-- ----------------------------------------------------------------------------
-- WHY
--   The admin console (Next.js) talks to Supabase with the ANON key + a logged-in
--   admin session — there is NO service-role bypass — so every query it makes is
--   subject to RLS. Four tables had policies with no is_admin() clause, so parts of
--   the console were reading NOTHING and rendering it as zero/empty. No page in the
--   console checks `error`, so none of this surfaced.
--
--     sessions       participant-only  -> booking counts on dashboard/users/providers read 0
--     messages       participant-only  -> reported-chat evidence + flagged-text scan see nothing
--     notifications  own-rows-only     -> admin message log only shows messages sent TO the admin
--     providers      published-or-own  -> UNPUBLISHED providers invisible: exactly the population
--                                         the verification queue exists to review
--
--   All four are permissive policies, and permissive policies OR together, so each
--   of these only ADDS admin access — nothing is loosened for normal users.
--
-- ⚠️ PRIVACY: the `messages` policy lets an admin read ANY private DM between two
--   18+ users, at any time — not just reported ones. That is a deliberate choice
--   (Apple Guideline 1.2 requires being able to act on reported UGC, and a moderator
--   who can't read the reported message can't act). It MUST be disclosed in the
--   privacy policy before launch. A narrower "only messages attached to a report"
--   policy is the tighter long-term shape.
-- ============================================================================

-- Booking counts and any future session list in the console.
create policy sessions_select_admin
  on public.sessions for select to authenticated
  using (is_admin());

-- Reported-chat evidence (reports "View Chat") and the flagged-text scan.
create policy messages_select_admin
  on public.messages for select to authenticated
  using (is_admin());

-- The admin messages page's "sent" log.
create policy notifications_select_admin
  on public.notifications for select to authenticated
  using (is_admin());

-- Providers awaiting verification are unpublished, so an admin could not read them
-- even though `admins update any provider` already let them WRITE.
create policy providers_select_admin
  on public.providers for select to authenticated
  using (is_admin());

-- ============================================================================
-- VERIFY (in the console, as the admin)
--   Providers page  -> unpublished / pending providers now appear
--   Reports page    -> "View Chat" on a reported session shows the messages
--   Moderation      -> "Flagged Text" finds matches for a known banned word
--   Messages page   -> previously-sent admin messages appear in the log
--   Users/Providers -> Sessions column shows real counts, not 0
--
-- VERIFY (nothing loosened) — as a NORMAL user on the device:
--   still cannot see other people's bookings, DMs, or notifications;
--   unpublished shops still hidden from browse.
-- ============================================================================

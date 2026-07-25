-- ============================================================================
-- REVIEW INTEGRITY
-- ----------------------------------------------------------------------------
-- TWO GAPS
--   1. The INSERT policy checks the reviewer is a session PARTICIPANT, but not that
--      the session actually happened. Combined with the (now-fixed) self-complete
--      hole this allowed fabricated reviews; even alone it lets a participant review
--      a pending/declined/cancelled booking.
--   2. Duplicate reviews are only prevented CLIENT-side (leave-review.tsx checks for
--      an existing row). Nothing stops repeated API inserts to inflate a rating.
--
-- Pairs with session-status-guard.sql — that trigger is what makes 'completed'
-- trustworthy, so gating on it here is meaningful.
-- ============================================================================

-- 1. Require the session to be COMPLETED (keeps the existing participant checks).
drop policy if exists "write own review for own session" on public.reviews;

create policy "write own review for own session"
  on public.reviews for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.sessions s
      where s.id = reviews.session_id
        and s.status = 'completed'
        and (
          auth.uid() = s.model_user_id
          or exists (
            select 1 from public.providers p
            where p.id = s.provider_id and p.user_id = auth.uid()
          )
        )
    )
  );

-- 2. One review per reviewer per session, enforced in the DB.
--    If this errors with a duplicate-key violation, run the dupe check below first.
create unique index if not exists reviews_session_reviewer_uniq
  on public.reviews (session_id, reviewer_id);

-- ============================================================================
-- PRE-CHECK for step 2 (run FIRST if the index creation fails):
--   select session_id, reviewer_id, count(*)
--   from reviews group by 1,2 having count(*) > 1;
--
-- VERIFY
--   In-app (must still work): after a stylist marks a session complete, the model
--   can leave a review.
--   Exploit (must now fail): inserting a review for a session that is not
--   'completed'; inserting a SECOND review for the same session as the same reviewer.
-- ============================================================================

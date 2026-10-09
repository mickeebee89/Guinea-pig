-- ============================================================================
-- Booking double-booking guard. Run in the Supabase SQL editor.
--
-- Slot-collision prevention was display-time only: the client greys out slots
-- already held by pending/accepted sessions (via the taken_slots RPC), but the
-- booking INSERT had no pre-insert re-check, no transaction, and no DB
-- uniqueness. Two models racing for the same free slot could both insert an
-- active booking (a time-of-check/time-of-use race). This adds an atomic guard
-- so the SECOND concurrent insert fails; the app catches the 23505 and asks the
-- losing model to pick another time.
--
-- Active = pending|accepted. completed|declined|cancelled are EXCLUDED, so a
-- slot re-opens once its booking ends — matching the taken_slots semantics.
-- ============================================================================

-- 1) PRE-CHECK — must return NO rows before the index will build. Finds any
--    existing active double-bookings (usually only leftover test data).
select provider_id, date, start_time, count(*), array_agg(id) as session_ids
from public.sessions
where status in ('pending','accepted')
group by provider_id, date, start_time
having count(*) > 1;

-- If the pre-check returns rows, cancel the duplicate(s) and re-run it until empty:
--   update public.sessions set status = 'cancelled' where id = '<duplicate session id>';

-- 2) THE GUARD — one active booking per provider + date + start_time. Two active
--    bookings starting at the same provider/date/time overlap regardless of
--    duration, so start_time is the correct collision key. Does NOT touch the
--    availability table's own unique index (provider_id, date, start_time, end_time).
-- MIGRATION-OWNS: sessions_active_slot_uniq 0093
--
-- ⚠️ AND FOR AN INDEX THAT MARKER MEANS SOMETHING SHARPER THAN IT DOES FOR A
-- FUNCTION. `create or replace function` overwrites; `create index if not
-- exists` matches on the NAME ALONE. So re-running this file against a database
-- whose index has DRIFTED — or whose index is INVALID, which is what a failed
-- CREATE INDEX CONCURRENTLY leaves behind — is a silent no-op, not a repair. It
-- will report success and change nothing.
--
-- ✅ 0093 is the authority. It asserts the key by position and parses the status
-- set out of the predicate, and it REFUSES rather than relying on a create to fix
-- anything. If this file and the live index disagree, 0093 is what will say so.
create unique index if not exists sessions_active_slot_uniq
  on public.sessions (provider_id, date, start_time)
  where status in ('pending','accepted');

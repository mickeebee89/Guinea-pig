-- ============================================================================
-- BOOKING OVERLAP GUARD
-- ----------------------------------------------------------------------------
-- WHY
--   booking-guard.sql added a unique index on (provider_id, date, start_time)
--   for active sessions, which stops two bookings that START at the same time.
--   It does NOT stop bookings that merely OVERLAP:
--
--       09:00–12:00  booked   (Hair)
--       10:00–11:00  booked   (Nails)   <-- different start_time, sails through
--
--   The stylist is then double-booked for 10:00–11:00. Reported in testing:
--   "I booked a slot in between an existing slot and it allowed me to."
--
--   Root cause is two-fold: the availability editor allowed OVERLAPPING SLOTS to
--   be created (now blocked client-side), and the DB had no overlap check. This
--   is the half that actually guarantees it — it holds even for overlapping slots
--   that already exist, and against a hand-crafted API call.
--
--   Raises errcode 23505 deliberately: the app already handles that code on the
--   booking insert with a friendly "That time was just booked" + back to the time
--   step (apply-session.tsx:500), so no client change is needed.
--
--   Active = pending|accepted, matching booking-guard.sql and taken_slots — a
--   completed/declined/cancelled booking frees the time again.
-- ============================================================================

create or replace function public.reject_overlapping_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clash record;
begin
  -- Only active bookings hold a time. Cancelling/declining frees it.
  if new.status not in ('pending', 'accepted') then
    return new;
  end if;

  select s.start_time, s.end_time
    into clash
  from public.sessions s
  where s.provider_id = new.provider_id
    and s.date        = new.date
    and s.id         <> new.id
    and s.status in ('pending', 'accepted')
    -- Half-open overlap: 09:00-10:00 and 10:00-11:00 do NOT clash.
    and s.start_time < new.end_time
    and s.end_time   > new.start_time
  limit 1;

  if found then
    raise exception
      'This time overlaps an existing booking (%-%)', clash.start_time, clash.end_time
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_overlapping_session on public.sessions;
create trigger trg_reject_overlapping_session
  before insert or update of date, start_time, end_time, status, provider_id
  on public.sessions
  for each row
  execute function public.reject_overlapping_session();

-- ============================================================================
-- PRE-CHECK — existing overlapping active bookings. The trigger only guards NEW
-- writes, so anything already overlapping stays until resolved. Should be empty:
--   select a.id, b.id, a.date, a.start_time, a.end_time, b.start_time, b.end_time
--   from public.sessions a
--   join public.sessions b
--     on a.provider_id = b.provider_id and a.date = b.date and a.id < b.id
--    and a.start_time < b.end_time and b.start_time < a.end_time
--   where a.status in ('pending','accepted') and b.status in ('pending','accepted');
--
-- VERIFY
--   In-app: book 09:00-12:00, then try to book 10:00-11:00 with the same stylist
--   on the same date -> rejected with "That time was just booked".
--   Back-to-back must still work: 09:00-10:00 then 10:00-11:00 -> both succeed.
--   A cancelled/declined booking frees its time -> re-booking works.
-- ============================================================================

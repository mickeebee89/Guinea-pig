-- ===========================================================================
-- 0015_live_booking_means_future_booking
--
-- Narrows 0013's guard: a booking only locks a treatment while it is still in
-- the future. A past-dated one that was never closed out no longer does.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHY: 0013 CAN LOCK A TREATMENT FOR EVER ───────────────────────────────
-- 0013 treats `status in ('pending','accepted')` as "live". Nothing in this
-- system ever closes a booking automatically — only the provider can set
-- `completed`, per enforce_session_status_transition — so an accepted booking
-- from three weeks ago stays `accepted` indefinitely if the stylist never
-- marked it done. Most people will not.
--
-- Real data found this the day 0013 shipped. Seven treatments were locked, and
-- five of them by bookings already in the past:
--
--   Nails      Micky B   2  earliest 2026-08-12   future
--   Brows      Micky B   2  earliest 2026-07-26   PAST, still 'accepted'
--   Nails      Mod       1           2026-07-09   PAST, still 'accepted'
--   Hair       Micky B   1           2026-08-15   future
--   Makeup     Micky B   1           2026-07-29   PAST, still 'accepted'
--   Lashes     Micky B   1           2026-07-30   PAST, still 'accepted'
--   Spray Tan  Micky B   1           2026-07-25   PAST, still 'accepted'
--
-- That is ALL SIX categories locked for one stylist, five of them by bookings
-- that had already happened.
--
-- ── THIS IS THE FAULT 0013 WAS WRITTEN TO AVOID ───────────────────────────
-- 0013's own header rejects a foreign key partly because:
--
--   "restrict — a stylist who stops doing lashes could NEVER remove Lashes,
--    because completed bookings are permanent"
--
-- and then reintroduced a weaker version of exactly that through stale
-- `accepted` rows. The argument was right; it was applied to the wrong column.
-- The guard needed to key on whether the appointment is still COMING, not on
-- whether a status field was ever updated.
--
-- ── WHY DATE AND NOT STATUS HYGIENE ───────────────────────────────────────
-- The alternative is to make stylists close bookings out, or to auto-complete
-- past ones. Both are worth doing on their own merits and neither belongs
-- here: a guard whose correctness depends on people keeping a status field
-- tidy is a guard that fails quietly for the least diligent user, which is the
-- opposite of who a guard is for.
--
-- `date >= current_date` includes today, so a booking later this afternoon
-- still protects its treatment.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0015') then
    raise exception 'Migration 0015 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE, per 0014. What the old predicate locked, and what the new one will.
--
-- Recorded before the change so the difference is answerable later without
-- anyone having had to think of the question today.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0015', 'treatments locked under 0013 (any pending/accepted)', count(*)::text
from (
  select distinct s.treatment_id
  from public.sessions s
  where s.treatment_id is not null and s.status in ('pending', 'accepted')
) x;

insert into public.migration_findings (version, item, value)
select '0015', 'treatments locked under 0015 (future only)', count(*)::text
from (
  select distinct s.treatment_id
  from public.sessions s
  where s.treatment_id is not null
    and s.status in ('pending', 'accepted')
    and s.date >= current_date
) x;

insert into public.migration_findings (version, item, value)
select '0015', 'stale accepted/pending bookings in the past', count(*)::text
from public.sessions s
where s.status in ('pending', 'accepted') and s.date < current_date;

-- ---------------------------------------------------------------------------
-- ASSERT, per 0014. 0013 must actually be in place — narrowing a guard that
-- is not there would report success while changing nothing.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.provider_treatments'::regclass
      and tgname = 'trg_refuse_treatment_delete_while_booked'
  ) and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0015 narrows 0013''s guard, but that trigger is not installed. Apply 0013 first, '
      'or re-run with: set local cavy.migration_override = ''yes'';';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The narrowed rule. Body is 0013's, with the date condition added in both
-- places and the message saying which appointment rather than just a date.
-- ---------------------------------------------------------------------------
create or replace function public.refuse_treatment_delete_while_booked()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_date  date;
  v_time  time;
  v_count integer;
begin
  select count(*), min(s.date)
    into v_count, v_date
  from public.sessions s
  where s.treatment_id = old.id
    and s.status in ('pending', 'accepted')
    and s.date >= current_date;

  if v_count > 0 then
    select s.start_time into v_time
    from public.sessions s
    where s.treatment_id = old.id
      and s.status in ('pending', 'accepted')
      and s.date >= current_date
      and s.date = v_date
    order by s.start_time
    limit 1;

    raise exception
      'Treatment % (%) has % upcoming booking(s); earliest % %',
      old.id, coalesce(old.category, '?'), v_count, v_date, coalesce(v_time::text, '')
      using errcode = '23503';
  end if;

  return old;
end;
$function$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0015', 'live_booking_means_future_booking', '242fee870f99a11ea2bfd440763484716f3686eec06ee344d0b5f707ec469911');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — the before/after numbers this migration recorded ───────────
--
--   select item, value from public.migration_findings
--   where version = '0015' order by id;
--
-- ── BLOCK B — a PAST booking no longer locks. Rolls itself back. ─────────
--
--   Expect: DELETE 1, no error. Under 0013 this raised.
--
--   begin;
--     delete from public.provider_treatments
--      where id = (select s.treatment_id from public.sessions s
--                   where s.status in ('pending','accepted')
--                     and s.date < current_date
--                     and s.treatment_id is not null
--                   limit 1);
--   rollback;
--
-- ── BLOCK C — a FUTURE booking still locks. Rolls itself back. ───────────
--
--   Expect: ERROR 23503, "upcoming booking(s)".
--
--   begin;
--     delete from public.provider_treatments
--      where id = (select s.treatment_id from public.sessions s
--                   where s.status in ('pending','accepted')
--                     and s.date >= current_date
--                     and s.treatment_id is not null
--                   limit 1);
--   rollback;
--
-- ===========================================================================


-- ===========================================================================
-- FOLLOW-UP, NOT PART OF THIS MIGRATION
--
-- The stale bookings are still stale. Nothing closes a past `accepted` session,
-- so they accumulate for ever and show up as "upcoming" on dashboards that only
-- filter by status. Worth deciding separately:
--
--   * auto-complete past accepted sessions on a schedule, or
--   * prompt the stylist to close them out, or
--   * treat date, not status, as the source of truth everywhere.
--
-- Recorded here because this migration works AROUND that problem rather than
-- fixing it, and a workaround nobody knows about becomes the design.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

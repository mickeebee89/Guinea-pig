-- ===========================================================================
-- PRE-CHECK for migration 0013_refuse_treatment_delete_while_booked
--
-- RUN THIS FIRST, AND KEEP THE OUTPUT. Then apply 0013.
--
-- ── WHY THIS IS A SEPARATE FILE ───────────────────────────────────────────
-- 0012 carried its pre-check in its own header comments. "Run the migration"
-- and "run the thing that must precede the migration" were therefore the same
-- paste, the pre-check was skipped, and the baseline it existed to capture is
-- gone permanently — the repair had already rewritten the rows it measured.
--
-- A pre-check that ships inside the change it is checking will be skipped
-- sooner or later. This directory is for the ones that must not be.
--
-- ── ⚠️ AND IT WAS SKIPPED ANYWAY. THE SEPARATE FILE WAS NOT THE FIX. ──────
-- Run after 0013 had already been applied, on 10 Aug. The operator's diagnosis:
-- "The instruction to run it lives in your message, and by the time I'm in the
-- SQL editor I'm pasting migrations."
--
-- Correct, and it generalises — a pre-check that depends on someone remembering
-- is not a check, wherever the file sits. Migration 0014 moves both halves
-- INSIDE the migration: it records its own before-figures into
-- migration_findings, and aborts on an assertion when the world is not what the
-- author assumed. **New migrations should use that; do not add files here
-- expecting them to be run.**
--
-- ── ⚠️ SECOND FAULT IN THIS FILE: TWO SELECTS, ONE VISIBLE ────────────────
-- It has two statements, and the Supabase SQL editor only shows the LAST result
-- set — so query 1, the one naming which treatments would become un-removable,
-- ran and was never displayed. The migration files' own convention says "one
-- paste per block, each ending in one select", and this file broke it.
--
-- ── WHAT THIS DIRECTORY IS ────────────────────────────────────────────────
-- Read-only SQL. Nothing here writes, so anything in it is safe to run twice,
-- out of order, or by mistake. Deliberately NOT under supabase/migrations/ —
-- scripts/migration-status.mjs treats any `NNNN_*.sql` in that folder as a
-- migration, so a diagnostic living there would be reported as PENDING for
-- ever, and "there is always one pending" is how a real pending one gets
-- ignored.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What the new guard will protect, and what it will make un-removable today.
--
--    0013 refuses deleting a treatment while a pending/accepted session uses
--    it. This is the exact population that rule will bite on RIGHT NOW.
--
--    Expected on 10 Aug 2026: zero rows. Every session carrying a treatment_id
--    is completed/cancelled/declined test data. If this returns rows, a real
--    stylist is about to find a chip they cannot remove — which is correct
--    behaviour, but you want to know before they do, not after.
-- ---------------------------------------------------------------------------
select 'treatments that would become un-removable' as item,
       pt.id      as treatment_id,
       pt.category,
       p.name     as stylist,
       count(*)   as live_bookings,
       min(s.date) as earliest
from public.provider_treatments pt
join public.sessions s
  on s.treatment_id = pt.id
 and s.status in ('pending', 'accepted')
join public.providers p on p.id = pt.provider_id
group by pt.id, pt.category, p.name
order by live_bookings desc;


-- ---------------------------------------------------------------------------
-- 2. Context for the above, as single numbers.
--
--    `live bookings with a treatment` is the population 0013 protects.
--    `live bookings with a DEAD treatment_id` is the population it arrived too
--    late for — those are already unfixable by any trigger, and if it is not
--    zero they need doing by hand before anyone relies on the label.
-- ---------------------------------------------------------------------------
select 'live bookings with a treatment' as item,
       (select count(*)::text from public.sessions
         where status in ('pending', 'accepted') and treatment_id is not null) as value
union all
select 'live bookings with a DEAD treatment_id',
       (select count(*)::text from public.sessions s
         where s.status in ('pending', 'accepted')
           and s.treatment_id is not null
           and not exists (select 1 from public.provider_treatments pt where pt.id = s.treatment_id))
union all
select 'terminal bookings with a DEAD treatment_id (accepted, not repaired)',
       (select count(*)::text from public.sessions s
         where s.status not in ('pending', 'accepted')
           and s.treatment_id is not null
           and not exists (select 1 from public.provider_treatments pt where pt.id = s.treatment_id))
union all
select '0012 strip trigger still installed',
       coalesce((select tgname from pg_trigger
                  where tgrelid = 'public.provider_treatments'::regclass
                    and tgname = 'trg_strip_treatment_from_availability'), 'MISSING')
union all
select '0013 guard already installed?',
       coalesce((select tgname from pg_trigger
                  where tgrelid = 'public.provider_treatments'::regclass
                    and tgname = 'trg_refuse_treatment_delete_while_booked'), 'not yet - expected');

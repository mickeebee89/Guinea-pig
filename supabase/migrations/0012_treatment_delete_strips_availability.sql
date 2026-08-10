-- ===========================================================================
-- 0012_treatment_delete_strips_availability
--
-- Deleting a provider_treatments row now removes its id from every slot that
-- referenced it, and repairs the slots where that never happened.
--
-- ── WHAT BREAKS FOR A STYLIST TODAY ───────────────────────────────────────
-- A stylist opens Edit Shop in the app, changes nothing, presses Save — and
-- every slot in their diary quietly forgets which treatments it was for.
--
-- edit-shop.tsx:115 deletes ALL of a provider's provider_treatments rows and
-- re-inserts the selection, which mints new uuids. Those uuids are not private
-- to that table:
--
--   availability.active_treatments   uuid[] of provider_treatments.id
--   sessions.treatment_id            one provider_treatments.id
--
-- so the delete leaves both pointing at rows that no longer exist. Nothing
-- cleans up after it, in any client or any trigger.
--
-- ── WHY THE EXISTING MITIGATION MADE IT WORSE, NOT BETTER ─────────────────
-- This surfaced on 11 Jul as "Model apply: No treatments listed for this slot"
-- against Micky B's account. The fix was a FALLBACK at apply-session.tsx:293:
-- when a slot's scoped treatment set resolves to nothing, offer the provider's
-- ENTIRE current treatment list instead.
--
-- cavy-handover.md then downgraded the root cause to a parked nice-to-have,
-- reasoning that it "only over-offers for a multi-treatment provider who scopes
-- slots to subsets AND has orphans — niche, soft failure".
--
-- That reasoning assumed orphans are rare accidents. They are not. Pressing
-- Save in Edit Shop produces them for EVERY slot, EVERY time, for any provider
-- who has ever re-saved. For those providers the fallback is not a safety net
-- catching an edge case — it is the normal path, and what it does is offer
-- models treatments the stylist deliberately did not enable for that slot, then
-- let them book one. The scoping is silently inverted from "these three" to
-- "anything I do".
--
-- A mitigation that hides the symptom is what allowed the cause to be filed as
-- niche. Same shape as the client-boundary check that passed with a violation
-- one level down: nothing was reporting a problem, so there appeared not to be
-- one.
--
-- ── WHY A TRIGGER AND NOT CLIENT CODE ─────────────────────────────────────
-- Three writers can delete a provider_treatments row: mobile Edit Shop, the web
-- /shop action, and an admin. The rule "a deleted treatment must not stay
-- referenced" belongs to the data, not to whichever screen happened to do it.
-- Put it in three clients and it is one client away from being wrong again —
-- which is the history of this bug.
--
-- This does NOT make the client fix unnecessary. The trigger stops references
-- DANGLING; it cannot stop delete-all-and-reinsert from emptying every slot,
-- because a slot losing its treatments is exactly what that code asked for. The
-- clients must stop asking. See mobile-treatments-orphan-bug.md.
--
-- ── WHAT THE REPAIR DOES AND DOES NOT FIX ─────────────────────────────────
-- Step 2 strips ids that already point at nothing. A slot whose treatments were
-- ALL orphaned ends up with an empty array, which behaves the same as before
-- under the apply-session fallback — the repair does not restore information
-- nobody recorded.
--
-- What it does buy: dangling ids are currently PERMANENT. DayEditor.tsx:106
-- rebuilds a slot's array from the live chip list plus whatever was already in
-- it, so an id matching no chip is invisible, unclearable, and re-saved for
-- ever. After this, re-saving a day actually sets it right.
--
-- sessions.treatment_id is deliberately NOT touched. A booking is a historical
-- record; blanking its treatment loses evidence, and every read site already
-- degrades to omitting the label rather than failing. The one exception worth
-- knowing is chat/[sessionId].tsx:546, which gates the date line on the
-- treatment resolving, so a locked chat shows neither. That is a client bug and
-- is fixed as one.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0012') then
    raise exception 'Migration 0012 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The rule.
--
--    SECURITY DEFINER because the deleter is not always the owner of the
--    availability rows — an admin tidying a category must not leave half the
--    job done because RLS refused the second half.
--
--    AFTER DELETE, not BEFORE: if the delete is refused (a foreign key, a
--    policy), nothing should have been stripped.
-- ---------------------------------------------------------------------------
create or replace function public.strip_treatment_from_availability()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.availability
     set active_treatments = array_remove(active_treatments, old.id)
   where provider_id = old.provider_id
     and active_treatments is not null
     and old.id = any (active_treatments);
  return old;
end;
$function$;

drop trigger if exists trg_strip_treatment_from_availability on public.provider_treatments;

create trigger trg_strip_treatment_from_availability
  after delete on public.provider_treatments
  for each row execute function public.strip_treatment_from_availability();

-- ---------------------------------------------------------------------------
-- 2. The repair, for everything deleted before the trigger existed.
--
--    Rewrites each affected array to only the ids that still resolve.
--    coalesce(..., '{}') so a fully-orphaned slot becomes an empty array rather
--    than NULL — cardinality() treats them alike, but the availability writers
--    expect an array.
--
--    Idempotent: a second run matches no rows.
-- ---------------------------------------------------------------------------
update public.availability a
   set active_treatments = coalesce(
     (select array_agg(t)
        from unnest(a.active_treatments) as t
       where exists (select 1 from public.provider_treatments pt where pt.id = t)),
     '{}'::uuid[]
   )
 where a.active_treatments is not null
   and exists (
     select 1 from unnest(a.active_treatments) as t
      where not exists (select 1 from public.provider_treatments pt where pt.id = t)
   );

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0012', 'treatment_delete_strips_availability', 'ae712d0296c4282612139844b27ad60ae564064623bc01bb440501b381b0bae1');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- BEFORE APPLYING — measure the damage, so the repair can be believed
--
-- Run these FIRST and keep the output. After the migration, block B must
-- return zero rows; if it does not, the repair did not do what it claims.
--
-- ── BLOCK A — how many slots are affected, and whose ──────────────────────
--
--   select a.provider_id, p.name, count(*) as slots_with_dead_ids
--   from public.availability a
--   join public.providers p on p.id = a.provider_id
--   where a.active_treatments is not null
--     and exists (
--       select 1 from unnest(a.active_treatments) as t
--        where not exists (select 1 from public.provider_treatments pt where pt.id = t)
--     )
--   group by a.provider_id, p.name
--   order by slots_with_dead_ids desc;
--
-- ── BLOCK B — the same rows, in detail. Zero after applying. ──────────────
--
--   select a.provider_id, a.date, a.start_time, a.active_treatments
--   from public.availability a
--   where a.active_treatments is not null
--     and exists (
--       select 1 from unnest(a.active_treatments) as t
--        where not exists (select 1 from public.provider_treatments pt where pt.id = t)
--     )
--   order by a.date;
--
-- ── BLOCK C — bookings pointing at a treatment that no longer exists ──────
--
--   NOT repaired by this migration, and the number matters on its own: it is
--   how many real bookings have lost their treatment label. If this returns
--   zero rows there may be a foreign key holding it, which BLOCK D settles.
--
--   select s.id, s.provider_id, s.date, s.status, s.treatment_id
--   from public.sessions s
--   where s.treatment_id is not null
--     and not exists (select 1 from public.provider_treatments pt where pt.id = s.treatment_id)
--   order by s.date desc;
--
-- ── BLOCK D — is there a foreign key on sessions.treatment_id at all? ─────
--
--   This decides which failure we have been living with, and the two are very
--   different. confdeltype: a = no action, r = restrict, c = CASCADE,
--   n = set null, d = set default.
--
--   c would mean edit-shop has been DELETING BOOKINGS on every save.
--   a or r would mean the delete has been silently refused whenever a booking
--     referenced a treatment — and because edit-shop.tsx:115 never reads
--     delError, the re-insert still ran, so those providers have DUPLICATE
--     treatment rows rather than orphans.
--   no row at all means nothing has been enforcing it and orphans are real.
--
--   select conname, conrelid::regclass as child, confrelid::regclass as parent,
--          confdeltype, pg_get_constraintdef(oid) as definition
--   from pg_constraint
--   where contype = 'f' and confrelid = 'public.provider_treatments'::regclass;
--
-- ── BLOCK E — the duplicate-row symptom, if BLOCK D says a/r ─────────────
--
--   select provider_id, category, count(*)
--   from public.provider_treatments
--   group by provider_id, category
--   having count(*) > 1
--   order by count(*) desc;
--
-- ===========================================================================


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- One paste per block, each ending in one select.
--
-- ── BLOCK F — the trigger exists and is enabled ──────────────────────────
--
--   select tgname, tgenabled
--   from pg_trigger
--   where tgrelid = 'public.provider_treatments'::regclass
--     and not tgisinternal;
--
-- ── BLOCK G — it actually strips. Rolls itself back. ─────────────────────
--
--   begin;
--     with p as (select id from public.providers limit 1),
--          t as (
--            insert into public.provider_treatments (provider_id, name, category)
--            select id, '__verify_0012', '__verify_0012' from p returning id, provider_id
--          )
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments)
--     select t.provider_id, current_date + 3650, '09:00', '10:00', array[t.id] from t;
--
--     delete from public.provider_treatments where name = '__verify_0012';
--
--     -- expect: one row, active_treatments = {}
--     select active_treatments, cardinality(active_treatments) as remaining
--     from public.availability where date = current_date + 3650;
--   rollback;
--
-- ── BLOCK H — BLOCK B above, which must now return zero rows ─────────────
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
--
-- Apply, verify, THEN run this. It compares every file against
-- public.schema_migrations and reports PENDING, DRIFTED, ORPHAN or SUPERSEDED.
--
-- Needs SUPABASE_SERVICE_ROLE_KEY in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
-- ===========================================================================

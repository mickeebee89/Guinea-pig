-- ===========================================================================
-- 0052_a_booking_remembers_its_price
--
-- The price a slot carried when it was booked, kept on the booking.
-- Audit item 83. Step 5 of the web apply flow.
--
-- ⚠️ Apply 0051 first.
--
-- ── WHY THE BOOKING NEEDS ITS OWN COPY ──────────────────────────────────
-- availability.price_pence (0050) is the stylist's CURRENT asking price, and
-- they can change it. A booking must remember what it said when it was
-- agreed, or editing a slot rewrites history for a treatment that already
-- happened — and the whole reason for showing a price before applying is that
-- the model can rely on it.
--
-- ── ⚠️ NO 18th PARAMETER, AND THAT IS A CHANGE OF PLAN ──────────────────
-- The plan said create_session_with_consent would gain an 18th argument with
-- a default. It does not, for three reasons found while writing it:
--
--   1. IT CANNOT BE DONE SAFELY. CREATE OR REPLACE cannot change an argument
--      list, so a defaulted 18th parameter is a NEW function — and then the
--      installed mobile app's 17-argument call matches BOTH, which Postgres
--      refuses as "function is not unique". The old one would have to be
--      dropped and its grants re-applied, to gain nothing.
--   2. THE CLIENT WOULD BE TELLING US THE PRICE. Anything passed as an
--      argument can be passed wrongly. The slot already knows.
--   3. OLD CLIENTS WOULD RECORD NOTHING. A trigger fills the column for every
--      caller, including the app build in Micky's hands and any that follow.
--
-- So the snapshot is taken by a BEFORE INSERT trigger, from the availability
-- row the booking already points at. Same approach as 0049's apply gate, for
-- the same reason: the rule belongs to the table, not to one caller.
--
-- ── WHAT "NO PRICE" MEANS, AND WHY NULL IS NOT ZERO ─────────────────────
-- A slot with no price snapshots as NULL: "not set — agree it in the chat",
-- which is how every booking worked before 0050 and still works now. NULL is
-- not £0. £0 is a stylist saying "free". Both clients already render them
-- differently and the column keeps them different.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.sessions') is null or to_regclass('public.availability') is null then
    raise exception '0052: sessions or availability is missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'availability' and column_name = 'price_pence'
  ) then
    raise exception '0052: availability.price_pence is missing — apply 0050 first, there would be nothing to copy.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'price_pence'
  ) then
    raise exception '0052: sessions.price_pence already exists. Read it before applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE COLUMN
--
-- Same shape and same range as the slot's, so a snapshot can never be a value
-- the slot itself could not have held.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column price_pence integer
  constraint sessions_price_pence_range check (price_pence between 0 and 10000);

comment on column public.sessions.price_pence is
  'What the slot was asking when this booking was made, in pence. NULL means the slot had no '
  'price and the cost is agreed in the chat; 0 means free. Copied from availability.price_pence '
  'by tg_session_price_snapshot, never supplied by a client. 0052, audit item 83.';

-- ---------------------------------------------------------------------------
-- THE SNAPSHOT
--
-- BEFORE INSERT, so it is part of the same row write — there is no window in
-- which a booking exists without its price.
--
-- It only fills a NULL. That leaves a path for an admin correction later
-- without this trigger stamping over it, and it means re-running a fixture
-- does not change what it is testing.
-- ---------------------------------------------------------------------------
create or replace function public.tg_session_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.price_pence is null and new.availability_id is not null then
    select a.price_pence into new.price_pence
    from public.availability a
    where a.id = new.availability_id;
  end if;
  return new;
end $$;

comment on function public.tg_session_price_snapshot() is
  'BEFORE INSERT on sessions (0052): copies the slot''s price onto the booking, so a later edit '
  'to the slot cannot rewrite what was agreed. Fills only a NULL.';

-- ⚠️ Name it so it sorts AFTER session_apply_gate (0049). Postgres fires
-- BEFORE triggers in alphabetical order, and a booking that is about to be
-- refused should not have work done for it first.
create trigger session_price_snapshot
  before insert on public.sessions
  for each row execute function public.tg_session_price_snapshot();

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0052', 'a_booking_remembers_its_price', 'bda83bb9f978f65e9d1a4cfc152fb8a60b8e58c9f54c554062988e5d7d1be775');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   1. Apply this migration.
--   2. Push the site — the apply flow reads and shows the snapshot.
--   3. Blocks A to C below.
--
--   The installed mobile app needs no change: the trigger fills the column
--   for its bookings too, without it knowing.
-- ===========================================================================
--
-- ── BLOCK A — the snapshot happens, and it is the SLOT's price. Rolls back ─
--
--   do $$
--   declare
--     v_me constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';  -- model test acct
--     v_prov uuid; v_treat uuid; v_priced uuid; v_free uuid; v_unset uuid;
--     v_a int; v_b int; v_c int;
--     v_got_priced int; v_got_free int; v_got_unset int;
--   begin
--     select p.id, t.id into v_prov, v_treat
--     from public.providers p
--     join public.provider_treatments t on t.provider_id = p.id
--     limit 1;
--     if v_prov is null then
--       raise exception 'ROLLED BACK. No provider with a treatment, so no booking can be built.';
--     end if;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments, price_pence)
--     values (v_prov, current_date + 500, '09:00', '10:00', array[v_treat::text], 2500) returning id into v_priced;
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments, price_pence)
--     values (v_prov, current_date + 500, '11:00', '12:00', array[v_treat::text], 0)    returning id into v_free;
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments)
--     values (v_prov, current_date + 500, '13:00', '14:00', array[v_treat::text])       returning id into v_unset;
--
--     insert into public.sessions (provider_id, model_id, model_user_id, availability_id, treatment_id,
--                                  date, start_time, end_time, scheduled_at, duration_minutes, location_type, status)
--     values (v_prov, v_me, v_me, v_priced, v_treat, current_date + 500, '09:00', '10:00',
--             (current_date + 500)::timestamptz + interval '9 hours', 60, 'provider', 'pending')
--     returning price_pence into v_got_priced;
--
--     insert into public.sessions (provider_id, model_id, model_user_id, availability_id, treatment_id,
--                                  date, start_time, end_time, scheduled_at, duration_minutes, location_type, status)
--     values (v_prov, v_me, v_me, v_free, v_treat, current_date + 500, '11:00', '12:00',
--             (current_date + 500)::timestamptz + interval '11 hours', 60, 'provider', 'pending')
--     returning price_pence into v_got_free;
--
--     insert into public.sessions (provider_id, model_id, model_user_id, availability_id, treatment_id,
--                                  date, start_time, end_time, scheduled_at, duration_minutes, location_type, status)
--     values (v_prov, v_me, v_me, v_unset, v_treat, current_date + 500, '13:00', '14:00',
--             (current_date + 500)::timestamptz + interval '13 hours', 60, 'provider', 'pending')
--     returning price_pence into v_got_unset;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n£25 slot  -> booking says: %  (must be 2500)\nfree slot -> booking says: %  (must be 0, NOT null)\nno price  -> booking says: %  (must be null, NOT 0)',
--       coalesce(v_got_priced::text, 'null'), coalesce(v_got_free::text, 'null'), coalesce(v_got_unset::text, 'null');
--   end $$;
--
--   These three lines are the whole feature: 2500, 0, null. A `0` on the third
--   would mean free and not-set have been merged, and every unpriced slot in
--   the product would start promising a free treatment.
--
--   ⚠️ Run this as the OWNER in the SQL editor. auth.uid() is null there, so
--   0049's apply gate lets the inserts through — this block is about the
--   snapshot, and Block C of 0049 is the one about the gate.
--
-- ── BLOCK B — a later edit to the slot does NOT move the booking. Rolls back ─
--
--   do $$
--   declare
--     v_me constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_prov uuid; v_treat uuid; v_slot uuid; v_sess uuid; v_before int; v_after int;
--   begin
--     select p.id, t.id into v_prov, v_treat
--     from public.providers p join public.provider_treatments t on t.provider_id = p.id limit 1;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments, price_pence)
--     values (v_prov, current_date + 501, '09:00', '10:00', array[v_treat::text], 1000) returning id into v_slot;
--
--     insert into public.sessions (provider_id, model_id, model_user_id, availability_id, treatment_id,
--                                  date, start_time, end_time, scheduled_at, duration_minutes, location_type, status)
--     values (v_prov, v_me, v_me, v_slot, v_treat, current_date + 501, '09:00', '10:00',
--             (current_date + 501)::timestamptz + interval '9 hours', 60, 'provider', 'pending')
--     returning id, price_pence into v_sess, v_before;
--
--     update public.availability set price_pence = 9000 where id = v_slot;
--     select price_pence into v_after from public.sessions where id = v_sess;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\nbooking at insert: %\nslot changed to £90, booking now: %  (must still be 1000)',
--       v_before, v_after;
--   end $$;
--
-- ── BLOCK C — what is out there. Read-only ─────────────────────────────
--
--   select
--     count(*)                                        as bookings,
--     count(*) filter (where price_pence is null)     as no_price,
--     count(*) filter (where price_pence = 0)         as free,
--     count(*) filter (where price_pence > 0)         as priced
--   from public.sessions;
--
--   Every EXISTING booking is no_price, and stays that way: the trigger fires
--   on insert only, and nothing backfills. A booking made before slots could
--   carry a price never had one, and inventing one now would be writing a
--   number nobody agreed to.

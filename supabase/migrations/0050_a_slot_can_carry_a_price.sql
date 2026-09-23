-- ===========================================================================
-- 0050_a_slot_can_carry_a_price
--
-- A stylist can say what a slot costs. Audit item 79. Decision: Micky,
-- 23 Sep 2026 — per SLOT, not per treatment. Step 2 of the web apply flow.
--
-- ⚠️ Apply 0049 first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────
-- A model cannot see what a session will cost until the chat opens, and the
-- chat opens only once she has been accepted (chat/[sessionId].tsx:407). So
-- she applies, waits, is chosen, and only then finds out. Meanwhile
-- /for-models publishes "what it costs — usually nothing — in the chat,
-- before you commit", and the commit point is the application.
--
-- Nothing in the product has ever held a price: provider_treatments has dead
-- `price` and `duration` columns that no client writes (provider/[id].tsx:182),
-- and the only mention of materials_cost in the repo records that the column
-- does not exist (chat/[sessionId].tsx:173).
--
-- ── WHY ON THE SLOT, AND WHAT THAT COSTS ────────────────────────────────
-- A slot carries SEVERAL treatments (availability.active_treatments is an
-- array), so a price on the slot cannot vary by which treatment the model
-- picks. That is the accepted trade: one price per slot, and the treatment
-- step must restate the same figure rather than look like it changes it.
-- Per slot-and-treatment would mean a join table and is not what was decided.
--
-- ── NULLABLE, WITH NO DEFAULT, ON PURPOSE ───────────────────────────────
-- Every slot that exists today has no price. A default of 0 would publish
-- "free" on behalf of every stylist who has never seen this feature, which is
-- a promise the product would be making for them. So:
--     null = not set   →  "Price not set — agree in the chat"
--     0    = free      →  "Free"
-- Those are different answers and the display must never merge them.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────
-- It does not put a price on a BOOKING. sessions has no price column and does
-- not gain one here: the snapshot belongs with the apply flow (step 5), so
-- that a stylist editing a slot afterwards cannot rewrite what was agreed.
-- Until then a booking still records nothing about cost, and Privacy's claim
-- that we hold "what it cost" (legal.ts:462) stays false.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.availability') is null then
    raise exception '0050: public.availability is missing.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'availability' and column_name = 'price_pence'
  ) then
    raise exception '0050: availability.price_pence already exists. Read it before applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE COLUMN
--
-- Pence, integer, like verification_payments.amount_pence — money in a float
-- is how £14.99 becomes £14.989999999999998. £0 to £100 as decided; the ceiling
-- is a guard against a typo turning £45 into £4500, not a business rule, and
-- it is stated in one place so both clients cannot disagree about it.
--
-- NULL passes the CHECK, which is what lets "not set" exist at all.
-- ---------------------------------------------------------------------------
alter table public.availability
  add column price_pence integer
  constraint availability_price_pence_range check (price_pence between 0 and 10000);

comment on column public.availability.price_pence is
  'What the stylist asks for this slot, in pence. NULL means not set (shown as "agree in the chat"); '
  '0 means free. Capped at 10000 (£100). Per slot, not per treatment: a slot can offer several '
  'treatments and they all carry this figure. An indication, not a payment — Cavy takes no money '
  'for treatments. 0050, audit item 79.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0050', 'a_slot_can_carry_a_price', '532794a971f7c097af25da505d9500b0eca1c36a9af28133638d9f1cc9aaf812');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   1. Apply this migration.
--   2. Push the site. The day editor and the slot list read the new column;
--      until the deploy lands, the web shows no prices and saves none.
--   3. Reload the app with `npx expo start -c --dev-client` — a stale Metro
--      bundle will not have the price field, and its saves would write slots
--      with no price at all.
--   4. Blocks A to C below.
-- ===========================================================================
--
-- ── BLOCK A — the column, and what it will and will not accept. Rolls back ─
--
--   do $$
--   declare
--     v_prov uuid; v_slot uuid;
--     v_too_high text; v_negative text; v_free text; v_null text;
--   begin
--     select id into v_prov from public.providers limit 1;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments)
--     values (v_prov, current_date + 400, '09:00', '10:00', '{}') returning id into v_slot;
--     v_null := 'accepted (correct — a slot with no price is the normal state today)';
--
--     begin
--       update public.availability set price_pence = 10001 where id = v_slot;
--       v_too_high := 'ACCEPTED <-- WRONG, the £100 cap is not holding';
--     exception when check_violation then v_too_high := 'refused (correct)';
--     end;
--
--     begin
--       update public.availability set price_pence = -1 where id = v_slot;
--       v_negative := 'ACCEPTED <-- WRONG';
--     exception when check_violation then v_negative := 'refused (correct)';
--     end;
--
--     update public.availability set price_pence = 0 where id = v_slot;
--     v_free := 'accepted (correct — 0 is free, and is not the same as not set)';
--
--     raise exception E'ROLLED BACK ON PURPOSE.\nno price:  %\n£100.01:   %\nnegative:  %\nfree (0):  %',
--       v_null, v_too_high, v_negative, v_free;
--   end $$;
--
-- ── BLOCK B — the stylist who owns the slot can set it; nobody else can.
--    Rolls itself back ────────────────────────────────────────────────────
--
-- The column inherits availability's existing policies — avail_write_own for
-- writes, avail_select "using (true)" for reads. That is worth SEEING rather
-- than assuming, because it is the difference between a stylist setting their
-- own price and anyone setting anyone's.
--
--   do $$
--   declare
--     v_prov uuid; v_owner uuid; v_other uuid; v_slot uuid;
--     v_own int; v_theirs int;
--   begin
--     select p.id, p.user_id into v_prov, v_owner
--     from public.providers p where p.user_id is not null limit 1;
--     select u.id into v_other from public.users u where u.id <> v_owner limit 1;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments)
--     values (v_prov, current_date + 401, '09:00', '10:00', '{}') returning id into v_slot;
--
--     execute format('set local role authenticated');
--
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_owner, 'role', 'authenticated')::text);
--     update public.availability set price_pence = 2500 where id = v_slot;
--     get diagnostics v_own = row_count;
--
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_other, 'role', 'authenticated')::text);
--     update public.availability set price_pence = 100 where id = v_slot;
--     get diagnostics v_theirs = row_count;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nowner set the price:      % row(s)  (must be 1)\nsomeone else set it:      % row(s)  (must be 0)',
--       v_own, v_theirs;
--   end $$;
--
-- ── BLOCK C — what is out there now. Read-only ─────────────────────────
--
--   select
--     count(*)                                          as slots_total,
--     count(*) filter (where price_pence is null)       as no_price_set,
--     count(*) filter (where price_pence = 0)           as free,
--     count(*) filter (where price_pence > 0)           as priced,
--     max(price_pence)                                  as highest_pence
--   from public.availability
--   where date >= current_date;
--
--   On the day this lands, every future slot should be no_price_set. That is
--   the correct starting state, not a fault: nothing has been decided on any
--   stylist's behalf.

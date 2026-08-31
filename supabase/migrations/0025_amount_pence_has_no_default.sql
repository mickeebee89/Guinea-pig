-- ===========================================================================
-- 0025_amount_pence_has_no_default
--
-- A price column must not have a default. Nobody was ever charged £2.99.
--
-- ⚠️ Apply 0014 and 0024 first.
--
-- ── WHAT THIS IS ─────────────────────────────────────────────────────────
-- `subscriptions.amount_pence` defaults to 299. The live price is 499 and has
-- been since Stripe went live on 17 Jul 2026. Verified by 0024's Block E: a
-- brand-new subscription created through apply_subscription_state recorded
-- `model_monthly / 299 / GBP / active` while Stripe charged £4.99.
--
-- ── WHY NOT JUST CHANGE THE DEFAULT TO 499 ───────────────────────────────
-- Because a default on a price column is a SECOND OWNER OF THE PRICE. Stripe
-- owns what was charged. A column default silently claims to know it too, and
-- nothing compares the two — the same shape as STRIPE_SECRET_KEY sitting beside
-- stripe_secret_key, and the two Cloudflare accounts.
--
-- Correcting 299 to 499 fixes today's number and keeps the trap: the day the
-- price changes, the default is wrong again and nothing says so. It also cannot
-- be right in principle. Founding providers pay nothing, comped accounts pay
-- nothing, and any future plan charges something else — so there is no single
-- number this column can assume and be correct.
--
-- NULL means "we did not record what was charged". That is true, visible, and
-- greppable. 299 means "we charged £2.99", which is false. A billing column
-- should never hold a number nobody was charged.
--
-- ── WHY NULLABLE AND NOT JUST DEFAULT-LESS ───────────────────────────────
-- 0024's ASSERT 1 fails the migration if any NOT NULL column has no default and
-- is not supplied by apply_subscription_state. Dropping the default while
-- keeping NOT NULL would therefore require every caller to supply an amount —
-- including the ones that legitimately do not know it, such as expiring a
-- subscription or recording a cancellation. Those are exactly the paths where
-- inventing a number does the most harm.
--
-- The callers that DO know the amount already pass it, read from the Stripe
-- price object: confirm_subscription and sync_subscription both send
-- `price?.unit_amount`. Nothing is lost.
--
-- ── EXISTING ROWS ARE LEFT ALONE ─────────────────────────────────────────
-- Deliberately. A stored 299 might be a real £2.99 charge from before the price
-- moved, or it might be this default firing. From inside the database those are
-- indistinguishable, and overwriting them with null would destroy a real figure
-- to tidy up a fake one. Stripe knows which is which; `reconcile_audit` is the
-- tool that asks. Recorded as an open question rather than guessed at.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — what is stored today, and how much of it is suspect.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0025', 'amount_pence_' || coalesce(amount_pence::text, 'null'), count(*)::text
from public.subscriptions group by amount_pence;

insert into public.migration_findings (version, item, value)
select '0025', 'amount_pence_default_before',
       coalesce(
         (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'subscriptions'
             and column_name = 'amount_pence'),
         'NONE');

insert into public.migration_findings (version, item, value)
select '0025', 'amount_pence_nullable_before',
       coalesce(
         (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'subscriptions'
             and column_name = 'amount_pence'),
         'COLUMN NOT FOUND');

-- ---------------------------------------------------------------------------
-- ASSERT — the column must exist and be what we think it is.
--
-- Small, but the reason it is here is 0023: that migration created a function
-- against a table it had never read, and this is the cheapest possible version
-- of not doing that again.
-- ---------------------------------------------------------------------------
do $$
declare v_type text;
begin
  select data_type into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'subscriptions'
     and column_name = 'amount_pence';

  if v_type is null then
    raise exception '0025: subscriptions.amount_pence does not exist. Nothing to alter.';
  end if;
  if v_type not in ('integer', 'bigint', 'smallint') then
    raise exception
      '0025: subscriptions.amount_pence is %, not an integer type. This migration '
      'assumes a pence integer; look before altering it.', v_type;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The change.
-- ---------------------------------------------------------------------------
alter table public.subscriptions alter column amount_pence drop default;
alter table public.subscriptions alter column amount_pence drop not null;

comment on column public.subscriptions.amount_pence is
  'What was actually charged, in pence, read from the Stripe price object by '
  'confirm_subscription and sync_subscription. NULL means we did not record it — '
  'which is true and visible. It had a DEFAULT of 299 until 0025, so a new row '
  'created through any path that did not supply an amount recorded a £2.99 charge '
  'that never happened, against a live price of £4.99. A default on a price column '
  'is a second owner of the price: Stripe owns what was charged, and nothing was '
  'comparing the two. Existing 299 rows are left alone because a real £2.99 charge '
  'and the default firing are indistinguishable from inside the database.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0025', 'amount_pence_has_no_default', '0cab6974f65dc5f0f7052305afc5cee30a96dd8feccd3f25e3ac094843a19abf');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Nothing below the footer affects the checksum.
-- Written for the Supabase SQL editor: one self-contained statement per check,
-- no temp tables, no session state carried between statements.
--
-- ── BLOCK A — the default is gone and the column is nullable ────────────
--
--   select column_name, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'subscriptions'
--     and column_name = 'amount_pence';
--
--   Expect is_nullable = YES, column_default = null.
--
-- ── BLOCK B — a new row with no amount records nothing, not £2.99 ───────
--
--   Two steps, because a single block that derives the id twice would exclude
--   the row it just created (see 0024 Block E and the rules in
--   scripts/migration-status.mjs).
--
--   Step 1 — pick an id and COPY IT:
--
--     select id from public.users
--     where id not in (select user_id from public.subscriptions) limit 1;
--
--   Step 2 — paste it into both places and run as one statement:
--
--     begin;
--       select public.apply_subscription_state('<PASTE-ID>'::uuid, 'active');
--       select amount_pence, currency_code, plan
--       from public.subscriptions where user_id = '<PASTE-ID>'::uuid;
--     rollback;
--
--   Expect amount_pence to be NULL. If it is 299 the default is still there.
--
-- ── BLOCK C — a real subscribe still records the real amount ────────────
--
--   The point is to stop inventing a figure, not to stop recording one.
--   Subscribe on a test account, then:
--
--     select user_id, amount_pence, currency_code
--     from public.subscriptions order by current_period_start desc limit 3;
--
--   Expect 499 on the new row, read from the Stripe price. A null here would
--   mean confirm_subscription stopped passing p_amount_pence, which would be a
--   regression rather than the intended behaviour.
--
-- ── BLOCK D — the open question this migration does NOT answer ──────────
--
--   select amount_pence, count(*) from public.subscriptions group by amount_pence;
--
--   Any 299 rows are ambiguous: a real £2.99 charge from before the price moved,
--   or this default firing. The database cannot tell. Stripe can — run
--   reconcile_audit from the admin Revenue page and compare against the actual
--   charges before treating any 299 as real.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

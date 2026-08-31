-- ===========================================================================
-- 0024_subscription_writes_read_the_table_first
--
-- Replaces apply_subscription_state. 0023 created it against a table it had
-- never looked at.
--
-- ⚠️ Apply 0014 and 0023 first.
--
-- ── SAY IT PLAINLY: 0023 WAS THE MIGRATION WRITTEN TO STOP GUESSING ──────
-- Its header says so. It exists because `users.subscription_status` rejected a
-- value the code had assumed, and its answer was to go and read the constraint
-- rather than guess a second time. That part worked: it probed the live
-- constraint, recorded the definition in migration_findings, and used what it
-- found.
--
-- Then it guessed the whole of a different table.
--
--   * `subscriptions.plan` is NOT NULL. The function passed null, so the
--     repair failed with 23502 on the first run.
--   * `plan`, `amount_pence` and `currency_code` all have column DEFAULTS. The
--     function named them explicitly and passed nulls, which defeats a default
--     that was already correct.
--
-- The probe covered ONE COLUMN of one table. Proving `users.subscription_status`
-- and then assuming the shape of `subscriptions` is not "reading the schema" —
-- it is guessing with one worked example in front of it, which reads as
-- diligence and is not. A migration that had actually read the table would have
-- listed its columns, and this one does.
--
-- ── WHAT THE ANSWERS TURNED OUT TO BE ────────────────────────────────────
-- Recorded here because they were not in this repo before 31 Aug 2026:
--
--   users_subscription_status_check permits:
--     none, trialling, active, cancelled, cancelling
--   It does NOT permit 'expired' or 'free'. 'free' is what the code wrote for
--   weeks, without checking the error.
--
--   subscriptions.user_id IS unique, so `on conflict (user_id)` was correct.
--   The 23502 fired because INSERT ... ON CONFLICT DO UPDATE still evaluates
--   NOT NULL on the proposed row before conflict arbitration — the update would
--   have been taken, and never got the chance.
--
--   subscriptions.plan held two values for the same thing: 'monthly' (six rows,
--   written by confirm_subscription and sync_subscription) and 'model_monthly'
--   (six rows, the column default). NOTHING READS THE COLUMN. Same
--   one-thing-two-names family as location/location_text.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
-- 1. The INSERT names only the columns it has values for. Defaulted columns are
--    omitted entirely so their defaults apply, instead of being overwritten
--    with null.
-- 2. plan/amount_pence/currency_code are touched only when a caller actually
--    supplies them, in the same function body and therefore the same
--    transaction.
-- 3. 'model_monthly' becomes canonical and the six 'monthly' rows are
--    normalised. Nothing reads the column, so no behaviour changes; this closes
--    a two-names-one-thing trap while it is still twelve rows of test data.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — put the table's actual shape in the repo. It has never been here.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0024', 'column_' || lpad(ordinal_position::text, 2, '0') || '_' || column_name,
       data_type || ' | nullable=' || is_nullable || ' | default=' || coalesce(column_default, 'NONE')
from information_schema.columns
where table_schema = 'public' and table_name = 'subscriptions';

insert into public.migration_findings (version, item, value)
select '0024', 'constraint_' || conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.subscriptions'::regclass;

insert into public.migration_findings (version, item, value)
select '0024', 'plan_' || coalesce(plan, 'null'), count(*)::text
from public.subscriptions group by plan;

-- ---------------------------------------------------------------------------
-- ASSERT 1 — every NOT NULL column must be supplied or defaulted.
--
-- This is the check that would have caught 0023's bug before it ran. If a
-- column is NOT NULL, has no default, and is not one the function supplies,
-- the INSERT path cannot work — and the failure would land on whoever next
-- cancels a subscription, not on whoever added the column.
-- ---------------------------------------------------------------------------
do $$
declare v_unsupplied text;
begin
  select string_agg(column_name, ', ' order by ordinal_position)
    into v_unsupplied
  from information_schema.columns
  where table_schema = 'public' and table_name = 'subscriptions'
    and is_nullable = 'NO'
    and column_default is null
    and column_name not in (
      -- exactly what apply_subscription_state names in its INSERT
      'user_id', 'status', 'stripe_customer_id', 'stripe_subscription_id',
      'current_period_start', 'current_period_end'
    );

  if v_unsupplied is not null
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0024: subscriptions has NOT NULL column(s) with no default that '
      'apply_subscription_state does not supply: %. The insert path would fail with '
      '23502 the next time a subscription is created. Add them to the function or give '
      'them defaults. See migration_findings for 0024.', v_unsupplied;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ASSERT 2 — `on conflict (user_id)` needs a unique constraint to arbitrate on.
--
-- Without one this function would silently create a second subscriptions row
-- per user on every write, rather than repairing the existing one.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and contype in ('u', 'p')
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.subscriptions'::regclass and attname = 'user_id'
      )]::smallint[]
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'subscriptions'
      and indexdef ilike '%unique%(user_id)%'
  ) then
    raise exception
      '0024: no unique constraint or index on subscriptions.user_id, so '
      '`on conflict (user_id)` cannot arbitrate and every write would insert a '
      'duplicate row instead of repairing the existing one.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. One canonical plan name.
--
-- Safe because nothing reads the column: the only writers set 'monthly' and
-- they stop doing so in this change, and no reader exists in mobile, site,
-- admin or any edge function. Counts are recorded above, so this is reversible.
-- ---------------------------------------------------------------------------
update public.subscriptions set plan = 'model_monthly' where plan = 'monthly';

comment on column public.subscriptions.plan is
  'Canonical value: model_monthly, which is also the column default. Held two '
  'names for one thing until 0024 — ''monthly'' from confirm_subscription and '
  'sync_subscription, ''model_monthly'' from the default — with no reader '
  'anywhere to notice the disagreement. Callers no longer write it at all; the '
  'default owns it. Named model_ rather than just monthly to leave room for a '
  'provider plan.';

-- ---------------------------------------------------------------------------
-- 2. The function, written against the columns that actually exist.
--
-- Signature is unchanged from 0023 so `create or replace` applies in place and
-- every caller keeps working.
-- ---------------------------------------------------------------------------
create or replace function public.apply_subscription_state(
  p_user_id         uuid,
  p_status          text,               -- active | cancelling | past_due | expired
  p_customer_id     text default null,
  p_subscription_id text default null,
  p_period_start    timestamptz default null,
  p_period_end      timestamptz default null,
  p_amount_pence    int  default null,
  p_currency_code   text default null,
  p_plan            text default null
) returns void
language plpgsql
security definer
set search_path = public
as $body$
declare v_user_status text;
begin
  if p_status not in ('active', 'cancelling', 'past_due', 'expired') then
    raise exception 'apply_subscription_state: unknown status %', p_status;
  end if;

  -- users_subscription_status_check permits exactly:
  --   none, trialling, active, cancelled, cancelling
  -- It does NOT permit 'expired' — which is why this maps rather than passing
  -- p_status through — and it does not permit 'free', which is what the code
  -- wrote unchecked for weeks. 'none' is the not-paying value.
  --
  -- past_due still IS a live membership: access runs to current_period_end
  -- while Stripe retries, so Settings must not show it as anything else.
  v_user_status := case
    when p_status = 'expired'  then 'none'
    when p_status = 'past_due' then 'active'
    else p_status
  end;

  -- plan, amount_pence and currency_code are DELIBERATELY ABSENT from this
  -- column list. All three have defaults; naming them and passing null is what
  -- broke 0023, and a default that is already correct should not be argued
  -- with. They are set below, only when a caller actually has a value.
  insert into public.subscriptions as s (
    user_id, status, stripe_customer_id, stripe_subscription_id,
    current_period_start, current_period_end
  )
  values (
    p_user_id, p_status, p_customer_id, p_subscription_id,
    p_period_start, p_period_end
  )
  on conflict (user_id) do update set
    status                 = excluded.status,
    -- coalesce so a partial update never blanks something already stored.
    stripe_customer_id     = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, s.stripe_subscription_id),
    current_period_start   = coalesce(excluded.current_period_start, s.current_period_start),
    current_period_end     = coalesce(excluded.current_period_end, s.current_period_end);

  if p_amount_pence is not null or p_currency_code is not null or p_plan is not null then
    update public.subscriptions
       set amount_pence  = coalesce(p_amount_pence,  amount_pence),
           currency_code = coalesce(p_currency_code, currency_code),
           plan          = coalesce(p_plan,          plan)
     where user_id = p_user_id;
  end if;

  update public.users
     set subscription_status       = v_user_status,
         subscription_next_billing = case when p_status = 'expired' then null else p_period_end end
   where id = p_user_id;

  -- Every statement above is in this one function body, so they share a
  -- transaction. A violation on the users UPDATE rolls back the subscriptions
  -- write with it. That is the whole point: on 31 Aug 2026 three accounts ended
  -- up 'expired' in one table and 'active' in the other because two independent
  -- statements were used and only one succeeded.
end $body$;

comment on function public.apply_subscription_state(uuid, text, text, text, timestamptz, timestamptz, int, text, text) is
  'The only supported way to change subscription state. Writes public.subscriptions '
  'and public.users in one transaction so they cannot disagree. Written against the '
  'table''s actual column list and nullability (recorded in migration_findings for '
  '0024) after 0023 created it against a table it had never read.';

revoke execute on function public.apply_subscription_state(uuid, text, text, text, timestamptz, timestamptz, int, text, text) from public, anon, authenticated;
grant  execute on function public.apply_subscription_state(uuid, text, text, text, timestamptz, timestamptz, int, text, text) to service_role;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0024', 'subscription_writes_read_the_table_first', '65cfd8d9ee0633917dafdc57eb7d763bbc09f2e2e50809c1249ed065039f1bf4');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Nothing below the footer affects the checksum.
--
-- ── BLOCK A — repair the three split rows ───────────────────────────────
--
--   This is what failed on the first attempt. Run as service_role.
--
--   select public.apply_subscription_state(u.id, 'expired')
--   from public.users u
--   join public.subscriptions s on s.user_id = u.id
--   where s.status = 'expired'
--     and u.subscription_status in ('active', 'cancelling');
--
--   Then confirm none are left:
--
--   select u.email, s.status as sub_status, u.subscription_status, s.plan
--   from public.subscriptions s join public.users u on u.id = s.user_id
--   where s.status = 'expired' and u.subscription_status in ('active', 'cancelling');
--
--   Expect 0 rows. The three should now read sub_status 'expired',
--   subscription_status 'none', plan 'model_monthly'.
--
-- ── BLOCK B — no duplicate rows were created ────────────────────────────
--
--   select user_id, count(*) from public.subscriptions
--   group by user_id having count(*) > 1;
--
--   Expect 0 rows. If this returns anything, the conflict target is not
--   arbitrating and ASSERT 2 passed on an index that does not do what it looks
--   like it does.
--
-- ── BLOCK C — one plan name ─────────────────────────────────────────────
--
--   select plan, count(*) from public.subscriptions group by plan;
--
--   Expect model_monthly only.
--
-- ── BLOCK D — atomicity still holds ─────────────────────────────────────
--
--   begin;
--     select public.apply_subscription_state(
--       (select id from public.users limit 1), 'not_a_real_status');
--   rollback;
--
--   Expect 'apply_subscription_state: unknown status not_a_real_status' and
--   nothing written to either table.
--
-- ── BLOCK E — the defaults own the insert path ──────────────────────────
--
--   A brand-new subscription must get its column defaults, not nulls.
--
--   NOT written as a single self-contained block on purpose: the obvious
--   version selects a user `not in (select user_id from subscriptions)`,
--   inserts a row for them, then re-evaluates the same subquery — which now
--   excludes the row it just created and returns nothing. That reads as a
--   failure and is not. It was written that way once; see the VERIFY-block
--   rules in scripts/migration-status.mjs.
--
--   Step 1 — pick an id and COPY IT:
--
--     select id from public.users
--     where id not in (select user_id from public.subscriptions) limit 1;
--
--   Step 2 — paste that id into both places below and run as one statement:
--
--     begin;
--       select public.apply_subscription_state('<PASTE-ID>'::uuid, 'active');
--       select plan, amount_pence, currency_code, status
--       from public.subscriptions where user_id = '<PASTE-ID>'::uuid;
--     rollback;
--
--   Expect the column defaults rather than nulls. A 23502 here means a NOT NULL
--   column with no default is still unsupplied and ASSERT 1 failed to catch it.
--
--   ⚠️ amount_pence defaults to 299 — £2.99, while Stripe charges £4.99. That is
--   a wrong number in a billing column and is being decided separately; nothing
--   reads it today.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

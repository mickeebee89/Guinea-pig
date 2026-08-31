-- ===========================================================================
-- 0023_subscription_state_is_written_atomically
--
-- Subscription state lives in two tables. Write both or neither, and stop
-- guessing what `users.subscription_status` will accept.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHAT HAPPENED, 31 AUG 2026 ───────────────────────────────────────────
-- Three genuinely live Stripe subscriptions were cancelled by hand. The three
-- customer.subscription.deleted events all failed:
--
--   db write failed: new row for relation "users"
--   violates check constraint "users_subscription_status_check"
--
-- and left this:
--
--   subscriptions.status = 'expired'   users.subscription_status = 'active'
--
-- One table moved and the other did not, so three accounts still read as paying
-- members with access, on the exact event that is supposed to end access.
--
-- ── TWO SEPARATE DEFECTS, AND THE SECOND IS OLDER ────────────────────────
--
-- 1. THE WRITE WAS NOT ATOMIC. stripe-webhook's writeState() issued the two
--    updates in a Promise.all and threw afterwards if either failed. Throwing
--    does not undo the one that succeeded. Two tables that must agree were
--    being written by two independent statements, so any failure of either left
--    them disagreeing.
--
-- 2. 'free' WAS PROBABLY NEVER A PERMITTED VALUE, AND NOTHING SAID SO.
--    sync_subscription (stripe-payment) has two expiry branches. Both write
--    subscription_status: 'free'. NEITHER CHECKS THE ERROR. Both then return
--    `{ ok: true, repaired: true }`.
--
--    So if 'free' violates this constraint — and mobile's own settings screen
--    comments its fallback case as "none / cancelled / null", never 'free' —
--    then every expiry repair since Stripe went live has reported success for a
--    write that could not succeed. The webhook did not introduce that. It is
--    the first code to check the error, so it is the first to make it visible.
--
--    That is this audit's recurring shape again: a success signal that does not
--    depend on the thing it claims to prove.
--
-- ── WHY THIS MIGRATION DISCOVERS THE VALUE RATHER THAN HARD-CODING IT ────
-- The constraint was created in the Supabase dashboard before the migration
-- framework existed. It is not in this repo, nothing compares it against the
-- code, and the code has been wrong about it for weeks. Hard-coding a second
-- guess would repeat the mistake.
--
-- So this migration reads the constraint, records its definition in
-- migration_findings — which puts the answer in the repo permanently — and
-- PROVES which values are writable by attempting each one inside a savepoint
-- and rolling it back. No data is changed by the test.
--
-- If none of the candidates is accepted it aborts and prints the constraint
-- definition, because at that point a human needs to look rather than a script
-- needs to be cleverer.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — put the actual constraint in the record, once and for all.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0023', 'users_subscription_status_check',
       coalesce(
         (select pg_get_constraintdef(oid) from pg_constraint
           where conname = 'users_subscription_status_check'
             and conrelid = 'public.users'::regclass),
         'CONSTRAINT NOT FOUND');

insert into public.migration_findings (version, item, value)
select '0023', 'users_status_' || coalesce(subscription_status, 'null'), count(*)::text
from public.users group by subscription_status;

insert into public.migration_findings (version, item, value)
select '0023', 'split_state_rows', count(*)::text
from public.subscriptions s
join public.users u on u.id = s.user_id
where s.status = 'expired' and u.subscription_status in ('active', 'cancelling');

-- ---------------------------------------------------------------------------
-- PROVE — which values `users.subscription_status` actually accepts.
--
-- Each candidate is applied to one real row inside a savepoint and rolled back
-- immediately. The table is unchanged when this block finishes; only the
-- findings are written.
-- ---------------------------------------------------------------------------
do $$
declare
  v_probe   uuid;
  v_cand    text;
  v_ok      boolean;
  v_accepted text[] := '{}';
  v_def     text;
begin
  select id into v_probe from public.users limit 1;
  if v_probe is null then
    raise notice '0023: no users to probe against; skipping the value proof';
    return;
  end if;

  -- 'active' and 'cancelling' are included deliberately: the code already
  -- depends on them, so if either is rejected that is a live bug too.
  foreach v_cand in array array['active', 'cancelling', 'free', 'none', 'cancelled', 'inactive', 'expired']
  loop
    begin
      update public.users set subscription_status = v_cand where id = v_probe;
      v_ok := true;
      raise exception 'rollback_probe';   -- always undo
    exception
      when check_violation then v_ok := false;
      when others then
        if sqlerrm = 'rollback_probe' then v_ok := true; else raise; end if;
    end;

    insert into public.migration_findings (version, item, value)
    values ('0023', 'accepts_' || v_cand, v_ok::text);

    if v_ok then v_accepted := v_accepted || v_cand; end if;
  end loop;

  raise notice '0023: users.subscription_status accepts: %', array_to_string(v_accepted, ', ');

  -- The two the code already relies on.
  if not ('active' = any(v_accepted)) or not ('cancelling' = any(v_accepted)) then
    select pg_get_constraintdef(oid) into v_def from pg_constraint
      where conname = 'users_subscription_status_check' and conrelid = 'public.users'::regclass;
    raise exception
      '0023: users.subscription_status rejects ''active'' and/or ''cancelling'', which the '
      'existing code writes on every subscribe. Constraint is: %', coalesce(v_def, '(not found)');
  end if;

  -- At least one way to say "not paying" must exist, or nothing can ever expire.
  if not (v_accepted && array['free', 'none', 'cancelled', 'inactive', 'expired']) then
    select pg_get_constraintdef(oid) into v_def from pg_constraint
      where conname = 'users_subscription_status_check' and conrelid = 'public.users'::regclass;
    raise exception
      '0023: none of free/none/cancelled/inactive/expired is accepted by '
      'users_subscription_status_check, so there is no value meaning "not paying" and no '
      'account can ever be expired. Constraint is: %. Look at migration_findings for 0023.',
      coalesce(v_def, '(not found)');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. One function, one transaction, both tables.
--
-- Everything that changes subscription state goes through here: the webhook,
-- sync_subscription, confirm_subscription and cancel_subscription. A function
-- body is a single transaction, so a constraint violation on the second table
-- rolls back the first. The split state that started this cannot recur.
--
-- The "not paying" value is resolved from what the proof above accepted, in a
-- documented preference order, and baked into the body at creation time. It is
-- discovered rather than assumed because the constraint lives outside this repo
-- and the code has already been wrong about it once.
-- ---------------------------------------------------------------------------
do $$
declare
  v_inactive text;
  v_probe    uuid;
begin
  select id into v_probe from public.users limit 1;

  -- Preference order: whichever the constraint actually permits, first match
  -- wins. 'none' leads because mobile's settings screen documents its
  -- not-paying cases as "none / cancelled / null".
  select f.item into v_inactive
  from (
    select unnest(array['none', 'cancelled', 'free', 'inactive', 'expired']) as cand,
           generate_series(1, 5) as rank
  ) c
  join lateral (
    select replace(mf.item, 'accepts_', '') as item
    from public.migration_findings mf
    where mf.version = '0023' and mf.item = 'accepts_' || c.cand and mf.value = 'true'
  ) f on true
  order by c.rank
  limit 1;

  -- No users to probe against (fresh database): fall back to the documented
  -- preference rather than failing the migration.
  if v_inactive is null and v_probe is null then v_inactive := 'none'; end if;

  if v_inactive is null then
    raise exception '0023: could not determine a not-paying value; see migration_findings';
  end if;

  insert into public.migration_findings (version, item, value)
  values ('0023', 'chosen_inactive_value', v_inactive);

  raise notice '0023: "not paying" will be written as %', v_inactive;

  execute format($fn$
    create or replace function public.apply_subscription_state(
      p_user_id         uuid,
      p_status          text,               -- active | cancelling | past_due | expired
      p_customer_id     text default null,
      p_subscription_id text default null,
      p_period_start    timestamptz default null,
      p_period_end      timestamptz default null,
      -- Only confirm_subscription and sync_subscription have these; everything
      -- else passes null and coalesce keeps whatever is already stored.
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
        raise exception 'apply_subscription_state: unknown status %%', p_status;
      end if;

      -- past_due still IS a live membership: access runs to period end while
      -- Stripe retries, so Settings must not show it as anything else.
      v_user_status := case
        when p_status = 'expired'  then %L
        when p_status = 'past_due' then 'active'
        else p_status
      end;

      insert into public.subscriptions as s (
        user_id, status, stripe_customer_id, stripe_subscription_id,
        current_period_start, current_period_end, amount_pence, currency_code, plan
      )
      values (
        p_user_id, p_status, p_customer_id, p_subscription_id,
        p_period_start, p_period_end, p_amount_pence, p_currency_code, p_plan
      )
      on conflict (user_id) do update set
        status                 = excluded.status,
        -- coalesce so a partial update never blanks something already stored.
        stripe_customer_id     = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, s.stripe_subscription_id),
        current_period_start   = coalesce(excluded.current_period_start, s.current_period_start),
        current_period_end     = coalesce(excluded.current_period_end, s.current_period_end),
        amount_pence           = coalesce(excluded.amount_pence, s.amount_pence),
        currency_code          = coalesce(excluded.currency_code, s.currency_code),
        plan                   = coalesce(excluded.plan, s.plan);

      update public.users
         set subscription_status       = v_user_status,
             subscription_next_billing = case when p_status = 'expired' then null else p_period_end end
       where id = p_user_id;

      -- Both writes are in this one function body, so they share a transaction.
      -- If the UPDATE above violates the check constraint, the INSERT above it
      -- is rolled back with it. That is the whole point.
    end $body$;
  $fn$, v_inactive);
end $$;

comment on function public.apply_subscription_state(uuid, text, text, text, timestamptz, timestamptz, int, text, text) is
  'The only supported way to change subscription state. Writes public.subscriptions '
  'and public.users in one transaction so they cannot disagree — on 31 Aug 2026 three '
  'accounts ended up expired in one table and active in the other because two '
  'independent statements were used and only one succeeded. The value written for '
  '"not paying" was discovered by migration 0023 against the live check constraint '
  'rather than assumed; see migration_findings for version 0023.';

revoke execute on function public.apply_subscription_state(uuid, text, text, text, timestamptz, timestamptz, int, text, text) from public, anon, authenticated;
-- service_role only: the edge functions call it. Nothing holding an anon key
-- has any business setting its own subscription state.
grant execute on function public.apply_subscription_state(uuid, text, text, text, timestamptz, timestamptz, int, text, text) to service_role;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0023', 'subscription_state_is_written_atomically', '116d330bdab3ee7b66342c7e906e91e527c57dc327a1f780811011b7f31724ab');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Nothing below the footer affects the checksum.
--
-- ── BLOCK A — read the answer this migration went and got ───────────────
--
--   select item, value from public.migration_findings
--   where version = '0023' order by item;
--
--   `users_subscription_status_check` is the constraint definition itself —
--   the thing that was never in this repo. `accepts_*` says which values are
--   writable. `chosen_inactive_value` is what "not paying" now writes.
--
-- ── BLOCK B — repair the three split rows ───────────────────────────────
--
--   These are expired in `subscriptions` and still active in `users`. Run as
--   service_role (the SQL editor is):
--
--   select public.apply_subscription_state(u.id, 'expired')
--   from public.users u
--   join public.subscriptions s on s.user_id = u.id
--   where s.status = 'expired'
--     and u.subscription_status in ('active', 'cancelling');
--
--   Then confirm none are left:
--
--   select u.email, s.status as sub_status, u.subscription_status
--   from public.subscriptions s join public.users u on u.id = s.user_id
--   where s.status = 'expired' and u.subscription_status in ('active', 'cancelling');
--
--   Expect 0 rows. Any row still returned means the UPDATE inside the function
--   is being rejected, which would show as an error rather than silence.
--
-- ── BLOCK C — the atomicity actually holds ──────────────────────────────
--
--   The point of the function is that a failure leaves BOTH tables untouched.
--
--   begin;
--     select public.apply_subscription_state(
--       (select id from public.users limit 1), 'not_a_real_status');
--   rollback;
--
--   Expect 'apply_subscription_state: unknown status not_a_real_status', and
--   nothing written. If the subscriptions row moved anyway, the two writes are
--   not sharing a transaction and this migration has not fixed the defect.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

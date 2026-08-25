-- ===========================================================================
-- 0022_stripe_webhook_events
--
-- A record of every Stripe event we receive, so the webhook's silence can be
-- told apart from its success.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHY A TABLE AND NOT JUST LOGS ────────────────────────────────────────
-- The endpoint URL and the signing secret are configured in the Stripe
-- dashboard and the Supabase dashboard. Neither is in this repo, nothing
-- compares them, and a webhook that was never registered behaves exactly like
-- one that is registered and simply has nothing to deliver: no errors, no rows,
-- no difference. That is the same shape as the cron install script that still
-- contains <YOUR-RANDOM-CRON-SECRET>, and as STRIPE_SECRET_KEY sitting beside
-- stripe_secret_key with only one of them ever read.
--
-- So the webhook records what it receives, and the admin Revenue page shows
-- when the last event arrived. "Nothing has come in since you set this up" is
-- then a visible fact rather than an absence nobody can see.
--
-- ── IDEMPOTENCY COMES FROM THE PRIMARY KEY ───────────────────────────────
-- Stripe retries on any non-2xx and can deliver the same event more than once
-- regardless. `id` is Stripe's own event id and it is the primary key, so a
-- duplicate delivery fails the INSERT with 23505 and the handler returns 200
-- without reprocessing. The uniqueness constraint IS the idempotency
-- mechanism — there is no separate check that could drift from it.
--
-- ── WHAT IS DELIBERATELY NOT STORED ──────────────────────────────────────
-- No payloads. A Stripe event carries customer email, card brand, last four
-- and billing address; none of that is needed to answer "did this arrive and
-- what did we do about it", and storing it would quietly create a second copy
-- of payment data inside a database whose retention policy says nothing about
-- one. Type, outcome, the affected user and a short human note only.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — what subscription statuses actually exist today.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0022', 'subscription_status_' || coalesce(status, 'null'), count(*)::text
from public.subscriptions group by status;

insert into public.migration_findings (version, item, value)
select '0022', 'users_subscription_status_' || coalesce(subscription_status, 'null'), count(*)::text
from public.users group by subscription_status;

-- ---------------------------------------------------------------------------
-- ASSERT — the status vocabulary must be closed.
--
-- The webhook maps Stripe's status onto ours, and both gates decide access
-- with `['active','cancelling'].includes(status)` — plus 'past_due' from this
-- work onward. Every one of those is a list written by hand in three places.
-- A status already in the table that none of them names is a row that silently
-- means "no access" everywhere, which is the wrong direction to fail by
-- accident.
--
-- If this fires, look at migration_findings for 0022 before overriding: the
-- answer is usually to add the value to the gates, not to wave it through.
--   set local cavy.migration_override = 'yes';
-- ---------------------------------------------------------------------------
do $$
declare v_unknown text;
begin
  select string_agg(distinct coalesce(status, 'NULL'), ', ')
    into v_unknown
  from public.subscriptions
  where status is null
     or status not in ('active', 'cancelling', 'past_due', 'expired');

  if v_unknown is not null
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0022 found subscription status values nothing handles: %. Both access gates '
      'and the new webhook decide on a hand-written list, so a status none of them '
      'names grants nobody access and nothing reports it. Look at migration_findings '
      'for 0022, then re-run with: set local cavy.migration_override = ''yes'';', v_unknown;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The record.
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_webhook_events (
  -- Stripe's event id (evt_...). Primary key on purpose — see the header.
  id            text primary key,
  type          text not null,
  received_at   timestamptz not null default now(),
  -- 'processed'  we understood it and wrote something
  -- 'ignored'    valid, signed, but not an event this handler acts on
  -- 'failed'     we tried and could not; `detail` says why
  outcome       text not null check (outcome in ('processed', 'ignored', 'failed')),
  -- Who it was about, when we could work that out. ON DELETE SET NULL so the
  -- record survives the account, matching how `reports` is treated in 0004.
  user_id       uuid references auth.users(id) on delete set null,
  detail        text
);

create index if not exists stripe_webhook_events_received_idx
  on public.stripe_webhook_events (received_at desc);

create index if not exists stripe_webhook_events_failed_idx
  on public.stripe_webhook_events (received_at desc)
  where outcome = 'failed';

comment on table public.stripe_webhook_events is
  'One row per Stripe event received. Exists so a webhook that was never '
  'registered can be told apart from one that is registered and quiet — the '
  'endpoint and signing secret live in two dashboards, outside this repo, with '
  'nothing comparing them. No payloads are stored: type, outcome, user and a '
  'short note only.';

alter table public.stripe_webhook_events enable row level security;

-- Admin read only. The function writes with the service-role key, which
-- bypasses RLS, so no INSERT policy is needed and none should exist — nothing
-- holding an anon key has any business writing here.
drop policy if exists stripe_webhook_events_read_admin on public.stripe_webhook_events;
create policy stripe_webhook_events_read_admin
  on public.stripe_webhook_events as permissive for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. "Is this thing on?" — one row, for the Revenue page.
--
-- Deliberately answers the question in the form it is actually asked, rather
-- than making the page assemble it from three queries and get one wrong.
-- ---------------------------------------------------------------------------
drop function if exists public.stripe_webhook_health();

create function public.stripe_webhook_health()
returns table (
  last_event_at     timestamptz,
  last_event_type   text,
  events_7d         bigint,
  failures_7d       bigint,
  last_failure_at   timestamptz,
  last_failure_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'stripe_webhook_health is admin-only';
  end if;

  return query
  select
    (select e.received_at from public.stripe_webhook_events e
      order by e.received_at desc limit 1),
    (select e.type from public.stripe_webhook_events e
      order by e.received_at desc limit 1),
    (select count(*) from public.stripe_webhook_events e
      where e.received_at > now() - interval '7 days'),
    (select count(*) from public.stripe_webhook_events e
      where e.received_at > now() - interval '7 days' and e.outcome = 'failed'),
    (select e.received_at from public.stripe_webhook_events e
      where e.outcome = 'failed' order by e.received_at desc limit 1),
    (select e.detail from public.stripe_webhook_events e
      where e.outcome = 'failed' order by e.received_at desc limit 1);
end $$;

comment on function public.stripe_webhook_health() is
  'Admin-only. Backs the "is the webhook actually receiving anything" panel on '
  'the Revenue page. A null last_event_at means nothing has ever arrived, which '
  'is the state an unregistered endpoint and a correctly-registered quiet one '
  'would otherwise share.';

revoke execute on function public.stripe_webhook_health() from public;
grant   execute on function public.stripe_webhook_health() to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0022', 'stripe_webhook_events', '4fab3852b1fbe3391ab3ba9bada2a809f9b8620020e8315f009561d5395a95f9');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Nothing below the footer affects the checksum.
--
-- ── BLOCK A — the health function before anything is registered ─────────
--
--   select * from public.stripe_webhook_health();
--
--   Expect one row, every column null or 0. That is the honest "nothing has
--   ever arrived" state, and it is what the Revenue page must say out loud.
--
-- ── BLOCK B — idempotency is the primary key ────────────────────────────
--
--   begin;
--     insert into public.stripe_webhook_events (id, type, outcome)
--     values ('evt_test_0022', 'invoice.payment_failed', 'processed');
--     insert into public.stripe_webhook_events (id, type, outcome)
--     values ('evt_test_0022', 'invoice.payment_failed', 'processed');
--   rollback;
--
--   Expect 23505 on the second. If it inserts, redelivery double-applies and
--   the handler's "already processed" branch is unreachable.
--
-- ── BLOCK C — admin-only ────────────────────────────────────────────────
--
--   As a signed-in non-admin member:
--     select * from public.stripe_webhook_events;      -- expect 0 rows (RLS)
--     select * from public.stripe_webhook_health();    -- expect an exception
--
-- ── BLOCK D — the real proof, in Stripe ─────────────────────────────────
--
--   In the Stripe dashboard, Developers → Webhooks → send a test event to the
--   endpoint. Then:
--
--     select id, type, outcome, detail, received_at
--     from public.stripe_webhook_events order by received_at desc limit 5;
--
--   A signed test event must land as 'ignored' (a test event is not one we
--   act on) rather than 'failed'. A 'failed' row with a signature error means
--   STRIPE_WEBHOOK_SECRET does not match the endpoint's signing secret — which
--   is the two-dashboard problem this table exists to make visible.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

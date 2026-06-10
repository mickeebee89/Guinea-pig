-- Run these in the Supabase SQL editor before deploying the edge function.

create table if not exists verification_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  passed      boolean not null default false,
  selfie_url  text,
  created_at  timestamptz not null default now()
);
create index on verification_attempts (user_id, created_at);

create table if not exists verification_payments (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  stripe_payment_intent_id  text not null unique,
  amount                    integer not null,     -- in pence/cents
  currency                  text not null,
  created_at                timestamptz not null default now()
);

create table if not exists subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id        text not null,
  stripe_subscription_id    text not null unique,
  status                    text not null default 'incomplete',
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  created_at                timestamptz not null default now()
);

-- Add missing columns to users if not present
alter table users add column if not exists is_verified               boolean default false;
alter table users add column if not exists subscription_status       text;
alter table users add column if not exists subscription_next_billing timestamptz;
alter table users add column if not exists notification_preferences  jsonb;

-- Storage bucket for selfies (private)
-- Run in Storage tab or via SQL:
-- insert into storage.buckets (id, name, public) values ('verification-selfies', 'verification-selfies', false);

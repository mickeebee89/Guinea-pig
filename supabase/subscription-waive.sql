-- ============================================================================
-- Model membership comp/waive. Run in the Supabase SQL editor.
--
-- Mirrors provider_fee_waived (the provider side). A model with
-- subscription_waived = true is treated as having an active £4.99/mo
-- membership WITHOUT a Stripe charge — for App-Review demo accounts, comps,
-- and promos. The mobile apply-gate (lib/verification.ts hasActiveSubscription)
-- returns true for a waived member; the admin Users page toggles it
-- ("Free membership" / "Revoke membership").
-- ============================================================================

alter table public.users
  add column if not exists subscription_waived boolean not null default false;

-- Grant/revoke a specific account (the admin UI does this via a button):
--   update public.users set subscription_waived = true  where id = '<user-uuid>';
--   update public.users set subscription_waived = false where id = '<user-uuid>';

-- ============================================================================
-- RLS LOCKDOWN — public schema
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
--   Supabase grants BOTH `anon` and `authenticated` the full privilege set
--   (SELECT/INSERT/UPDATE/DELETE/TRUNCATE) on every table by default, so RLS is
--   the ONLY lock. Policies were written for many tables over the project's life
--   but `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` was never run for 13 of them,
--   leaving the policies DORMANT and the tables fully readable/writable/truncatable
--   by an unauthenticated client. `model_photos` handed a real row to an anon
--   `curl` during the audit — proof the exposure was live.
--
-- SCOPE (verified 2026-07-22 against the live DB via pg_class.relrowsecurity)
--   The sensitive core is ALREADY protected and is NOT touched here:
--     users, sessions, subscriptions, verification_payments, admins, messages,
--     providers, blocks, reports, notifications, moderation_actions, ... = RLS ON.
--   This file locks down the 13 RLS-off tables + fixes ONE over-permissive policy
--   on model_photo_categories (RLS on, but its SELECT policy was granted to {public}).
--
-- METHOD
--   Policies are created FIRST (dormant while RLS is off = zero risk), THEN RLS is
--   enabled, THEN verified. Apply ONE section at a time, in the order below, and
--   verify after each before moving on (anon probe returns [] + real app flow works).
--   Defaults: browse/lookup tables → `authenticated` read (the app requires login),
--   NOT anon; writes are owner-scoped; admin-only where the console is the only writer.
--
--   is_admin() is an existing SECURITY DEFINER helper. Provider ownership =
--   provider_id in (select id from providers where user_id = auth.uid()).
--
-- APPLY ORDER (by blast radius, safest first):
--   1 availability            5 model_photos             9 suspensions
--   2 portfolio_items         6 model_photo_categories  10 founding_providers
--   3 portfolio_categories    7 treatment_categories    11 treatments (deny-all)
--   4 favourites              8 settings + audit_log     12 provider_availability (deny-all)
-- ============================================================================


-- === 1. availability — auth read, owner-provider write ======================
create policy avail_select    on public.availability for select to authenticated using (true);
create policy avail_write_own on public.availability for all to authenticated
  using      (provider_id in (select id from public.providers where user_id = auth.uid()))
  with check (provider_id in (select id from public.providers where user_id = auth.uid()));
alter table public.availability enable row level security;


-- === 2. portfolio_items — auth read, owner/admin write ======================
create policy port_select on public.portfolio_items for select to authenticated using (true);
create policy port_write   on public.portfolio_items for all to authenticated
  using      (provider_id in (select id from public.providers where user_id = auth.uid()) or is_admin())
  with check (provider_id in (select id from public.providers where user_id = auth.uid()) or is_admin());
alter table public.portfolio_items enable row level security;


-- === 3. portfolio_categories — same shape ===================================
create policy pcat_select on public.portfolio_categories for select to authenticated using (true);
create policy pcat_write   on public.portfolio_categories for all to authenticated
  using      (provider_id in (select id from public.providers where user_id = auth.uid()) or is_admin())
  with check (provider_id in (select id from public.providers where user_id = auth.uid()) or is_admin());
alter table public.portfolio_categories enable row level security;


-- === 4. favourites — owner + favourited stylist read; owner write ===========
create policy fav_select on public.favourites for select to authenticated
  using (user_id = auth.uid() or provider_id in (select id from public.providers where user_id = auth.uid()));
create policy fav_insert on public.favourites for insert to authenticated with check (user_id = auth.uid());
create policy fav_delete on public.favourites for delete to authenticated using (user_id = auth.uid());
alter table public.favourites enable row level security;


-- === 5. model_photos — has 4 OWNER-ONLY policies (incl. SELECT). Add an ======
--        authenticated read so a stylist can view a model's gallery
--        (model/[id].tsx), keep the existing owner insert/update/delete, enable.
create policy model_photos_select_auth on public.model_photos for select to authenticated using (true);
alter table public.model_photos enable row level security;


-- === 6. model_photo_categories — RLS already ON; the leak is one policy on ===
--        role {public} with using(true). Re-scope all four to authenticated.
drop policy "read photo categories"       on public.model_photo_categories;
drop policy "insert own photo categories" on public.model_photo_categories;
drop policy "update own photo categories" on public.model_photo_categories;
drop policy "delete own photo categories" on public.model_photo_categories;
create policy mpc_select on public.model_photo_categories for select to authenticated using (true);
create policy mpc_insert on public.model_photo_categories for insert to authenticated with check (auth.uid() = user_id);
create policy mpc_update on public.model_photo_categories for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy mpc_delete on public.model_photo_categories for delete to authenticated using (auth.uid() = user_id);


-- === 7. treatment_categories — authenticated read, admin write ==============
create policy tcat_select      on public.treatment_categories for select to authenticated using (true);
create policy tcat_write_admin on public.treatment_categories for all    to authenticated using (is_admin()) with check (is_admin());
alter table public.treatment_categories enable row level security;


-- === 8. settings + admin_audit_log — admin-only =============================
create policy settings_select_admin on public.settings for select to authenticated using (is_admin());
create policy settings_write_admin  on public.settings for all    to authenticated using (is_admin()) with check (is_admin());
alter table public.settings enable row level security;

-- admin_audit_log — admin-only, append-only (service-role edge fn bypasses RLS)
create policy audit_select_admin on public.admin_audit_log for select to authenticated using (is_admin());
create policy audit_insert_admin on public.admin_audit_log for insert to authenticated with check (is_admin());
alter table public.admin_audit_log enable row level security;


-- === 9. suspensions — admin-only (in-app enforcement is a separate task) =====
create policy susp_admin on public.suspensions for all to authenticated using (is_admin()) with check (is_admin());
alter table public.suspensions enable row level security;


-- === 10. founding_providers — admin-only ====================================
create policy found_admin on public.founding_providers for all to authenticated using (is_admin()) with check (is_admin());
alter table public.founding_providers enable row level security;


-- === 11 & 12. treatments + provider_availability — unused/legacy ============
--         (app uses provider_treatments + availability). Deny-all: RLS on, no
--         policy. Confirm zero reads, then DROP these tables in a later change.
alter table public.treatments enable row level security;
alter table public.provider_availability enable row level security;


-- ============================================================================
-- VERIFY (after all sections). As anon (publishable key), every locked table
-- must return HTTP 200 [] — no rows. Run against each table:
--   curl -s "$URL/rest/v1/<table>?select=*&limit=3" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
-- Then a two-role device pass (model + stylist) + an admin-console pass.
--
-- SEPARATE FOLLOW-UPS (not this file):
--   * sessions UPDATE policy has no status guard (self-accept/self-complete) — needs a transition guard.
--   * reviews INSERT does not require the session to be completed.
--   * suspend/ban ENFORCEMENT in the app (locking the table only stops tampering).
--   * model-photos STORAGE bucket is separately public (storage policy, not table RLS).
--   * DROP treatments / provider_availability / verification_attempts once confirmed unused.
-- ============================================================================

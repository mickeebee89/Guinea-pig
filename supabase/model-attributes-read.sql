-- ============================================================================
-- model_attributes: let a stylist read a model's profile
-- ----------------------------------------------------------------------------
-- WHY
--   A model fills in their bio and physical characteristics, but a stylist
--   viewing that model's profile saw NEITHER. The UI was never the problem —
--   model/[id].tsx renders the bio (line ~427) and the attribute chips
--   (~445-461); it was receiving no data.
--
--   model_attributes has RLS enabled with BOTH policies scoped owner-only:
--     model_attrs_policy               ALL  (auth.uid() = user_id)
--     users can manage own attributes  ALL  (auth.uid() = user_id)
--   so any read of ANOTHER user's row returns zero rows. maybeSingle() on zero
--   rows gives { data: null, error: null }, so it failed completely silently —
--   no error, no warning, just a blank section.
--
--   Filtering still worked because nearby_models is a SECURITY DEFINER RPC and
--   bypasses RLS, which is why search-by-hair-colour worked while the profile
--   showed nothing.
--
--   Same shape as the model_photos fix in rls-lockdown.sql: keep the owner-only
--   WRITE policies, add an authenticated READ. A model's attributes are exactly
--   what a stylist is browsing for, so authenticated-read is the intent.
--   (Deliberately NOT anon — browsing requires login.)
-- ============================================================================

create policy model_attributes_select_auth
  on public.model_attributes for select to authenticated
  using (true);

-- ============================================================================
-- VERIFY
--   As a STYLIST, open a model's profile → bio and the attribute chips appear.
--   As the MODEL, editing own attributes still works (owner-only writes untouched).
--   Search filters (hair colour, skin type…) still return the same results.
-- ============================================================================

-- ===========================================================================
-- RLS POLICY SNAPSHOT — public schema, 2026-08-08
--
-- Companion to schema-snapshot-2026-08-08.sql. Split out because there are ~90
-- policies and they churn far faster than functions and triggers.
--
-- REFERENCE ONLY — not a migration. Do not run this file.
--
-- Until this snapshot, NO RLS policy of consequence existed in any repo file,
-- including the live `providers` SELECT policy that the whole public-website
-- design depends on.
--
-- READING NOTES
--   * RESTRICTIVE policies AND with the permissive ones. A RESTRICTIVE INSERT
--     still needs a matching PERMISSIVE INSERT to exist at all.
--   * Almost everything is `to authenticated` on purpose — see rls-lockdown.sql.
--     The public website therefore reads through the public_* views, never
--     these tables. Two deviations are flagged inline below.
--   * `is_admin()` and `is_suspended()` are SECURITY DEFINER helpers so the
--     policy predicate can read admins/suspensions without recursing into RLS.
-- ===========================================================================


-- ---- admin_audit_log ------------------------------------------------------
create policy audit_insert_admin on public.admin_audit_log as PERMISSIVE for INSERT to authenticated using (true) with check (is_admin());
create policy audit_select_admin on public.admin_audit_log as PERMISSIVE for SELECT to authenticated using (is_admin());

-- ---- admins ---------------------------------------------------------------
create policy admins_read on public.admins as PERMISSIVE for SELECT to authenticated using (is_admin());

-- ---- availability ---------------------------------------------------------
create policy avail_select on public.availability as PERMISSIVE for SELECT to authenticated using (true);
create policy avail_write_own on public.availability as PERMISSIVE for ALL to authenticated using ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid())))) with check ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))));

-- ---- blocks ---------------------------------------------------------------
create policy blocks_delete_own on public.blocks as PERMISSIVE for DELETE to authenticated using ((blocker_id = auth.uid()));
create policy blocks_insert_own on public.blocks as PERMISSIVE for INSERT to authenticated using (true) with check ((blocker_id = auth.uid()));
create policy blocks_select_involved on public.blocks as PERMISSIVE for SELECT to authenticated using (((blocker_id = auth.uid()) OR (blocked_id = auth.uid())));

-- ---- consent_documents ----------------------------------------------------
create policy cd_read on public.consent_documents as PERMISSIVE for SELECT to authenticated using (true);
create policy cd_write on public.consent_documents as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());

-- ---- favourites -----------------------------------------------------------
create policy fav_delete on public.favourites as PERMISSIVE for DELETE to authenticated using ((user_id = auth.uid()));
create policy fav_insert on public.favourites as PERMISSIVE for INSERT to authenticated using (true) with check ((user_id = auth.uid()));
create policy fav_select on public.favourites as PERMISSIVE for SELECT to authenticated using (((user_id = auth.uid()) OR (provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid())))));

-- ---- founding_providers ---------------------------------------------------
create policy found_admin on public.founding_providers as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());

-- ---- messages -------------------------------------------------------------
-- Two RESTRICTIVE guards: mutual blocks, and suspension.
create policy messages_insert_not_blocked on public.messages as RESTRICTIVE for INSERT to authenticated using (true) with check ((NOT (EXISTS ( SELECT 1
   FROM (sessions s
     LEFT JOIN providers p ON ((p.id = s.provider_id)))
  WHERE ((s.id = messages.session_id) AND (EXISTS ( SELECT 1
           FROM blocks b
          WHERE (((b.blocker_id = s.model_user_id) AND (b.blocked_id = p.user_id)) OR ((b.blocker_id = p.user_id) AND (b.blocked_id = s.model_user_id))))))))));
create policy messages_not_suspended on public.messages as RESTRICTIVE for INSERT to authenticated using (true) with check ((NOT is_suspended(auth.uid())));
create policy messages_select_admin on public.messages as PERMISSIVE for SELECT to authenticated using (is_admin());
create policy "participants can read messages" on public.messages as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM (sessions s
     LEFT JOIN providers p ON ((p.id = s.provider_id)))
  WHERE ((s.id = messages.session_id) AND ((auth.uid() = s.model_user_id) OR (auth.uid() = p.user_id))))));
create policy "participants can send messages" on public.messages as PERMISSIVE for INSERT to authenticated using (true) with check (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (sessions s
     LEFT JOIN providers p ON ((p.id = s.provider_id)))
  WHERE ((s.id = messages.session_id) AND ((auth.uid() = s.model_user_id) OR (auth.uid() = p.user_id)))))));
create policy "participants can update messages" on public.messages as PERMISSIVE for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM (sessions s
     LEFT JOIN providers p ON ((p.id = s.provider_id)))
  WHERE ((s.id = messages.session_id) AND ((auth.uid() = s.model_user_id) OR (auth.uid() = p.user_id))))));

-- ---- model_attributes -----------------------------------------------------
-- ⚠️ POLICY SPRAWL: model_attrs_policy and "users can manage own attributes"
-- are byte-identical. One is redundant. Worth consolidating — duplicated
-- policies make it hard to reason about what actually applies.
create policy model_attributes_select_auth on public.model_attributes as PERMISSIVE for SELECT to authenticated using (true);
create policy model_attrs_policy on public.model_attributes as PERMISSIVE for ALL to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "users can manage own attributes" on public.model_attributes as PERMISSIVE for ALL to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

-- ---- model_photo_categories -----------------------------------------------
create policy mpc_delete on public.model_photo_categories as PERMISSIVE for DELETE to authenticated using ((auth.uid() = user_id));
create policy mpc_insert on public.model_photo_categories as PERMISSIVE for INSERT to authenticated using (true) with check ((auth.uid() = user_id));
create policy mpc_select on public.model_photo_categories as PERMISSIVE for SELECT to authenticated using (true);
create policy mpc_update on public.model_photo_categories as PERMISSIVE for UPDATE to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

-- ---- model_photos ---------------------------------------------------------
-- ⚠️ POLICY SPRAWL: five policies, and they disagree. "Allow users to read own
-- photos" restricts SELECT to the owner, but model_photos_select_auth grants
-- SELECT to every authenticated user — and PERMISSIVE policies OR together, so
-- the broad one wins. The narrow policy reads like a protection it is not.
create policy "Allow users to delete own photos" on public.model_photos as PERMISSIVE for DELETE to authenticated using ((auth.uid() = user_id));
create policy "Allow users to insert own photos" on public.model_photos as PERMISSIVE for INSERT to authenticated using (true) with check ((auth.uid() = user_id));
create policy "Allow users to read own photos" on public.model_photos as PERMISSIVE for SELECT to authenticated using ((auth.uid() = user_id));
create policy model_photos_select_auth on public.model_photos as PERMISSIVE for SELECT to authenticated using (true);
create policy "users can manage own photos" on public.model_photos as PERMISSIVE for ALL to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

-- ---- moderation_actions ---------------------------------------------------
-- No DELETE/UPDATE policy, and trg_lock_moderation blocks them anyway.
create policy ma_insert on public.moderation_actions as PERMISSIVE for INSERT to authenticated using (true) with check (is_admin());
create policy ma_select on public.moderation_actions as PERMISSIVE for SELECT to authenticated using ((is_admin() OR (target_user_id = auth.uid())));

-- ---- notifications --------------------------------------------------------
create policy "authenticated can create notifications" on public.notifications as PERMISSIVE for INSERT to authenticated using (true) with check ((auth.uid() IS NOT NULL));
create policy notifications_select_admin on public.notifications as PERMISSIVE for SELECT to authenticated using (is_admin());
create policy "read own notifications" on public.notifications as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));
create policy "update own notifications" on public.notifications as PERMISSIVE for UPDATE to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

-- ---- patch_test_rules -----------------------------------------------------
create policy ptr_read on public.patch_test_rules as PERMISSIVE for SELECT to authenticated using (true);
create policy ptr_write on public.patch_test_rules as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());

-- ---- patch_tests ----------------------------------------------------------
-- NB provider_id here is an auth.users id, not providers.id.
create policy pt_insert on public.patch_tests as PERMISSIVE for INSERT to authenticated using (true) with check (((auth.uid() = provider_id) OR is_admin()));
create policy pt_select on public.patch_tests as PERMISSIVE for SELECT to authenticated using ((((auth.uid() = model_id) OR (auth.uid() = provider_id)) OR is_admin()));
create policy pt_update on public.patch_tests as PERMISSIVE for UPDATE to authenticated using (((auth.uid() = provider_id) OR is_admin())) with check (((auth.uid() = provider_id) OR is_admin()));

-- ---- portfolio_categories -------------------------------------------------
create policy pcat_select on public.portfolio_categories as PERMISSIVE for SELECT to authenticated using (true);
create policy pcat_write on public.portfolio_categories as PERMISSIVE for ALL to authenticated using (((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))) OR is_admin())) with check (((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))) OR is_admin()));

-- ---- portfolio_items ------------------------------------------------------
create policy port_select on public.portfolio_items as PERMISSIVE for SELECT to authenticated using (true);
create policy port_write on public.portfolio_items as PERMISSIVE for ALL to authenticated using (((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))) OR is_admin())) with check (((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))) OR is_admin()));

-- ---- provider_treatments --------------------------------------------------
create policy pt_delete on public.provider_treatments as PERMISSIVE for DELETE to authenticated using ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))));
create policy pt_insert on public.provider_treatments as PERMISSIVE for INSERT to authenticated using (true) with check ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))));
create policy pt_select on public.provider_treatments as PERMISSIVE for SELECT to authenticated using (true);
create policy pt_update on public.provider_treatments as PERMISSIVE for UPDATE to authenticated using ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid())))) with check ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.user_id = auth.uid()))));

-- ---- providers ------------------------------------------------------------
-- "providers readable when published" is the policy the whole public website
-- design rests on, and until this snapshot it existed in no file anywhere.
create policy "admins update any provider" on public.providers as PERMISSIVE for UPDATE to authenticated using (is_admin()) with check (is_admin());
create policy "providers can insert own row" on public.providers as PERMISSIVE for INSERT to authenticated using (true) with check ((auth.uid() = user_id));
create policy "providers can update own row" on public.providers as PERMISSIVE for UPDATE to authenticated using ((auth.uid() = user_id));
create policy "providers readable when published" on public.providers as PERMISSIVE for SELECT to authenticated using (((is_published = true) OR (auth.uid() = user_id)));
create policy providers_not_suspended on public.providers as RESTRICTIVE for UPDATE to authenticated using ((NOT is_suspended(auth.uid())));
create policy providers_select_admin on public.providers as PERMISSIVE for SELECT to authenticated using (is_admin());

-- ---- push_tokens ----------------------------------------------------------
create policy push_tokens_own on public.push_tokens as PERMISSIVE for ALL to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

-- ---- reports --------------------------------------------------------------
create policy gp_reports_insert on public.reports as PERMISSIVE for INSERT to authenticated using (true) with check ((reporter_id = auth.uid()));
create policy gp_reports_select on public.reports as PERMISSIVE for SELECT to authenticated using (((reporter_id = auth.uid()) OR is_admin()));
create policy gp_reports_update on public.reports as PERMISSIVE for UPDATE to authenticated using (is_admin()) with check (is_admin());

-- ---- reviews --------------------------------------------------------------
-- "publicly readable" means readable by any AUTHENTICATED user, not by anon.
create policy "reviews are publicly readable" on public.reviews as PERMISSIVE for SELECT to authenticated using (true);
create policy reviews_not_suspended on public.reviews as RESTRICTIVE for INSERT to authenticated using (true) with check ((NOT is_suspended(auth.uid())));
create policy "write own review for own session" on public.reviews as PERMISSIVE for INSERT to authenticated using (true) with check (((reviewer_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = reviews.session_id) AND (s.status = 'completed'::text) AND ((auth.uid() = s.model_user_id) OR (EXISTS ( SELECT 1
           FROM providers p
          WHERE ((p.id = s.provider_id) AND (p.user_id = auth.uid()))))))))));

-- ---- session_consents -----------------------------------------------------
-- Append-only via trg_lock_consents. No UPDATE or DELETE policy exists, and
-- the trigger would reject them regardless.
create policy sc_insert on public.session_consents as PERMISSIVE for INSERT to authenticated using (true) with check ((user_id = auth.uid()));
create policy sc_select on public.session_consents as PERMISSIVE for SELECT to authenticated using (((user_id = auth.uid()) OR is_admin()));

-- ---- sessions -------------------------------------------------------------
create policy "model can create session" on public.sessions as PERMISSIVE for INSERT to authenticated using (true) with check ((auth.uid() = model_user_id));
create policy "participants can read sessions" on public.sessions as PERMISSIVE for SELECT to authenticated using (((auth.uid() = model_user_id) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = sessions.provider_id) AND (p.user_id = auth.uid()))))));
create policy "participants can update sessions" on public.sessions as PERMISSIVE for UPDATE to authenticated using (((auth.uid() = model_user_id) OR (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = sessions.provider_id) AND (p.user_id = auth.uid()))))));
create policy sessions_insert_not_blocked on public.sessions as RESTRICTIVE for INSERT to authenticated using (true) with check ((NOT (EXISTS ( SELECT 1
   FROM (providers p
     JOIN blocks b ON ((((b.blocker_id = sessions.model_user_id) AND (b.blocked_id = p.user_id)) OR ((b.blocker_id = p.user_id) AND (b.blocked_id = sessions.model_user_id)))))
  WHERE (p.id = sessions.provider_id)))));
create policy sessions_not_suspended on public.sessions as RESTRICTIVE for INSERT to authenticated using (true) with check ((NOT is_suspended(auth.uid())));
create policy sessions_select_admin on public.sessions as PERMISSIVE for SELECT to authenticated using (is_admin());

-- ---- settings -------------------------------------------------------------
create policy settings_select_admin on public.settings as PERMISSIVE for SELECT to authenticated using (is_admin());
create policy settings_write_admin on public.settings as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());

-- ---- subscriptions --------------------------------------------------------
create policy subscriptions_select_admin on public.subscriptions as PERMISSIVE for SELECT to authenticated using (is_admin());
create policy subscriptions_select_own on public.subscriptions as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));

-- ---- suspensions ----------------------------------------------------------
create policy susp_admin on public.suspensions as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());

-- ---- treatment_categories -------------------------------------------------
create policy tcat_select on public.treatment_categories as PERMISSIVE for SELECT to authenticated using (true);
create policy tcat_write_admin on public.treatment_categories as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());

-- ---- users ----------------------------------------------------------------
-- ⚠️ "users can read own row" is granted `to public`, not `to authenticated` —
-- the only such policy in the schema. It is currently harmless: the predicate
-- is auth.uid() = id, and auth.uid() is NULL for anon, so no row matches. But
-- it is one predicate change away from being an anon read, and it breaks the
-- rls-lockdown.sql convention that everything is scoped to `authenticated`.
-- Worth changing to `to authenticated` for consistency, not urgency.
create policy "admins read all users" on public.users as PERMISSIVE for SELECT to authenticated using (is_admin());
create policy "admins update any user" on public.users as PERMISSIVE for UPDATE to authenticated using (is_admin()) with check (is_admin());
create policy "users can insert own row" on public.users as PERMISSIVE for INSERT to authenticated using (true) with check ((auth.uid() = id));
create policy "users can read own row" on public.users as PERMISSIVE for SELECT to public using ((auth.uid() = id));
create policy "users can update own row" on public.users as PERMISSIVE for UPDATE to authenticated using ((auth.uid() = id)) with check ((auth.uid() = id));

-- ---- verification_payments ------------------------------------------------
create policy verification_payments_select_own on public.verification_payments as PERMISSIVE for SELECT to authenticated using (((user_id = auth.uid()) OR is_admin()));

-- ---- verification_requests ------------------------------------------------
create policy "admins read verification requests" on public.verification_requests as PERMISSIVE for SELECT to authenticated using (is_admin());
create policy "admins update verification requests" on public.verification_requests as PERMISSIVE for UPDATE to authenticated using (is_admin()) with check (is_admin());
create policy vr_user_policy on public.verification_requests as PERMISSIVE for ALL to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

-- ---- waitlist -------------------------------------------------------------
-- No INSERT policy for anon or authenticated: the waitlist-signup edge function
-- holds service_role and is the only writer. Deliberate.
create policy waitlist_select_admin on public.waitlist as PERMISSIVE for SELECT to authenticated using (is_admin());

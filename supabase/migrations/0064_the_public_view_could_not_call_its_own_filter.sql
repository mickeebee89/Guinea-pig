-- ===========================================================================
-- 0064_the_public_view_could_not_call_its_own_filter
--
-- A boolean wrapper the anon role may execute, so public_stylists can apply
-- its own content bar. Fixes a live fault introduced by 0060.
--
-- ⚠️ THIS MIGRATION ALONE CHANGES NOTHING VISIBLE. The view still calls
-- bio_publish_problem until supabase/public-web-views.sql is re-run by hand.
-- The order is at the bottom of this file.
--
-- ── THE FAULT ──────────────────────────────────────────
-- 0060 ended with:
--
--     revoke all on function public.bio_publish_problem(text) from public, anon;
--
-- and public_stylists filters with `public.bio_publish_problem(p.bio) is null`.
-- The public website reads that view with the ANON key. So every read of it
-- from cavybeauty.com failed outright:
--
--     permission denied for function bio_publish_problem
--
-- Not "returned fewer rows" — the whole statement errors, because the predicate
-- is evaluated per row and the privilege check aborts it.
--
-- ⚠️ WHY THE VIEW'S OWN PROTECTION DID NOT COVER THIS. The header of
-- public-web-views.sql explains, correctly, that these views are
-- security_invoker = false, so they read their TABLES as the view owner and
-- the anon role needs no privileges on providers or users. That is true, and it
-- is about tables. EXECUTE on a function called in the view body is still
-- checked against the CALLER. A view can therefore be readable and unusable at
-- the same time, and nothing about the view says so.
--
-- ── WHAT IT COST ───────────────────────────────────────
-- All six treatment landing pages showed "No one is offering <treatment> on
-- Cavy yet" and a count of zero, from 0060 until this is applied, while one
-- stylist genuinely qualified — read from the database 30 Sep 2026:
-- rows_public_site_would_show = 1.
--
-- It degraded quietly by design. safeList() in site/lib/stylists.ts catches the
-- error, logs a warning and returns an empty list, so the pages render a
-- correct-looking empty state with a 200. Its own comment (item 18) says that a
-- REVOKED GRANT and an empty table are byte-for-byte identical downstream. That
-- was written as a known risk, and this is that risk arriving.
--
-- ── WHY A WRAPPER RATHER THAN A GRANT ──────────────────
-- Granting anon execute on bio_publish_problem would work, and would hand the
-- public the sentence — which varies by WHICH rule failed, including the one
-- meaning "a banned word matched". Anyone with the anon key (it is in every
-- page's JavaScript) could then probe the moderation rules a character at a
-- time.
--
-- This returns a boolean and nothing else. It leaks no more than the view
-- already does: whether a stylist appears in a public list IS the boolean.
--
-- ⚠️ SECURITY DEFINER IS LOAD-BEARING, NOT DECORATION. The body calls
-- bio_publish_problem, which anon still may not execute. The inner call is
-- checked against the function's OWNER, so it succeeds. A plain SECURITY
-- INVOKER wrapper granted to anon would fail in exactly the way the view fails
-- now, one level deeper and harder to see.
--
-- Postgres does not inline SECURITY DEFINER SQL functions, so no optimisation
-- can flatten this back into the caller's privileges.
--
-- ── BEHAVIOUR IS UNCHANGED, DELIBERATELY ───────────────
-- `bio_publish_problem(x) is null` is the whole body. It is not a second copy
-- of the rule and it cannot drift from it: there is one implementation of what
-- a publishable bio is, and the dashboard still reads the sentence form, so the
-- view and the page explaining the view stay in agreement (0060).
--
-- The wrapper is NOT strict. bio_publish_problem coalesces null to '' and
-- returns the "needs an about" sentence, so a null bio is excluded today. A
-- strict wrapper would return null instead, the predicate would not be true,
-- and the outcome would happen to match — by luck, through a different path.
-- Not relying on that.
-- ===========================================================================

begin;

create or replace function public.bio_is_publishable(p_bio text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.bio_publish_problem(p_bio) is null
$$;

comment on function public.bio_is_publishable(text) is
  'TRUE when a bio may appear on cavybeauty.com. The boolean form of '
  'bio_publish_problem, which anon may not execute because its return value '
  'names which rule failed. public_stylists filters on THIS one; the stylist''s '
  'dashboard still reads the sentence. SECURITY DEFINER is what makes the inner '
  'call legal for anon. 0064, fixing a live fault from 0060.';

revoke all on function public.bio_is_publishable(text) from public;
grant execute on function public.bio_is_publishable(text) to anon, authenticated;

-- bio_publish_problem's own grants are UNCHANGED: still authenticated only.
-- The sentence stays behind the auth gate, which was the point of 0060's
-- revoke and remains right.

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0064', 'the_public_view_could_not_call_its_own_filter', 'e884fd531e73718b19b6ce1bc17564cdfbcbaf3de2f42797368ade6a983435ef');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0063') = 1
--       as v_0063_applied,
--     to_regprocedure('public.bio_publish_problem(text)') is not null
--       as inner_function_exists,
--     to_regprocedure('public.bio_is_publishable(text)') is null
--       as not_already_there;
--
--   Expect all three true.
-- ===========================================================================
--
-- ── ORDER. THE VIEW FILE MUST BE RE-RUN BY HAND. ────────────────────────
--
--   1. Apply this migration. Nothing changes yet: the view still calls
--      bio_publish_problem, and the public pages stay empty. This step is safe
--      on its own and cannot make anything worse.
--   2. Re-run supabase/public-web-views.sql IN FULL, by hand, in the SQL
--      editor. It now filters on bio_is_publishable. `create or replace view`
--      is enough — no column is added or dropped — and the file re-applies its
--      own revoke/grant block at the end either way.
--   3. Run the VERIFY below.
--   4. A redeploy is NOT required. The treatment pages carry
--      `export const revalidate = 900`, so they refresh within fifteen minutes
--      on their own. A deploy only makes it immediate.
--
--   Between 1 and 2 the site is exactly as broken as it is now, no more.
-- ===========================================================================
--
-- ── VERIFY — as the role that was actually failing ──────────────────────
--
--   -- (a) after step 1: anon may call the wrapper, and may still NOT call the
--   --     function that names the rule.
--   select
--     has_function_privilege('anon', 'public.bio_is_publishable(text)', 'execute')
--       as anon_may_check,
--     has_function_privilege('anon', 'public.bio_publish_problem(text)', 'execute')
--       as anon_may_read_the_sentence;
--
--   Expect true, false.
--
--   -- (b) after step 2: the read that has been failing since 0060.
--   begin;
--     set local role anon;
--     select count(*) as rows_the_public_site_can_see from public.public_stylists;
--   rollback;
--
--   Expect 1 — the same number the postgres role sees. Before step 2 this
--   raises "permission denied for function bio_publish_problem", which is the
--   whole fault, reproducible in one paste.
-- ===========================================================================

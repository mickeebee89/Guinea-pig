-- ============================================================================
-- Age gate: store the signup date of birth on public.users. Run in the SQL editor.
--
-- Signup collects a real DD/MM/YYYY date of birth and validates >= 18 before the
-- account is created (SignupScreen.tsx). The DOB is written to auth user_metadata
-- as `date_of_birth` (ISO YYYY-MM-DD); this column makes it queryable in
-- public.users (e.g. the admin Users "Age" column).
--
-- Population: ensureProfile backfills this column from auth metadata on first app
-- open when it is null (the auth.users trigger creates the users row without it),
-- and sets it directly when it has to recreate a missing row. Inherits the users
-- table's existing self+admin-only RLS, so a DOB is never publicly readable
-- (public_profiles is an explicit-column view and does NOT include it).
-- ============================================================================

alter table public.users
  add column if not exists date_of_birth date;

-- OPTIONAL (belt-and-braces): also have the signup trigger write it at creation
-- time, so the DOB lands a few seconds earlier instead of on first app open.
-- The trigger body is not in the repo — dump it first, then add
-- `date_of_birth = (new.raw_user_meta_data ->> 'date_of_birth')::date`
-- to its INSERT rather than rewriting it blind:
--
--   select pg_get_functiondef(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'handle_new_auth_user';

-- Existing accounts predate the DOB field, so this column stays null for them
-- (nothing to back-fill from) — expected, and why the admin Age column shows "—".

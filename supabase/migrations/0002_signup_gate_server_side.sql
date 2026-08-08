-- ===========================================================================
-- 0002_signup_gate_server_side
--
-- Moves the 18+ gate and the role requirement out of the client and into the
-- database, before a second client exists.
--
-- WHY NOW
--   Today both are enforced only in the app. SignupScreen.tsx:112 computes the
--   age in JavaScript and then sends `age_confirmed: true` as a hardcoded
--   boolean that nothing verifies, and handle_new_auth_user falls back to
--   `coalesce(raw_user_meta_data->>'role', 'model')`.
--
--   That holds together while there is one client. Phase 2 adds a browser, and
--   the cohort referral links mean signups arriving from a shared URL — which
--   is exactly where an under-18 turns up. One rule in the database is
--   inherited by every client that exists or ever will.
--
-- ── CONSTRAINT 1: does the shipped app always send `role`? YES, VERIFIED ────
--   Only TWO call sites create auth users in the entire repo:
--     * mobile/src/screens/auth/SignupScreen.tsx:143 — role is a typed prop
--       ('model' | 'provider'), fed from AppEntry.tsx:34 which is
--       useState<'model'|'provider'>('model'). It cannot be undefined.
--     * seed/seed.mjs:218 — passes role in user_metadata.
--   mobile/src/lib/ensureProfile.ts heals public.users rows but never inserts
--   into auth.users, so this trigger is not involved.
--   Rejecting an absent role is therefore a footgun fix, not a signup outage.
--
-- ── CONSTRAINT 2: what happens to existing accounts? NOTHING ────────────────
--   This trigger is AFTER INSERT ON auth.users. Logging in does not insert, so
--   it never re-runs for an existing row. Every account created before this
--   migration keeps working exactly as it did, whatever its date_of_birth says.
--
--   State that as a limitation, not a reassurance: this migration CANNOT
--   retroactively validate anyone. The audit query at the foot of this file
--   reports any existing account that would fail the new rule, so the number is
--   known rather than assumed to be zero.
--
-- ── WHAT THIS DELIBERATELY DOES NOT ADD ────────────────────────────────────
--   public.users.date_of_birth ALREADY EXISTS, and ensureProfile.ts:64-75
--   already backfills it from metadata on login. admin/app/users/page.tsx
--   renders an age column from it. Adding it again was the original plan and
--   would have been a duplicate — checked before writing, not after.
--
--   What is genuinely missing is terms_accepted: it exists nowhere in
--   public.users, so "did this user accept the terms?" currently has no answer
--   the admin console can query. Only auth metadata knows, and PostgREST
--   cannot read that.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0002') then
    raise exception 'Migration 0002 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Record terms acceptance where it can be queried.
--
--    Nullable on purpose: existing rows have no value and inventing one would
--    be fabricating a consent record. Null means "we do not know", which is
--    the truth for accounts created before this.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists terms_accepted_at timestamptz;

comment on column public.users.terms_accepted_at is
  'When this user accepted the Terms at signup. Set by handle_new_auth_user. '
  'NULL for accounts created before migration 0002 — unknown, not "no".';

-- Backfill only where auth metadata actually says so. created_at is the best
-- available timestamp: the acceptance happened at signup by construction,
-- because the signup form cannot be submitted without both boxes ticked.
update public.users u
   set terms_accepted_at = a.created_at
  from auth.users a
 where a.id = u.id
   and u.terms_accepted_at is null
   and coalesce(a.raw_user_meta_data->>'terms_accepted', 'false') = 'true';

-- ---------------------------------------------------------------------------
-- 2. The gate itself.
--
--    Both checks raise, which aborts the auth.users insert — so a rejected
--    signup leaves no orphaned auth row to clean up later.
--
--    NOTE ON THE ERROR MESSAGE. GoTrue wraps any exception here as "Database
--    error saving new user", so these messages are for the logs, not the user.
--    That is acceptable BECAUSE the client keeps its own checks: the form
--    still validates age and requires the role, so a normal user never reaches
--    this path. It is a backstop for a modified or future client, and a
--    backstop with a poor error message still beats no backstop.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := new.raw_user_meta_data->>'role';
  v_dob  text := new.raw_user_meta_data->>'date_of_birth';
  v_dob_date date;
begin
  -- ROLE: required and closed. The old coalesce(..., 'model') meant a signup
  -- that omitted role silently became a model with no providers row, and
  -- nothing errored — the failure only surfaced much later, as a stylist who
  -- could not find their dashboard.
  if v_role is null or v_role not in ('model', 'provider') then
    raise exception
      'Signup rejected: role must be model or provider (got %)', coalesce(v_role, 'null')
      using errcode = '22023';
  end if;

  -- AGE: verify the date, do not trust age_confirmed. The boolean is
  -- client-supplied and always true; the date is the actual evidence.
  if v_dob is null or btrim(v_dob) = '' then
    raise exception 'Signup rejected: date of birth is required'
      using errcode = '22023';
  end if;

  begin
    v_dob_date := v_dob::date;
  exception when others then
    raise exception 'Signup rejected: date of birth is not a valid date (got %)', v_dob
      using errcode = '22023';
  end;

  if v_dob_date > current_date then
    raise exception 'Signup rejected: date of birth is in the future'
      using errcode = '22023';
  end if;

  -- age_years uses full years, matching ageOn() in SignupScreen.tsx so the two
  -- checks cannot disagree on a birthday boundary.
  if extract(year from age(current_date, v_dob_date)) < 18 then
    raise exception 'Signup rejected: must be 18 or over'
      using errcode = '22023';
  end if;

  insert into public.users (
    id, email, role, first_name, last_name, last_initial, region,
    date_of_birth, terms_accepted_at
  )
  values (
    new.id,
    new.email,
    v_role,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'last_initial', ''),
    coalesce(new.raw_user_meta_data->>'region', 'UK'),
    v_dob_date,
    case when coalesce(new.raw_user_meta_data->>'terms_accepted', 'false') = 'true'
         then now() end
  )
  on conflict (id) do nothing;

  if v_role = 'provider' then
    insert into public.providers (user_id)
    values (new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0002', 'signup_gate_server_side', '59d279ca0f65ca2ce0f86ce1118c374c200ba7b2d942d0bb6e90f6b2af24112e');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- AUDIT — run AFTER applying. Reports what this migration could not fix.
--
-- Existing accounts are untouched by design, so any that would fail the new
-- rule still exist. This makes the number known rather than assumed to be zero.
--
--   select
--     count(*)                                                   as accounts,
--     count(*) filter (where u.date_of_birth is null)            as no_dob,
--     count(*) filter (where u.date_of_birth is not null
--                        and extract(year from age(current_date, u.date_of_birth)) < 18)
--                                                                as under_18,
--     count(*) filter (where u.role not in ('model','provider')) as bad_role,
--     count(*) filter (where u.terms_accepted_at is null)        as no_terms_record
--   from public.users u;
--
-- under_18 > 0 needs acting on, not recording. no_dob and no_terms_record are
-- expected for early accounts and mean "unknown", not "failed".
--
-- VERIFY THE GATE ITSELF (safe, rolls back):
--
--   begin;
--     insert into auth.users (id, email, raw_user_meta_data)
--     values (gen_random_uuid(), 'gate-test@example.invalid',
--             '{"role":"model","date_of_birth":"2015-01-01","terms_accepted":true}'::jsonb);
--   rollback;   -- expect: "Signup rejected: must be 18 or over"
--
--   begin;
--     insert into auth.users (id, email, raw_user_meta_data)
--     values (gen_random_uuid(), 'gate-test2@example.invalid',
--             '{"date_of_birth":"1990-01-01","terms_accepted":true}'::jsonb);
--   rollback;   -- expect: "role must be model or provider (got null)"
-- ===========================================================================

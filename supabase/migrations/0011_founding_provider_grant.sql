-- ===========================================================================
-- 0011_founding_provider_grant
--
-- Grants Founding Provider status automatically to stylists who sign up via a
-- referral link, up to a cap held in settings.
--
-- ── WHY: A PUBLISHED PROMISE WITH NO MECHANISM ────────────────────────────
-- cavybeauty.com/for-stylists says "you'll get the free early-stylist account
-- when we launch", and Terms §5 repeats it. Nothing implemented it.
--
-- users.is_founding_provider is READ in four places — the provider dashboard's
-- fee check, verify-payment, the admin user list and the web dashboard — and
-- WRITTEN by nothing. No trigger, no signup path, no admin button. Same for
-- provider_fee_waived. Both existed only as columns someone would have had to
-- UPDATE by hand.
--
-- The consequence was concrete: a college cohort signing up through a course
-- leader's link would arrive with is_founding_provider false, so
--   settled = paid OR is_founding_provider OR provider_fee_waived
-- would be false, and every one of them would have hit a £14.99 fee the site
-- had already told them they would not pay.
--
-- Third instance today of a claim with nothing behind it, after the privacy
-- policy describing an IP address that was never recorded and the ID check
-- described as identity verification. The pattern is the same each time: the
-- sentence is written once and the mechanism is assumed to follow.
--
-- ── HOW ───────────────────────────────────────────────────────────────────
-- handle_new_auth_user already runs on every signup and already reads
-- raw_user_meta_data. Granting there means it happens inside the same
-- transaction as the account, so there is no window where a stylist exists
-- without the status they were promised.
--
-- Requires ALL of:
--   * role = 'provider'          — founding is a stylist offer
--   * signup_source is present   — arrived via someone's referral link
--   * the cap is not yet reached — settings.founding_provider_cap
--
-- signup_source is written by site/lib/signup.ts on web. The MOBILE signup does
-- NOT send it (SignupScreen.tsx:171 passes no source), so app signups never
-- qualify. That is correct for now — the referral link is a web URL — but it
-- means "sign up in the app instead" silently loses the offer.
--
-- ⚠ NO MANUAL GRANT PATH EXISTS. A cohort member who types the URL rather than
--   following the link gets nothing, and the only remedy is an UPDATE by hand.
--   An admin toggle is the obvious next piece and is deliberately not in this
--   migration.
--
-- ── THE CAP IS APPROXIMATE ON PURPOSE, BUT NOT SLOPPY ─────────────────────
-- Two simultaneous signups could both read the same count and both be granted.
-- An advisory lock serialises the grant so that cannot happen, and it is used
-- rather than a unique constraint on slot_number because a constraint would
-- resolve the race by FAILING somebody's signup. Losing an account is a far
-- worse outcome than handing out one extra free slot.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0011') then
    raise exception 'Migration 0011 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The cap.
--
--    settings is admin-only by RLS, which is right — this is a commercial
--    limit, not something a user may read or change. The trigger below is
--    SECURITY DEFINER so it can read it regardless.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value)
values ('founding_provider_cap', '200')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The grant, inside the existing signup trigger.
--
--    Everything above the founding block is migration 0002's body, unchanged.
--    The 18+ gate and the role requirement are untouched.
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
  v_source text := nullif(btrim(coalesce(new.raw_user_meta_data->>'signup_source', '')), '');
  v_cap    int;
  v_taken  int;
  v_slot   int;
  v_founding boolean := false;
begin
  -- ROLE: required and closed.
  if v_role is null or v_role not in ('model', 'provider') then
    raise exception
      'Signup rejected: role must be model or provider (got %)', coalesce(v_role, 'null')
      using errcode = '22023';
  end if;

  -- AGE: verify the date, do not trust age_confirmed.
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

  if extract(year from age(current_date, v_dob_date)) < 18 then
    raise exception 'Signup rejected: must be 18 or over'
      using errcode = '22023';
  end if;

  -- ── FOUNDING PROVIDER ────────────────────────────────────────────────────
  -- Stylist, arrived by referral, and there is room. The advisory lock makes
  -- the count-then-grant atomic across concurrent signups; it is released at
  -- the end of this transaction whether the signup succeeds or fails.
  if v_role = 'provider' and v_source is not null then
    perform pg_advisory_xact_lock(hashtext('founding_provider_grant'));

    select coalesce(nullif(value, '')::int, 0) into v_cap
      from public.settings where key = 'founding_provider_cap';
    v_cap := coalesce(v_cap, 0);

    select count(*) into v_taken from public.founding_providers;

    if v_taken < v_cap then
      v_founding := true;
      v_slot := v_taken + 1;
    end if;
  end if;

  insert into public.users (
    id, email, role, first_name, last_name, last_initial, region,
    date_of_birth, terms_accepted_at, is_founding_provider
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
         then now() end,
    v_founding
  )
  on conflict (id) do nothing;

  if v_role = 'provider' then
    insert into public.providers (user_id)
    values (new.id)
    on conflict do nothing;
  end if;

  -- The slot record. Written only on a real grant, so the count above stays
  -- the source of truth for how many have gone.
  if v_founding then
    insert into public.founding_providers (user_id, slot_number, claimed_at)
    values (new.id, v_slot, now())
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0011', 'founding_provider_grant', 'ac9c5086c92ebba39dae79f05a6dc0bd4be6ee43d91de75e5aa4ef7be46763a8');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- One paste per block, each ending in one select.
--
-- ── BLOCK A — the cap exists ──────────────────────────────────────────────
--
--   select key, value from public.settings where key = 'founding_provider_cap';
--
--   Expect 200. Change it here to change the offer; nothing else reads a
--   number.
--
--
-- ── BLOCK B — who is founding now, and how many slots are left ────────────
--
--   select (select value from public.settings where key = 'founding_provider_cap') as cap,
--          (select count(*) from public.founding_providers)                        as taken,
--          (select count(*) from public.users where is_founding_provider)          as flagged;
--
--   taken and flagged should agree. They can differ only if someone was
--   granted by hand without a slot row.
--
--
-- ── BLOCK C — the grant fires, and only for the right signups ─────────────
-- Four signups, all rolled back. Paste as ONE run.
--
--   create or replace function pg_temp.verify_0011()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_meta jsonb := '{"role":"provider","date_of_birth":"1990-01-01","terms_accepted":true}'::jsonb;
--     r record;
--     v_prov_ref text := 'not reached';
--     v_prov_noref text := 'not reached';
--     v_model_ref text := 'not reached';
--   begin
--     begin
--       -- stylist WITH a referral source -> founding
--       insert into auth.users (id, email, raw_user_meta_data)
--       values ('00000000-0000-0000-0000-00000000f001', 'f1@example.invalid',
--               v_meta || '{"signup_source":"college-test"}'::jsonb);
--       select is_founding_provider into r from public.users
--        where id = '00000000-0000-0000-0000-00000000f001';
--       v_prov_ref := case when r.is_founding_provider
--         then 'granted — correct' else 'PROBLEM: not granted' end;
--
--       -- stylist with NO source -> not founding
--       insert into auth.users (id, email, raw_user_meta_data)
--       values ('00000000-0000-0000-0000-00000000f002', 'f2@example.invalid', v_meta);
--       select is_founding_provider into r from public.users
--        where id = '00000000-0000-0000-0000-00000000f002';
--       v_prov_noref := case when r.is_founding_provider
--         then 'PROBLEM: granted without a referral' else 'not granted — correct' end;
--
--       -- MODEL with a source -> not founding, it is a stylist offer
--       insert into auth.users (id, email, raw_user_meta_data)
--       values ('00000000-0000-0000-0000-00000000f003', 'f3@example.invalid',
--               ('{"role":"model","date_of_birth":"1990-01-01","terms_accepted":true}'::jsonb)
--               || '{"signup_source":"college-test"}'::jsonb);
--       select is_founding_provider into r from public.users
--        where id = '00000000-0000-0000-0000-00000000f003';
--       v_model_ref := case when r.is_founding_provider
--         then 'PROBLEM: a model was granted' else 'not granted — correct' end;
--
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_prov_ref := 'could not test — ' || left(sqlerrm, 90);
--       end if;
--     end;
--
--     check_name := 'stylist via referral';    outcome := v_prov_ref;   return next;
--     check_name := 'stylist with no referral'; outcome := v_prov_noref; return next;
--     check_name := 'model via referral';       outcome := v_model_ref;  return next;
--   end $f$;
--
--   select * from pg_temp.verify_0011();
--
--
-- ── BLOCK D — signup itself still works ───────────────────────────────────
-- This rewrote handle_new_auth_user, which every account creation depends on.
-- The 18+ gate and the role requirement are unchanged above, and 0002's own
-- verify block still applies — re-run it. Then SIGN UP FOR REAL on the web,
-- because a broken signup trigger takes the whole product down and is not
-- something to discover from a support email.
-- ===========================================================================

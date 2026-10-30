-- ===========================================================================
-- 0107_where_a_signup_came_from_is_a_column
--
-- ⚠️ Apply 0106 first. Two columns on public.users recording where a signup
-- came from, and handle_new_auth_user writes them.
--
-- ⚠️⚠️ NOT APPLIED. Written 30 Oct 2026 and committed on its own so it can be
-- read before it runs. The site/ half (capture → hidden field → auth metadata)
-- is already live and does not need this: it writes
-- `raw_user_meta_data->>'signup_campaign'`, which is readable today with a join
-- into the auth schema. This migration is what makes it readable WITHOUT one.
--
-- ── ⚠️⚠️⚠️ TWO COLUMNS, BECAUSE ONE OF THESE HANDS OUT A FEE WAIVER ───────
--
-- The function below already contains this, and has since the Founding
-- Provider work:
--
--     if v_role = 'provider' and v_source is not null then
--        … grant Founding Provider, claim a slot …
--
-- So `signup_source` is not a label — its mere PRESENCE grants a benefit, and
-- `provider_fee_settled()` (0045) treats `is_founding_provider` as one of the
-- three ways the stylist fee counts as settled. settings.founding_provider_cap
-- reads 200 and founding_providers holds 1 row, so 199 slots are open.
--
-- ⚠️ WHICH IS WHY A CAMPAIGN TAG DOES NOT GO IN `signup_source`. Pour advert
-- traffic into that field and every stylist who clicks the advert silently
-- becomes a Founding Provider — a pricing decision arriving as a side effect of
-- an attribution fix, and not reversible by deciding differently later.
--
--   signup_source    a `?ref=` cohort code. GRANTS founding, exactly as now.
--   signup_campaign   utm / click-platform label. Read by NOTHING. No trigger,
--                     no policy, no RPC, no function.
--
-- Step 4 asserts that second sentence rather than trusting this comment: it
-- fails if `signup_campaign` appears in any function body or policy expression
-- in the schema.
--
-- ── ⚠️ NOT CLIENT-WRITABLE, AND THAT NEEDS SAYING OUT LOUD ────────────────
-- 0088 revoked table-wide UPDATE on public.users and granted it back by NAME;
-- 0099 had to extend that list to ten columns. ⚠️ A NEW COLUMN IS NOT WRITABLE
-- BY THE CLIENT UNLESS IT IS NAMED, and neither of these is named — on purpose.
-- Where somebody came from is a fact recorded once, at signup, by a SECURITY
-- DEFINER trigger that does not consult the grant list. A member editing her
-- own attribution afterwards is not a feature; being able to award yourself a
-- founding slot by UPDATEing signup_source would be a hole.
--
-- Step 4 asserts the absence, so a later migration that widens the grant list
-- by pasting a longer one has to notice these two.
--
-- ── ⚠️ LENGTH IS CAPPED AT THE WRITE, AND THE CHECK CANNOT REFUSE A SIGNUP ─
-- `raw_user_meta_data` is whatever was sent to GoTrue; anyone with the anon key
-- can call signUp directly with a megabyte in `options.data`. So the trigger
-- does `left(…, 120)` and the CHECK constraints are length-only.
--
-- ⚠️ THAT ORDER IS DELIBERATE. A CHECK that can actually fire inside
-- handle_new_auth_user reaches the person as "Database error saving new user" —
-- GoTrue discards the RAISE, so nothing names the field and nothing is
-- actionable. site/app/(auth)/sign-up/actions.ts carries forty lines about
-- exactly that. With `left()` ahead of it the constraint can never fire, so it
-- documents the invariant and cannot cost anybody an account.
--
-- A charset CHECK was considered and REFUSED for the same reason: `?ref=` codes
-- are handed out by people, `site/app/(auth)/sign-up/page.tsx` cleans them now
-- but older links are in circulation, and a stray character must not be the
-- difference between having an account and not.
--
-- ── ⚠️⚠️ WHAT THESE COLUMNS WILL SHOW ON DAY ONE: ALMOST NOTHING ──────────
-- 60 accounts exist. Two carry a `signup_source` in their auth metadata —
-- `flowersamaral` (a stylist, 21 Oct, the one Founding Provider) and `facebook`
-- (a model, 23 Oct) — and step 3 copies those two across. The other 58 have no
-- record of where they came from and never will; the field did not exist when
-- they signed up.
--
-- ⚠️ SO AN ALMOST-EMPTY COLUMN MEANS "WE DID NOT ASK", NOT "NO CAMPAIGN
-- TRAFFIC". 58 nulls out of 60 is a fact about this migration's date, not about
-- marketing. Nothing here is a reconstruction: step 3 copies values that are
-- already in auth.users and invents none.
--
-- ⚠️ AND NULL STAYS NULL FOR DIRECT ARRIVALS. There is no DEFAULT 'direct' and
-- no backfill to one. "We do not know where she came from" and "she typed the
-- address in" are different facts; a default would make the second one up, for
-- every row, forever.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0106') then
    raise exception '0107 needs 0106 applied first.';
  end if;

  -- The function this migration replaces. Read live on 30 Oct 2026; the body in
  -- step 2 is that definition plus the two column writes and nothing else.
  if to_regprocedure('public.handle_new_auth_user()') is null then
    raise exception '0107 needs public.handle_new_auth_user.';
  end if;

  -- ⚠️ THE PREMISE OF THE WHOLE TWO-COLUMN DESIGN. If the founding grant no
  -- longer reads signup_source, the reason these are two columns has gone and
  -- this file's header is describing a database that no longer exists. Stop and
  -- re-read rather than apply a design whose justification has moved.
  if (select position('v_source is not null' in p.prosrc) = 0
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'handle_new_auth_user') then
    raise exception '0107: handle_new_auth_user no longer grants Founding Provider off '
      'v_source. That is the entire reason signup_source and signup_campaign are '
      'separate columns. Re-read this file''s header before applying it.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('signup_source', 'signup_campaign')
  ) then
    raise exception '0107: public.users already has signup_source or signup_campaign. '
      'Something else added it. Read that before running this.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The two columns.
-- ---------------------------------------------------------------------------
alter table public.users
  add column signup_source   text,
  add column signup_campaign text;

-- Length only. See the header: a constraint that can fire inside the signup
-- trigger is a constraint that can cost somebody an account with an error
-- message that names nothing. `left()` in step 2 keeps these unreachable.
alter table public.users
  add constraint users_signup_source_len
    check (signup_source is null or char_length(signup_source) <= 120),
  add constraint users_signup_campaign_len
    check (signup_campaign is null or char_length(signup_campaign) <= 120);

comment on column public.users.signup_source is
  'The ?ref= cohort code this account signed up with, or null. ⚠️ ITS PRESENCE '
  'GRANTS FOUNDING PROVIDER to a stylist in handle_new_auth_user, and 0045 '
  'treats that as the fee being settled — so this is not a free-text label. '
  'Written once at signup by that trigger; deliberately NOT in 0088''s client '
  'UPDATE grant list. Null means we have no record, never "direct".';

comment on column public.users.signup_campaign is
  'utm_source:utm_medium:utm_campaign for the advert or link this account '
  'arrived from, or null. A LABEL ONLY — read by no trigger, policy or RPC, '
  'which is what keeps a campaign from granting anything. Each part is reduced '
  'to [a-z0-9_-] so the colon separator is unambiguous: use split_part(…, '':'', '
  '1) for the source. No click identifier is ever stored — fbclid is recorded '
  'as the literal word and its value dropped in the browser. Null means we have '
  'no record, never "direct".';

-- ---------------------------------------------------------------------------
-- 2. handle_new_auth_user writes them.
--
-- ⚠️ THE BODY BELOW IS THE LIVE 30 Oct 2026 DEFINITION PLUS FOUR LINES: the
-- v_campaign declaration, two names in the insert column list, and two values.
-- Everything else — the role check, the age checks, the advisory lock, the
-- founding grant, the providers insert, the founding_providers insert — is
-- character-for-character what was running. ⚠️ THE FOUNDING CONDITION IS
-- UNTOUCHED: it still reads `v_source is not null` and has never read
-- v_campaign.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text := new.raw_user_meta_data->>'role';
  v_dob  text := new.raw_user_meta_data->>'date_of_birth';
  v_dob_date date;
  v_source text := nullif(btrim(coalesce(new.raw_user_meta_data->>'signup_source', '')), '');
  -- ⚠️ NEW, AND IT IS NOT USED BY THE FOUNDING GRANT BELOW. See the header.
  v_campaign text := nullif(btrim(coalesce(new.raw_user_meta_data->>'signup_campaign', '')), '');
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
  --
  -- ⚠️ v_source ONLY. A campaign tag must never reach this condition: see the
  -- header of 0107, and lib/attribution.ts in site/, which keeps the two
  -- apart from the moment they are read off the URL.
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
    date_of_birth, terms_accepted_at, is_founding_provider,
    signup_source, signup_campaign
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
    v_founding,
    -- ⚠️ CAPPED HERE, WHICH IS WHY THE CHECK CONSTRAINTS CANNOT FIRE. Metadata
    -- is client-settable and unbounded; nothing on our side sees the GoTrue
    -- call. left() is the only place this value is actually bounded.
    left(v_source, 120),
    left(v_campaign, 120)
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

-- ---------------------------------------------------------------------------
-- 3. Copy across the two values that already exist.
--
-- ⚠️ THIS IS A COPY, NOT A RECONSTRUCTION. Both values are sitting in
-- auth.users.raw_user_meta_data right now, put there by the `?ref=` path that
-- has worked all along. Nothing is inferred, nothing is guessed, and no row
-- without a recorded value gets one.
--
-- ⚠️ IT CANNOT GRANT ANYTHING. is_founding_provider is not touched; the stylist
-- among these two was granted it at signup and the other is a model. This
-- statement writes one column on two rows.
--
-- ⚠️ IF YOU WOULD RATHER THE COLUMN STARTED TRULY EMPTY, DELETE THIS STEP. The
-- migration is correct without it, and step 4's assertions do not depend on it.
-- The argument for keeping it is that 2 rows of real history make the column
-- harder to misread than 0 do.
--
-- `signup_campaign` is deliberately NOT backfilled: no account has one, because
-- the key did not exist until the commit that precedes this file.
-- ---------------------------------------------------------------------------
update public.users u
   set signup_source = left(nullif(btrim(a.raw_user_meta_data->>'signup_source'), ''), 120)
  from auth.users a
 where a.id = u.id
   and u.signup_source is null
   and nullif(btrim(coalesce(a.raw_user_meta_data->>'signup_source', '')), '') is not null;

-- ---------------------------------------------------------------------------
-- 4. Verify. Every line below measures something.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_n        int;
  v_granted  text;
  v_readers  text;
  v_src      text;
begin
  -- (a) Both columns exist, nullable, no default. A DEFAULT is the one thing
  --     that would turn "we do not know" into a fact we invented.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('signup_source', 'signup_campaign')
     and is_nullable = 'YES' and column_default is null and data_type = 'text';
  if v_n <> 2 then
    raise exception '0107: expected 2 nullable text columns with no default, found %. '
      'A DEFAULT here would make every direct arrival claim a source it never had.', v_n;
  end if;

  -- (b) ⚠️ NOT CLIENT-WRITABLE. 0088 granted UPDATE on users by name and 0099
  --     extended that list; neither of these must be in it, for either role.
  select string_agg(column_name || '/' || grantee, ', ') into v_granted
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('signup_source', 'signup_campaign')
     and grantee in ('authenticated', 'anon', 'PUBLIC')
     and privilege_type = 'UPDATE';
  if v_granted is not null then
    raise exception '0107: these are client-UPDATEable and must not be: %. Where somebody '
      'came from is recorded once by a definer trigger. A member who can UPDATE '
      'signup_source can award herself a Founding Provider slot. Rolled back.', v_granted;
  end if;

  -- (c) ⚠️⚠️ signup_campaign IS READ BY NOTHING, WHICH IS WHAT KEEPS A CAMPAIGN
  --     FROM GRANTING ANYTHING. This is the claim the header makes twice, so it
  --     is measured rather than promised: no function body and no policy
  --     expression in this schema may mention it.
  select string_agg(src, ', ') into v_readers from (
    select p.proname || '()' as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname <> 'handle_new_auth_user'
       and position('signup_campaign' in p.prosrc) > 0
    union all
    select 'policy ' || pol.polname || ' on ' || pol.polrelid::regclass::text
      from pg_policy pol
     where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
        || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
           like '%signup_campaign%'
  ) r;
  if v_readers is not null then
    raise exception '0107: signup_campaign is read by %. It is meant to be a label that '
      'grants nothing — the reason it is a second column rather than going in '
      'signup_source. Rolled back.', v_readers;
  end if;

  -- (d) The trigger writes both, and the founding grant still reads only
  --     v_source. The second half is the one that matters: a future edit
  --     widening that condition to v_campaign is the bug this file exists to
  --     prevent, and it would be invisible.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_auth_user';
  if position('left(v_source, 120)' in v_src) = 0
     or position('left(v_campaign, 120)' in v_src) = 0 then
    raise exception '0107: handle_new_auth_user does not write both columns capped. '
      'Uncapped, client-settable metadata reaches a CHECK that then fails inside the '
      'trigger as "Database error saving new user". Rolled back.';
  end if;
  if position('v_role = ''provider'' and v_source is not null' in v_src) = 0 then
    raise exception '0107: the Founding Provider condition is not the one this migration '
      'was written against. Rolled back rather than guess what it now grants on.';
  end if;
  if position('v_campaign' in replace(v_src, 'left(v_campaign, 120)', '')) <> 0
     and position('if v_role = ''provider'' and v_campaign' in v_src) > 0 then
    raise exception '0107: v_campaign reaches the Founding Provider condition. A campaign '
      'tag must never grant a fee waiver. Rolled back.';
  end if;

  -- (e) The copy in step 3, reported as both numbers rather than one.
  select count(*) into v_n from public.users where signup_source is not null;
  raise notice '0107: signup_source now set on % of % users; % have no record of where '
    'they came from and never will — the field did not exist when they signed up. '
    'signup_campaign is set on 0, because the key it reads was deployed in the commit '
    'before this file. An empty column here means "we did not ask", not "no campaign '
    'traffic".',
    v_n, (select count(*) from public.users),
    (select count(*) from public.users where signup_source is null);
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0107', 'where_a_signup_came_from_is_a_column', 'a33d97894b0f8946fad2b4771fb297d86a4e075c966122df1970561afcbd0bbc');

commit;

notify pgrst, 'reload schema';

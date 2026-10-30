-- ===========================================================================
-- 0108_a_dial_wired_to_nothing_is_worse_than_no_dial
--
-- ⚠️ Apply 0107 first. Two things, deliberately in one migration.
--
-- ⚠️⚠️ NOT APPLIED. Written 30 Oct 2026, committed on its own to be read and
-- diffed before it runs — the same treatment 0107 got, and for the same reason:
-- this replaces `handle_new_auth_user`, the one function that breaks every
-- signup if it is wrong.
--
-- ── 1. THE FOUNDING GRANT IS GATED ON THE FEE EXISTING ────────────────────
--
-- `handle_new_auth_user` grants Founding Provider to any stylist arriving with
-- a non-empty `signup_source`, and `provider_fee_settled()` (0045) treats that
-- flag as one of the three ways the £14.99 counts as settled. The fee has been
-- switched OFF since 0102 (23 Oct 2026), so the grant awards a waiver against a
-- charge nobody is asked for, out of a pool capped at 200.
--
-- ⚠️ AND IT GOT FASTER THIS WEEK. Until 30 Oct a `?ref=` only reached /sign-up
-- if the link pointed straight at it; the capture added that morning carries it
-- from any landing page. So slots are consumed at a higher rate than when this
-- was last thought about, by the same links.
--
-- ⚠️ THE GRANT'S SELECTOR STOPPED MATCHING ITS PURPOSE, which is the real
-- argument. It was never "reward early stylists" — it is "reward whoever
-- arrived with a non-empty source". That was a good proxy while the invite link
-- WAS the offer. Now the link is attribution, so the grant selects for
-- link-provenance, which is noise: slot 1 went to a genuine founding stylist,
-- slot 2 would go to whoever clicks a QR code.
--
-- ⚠️⚠️ `signup_source` IS STILL WRITTEN WHEN THE GATE IS CLOSED, AND THAT IS
-- THE WHOLE POINT OF WHERE THE CONDITION SITS. The gate is on the GRANT block
-- only. The users insert is below it and unconditional, so a `?ref=` arrival
-- while the fee is off records its source, takes no slot, and is still
-- countable. Step 4(b) asserts the record survives a closed gate.
--
-- ⚠️ NOTHING RETROACTIVE. Samantha keeps slot 1 — she arrived through a genuine
-- invite while the offer was published. No users row and no founding_providers
-- row is touched; step 4(f) measures that.
--
-- ⚠️ REVERSIBLE BY THE FLAG, NOT BY A MIGRATION. Switch the fee back on
-- (supabase/FEE-REINSTATEMENT.md §1) and granting resumes on the next signup,
-- with the cap and the slot numbering exactly where they were left.
--
-- ── 2. THE CONSOLE STOPS LYING ────────────────────────────────────────────
--
-- Three settings keys are dials wired to nothing. Measured 30 Oct 2026 against
-- every function body in this schema AND every .ts/.tsx/.mjs in site/, admin/,
-- mobile/, scripts/ and supabase/functions/:
--
--   founding_provider_limit          read by NO function. The admin console
--                                    writes it and reads it back. Signup reads
--                                    `founding_provider_cap` instead, so
--                                    setting this to 0 to stop the bleed would
--                                    have done NOTHING — the most dangerous
--                                    kind of dead dial, because it looks like
--                                    the brake.
--   founding_provider_offer_enabled  read by NO function. Rendered as an ON/OFF
--                                    toggle labelled "Founding Provider Offer",
--                                    currently showing ON. Turning it off
--                                    changed nothing.
--   materials_cost_cap_pence         ⚠️ READ BY NOTHING ANYWHERE — no function,
--                                    no constraint, no column default, no app
--                                    code, and not even rendered in the
--                                    console. NOT named in the brief for this
--                                    migration; found while measuring the class
--                                    rather than the instance. `sessions` has
--                                    no materials_cost above 0 in its history,
--                                    so nothing is being capped or failing to
--                                    be capped. Restore with:
--                                      insert into public.settings (key, value)
--                                      values ('materials_cost_cap_pence', '5000');
--
-- ── ⚠️ WHICH END STATE, AND WHY THE OFFER TOGGLE IS DELETED NOT WIRED ─────
--
-- The choice was: make `founding_provider_offer_enabled` real and read it in
-- the grant, or delete it and let the console surface `provider_fee_enabled()`.
-- Deleted. Two switches that can disagree is the defect this migration exists
-- to remove, not a shape to preserve — and "is the founding offer on" has no
-- meaning independent of "do we charge stylists", because the offer IS the
-- waiver. One switch.
--
-- ⚠️ THE CONSOLE SHOULD SURFACE `provider_fee_enabled()` READ-ONLY, NOT AS A
-- TOGGLE. Turning the fee on is a twelve-step checklist in
-- FEE-REINSTATEMENT.md — restoring the /verify fee block, the Terms §5 body,
-- the non-refundable clause, advance notice to existing stylists that Terms §5
-- commits to, and a Stripe path that has NEVER run end to end against a real
-- card. A one-click toggle for that is a trap, not a control.
--
-- ⚠️⚠️ THE CONSOLE CODE CANNOT BE IN THIS FILE, AND THE ORDER MATTERS.
-- `admin/app/settings/page.tsx` renders the two controls being deleted here; a
-- migration cannot edit TSX. Applying this first would leave the console
-- rendering a price field and a toggle for keys that no longer exist — a
-- different lie, not a fixed one. So the console change ships FIRST, as its own
-- commit, and this is applied after. There is no window in that order: a
-- console that has stopped claiming to control the offer is not lying while it
-- waits for the gate.
--
-- ── 3. THE DEFECT CLASS, NOT THE INSTANCE ─────────────────────────────────
--
-- Deleting three keys fixes three dials. The class is that a key could be added
-- or orphaned again with nothing noticing — which is how all three got here. So
-- `settings.key` becomes a CLOSED VOCABULARY: a CHECK constraint listing every
-- permitted key, so adding one costs a migration and therefore a decision. The
-- same shape as the eleven keys in `admin_activity_seen` (0104).
--
-- ⚠️⚠️ "NO KEY THAT NO FUNCTION READS" IS THE RIGHT INSTINCT AND THE WRONG
-- RULE, AND APPLYING IT LITERALLY WOULD DELETE WORKING FEATURES. Three of the
-- six surviving keys are read by application code and by no function at all:
--
--   image_review_enabled       admin/app/moderation/page.tsx — a live screen
--   subscription_price_pence   admin/app/settings/page.tsx
--   verification_price_pence   admin/app/settings/page.tsx
--
-- So the assertion in step 4(d) is "read by a function OR declared here with
-- its reader", and the declaration is what makes it honest: a key nobody reads
-- cannot pass by being quietly forgotten, it has to be written down.
--
-- ⚠️⚠️⚠️ AND THE DECLARATION IMMEDIATELY EXPOSES A WORSE ONE THAN THE THREE
-- BEING DELETED. `subscription_price_pence` (499) and `verification_price_pence`
-- (1499) are read ONLY by the console that edits them. The prices actually
-- charged are hardcoded in `supabase/functions/stripe-payment/index.ts` —
-- `amount: 1499` and `unit_amount: 499` — and the copy hardcodes "£4.99" in
-- `subscribe/page.tsx` and `SubscribePanel.tsx`. So the console's two price
-- fields change neither what Stripe charges nor what the member reads.
--
-- They are NOT touched here, and that is deliberate: Stripe is LIVE, real cards
-- are charged, and re-sourcing a price is a payments change that belongs in its
-- own piece of work with its own testing. What this migration does is stop them
-- being invisible — they are declared below as decorative, in writing, so the
-- next person to change a price in the console learns it from the registry
-- instead of from a customer.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0107') then
    raise exception '0108 needs 0107 applied first.';
  end if;

  if to_regprocedure('public.provider_fee_enabled()') is null then
    raise exception '0108 needs provider_fee_enabled(); it is the gate this adds.';
  end if;

  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_auth_user';
  if v_src is null then
    raise exception '0108 needs public.handle_new_auth_user.';
  end if;

  -- ⚠️ THE EXACT BODY THIS WAS WRITTEN AGAINST. The replacement in step 1 is
  -- the live 30 Oct 2026 definition with ONE line changed. If either of these
  -- is missing, the body has moved since and a blind replace would silently
  -- revert whatever moved it — which is the failure mode that matters most on
  -- this particular function.
  if position('if v_role = ''provider'' and v_source is not null then' in v_src) = 0 then
    raise exception '0108: the Founding Provider condition is not the one this migration was '
      'written against. Read handle_new_auth_user before applying. Nothing changed.';
  end if;
  if position('left(v_source, 120)' in v_src) = 0
     or position('left(v_campaign, 120)' in v_src) = 0 then
    raise exception '0108: handle_new_auth_user does not write both 0107 columns. The body has '
      'moved. Nothing changed.';
  end if;

  -- The three keys, as measured. If one is already gone, somebody else has been
  -- here and the reasoning above needs re-reading rather than re-running.
  if (select count(*) from public.settings
       where key in ('founding_provider_limit', 'founding_provider_offer_enabled',
                     'materials_cost_cap_pence')) <> 3 then
    raise exception '0108 expected all three dead keys to exist. One or more is already gone. '
      'Read why before removing the rest. Nothing changed.';
  end if;

  -- ⚠️ THE GATE IS ONLY MEANINGFUL WHILE THE FEE IS OFF, and this migration's
  -- whole argument assumes it is. Said out loud rather than assumed: if the fee
  -- has been switched on, granting is correct again and this changes nothing
  -- today — which is fine, but you should know that before applying it.
  if public.provider_fee_enabled() then
    raise notice '0108: provider_fee_enabled() is TRUE, so the new gate is open and founding '
      'grants continue exactly as now. That is correct behaviour, not a no-op bug — but it '
      'is not the state this was written in (it was false on 30 Oct 2026).';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The grant is gated. ONE LINE differs from the live body.
--
-- ⚠️ Diff this against `pg_get_functiondef` before applying. The only change is
-- the Founding Provider condition gaining `and public.provider_fee_enabled()`.
-- Role checks, DOB checks, the advisory lock, the cap read, the slot
-- arithmetic, the users insert (including both 0107 columns), the providers
-- insert and the founding_providers insert are unchanged.
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
  v_campaign text := nullif(btrim(coalesce(new.raw_user_meta_data->>'signup_campaign', '')), '');
  v_cap    int;
  v_taken  int;
  v_slot   int;
  v_founding boolean := false;
begin
  if v_role is null or v_role not in ('model', 'provider') then
    raise exception
      'Signup rejected: role must be model or provider (got %)', coalesce(v_role, 'null')
      using errcode = '22023';
  end if;
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
  -- ⚠️⚠️ THE ONE CHANGED LINE (0108). Founding Provider settles the stylist
  -- fee; while there is no fee it settles nothing and spends a capped slot on
  -- whoever happened to arrive with a parameter. The gate is HERE, on the
  -- grant, and NOT around the insert below — `signup_source` must still be
  -- recorded when this is closed, because it is the attribution column now.
  if v_role = 'provider' and v_source is not null and public.provider_fee_enabled() then
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
    left(v_source, 120),
    left(v_campaign, 120)
  )
  on conflict (id) do nothing;
  if v_role = 'provider' then
    insert into public.providers (user_id)
    values (new.id)
    on conflict do nothing;
  end if;
  if v_founding then
    insert into public.founding_providers (user_id, slot_number, claimed_at)
    values (new.id, v_slot, now())
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The three dials wired to nothing.
-- ---------------------------------------------------------------------------
delete from public.settings
 where key in ('founding_provider_limit',
               'founding_provider_offer_enabled',
               'materials_cost_cap_pence');

-- ---------------------------------------------------------------------------
-- 3. The vocabulary closes.
--
-- ⚠️ Adding a settings key now costs a migration. That is the point: all three
-- keys removed above were added without anyone having to say what would read
-- them, and nothing noticed for months. The console only ever writes the keys
-- it renders (admin/app/settings/page.tsx and moderation/page.tsx are the only
-- writers of this table in any app), so this refuses nothing that happens today.
-- ---------------------------------------------------------------------------
alter table public.settings
  add constraint settings_key_is_declared check (key in (
    'banned_words',
    'founding_provider_cap',
    'image_review_enabled',
    'provider_fee_enabled',
    'subscription_price_pence',
    'verification_price_pence'
  ));

comment on constraint settings_key_is_declared on public.settings is
  'The closed vocabulary of settings keys, and who reads each one — measured '
  '30 Oct 2026 against every function body and every .ts/.tsx/.mjs in site/, '
  'admin/, mobile/, scripts/ and supabase/functions/. '
  'banned_words: banned_word_hit, banned_words_check, screen_message, '
  'screen_status_post (gates publication). '
  'founding_provider_cap: handle_new_auth_user. '
  'provider_fee_enabled: provider_fee_enabled(), provider_fee_settled(). '
  'image_review_enabled: NO function — admin/app/moderation/page.tsx only. '
  'subscription_price_pence: NO function — ⚠️ DECORATIVE, admin console only; '
  'the charged price is hardcoded unit_amount 499 in stripe-payment and "£4.99" '
  'in subscribe copy. '
  'verification_price_pence: NO function — ⚠️ DECORATIVE, admin console only; '
  'the charged price is hardcoded amount 1499 in stripe-payment. '
  '⚠️ Adding a key means adding it here, which means saying what reads it.';

-- ---------------------------------------------------------------------------
-- 4. Verify. Every line below measures something.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src     text;
  v_orphans text;
  v_n       int;
  k_app_read constant text[] := array[
    -- Read by application code and by no function. Declared, not forgotten.
    'image_review_enabled',
    'subscription_price_pence',
    'verification_price_pence'
  ];
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_auth_user';

  -- (a) The gate is on, and the ungated form is gone. The old condition ended
  --     `is not null then`; the new one cannot, because the gate follows it.
  if position('v_source is not null and public.provider_fee_enabled() then' in v_src) = 0 then
    raise exception '0108: the Founding Provider condition is not gated on provider_fee_enabled. '
      'Rolled back.';
  end if;
  if position('v_source is not null then' in v_src) > 0 then
    raise exception '0108: an UNGATED Founding Provider condition survives in '
      'handle_new_auth_user. Rolled back rather than leave two conditions.';
  end if;

  -- (b) ⚠️⚠️ THE RECORD SURVIVES A CLOSED GATE. The users insert still writes
  --     signup_source, and it is NOT inside the gated block — proved by the
  --     insert appearing AFTER the block's `end if;`, and by the gate appearing
  --     exactly once in the whole body.
  if position('left(v_source, 120)' in v_src) = 0 then
    raise exception '0108: handle_new_auth_user no longer writes signup_source. The gate was '
      'supposed to stop the GRANT, not the record. Rolled back.';
  end if;
  if position('insert into public.users' in v_src)
       < position('public.provider_fee_enabled() then' in v_src) then
    raise exception '0108: the users insert sits INSIDE or above the gated block. A ?ref= '
      'arrival would stop being recorded while the fee is off. Rolled back.';
  end if;
  if (length(v_src) - length(replace(v_src, 'provider_fee_enabled', '')))
       / length('provider_fee_enabled') <> 1 then
    raise exception '0108: provider_fee_enabled appears more than once in handle_new_auth_user. '
      'It gates the grant and nothing else. Rolled back.';
  end if;

  -- (c) The three dials are gone.
  select string_agg(key, ', ') into v_orphans from public.settings
   where key in ('founding_provider_limit', 'founding_provider_offer_enabled',
                 'materials_cost_cap_pence');
  if v_orphans is not null then
    raise exception '0108: these were meant to be deleted and are still here: %. Rolled back.',
      v_orphans;
  end if;

  -- (d) ⚠️⚠️ THE DEFECT CLASS. Every surviving key is read by a function, or is
  --     declared above as application-read. Neither is not an option.
  select string_agg(s.key, ', ' order by s.key) into v_orphans
    from public.settings s
   where not (s.key = any (k_app_read))
     and not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and position(s.key in p.prosrc) > 0);
  if v_orphans is not null then
    raise exception '0108: these settings keys are read by no function and are not declared as '
      'application-read: %. A dial wired to nothing is worse than no dial — delete it, or '
      'declare what reads it. Rolled back.', v_orphans;
  end if;

  -- And the declaration cannot rot the other way: a key listed as app-read that
  -- no longer exists means the list is describing something gone.
  select string_agg(k, ', ') into v_orphans from unnest(k_app_read) k
   where not exists (select 1 from public.settings s where s.key = k);
  if v_orphans is not null then
    raise exception '0108: declared as application-read but not present in settings: %. '
      'Rolled back.', v_orphans;
  end if;

  -- (e) The vocabulary really is closed — tested, not assumed.
  begin
    insert into public.settings (key, value) values ('zz_0108_probe', 'x');
    delete from public.settings where key = 'zz_0108_probe';
    raise exception '0108: settings accepted an undeclared key, so the vocabulary is not closed. '
      'Rolled back.';
  exception when check_violation then
    null;  -- refused, which is the whole point
  end;

  -- (f) ⚠️ NOTHING RETROACTIVE. Samantha keeps slot 1.
  select count(*) into v_n from public.founding_providers;
  if v_n <> 1 then
    raise exception '0108: founding_providers holds % rows, expected the 1 that existed before. '
      'This migration must not add or remove a slot. Rolled back.', v_n;
  end if;
  select count(*) into v_n from public.users where is_founding_provider;
  if v_n <> 1 then
    raise exception '0108: % users carry is_founding_provider, expected 1. Rolled back.', v_n;
  end if;

  raise notice '0108: founding grants are now gated on provider_fee_enabled() (currently %). '
    'signup_source is still recorded either way. settings holds % keys, all declared. '
    'Slot 1 is untouched.',
    public.provider_fee_enabled(), (select count(*) from public.settings);
end $mig$;

-- ⚠️ WHAT NONE OF THE ABOVE PROVES: that a real signup behaves. Step 4(b)
-- matches strings in a function body; the behavioural proof is a signup. With
-- the fee off, create a stylist through `/sign-up?role=stylist&ref=gatetest`
-- and expect: users.signup_source = 'gatetest', users.is_founding_provider =
-- false, and `select count(*) from public.founding_providers` still 1.

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0108', 'a_dial_wired_to_nothing_is_worse_than_no_dial', 'e8504288f82abc094051a7ddfbbae322c57b991187600214544c8d8dc4385d62');

commit;

notify pgrst, 'reload schema';

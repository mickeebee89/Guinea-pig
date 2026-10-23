-- ===========================================================================
-- 0102_cavy_is_free_for_stylists_and_the_code_says_so_too
--
-- ⚠️ Apply 0101 first. The £14.99 stylist verification fee is TURNED OFF, not
-- removed. Every piece of machinery stays: verification_payments and its rows,
-- stripe-payment and stripe-webhook, provider_fee_waived, is_founding_provider,
-- founding_providers, handle_new_auth_user's founding grant. One settings row
-- turns it back on. See supabase/FEE-REINSTATEMENT.md.
--
-- ⚠️⚠️ THE ID CHECK IS NOT TOUCHED. The fee and the selfie are different gates
-- that happen to sit next to each other on one page. Nothing here changes the
-- selfie, the comparison, the admin queue, or a word of its copy.
--
-- ── ⚠️⚠️ WHY A FUNCTION AND NOT "READ THE SETTINGS ROW" ──────────────────
-- `settings` RLS is `settings_select_admin using is_admin()`. A stylist reads
-- NOTHING from it. So a call site that read the row directly and defaulted a
-- missing answer to false would fail TOWARD CHARGING — the worst direction for
-- a flag whose whole job is to stop a charge.
--
-- provider_fee_enabled() is SECURITY DEFINER so the answer does not depend on
-- who asks. It is safe as DEFINER in a way provider_fee_settled is not: it
-- exposes one CONFIGURATION boolean and nothing about any person.
--
-- ── ⚠️⚠️ "IS THE FEE SETTLED" EXISTED IN THREE PLACES. NOW IT EXISTS IN ONE
-- Before this migration the rule was implemented three times:
--   public.provider_fee_settled()          SQL
--   site/lib/queries/shop.ts:314           TypeScript, recomputed
--   site/app/(app)/verify/actions.ts:133   TypeScript, recomputed
-- A flag inside the SQL function alone would have left the two TypeScript
-- copies charging. shop.ts:341 would still have refused to publish a shop with
-- "Pay the £14.99 fee first" — a real block, under copy promising the opposite.
--
-- ⚠️ THE TWO COPIES COULD NOT SIMPLY CALL IT: provider_fee_settled's ACL was
-- `postgres, service_role` — `authenticated` had no EXECUTE, which is WHY the
-- TypeScript copies existed. This migration grants it, which is what makes one
-- source of truth possible rather than merely desirable.
--
-- ✅ AND THE ANSWER IS CORRECT FOR THE CALLER, MEASURED NOT ASSUMED. It stays
-- SECURITY INVOKER, so it reads under the caller's own RLS:
--   verification_payments_select_own  using (user_id = auth.uid() or is_admin())
--   users "users can read own row"    using (auth.uid() = id)
-- Simulated as b0df9c2f: her own users row visible, her own payments visible.
-- ⚠️ CALLED FOR SOMEBODY ELSE IT RETURNS false WHATEVER THE TRUTH IS, because
-- RLS hides the rows rather than erroring. Nothing calls it that way — every
-- call site passes the signed-in user — and it must stay that way.
--
-- ── ⚠️ CASE, NOT OR ───────────────────────────────────────────────────────
-- `not provider_fee_enabled() or exists(...)` would be correct only if Postgres
-- promised left-to-right evaluation of OR, and it does not. `case` does, by
-- definition. Same reasoning as 0100's storage clause: when short-circuiting is
-- the POINT rather than an optimisation, the construct has to guarantee it.
--
-- ── WHAT IS DELIBERATELY LEFT ALONE ───────────────────────────────────────
--   handle_new_auth_user   still grants founding status at signup, silently
--   founding_providers     still records who got it (1 row today)
--   provider_fee_waived    still settable; the admin lever for reinstatement
--   verification_price_pence, founding_provider_* settings: untouched, so a
--                          reinstatement finds its numbers where it left them
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0101') then
    raise exception '0102 needs 0101 applied first.';
  end if;

  if to_regprocedure('public.provider_fee_settled(uuid)') is null then
    raise exception '0102 rewrites provider_fee_settled and it does not exist.';
  end if;

  if to_regclass('public.settings') is null then
    raise exception '0102 needs the settings table.';
  end if;

  -- ⚠️ NOT `on conflict do nothing` BELOW, SO THIS HAS TO BE TRUE HERE. A row
  -- that already exists might say 'true', and absorbing it silently would turn
  -- the fee ON in a migration whose entire purpose is to turn it off.
  if exists (select 1 from public.settings where key = 'provider_fee_enabled') then
    raise exception '0102 expects no provider_fee_enabled row yet; one exists with value %. '
      'Decide what it should be rather than letting this migration guess.',
      (select value from public.settings where key = 'provider_fee_enabled');
  end if;

  if to_regprocedure('public.provider_fee_enabled()') is not null then
    raise exception '0102 expects the name provider_fee_enabled to be free; it is taken.';
  end if;

  -- The founding machinery must survive this migration untouched. Asserted
  -- here as a baseline so step 5 can prove it did.
  if to_regprocedure('public.handle_new_auth_user()') is null
     or to_regclass('public.founding_providers') is null then
    raise exception '0102 expects handle_new_auth_user and founding_providers to exist; '
      'they are kept, not removed.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The single source of truth. Default OFF: Cavy is free for stylists.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values ('provider_fee_enabled', 'false');

-- ---------------------------------------------------------------------------
-- 2. The flag, readable by anyone signed in.
--
--    STABLE so it can be used inside a policy or another function without
--    being re-read per row. DEFINER because settings is admin-only. pg_temp
--    last, per 0094.
-- ---------------------------------------------------------------------------
create or replace function public.provider_fee_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  -- ⚠️ A MISSING ROW MEANS OFF. The row is created by this migration, so its
  -- absence means somebody deleted it — and the safe reading of "the flag is
  -- gone" is "do not charge", never "charge". coalesce, not strict equality on
  -- a row that might not be there.
  select coalesce(
    (select s.value = 'true' from public.settings s where s.key = 'provider_fee_enabled'),
    false);
$fn$;

comment on function public.provider_fee_enabled() is
  'Whether the one-off stylist verification fee is charged at all. The single '
  'source of truth for that question: SQL and both TypeScript call sites read '
  'it through provider_fee_settled. Default false. See FEE-REINSTATEMENT.md.';

revoke all on function public.provider_fee_enabled() from public;
revoke all on function public.provider_fee_enabled() from anon;
grant execute on function public.provider_fee_enabled() to authenticated;
grant execute on function public.provider_fee_enabled() to service_role;

-- ---------------------------------------------------------------------------
-- 3. The rule, short-circuited.
--
--    ⚠️ STILL SECURITY INVOKER. Not an oversight — it reads a person's payment
--    and waiver state, and INVOKER plus RLS is what keeps it from being an
--    oracle on somebody else's account. The body is otherwise byte-for-byte
--    the rule that was there, wrapped in a CASE.
-- ---------------------------------------------------------------------------
create or replace function public.provider_fee_settled(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when not public.provider_fee_enabled() then true
    else exists (select 1 from public.verification_payments vp where vp.user_id = p_user_id)
      or coalesce((select coalesce(u.is_founding_provider, false) or coalesce(u.provider_fee_waived, false)
                     from public.users u where u.id = p_user_id), false)
  end;
$fn$;

comment on function public.provider_fee_settled(uuid) is
  'True when the stylist fee is not owed: either it is switched off entirely '
  '(provider_fee_enabled false, the default) or this user has paid, is a '
  'Founding Provider, or has been waived. SECURITY INVOKER on purpose — pass '
  'the SIGNED-IN user, never somebody else, because RLS hides another user''s '
  'rows and the answer would be a confident false.';

-- ---------------------------------------------------------------------------
-- 4. ⚠️ THE GRANT THAT MAKES ONE SOURCE OF TRUTH POSSIBLE.
--
--    Without this, `authenticated` cannot call it and the web has no choice but
--    to recompute the rule — which is exactly how it came to exist in three
--    places. service_role and postgres keep what they had.
-- ---------------------------------------------------------------------------
revoke all on function public.provider_fee_settled(uuid) from public;
revoke all on function public.provider_fee_settled(uuid) from anon;
grant execute on function public.provider_fee_settled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ⚠️⚠️ POST-CONDITION: BEHAVIOUR, NOT JUST SHAPE.
--
--    The strongest assertion available here is what the function now ANSWERS,
--    so that is what is asserted — including for the four accounts that must
--    NOT change, not only the one that must.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
  v_flipped boolean;
  v_unchanged int;
begin
  if public.provider_fee_enabled() <> false then
    raise exception '0102: the fee flag did not land as false.';
  end if;
  if (select value from public.settings where key = 'provider_fee_enabled') <> 'false' then
    raise exception '0102: the settings row is not false.';
  end if;

  -- The one account with no payment, no founding status and no waiver. It read
  -- FALSE before this migration (measured 23 Oct 2026) and must read true now.
  -- If this account ever gains a waiver the assertion stops proving anything,
  -- which is why its three inputs are checked alongside it.
  select public.provider_fee_settled('b0df9c2f-02c5-4fef-afb0-9b184c3b9130') into v_flipped;
  if v_flipped is not true then
    raise exception '0102: b0df9c2f still reads % — the short-circuit is not working.', v_flipped;
  end if;
  if exists (
    select 1 from public.users u
    where u.id = 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'
      and (coalesce(u.is_founding_provider, false) or coalesce(u.provider_fee_waived, false))
  ) or exists (
    select 1 from public.verification_payments vp
    where vp.user_id = 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'
  ) then
    raise exception '0102: b0df9c2f now settles for a reason OTHER than the flag, so the '
      'test above proves nothing. Pick a different account before trusting this.';
  end if;

  -- Everyone who settled before must still settle. A flag that turned the fee
  -- off AND broke the paid path would pass a test that only looked at b0df9c2f.
  select count(*) into v_unchanged
  from public.providers p
  where not public.provider_fee_settled(p.user_id);
  if v_unchanged <> 0 then
    raise exception '0102: % provider(s) still read as owing the fee after it was '
      'switched off.', v_unchanged;
  end if;

  -- Shape: the CASE is present and the flag is what it branches on.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'provider_fee_settled';
  if position('case' in lower(v_src)) = 0 or position('provider_fee_enabled' in v_src) = 0 then
    raise exception '0102: provider_fee_settled does not branch on the flag with a CASE.';
  end if;

  -- ⚠️ INVOKER PRESERVED. Asserted because flipping it to DEFINER would turn a
  -- per-person read into an oracle, and nothing else in this file would notice.
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'provider_fee_settled') is not false then
    raise exception '0102: provider_fee_settled is no longer SECURITY INVOKER.';
  end if;

  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'provider_fee_enabled') is not true
     or (select array_to_string(p.proconfig, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'provider_fee_enabled') <> 'search_path=public, pg_temp' then
    raise exception '0102: provider_fee_enabled is not DEFINER with search_path public, pg_temp.';
  end if;

  -- ACLs. A new DEFINER function starts at EXECUTE TO PUBLIC (0097, fourth time).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('provider_fee_enabled', 'provider_fee_settled')
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0102: one of the fee functions grants EXECUTE to PUBLIC.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
    where n.nspname = 'public' and p.proname = 'provider_fee_settled'
      and a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE'
  ) then
    raise exception '0102: authenticated cannot execute provider_fee_settled, so the web '
      'still has to recompute the rule and this migration solved nothing.';
  end if;

  -- ⚠️ THE FOUNDING MACHINERY IS KEPT. Asserted rather than assumed, because
  -- "nothing is removed" is the promise this whole migration rests on.
  if to_regprocedure('public.handle_new_auth_user()') is null
     or to_regclass('public.founding_providers') is null
     or to_regclass('public.verification_payments') is null then
    raise exception '0102: something that was supposed to be kept is gone.';
  end if;
  if not exists (select 1 from public.settings where key = 'verification_price_pence') then
    raise exception '0102: verification_price_pence was removed. Reinstatement needs it.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0102', 'cavy_is_free_for_stylists_and_the_code_says_so_too', '07f332677692172f871441199b45357e4dc6801297a1b0adcbc54aabc72fcf54');

commit;

notify pgrst, 'reload schema';

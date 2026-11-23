-- ===========================================================================
-- 0109_subscription_enabled_global_flag
--
-- ⚠️⚠️ ALREADY APPLIED. DO NOT RUN THIS AGAINST THE LIVE DATABASE.
--
-- This file was written on 18 Nov 2026 to RECORD a change that was already
-- live. The change was applied straight to the database through the Supabase
-- connector and recorded in `supabase_migrations.schema_migrations` as
-- **20261118071854 subscription_enabled_global_flag** — the Supabase CLI's own
-- ledger, which is not the one this repo keeps (`public.schema_migrations`).
-- So the schema moved and nothing in the repo could rebuild it.
--
-- ⚠️ THE SQL BELOW IS NOT A RECONSTRUCTION. `schema_migrations.statements`
-- stores what was executed, and steps 1–4 are that text verbatim, comments
-- included. The comments explaining the fail direction were written at the time
-- and are the part most worth keeping, so they are not re-worded here.
--
-- ⚠️ WHAT IS ADDED, AND IT IS ONLY SCAFFOLDING: this header, the preflight
-- guard, the verify block, and the footer. `drop constraint` has also gained
-- `if exists`, so a rebuild can run this file twice without failing — every
-- other statement was already idempotent (`create or replace`,
-- `on conflict do nothing`).
--
-- ── ⚠️ THE LEDGER IS STILL OUT OF STEP, AND A REBUILD IS NOT WHAT FIXES IT ─
-- The footer inserts '0109' into `public.schema_migrations`, which is right for
-- a database built from these files. The LIVE database has the schema change
-- but no '0109' row, so `scripts/migration-status.mjs` will report this file as
-- PENDING until the row exists. Running the file to get the row would re-run
-- the DDL, which is the thing not to do.
--
-- To reconcile the live ledger WITHOUT re-running anything, insert the row on
-- its own — checksum from `node scripts/migration-status.mjs`:
--
--   insert into public.schema_migrations (version, name, checksum)
--   values ('0109', 'subscription_enabled_global_flag', '<checksum>')
--   on conflict (version) do nothing;
--
-- ── WHAT IT DOES ──────────────────────────────────────────────────────────
-- Membership becomes a switch. `subscription_enabled()` is read by
-- `model_may_apply` and by `tg_session_apply_gate`, and since 18 Nov 2026 by
-- `site/lib/verification.ts` (`getGateFlags`). Set to 'false': no model is
-- asked to pay.
--
-- ⚠️ IT DOES NOT TOUCH THE ID CHECK. At this point verification was still
-- unconditional in both functions — 0110 is what puts it behind a flag. The
-- `and coalesce(u.is_verified, false)` you can see below with no flag around it
-- is correct for THIS migration and is replaced by the next one.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0108') then
    raise exception '0109 needs 0108 applied first.';
  end if;

  -- The shape being mirrored. If this is missing, the reasoning in the header
  -- has nothing to point at and the fail direction below is uncorroborated.
  if to_regprocedure('public.provider_fee_enabled()') is null then
    raise exception '0109 mirrors provider_fee_enabled(); it does not exist here.';
  end if;

  if to_regprocedure('public.model_may_apply(uuid)') is null then
    raise exception '0109 replaces model_may_apply(uuid); it does not exist here.';
  end if;
  if to_regprocedure('public.tg_session_apply_gate()') is null then
    raise exception '0109 replaces tg_session_apply_gate(); it does not exist here.';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.settings'::regclass
                    and conname = 'settings_key_is_declared') then
    raise notice '0109: settings_key_is_declared is not present. It is re-created below, '
      'so this is survivable — but 0108 should have added it, so read why it is gone.';
  end if;
end $mig$;

-- ===========================================================================
-- STEPS 1-4 ARE THE APPLIED TEXT, VERBATIM FROM
-- supabase_migrations.schema_migrations.statements FOR 20261118071854.
-- The only edit is `if exists` on the drop. Do not tidy the wording.
-- ===========================================================================

-- Membership can be switched off platform-wide while the marketplace is thin.
-- Mirrors provider_fee_enabled() deliberately: same settings table, same
-- coalesce-to-false shape, same meaning for a missing row.
--
-- POLARITY: 'false' means membership is NOT required, i.e. free for models.
-- A MISSING ROW MEANS FREE. Same reasoning as the provider fee: the safe
-- reading of "the flag is gone" is "do not charge", never "charge". This is a
-- revenue gate, not a safety gate -- the ID check is enforced separately in
-- model_may_apply and is unaffected by this flag -- so failing open costs
-- money, not safety.

alter table public.settings drop constraint if exists settings_key_is_declared;
alter table public.settings add constraint settings_key_is_declared
  check (key = any (array[
    'banned_words'::text,
    'founding_provider_cap'::text,
    'image_review_enabled'::text,
    'provider_fee_enabled'::text,
    'subscription_enabled'::text,
    'subscription_price_pence'::text,
    'verification_price_pence'::text]));

insert into public.settings (key, value)
values ('subscription_enabled', 'false')
on conflict (key) do nothing;

create or replace function public.subscription_enabled()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- A MISSING ROW MEANS OFF (free). See the migration note above.
  select coalesce(
    (select s.value = 'true' from public.settings s where s.key = 'subscription_enabled'),
    false);
$function$;

-- model_may_apply is the single hinge: tg_session_apply_gate calls it for the
-- pass/fail decision, so short-circuiting here switches off the membership
-- requirement in BOTH the trigger and anything else that asks. The ID check
-- stays mandatory either way.
create or replace function public.model_may_apply(p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select
       (not public.subscription_enabled()
         or coalesce(u.subscription_waived, false)
         or exists (select 1 from public.subscriptions s
                     where s.user_id = p_user_id
                       and s.status in ('active', 'cancelling', 'past_due')))
       and coalesce(u.is_verified, false)
     from public.users u
     where u.id = p_user_id),
    false)                    -- no user row at all: not eligible
$function$;

-- The trigger builds its error message from its own inline copy of the
-- subscription test. Left un-short-circuited it would tell a model they need a
-- membership while membership is switched off.
create or replace function public.tg_session_apply_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_subscribed boolean;
  v_verified   boolean;
begin
  -- Not a member-originated insert: the owner, the service role, an edge
  -- function, or a verify block. RLS does not bind those either, and admin
  -- tooling must keep working.
  if auth.uid() is null then
    return new;
  end if;

  if public.model_may_apply(new.model_user_id) then
    return new;
  end if;

  select
    (not public.subscription_enabled()
      or coalesce(u.subscription_waived, false)
      or exists (select 1 from public.subscriptions s
                  where s.user_id = new.model_user_id
                    and s.status in ('active', 'cancelling', 'past_due'))),
    coalesce(u.is_verified, false)
  into v_subscribed, v_verified
  from public.users u where u.id = new.model_user_id;

  raise exception '%',
    case
      when coalesce(v_subscribed, false) is false and coalesce(v_verified, false) is false then
        'You need an active Cavy membership and an ID check before you can apply.'
      when coalesce(v_subscribed, false) is false then
        'You need an active Cavy membership before you can apply.'
      else
        'You need to finish your ID check before you can apply.'
    end
    using errcode = 'CV003';
end $function$;

-- ---------------------------------------------------------------------------
-- 5. Verify. Every line below measures something.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
begin
  -- (a) The flag exists, reads from settings, and is OFF.
  if public.subscription_enabled() then
    raise exception '0109: subscription_enabled() is TRUE. The applied state was false. '
      'Rolled back rather than switch membership on.';
  end if;
  if not exists (select 1 from public.settings
                  where key = 'subscription_enabled' and value = 'false') then
    raise exception '0109: the subscription_enabled row is missing or not false. Rolled back.';
  end if;

  -- (b) ⚠️ THE FLAG IS READ BY THE GATE, NOT MERELY DEFINED. A function nobody
  --     calls is the dead dial 0108 exists to remove.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'model_may_apply'
     and p.pronargs = 1;
  if position('not public.subscription_enabled()' in v_src) = 0 then
    raise exception '0109: model_may_apply does not short-circuit on subscription_enabled. '
      'Rolled back.';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tg_session_apply_gate';
  if position('not public.subscription_enabled()' in v_src) = 0 then
    raise exception '0109: tg_session_apply_gate would still tell a model she needs a '
      'membership while membership is off. Rolled back.';
  end if;

  -- (c) ⚠️ THE ID CHECK IS STILL UNCONDITIONAL HERE, and that is this
  --     migration's scope. 0110 is what puts it behind a flag; asserting it
  --     stops this file from quietly having done 0110's job as well.
  if position('verification_required_to_apply' in v_src) > 0 then
    raise exception '0109: tg_session_apply_gate already reads a verification flag. That is '
      '0110. Rolled back rather than apply two migrations as one.';
  end if;

  -- (d) The vocabulary accepts the new key and still refuses an undeclared one.
  begin
    insert into public.settings (key, value) values ('zz_0109_probe', 'x');
    delete from public.settings where key = 'zz_0109_probe';
    raise exception '0109: settings accepted an undeclared key, so the constraint was dropped '
      'and not replaced. Rolled back.';
  exception when check_violation then
    null;  -- refused, which is the whole point
  end;

  raise notice '0109: subscription_enabled() is %, read by model_may_apply and '
    'tg_session_apply_gate. The ID check is untouched and still unconditional.',
    public.subscription_enabled();
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0109', 'subscription_enabled_global_flag', '973902941c23cae2219cf48440ce5273894fe6b65dea73218fa7e17efc3f43a1');

commit;

notify pgrst, 'reload schema';

-- ⚠️ WHAT NONE OF THE ABOVE PROVES: that a real apply behaves. The verify block
-- matches strings in function bodies. The behavioural proof is an insert into
-- `sessions` as an unsubscribed, VERIFIED model, which should now succeed —
-- and as an unsubscribed, UNVERIFIED model, which should still raise CV003
-- saying the ID check is outstanding and NOT mentioning membership.

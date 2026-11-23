-- ===========================================================================
-- 0110_verification_gate_flags
--
-- ⚠️⚠️ ALREADY APPLIED. DO NOT RUN THIS AGAINST THE LIVE DATABASE.
--
-- Recorded 18 Nov 2026 for a change that was already live: applied through the
-- Supabase connector and held in `supabase_migrations.schema_migrations` as
-- **20261118072407 verification_gate_flags**, which is the CLI's ledger and not
-- this repo's (`public.schema_migrations`). See 0109's header for the full
-- explanation and for the one-row INSERT that reconciles the live ledger
-- without re-running any DDL.
--
-- ⚠️ STEPS 1-6 ARE THE APPLIED TEXT, VERBATIM, from
-- `schema_migrations.statements`. The note about why the two fail directions
-- differ was written at the time and is the most valuable thing in the file.
-- Do not re-word it, and do not "tidy" the asymmetry it describes.
--
-- Only the scaffolding is added, plus `if exists` on the drop for idempotence.
--
-- ── WHAT IT DOES ──────────────────────────────────────────────────────────
-- The ID check becomes TWO switches, because applying and publishing are two
-- decisions:
--
--   verification_required_to_apply     a model applying for a slot   → 'false'
--   verification_required_to_publish   a shop going public           → 'true'
--
-- ⚠️⚠️ THE PUBLISH FLAG IS INSERTED AS 'true' HERE, AND THAT IS NOT A TYPO.
-- It was deliberately left ON "pending a decision". **0111 is what turns it
-- off**, and it does so with an UPDATE rather than by changing this insert —
-- so a rebuild passes through the same two states the live database did. If
-- you are tempted to set it to 'false' here and delete 0111's update: don't.
-- That would erase the fact that the publish side was a separate, later
-- decision, and 0111 carries the four pieces of machinery that had to move with
-- it.
--
-- ⚠️ `on conflict (key) do nothing` MEANS THIS CANNOT FLIP A LIVE FLAG BACK ON.
-- On a database where the row already exists — including one where 0111 has
-- since set it to 'false' — re-running this file leaves the value alone. That
-- is the behaviour you want from a safety flag: it is switched by a deliberate
-- UPDATE, never by re-running a migration.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0109') then
    raise exception '0110 needs 0109 applied first — it rewrites the same two functions.';
  end if;

  if to_regprocedure('public.subscription_enabled()') is null then
    raise exception '0110 needs subscription_enabled(); 0109 adds it.';
  end if;

  -- ⚠️ THE BODY THIS WAS WRITTEN AGAINST. The replacements below are 0109's
  -- functions with the verification half put behind a flag. If 0109's
  -- short-circuit is missing, something has moved these functions since and a
  -- blind replace would silently revert it.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'model_may_apply' and p.pronargs = 1;
  if position('not public.subscription_enabled()' in v_src) = 0 then
    raise exception '0110: model_may_apply is not the body 0109 left. Read it before applying. '
      'Nothing changed.';
  end if;
end $mig$;

-- ===========================================================================
-- THE APPLIED TEXT, VERBATIM FROM statements FOR 20261118072407.
-- ===========================================================================

-- Two separate switches for the two places the ID check is enforced:
--   verification_required_to_apply   -> a model applying to a slot (sessions)
--   verification_required_to_publish -> a provider's shop going public (providers)
--
-- They are separate on purpose. Applying and publishing sit on opposite sides
-- of the same in-person meeting, and the right answer for one is not
-- automatically the right answer for the other.
--
-- POLARITY AND FAIL DIRECTION -- NOTE THE DIFFERENCE FROM provider_fee_enabled
-- AND subscription_enabled. Those are revenue gates, so a missing row means
-- "do not charge": they fail OPEN, because the cost of failing open is money.
-- These two are safety gates. A missing row means REQUIRED: they fail CLOSED,
-- because the cost of failing open is an unidentified person at a private
-- address. Do not "tidy" these into the same coalesce direction as the fee
-- flags; the asymmetry is the point.

alter table public.settings drop constraint if exists settings_key_is_declared;
alter table public.settings add constraint settings_key_is_declared
  check (key = any (array[
    'banned_words'::text,
    'founding_provider_cap'::text,
    'image_review_enabled'::text,
    'provider_fee_enabled'::text,
    'subscription_enabled'::text,
    'subscription_price_pence'::text,
    'verification_price_pence'::text,
    'verification_required_to_apply'::text,
    'verification_required_to_publish'::text]));

-- Model side: off, per the decision to prioritise real usage while the
-- marketplace is thin.
insert into public.settings (key, value)
values ('verification_required_to_apply', 'false')
on conflict (key) do nothing;

-- Provider side: left ON pending a decision. Flipping it is a one-row update.
insert into public.settings (key, value)
values ('verification_required_to_publish', 'true')
on conflict (key) do nothing;

create or replace function public.verification_required_to_apply()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- A MISSING ROW MEANS REQUIRED. Fails closed. See the migration note.
  select coalesce(
    (select s.value = 'true' from public.settings s
      where s.key = 'verification_required_to_apply'),
    true);
$function$;

create or replace function public.verification_required_to_publish()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- A MISSING ROW MEANS REQUIRED. Fails closed. See the migration note.
  select coalesce(
    (select s.value = 'true' from public.settings s
      where s.key = 'verification_required_to_publish'),
    true);
$function$;

-- model_may_apply stays the single hinge for the apply gate.
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
       and (not public.verification_required_to_apply()
         or coalesce(u.is_verified, false))
     from public.users u
     where u.id = p_user_id),
    false)                    -- no user row at all: not eligible
$function$;

-- Keep the trigger's error message truthful about which gates are live.
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
    (not public.verification_required_to_apply()
      or coalesce(u.is_verified, false))
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
-- 7. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
begin
  -- (a) ⚠️⚠️ THE FAIL DIRECTIONS, TESTED RATHER THAN TRUSTED. This is the one
  --     thing in the file a careless later edit would silently reverse: both
  --     functions are one `coalesce` default away from failing the other way,
  --     and neither direction shows up in normal use because the rows exist.
  --
  --     So the rows are DELETED and the functions asked what they say with
  --     nothing to read.
  --
  --     ⚠️ A plpgsql BEGIN/EXCEPTION BLOCK, NOT A SAVEPOINT. plpgsql cannot
  --     issue SAVEPOINT or ROLLBACK TO SAVEPOINT at all — it raises
  --     "cannot begin/end transactions in PL/pgSQL". A block with an EXCEPTION
  --     handler is the supported equivalent: it opens an implicit
  --     subtransaction, and an exception reaching the handler rolls the block's
  --     writes back. The deliberate sentinel raise at the end is what undoes
  --     the two deletes.
  begin
    delete from public.settings where key = 'verification_required_to_apply';
    if not public.verification_required_to_apply() then
      raise exception '0110: with no row, verification_required_to_apply() returned FALSE. '
        'A safety gate must fail CLOSED.';
    end if;

    delete from public.settings where key = 'subscription_enabled';
    if public.subscription_enabled() then
      raise exception '0110: with no row, subscription_enabled() returned TRUE. A revenue gate '
        'must fail OPEN — never charge on a missing row.';
    end if;

    -- Both answered correctly. Raise to roll the deletes back.
    raise exception 'ZZ_0110_PROBE_OK';
  exception when others then
    -- ⚠️ ONLY THE SENTINEL IS SWALLOWED. A real failure above re-raises and
    -- takes the migration down, which is the point of measuring it.
    if sqlerrm <> 'ZZ_0110_PROBE_OK' then
      raise;
    end if;
  end;

  -- The rows are back, because the block above rolled back. Said out loud
  -- rather than assumed, since everything after this reads them.
  if not exists (select 1 from public.settings where key = 'verification_required_to_apply')
     or not exists (select 1 from public.settings where key = 'subscription_enabled') then
    raise exception '0110: the fail-direction probe did not roll back and a settings row is '
      'missing. Rolled back.';
  end if;

  -- (b) The values actually applied: apply off, publish ON at this point.
  if public.verification_required_to_apply() then
    raise exception '0110: verification_required_to_apply() is TRUE; the applied state was '
      'false. Rolled back.';
  end if;
  if not public.verification_required_to_publish() then
    raise exception '0110: verification_required_to_publish() is FALSE here. This migration '
      'left it ON — 0111 is what turns it off. Rolled back rather than do 0111''s job.';
  end if;

  -- (c) Both flags are read by the apply gate.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'model_may_apply' and p.pronargs = 1;
  if position('not public.verification_required_to_apply()' in v_src) = 0
     or position('not public.subscription_enabled()' in v_src) = 0 then
    raise exception '0110: model_may_apply does not read both flags. Rolled back.';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tg_session_apply_gate';
  if position('not public.verification_required_to_apply()' in v_src) = 0 then
    raise exception '0110: tg_session_apply_gate would still tell a model to finish an ID check '
      'that is not required. Rolled back.';
  end if;

  -- (d) ⚠️ THE PUBLISH SIDE IS NOT WIRED YET, and that is this migration's
  --     scope. The flag exists and nothing reads it until 0111 — which is
  --     exactly why 0111 exists rather than being folded in here.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and position('verification_required_to_publish' in p.prosrc) > 0
         and p.proname <> 'verification_required_to_publish') <> 0 then
    raise exception '0110: something already reads verification_required_to_publish. That is '
      '0111. Rolled back rather than apply two migrations as one.';
  end if;

  -- (e) The vocabulary still closes.
  begin
    insert into public.settings (key, value) values ('zz_0110_probe', 'x');
    delete from public.settings where key = 'zz_0110_probe';
    raise exception '0110: settings accepted an undeclared key. Rolled back.';
  exception when check_violation then
    null;
  end;

  raise notice '0110: apply gate %, publish gate % (0111 turns the publish side off). '
    'Both fail CLOSED on a missing row, unlike the two revenue flags.',
    public.verification_required_to_apply(), public.verification_required_to_publish();
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0110', 'verification_gate_flags', '55d3efb0f376531cf3c16b932b3d68b791bb55c3af430c1243d4c5ca7323a454');

commit;

notify pgrst, 'reload schema';

-- ⚠️ WHAT NONE OF THE ABOVE PROVES: that an unverified model can now apply. The
-- behavioural proof is an insert into `sessions` as a model with
-- is_verified = false and no subscription, which should succeed from here on.

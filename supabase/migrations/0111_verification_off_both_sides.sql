-- ===========================================================================
-- 0111_verification_off_both_sides
--
-- ⚠️⚠️ ALREADY APPLIED. DO NOT RUN THIS AGAINST THE LIVE DATABASE.
--
-- Recorded 18 Nov 2026 for a change that was already live: applied through the
-- Supabase connector and held in `supabase_migrations.schema_migrations` as
-- **20261118072729 verification_off_both_sides**. See 0109's header for why
-- these three files exist at all and for the one-row INSERT that reconciles the
-- live ledger without re-running any DDL.
--
-- ⚠️ STEPS 1-4 ARE THE APPLIED TEXT, VERBATIM, from
-- `schema_migrations.statements`. Only the scaffolding is added; nothing in
-- this one needed `if exists`, because it changes no constraint.
--
-- ── WHAT IT DOES, AND WHY IT IS A SEPARATE MIGRATION ──────────────────────
-- 0110 left `verification_required_to_publish` ON. This turns it off — and the
-- reason it is its own file is the sentence in its own header: **flipping the
-- flag alone is not enough.** Four pieces of machinery treat `is_verified` as
-- load-bearing for publication, and two of them would have quietly undone the
-- change:
--
--   enforce_publish_requires_verified   refuses the UPDATE outright
--   publish_provider_if_eligible        silently matches zero rows
--   unpublish_on_verification_lost      pulls a live shop down again
--   tg_user_verified_maybe_publish      left alone, deliberately — see step 4
--
-- The middle two are the quiet ones. A shop would simply never publish, with
-- no error anywhere, which is this codebase's hardest failure to notice.
--
-- ⚠️⚠️ SUSPENSION AND BANNING ARE UNTOUCHED AND STILL UNPUBLISH. That is the
-- line this migration does not cross: `is_suspended` stays in
-- `publish_provider_if_eligible`'s WHERE clause, and nothing here touches the
-- suspension triggers. "Verification is optional" must never be read as
-- "moderation is optional".
--
-- ⚠️ THE FLAGS STILL FAIL CLOSED. Switching a safety gate off is a deliberate
-- act recorded in a row — it is not something that can happen by a row going
-- missing. 0110's verify block measures that, and it stays true after this.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0110') then
    raise exception '0111 needs 0110 applied first — it reads the flag 0110 creates.';
  end if;

  if to_regprocedure('public.verification_required_to_publish()') is null then
    raise exception '0111 needs verification_required_to_publish(); 0110 adds it.';
  end if;

  -- ⚠️ THE THREE FUNCTIONS BEING REPLACED MUST ALL EXIST. Replacing two of
  -- three would leave the gate half-open in the worst way: publishing allowed,
  -- then immediately undone by the one that was missed.
  if to_regprocedure('public.enforce_publish_requires_verified()') is null
     or to_regprocedure('public.publish_provider_if_eligible(uuid)') is null
     or to_regprocedure('public.unpublish_on_verification_lost()') is null then
    raise exception '0111 replaces three functions and at least one is absent. Read why before '
      'applying — a partial replace is worse than none. Nothing changed.';
  end if;

  -- ⚠️ THE SUSPENSION GUARD IS A PRECONDITION, NOT A SIDE EFFECT. The
  -- replacement body below keeps `is_suspended` in its WHERE clause; if that
  -- function is gone, the body would not compile and the guard would be gone
  -- with it.
  if to_regprocedure('public.is_suspended(uuid)') is null then
    raise exception '0111: is_suspended(uuid) is missing, and publish_provider_if_eligible '
      'keeps it. Nothing changed.';
  end if;
end $mig$;

-- ===========================================================================
-- THE APPLIED TEXT, VERBATIM FROM statements FOR 20261118072729.
-- ===========================================================================

-- Verification is now optional on both sides while the marketplace is thin.
-- Flipping the flag alone is not enough: four separate pieces of machinery
-- assume is_verified is load-bearing, and two of them would quietly undo the
-- change. All four are brought under the flag here.
--
-- The flags still fail CLOSED (a missing row means required). Switching the
-- gate off is a deliberate act recorded in a row, not something that can
-- happen by a row going missing.

update public.settings
   set value = 'false'
 where key = 'verification_required_to_publish';

-- 1. The hard block on publishing.
create or replace function public.enforce_publish_requires_verified()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.is_published = true and public.verification_required_to_publish() then
    if not exists (
      select 1 from public.users u
      where u.id = new.user_id and u.is_verified = true
    ) then
      raise exception 'Cannot publish shop: provider is not verified';
    end if;
  end if;
  return new;
end $function$;

-- 2. The auto-publish path. Suspension and shop-completeness stay binding:
--    only the verification condition is under the flag.
create or replace function public.publish_provider_if_eligible(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.providers p
     set is_published       = true,
         first_published_at = now()
   where p.id = p_provider_id
     and p.is_published is not true
     and p.first_published_at is null          -- once, ever. See 0016's header.
     and public.provider_shop_is_publishable(p.id)
     and (not public.verification_required_to_publish()
          or exists (
            select 1 from public.users u
            where u.id = p.user_id and u.is_verified is true
          ))
     -- 0044: a suspended or banned stylist is never published automatically.
     and not public.is_suspended(p.user_id);
end;
$function$;

-- 3. Losing verification must not pull a shop down while verification is not
--    what is holding the shop up. Suspension and banning are separate
--    mechanisms and are untouched -- those still unpublish.
create or replace function public.unpublish_on_verification_lost()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if old.is_verified is true and new.is_verified is not true
     and public.verification_required_to_publish() then
    update public.providers
       set is_published       = false,
           first_published_at = null
     where user_id = new.id and is_published is true;
  end if;
  return new;
end $function$;

-- 4. tg_user_verified_maybe_publish is left as it is: it fires when someone
--    becomes verified, which is still a real event for anyone who verifies
--    voluntarily, and it routes through publish_provider_if_eligible above.

-- ---------------------------------------------------------------------------
-- 5. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
  v_n   int;
begin
  -- (a) The flag is off on both sides now.
  if public.verification_required_to_publish() then
    raise exception '0111: verification_required_to_publish() is still TRUE. Rolled back.';
  end if;
  if public.verification_required_to_apply() then
    raise exception '0111: verification_required_to_apply() is TRUE — 0110 set it false and '
      'something has moved it. Read why. Rolled back.';
  end if;

  -- (b) ⚠️⚠️ ALL THREE READ THE FLAG. Two of three is the bad outcome, and
  --     it is bad in two different ways: a shop that publishes and is pulled
  --     straight back down, or one that never publishes and says nothing about
  --     why. So this names the ones that DO NOT read it rather than looping and
  --     checking each — one query, and the message lists every offender
  --     instead of stopping at the first.
  select string_agg(want.proname, ', ' order by want.proname) into v_src
    from (values ('enforce_publish_requires_verified'),
                 ('publish_provider_if_eligible'),
                 ('unpublish_on_verification_lost')) as want(proname)
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = want.proname
        and position('verification_required_to_publish' in p.prosrc) > 0);
  if v_src is not null then
    raise exception '0111: these do not read verification_required_to_publish: %. A partial '
      'replace leaves the publish gate half-open. Rolled back.', v_src;
  end if;

  -- ⚠️ THE COUNT IS NOT REDUNDANT. The check above already catches a MISSING
  -- function: absence makes `not exists` true, so it is named as an offender.
  -- What it cannot catch is a SECOND overload of one of these names whose body
  -- also mentions the flag — two functions answering one question, the shape
  -- that put model_may_apply on two signatures. Three names, three functions.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('enforce_publish_requires_verified',
                       'publish_provider_if_eligible',
                       'unpublish_on_verification_lost');
  if v_n <> 3 then
    raise exception '0111: expected 3 publish-path functions, found %. Rolled back.', v_n;
  end if;

  -- (c) ⚠️⚠️ SUSPENSION SURVIVED. The single most important assertion in this
  --     file: "verification is optional" must not have become "a banned
  --     stylist can be published".
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publish_provider_if_eligible';
  if position('not public.is_suspended(p.user_id)' in v_src) = 0 then
    raise exception '0111: publish_provider_if_eligible has lost its suspension guard. '
      'Rolled back — this migration must not touch moderation.';
  end if;
  if position('public.provider_shop_is_publishable(p.id)' in v_src) = 0 then
    raise exception '0111: publish_provider_if_eligible has lost the shop-completeness check. '
      'Rolled back.';
  end if;
  if position('p.first_published_at is null' in v_src) = 0 then
    raise exception '0111: publish_provider_if_eligible has lost its once-ever guard (0016). '
      'Rolled back.';
  end if;

  -- (d) The suspension triggers are untouched and still present.
  if to_regprocedure('public.is_suspended(uuid)') is null then
    raise exception '0111: is_suspended is gone. Rolled back.';
  end if;

  raise notice '0111: verification is optional on both sides (apply %, publish %). All three '
    'publish-path functions read the flag. Suspension, banning and shop-completeness are '
    'untouched and still binding.',
    public.verification_required_to_apply(), public.verification_required_to_publish();
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0111', 'verification_off_both_sides', '879bd4019a62d6c3916836114f50de1c42a5fe106d0264c171d7c212d5c2d175');

commit;

notify pgrst, 'reload schema';

-- ⚠️ WHAT NONE OF THE ABOVE PROVES: that a shop actually publishes unverified.
-- The behavioural proof is `select public.publish_provider_if_eligible(id)` for
-- an unverified provider whose shop has a name and one categorised treatment —
-- `providers.is_published` should become true — and then setting that user's
-- is_verified from true to false, which must NOT unpublish them.
--
-- ⚠️ AND THE ONE THAT MATTERS MOST: suspend that stylist and confirm the shop
-- still comes down. That path is deliberately not under any flag.

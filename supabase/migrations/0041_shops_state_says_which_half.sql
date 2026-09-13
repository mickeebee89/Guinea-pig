-- ===========================================================================
-- 0041_shops_state_says_which_half
--
-- Let the console say WHICH publish requirement is unmet, instead of reciting
-- both. Audit items 29 and 40.
--
-- ── WHAT IS WRONG WITH THE MESSAGE TODAY ────────────────────────────────
-- _provider_shops_state returns `publishable` as one boolean, so every surface
-- that reports a shop staying hidden has to guess at the reason and lists all
-- the requirements:
--
--   "it is not ready — a shop needs a name and at least one treatment with a
--    category"
--
-- Micky, 12 Sep, on Test A: the shop HAS a name; only the treatment is missing.
-- The sentence reads as "both are missing" to someone who then goes looking for
-- a problem with the name that isn't there. Same sentence reaches the stylist
-- in their approval notification, where it is worse: they have no queue to
-- check it against.
--
-- ── ⚠️ HOW THIS AVOIDS BECOMING A THIRD COPY OF THE PUBLISH RULE ─────────
-- provider_shop_is_publishable is the rule. enforce_publish_requires_complete_
-- profile is the trigger that agrees with it. A third place computing "is this
-- shop ready" is exactly what item 29 warns about and what 0039's own helper
-- comment refuses ("by the existing check — not a third copy of it").
--
-- So this adds OBSERVATIONS, not a verdict:
--
--   publishable                  THE VERDICT. Unchanged, still the rule itself.
--   has_name                     an observation about the row
--   has_categorised_treatment    an observation about the row
--
-- The console phrases those as what it can SEE, never as the requirements list.
-- If a third requirement is added to the rule later, the message becomes
-- INCOMPLETE rather than WRONG — which is the failure mode to choose, and the
-- reason nobody should have to remember to update a sentence in the console
-- when they change the rule.
--
-- The two expressions below are copied from provider_shop_is_publishable's live
-- body, read verbatim on 12 Sep — including `pt.category`, which is NOT
-- `category_id`. Writing that from memory (portfolio_items has category_id)
-- would have produced a console message that disagreed with the rule.
--
-- ── AND THE PRE-CHECK IS THE POINT ──────────────────────────────────────
-- Before anything is replaced, this compares the rule against the two
-- observations FOR EVERY PROVIDER ROW and refuses if any disagrees. That is
-- what makes "the mirror matches the rule" a measurement rather than a claim.
--
-- ⚠️ What it catches: a mirror written wrong, and a rule whose extra condition
-- actually differs on today's data. What it does NOT catch: a third condition
-- that every current provider happens to satisfy. Stated because a green
-- pre-check here is evidence about this database today, not a proof about the
-- rule in general — and this file is exactly where someone would over-read it.
-- ===========================================================================

begin;

do $$
declare
  v_mismatch integer;
begin
  if to_regprocedure('public.provider_shop_is_publishable(uuid)') is null then
    raise exception '0041: public.provider_shop_is_publishable(uuid) is missing — it is the verdict this mirrors.';
  end if;

  if to_regprocedure('public._provider_shops_state(uuid)') is null then
    raise exception '0041: public._provider_shops_state(uuid) is missing — apply 0039 first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_treatments' and column_name = 'category'
  ) then
    raise exception '0041: provider_treatments.category is missing — the treatment half of the rule reads that column, not category_id.';
  end if;

  -- The mirror, checked against the rule, on live rows, before anything moves.
  select count(*) into v_mismatch
  from public.providers p
  where public.provider_shop_is_publishable(p.id)
        is distinct from (
          (coalesce(btrim(p.name), '') <> '')
          and exists (
            select 1 from public.provider_treatments pt
            where pt.provider_id = p.id and pt.category is not null
          )
        );

  if v_mismatch > 0 then
    raise exception
      '0041: % provider row(s) where the observations disagree with provider_shop_is_publishable. '
      'Either the two expressions below no longer mirror the rule, or the rule has gained a condition '
      'that matters on current data. Read the rule before changing this. Nothing has been changed.',
      v_mismatch;
  end if;

  raise notice '0041: observations agree with provider_shop_is_publishable on every provider row.';
end $$;

-- ---------------------------------------------------------------------------
-- The helper, with two observations added. Everything else is unchanged from
-- 0039, including SECURITY INVOKER: it has no privilege of its own and runs
-- with whatever its callers have.
-- ---------------------------------------------------------------------------
create or replace function public._provider_shops_state(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider_id',    p.id,
           'published',      coalesce(p.is_published, false),
           'publishable',    public.provider_shop_is_publishable(p.id),
           'ever_published', p.first_published_at is not null,
           -- Observations, not the rule. See the header.
           'has_name',       coalesce(btrim(p.name), '') <> '',
           'has_categorised_treatment', exists (
             select 1 from public.provider_treatments pt
             where pt.provider_id = p.id and pt.category is not null
           )
         ) order by p.id), '[]'::jsonb)
  from public.providers p
  where p.user_id = p_user_id;
$$;

comment on function public._provider_shops_state(uuid) is
  'What a user''s shops look like after a decision. Returns FACTS, not a reason: published, '
  'publishable (by provider_shop_is_publishable — NOT a second copy of that rule), ever_published, '
  'and since 0041 two observations, has_name and has_categorised_treatment, so the console can say '
  'WHICH requirement is unmet instead of reciting both. Those two mirror the rule''s own expressions '
  'and are checked against it on every provider row when 0041 applies. They are observations: if the '
  'rule gains a third condition the console message becomes incomplete rather than wrong, which is '
  'deliberate — nobody should have to update a sentence in the console to keep it honest.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0041', 'shops_state_says_which_half', '2bed404333d18765e50241daba779b50b5f313db16aa678003ab4bad5ecae9dd');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ── BLOCK A — the mirror still agrees with the rule ─────────────────────
--
-- The same comparison the migration refused to apply without. Zero rows.
--
--   select count(*) as disagreements
--   from public.providers p
--   where public.provider_shop_is_publishable(p.id)
--         is distinct from (
--           (coalesce(btrim(p.name), '') <> '')
--           and exists (select 1 from public.provider_treatments pt
--                        where pt.provider_id = p.id and pt.category is not null)
--         );
--
--   Expect 0. Any other number means the observations and the verdict have
--   parted company, and the console is now describing something else.
--
-- ── BLOCK B — the new keys are there, and they explain a real row ───────
--
-- Test A is the shop that prompted this: it HAS a name and has no categorised
-- treatment, so the old message named two requirements and got one of them
-- wrong.
--
--   select p.name,
--          public._provider_shops_state(p.user_id) as shops
--   from public.providers p
--   where coalesce(btrim(p.name), '') <> ''
--     and not exists (select 1 from public.provider_treatments pt
--                      where pt.provider_id = p.id and pt.category is not null)
--   limit 3;
--
--   Expect each shops entry to carry has_name true, has_categorised_treatment
--   false, publishable false. If no rows come back, no provider is in that
--   state today and the console change cannot be exercised against real data —
--   say so rather than treating an empty result as a pass.
--
-- ── BLOCK C — nothing else moved ────────────────────────────────────────
--
--   select p.proname, p.prosecdef as security_definer, p.provolatile, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = '_provider_shops_state';
--
--   Expect security_definer FALSE (it is invoker, deliberately — it has no
--   privilege of its own), provolatile 's' (stable), and proconfig holding
--   search_path=public, pg_temp.
-- ===========================================================================


-- ===========================================================================
-- ⚠️ FIRST STEP, NOT LAST — AND THIS IS THE OPPOSITE OF EVERY FILE BEFORE IT
--
--   node scripts/migration-status.mjs --stamp     <- BEFORE pasting this file
--   (paste into the SQL editor)
--   node scripts/migration-status.mjs             <- confirm: applied, no drift
--
-- Audit item 41. Every migration before this one ends with a "LAST STEP, EVERY
-- TIME" block sitting below the VERIFY section, which reads — working top to
-- bottom — as apply, verify, then stamp. Stamping last is what makes the ledger
-- read DRIFTED: the file is applied while its footer still says
-- PENDING_CHECKSUM, so that literal string is what the database records, and
-- the real checksum written afterwards can never match it. 0040 was applied
-- that way and had to be reconciled by hand.
--
-- The tool has always said so, in the line it prints when it stamps:
-- "Commit, then paste into the SQL editor."
-- ===========================================================================

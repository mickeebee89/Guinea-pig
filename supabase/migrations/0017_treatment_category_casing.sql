-- ===========================================================================
-- 0017_treatment_category_casing
--
-- Normalises provider_treatments.category to the canonical spelling in
-- treatment_categories, and keeps it that way.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHAT BROKE, FOR A REAL USER, TODAY ────────────────────────────────────
-- A stylist could not save ANY change to their treatments. Not one. Every save
-- was rejected with "We don't offer Spray Tan as a category" — naming a
-- treatment they had never touched, could not see selected, and could not
-- untick.
--
-- One capital letter:
--
--   treatment_categories.name       'Spray tan'    <- what the chip is labelled
--   provider_treatments.category    'Spray Tan'    <- what mobile writes
--
-- mobile/src/app/(app)/edit-shop.tsx:29 holds a hardcoded list with "Spray
-- Tan". The web shop editor seeded its selection from provider_treatments and
-- rendered its chips from treatment_categories, comparing exactly — so the
-- stored value sat in the selected set with no chip able to represent it,
-- travelled to the server on save, and failed validation as unknown.
--
-- Two rows, two providers. Small, and it made the feature unusable for both.
--
-- ── THE CONVENTION EXISTED AND WAS NOT FOLLOWED ───────────────────────────
-- public-web-views.sql:143 has ALWAYS joined these columns as
-- `lower(btrim(tc.name)) = lower(btrim(pt.category))`. Whoever wrote that view
-- already knew the two columns do not reliably agree. The web code compared
-- exactly anyway.
--
-- Same family as the note in the 8 Aug schema snapshot header: a category slug
-- guessed from the repo (`spray-tan`) that would have matched zero stylists for
-- ever because the database says `spray_tan`. Third time free text has been
-- treated as if it were an identifier.
--
-- ── WHY THIS MIGRATION ALSO INSTALLS A TRIGGER ────────────────────────────
-- Because the data fix alone undoes itself. mobile still writes "Spray Tan"
-- from its hardcoded list, so the very next Edit Shop save on either affected
-- account puts the row straight back. A one-off tidy with a live source of new
-- rows is not a fix, it is a delay.
--
-- The trigger canonicalises on write, which covers every client at once —
-- mobile, the web action, an admin — rather than needing all three to remember.
-- Same reasoning as 0012: the rule belongs to the data.
--
-- ── ⬜ THE REAL FIX, NOT DONE HERE ────────────────────────────────────────
-- `provider_treatments.category` should not be free text at all. It should be
-- `category_id uuid references treatment_categories(id)`, which makes this
-- entire class of bug unrepresentable — no casing, no whitespace, no typo, no
-- drift when a category is renamed.
--
-- Deliberately NOT done in this migration:
--   * mobile reads and writes `category` as text in edit-shop, availability and
--     apply-session
--   * public_stylists, browse and the dashboards all read it as text
--   * seed.mjs writes it as text
--
-- That is a coordinated change across three apps and a view, and it should not
-- ride along with an urgent unbreak. Recorded here so it is a decision that was
-- taken rather than a thing nobody noticed. Until then, categoryKey() in
-- site/lib/queries/shop.ts and the lower(btrim(...)) join in public-web-views
-- are the convention, and this trigger keeps the data honest enough that exact
-- matching mostly works anyway.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0017') then
    raise exception 'Migration 0017 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE, per 0014.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0017', 'provider_treatments rows whose casing differs from canonical', count(*)::text
from public.provider_treatments pt
join public.treatment_categories tc
  on lower(btrim(tc.name)) = lower(btrim(pt.category))
where pt.category is distinct from tc.name;

insert into public.migration_findings (version, item, value)
select '0017', 'providers affected', count(distinct pt.provider_id)::text
from public.provider_treatments pt
join public.treatment_categories tc
  on lower(btrim(tc.name)) = lower(btrim(pt.category))
where pt.category is distinct from tc.name;

-- Rows matching NO category even case-insensitively. These are a different and
-- worse problem — a value nothing can render — so they are counted, named, and
-- left alone rather than guessed at.
insert into public.migration_findings (version, item, value)
select '0017', 'provider_treatments rows matching no active category at all',
       coalesce(string_agg(distinct pt.category, ', '), 'none')
from public.provider_treatments pt
where pt.category is not null
  and not exists (
    select 1 from public.treatment_categories tc
    where lower(btrim(tc.name)) = lower(btrim(pt.category))
  );

-- ---------------------------------------------------------------------------
-- ASSERT, per 0014.
--
-- Canonicalising is only safe while each key maps to exactly ONE category. If
-- treatment_categories ever holds both 'Spray tan' and 'Spray Tan' as separate
-- active rows, "the canonical spelling" has no answer and this migration would
-- pick one arbitrarily and rewrite live data to it.
-- ---------------------------------------------------------------------------
do $$
declare v_dupes integer;
begin
  select count(*) into v_dupes from (
    select lower(btrim(name)) as k
    from public.treatment_categories
    where is_active is true
    group by 1 having count(*) > 1
  ) d;

  if v_dupes > 0
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0017 found % category name(s) that differ only by case in treatment_categories. '
      'There is no canonical spelling to normalise to until that is resolved. '
      'Re-run with: set local cavy.migration_override = ''yes'';', v_dupes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Keep it canonical on every write, from every client.
--
--    BEFORE INSERT OR UPDATE. Leaves a value alone when it matches no active
--    category — refusing would break a client mid-save over a row it did not
--    create, and silently blanking it would lose information. The findings
--    above name those rows instead.
--
--    `name` is carried along when it was tracking `category`, which is what
--    both clients write. A name the stylist deliberately typed differently is
--    left as theirs.
-- ---------------------------------------------------------------------------
create or replace function public.canonicalise_treatment_category()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_canon text;
begin
  if new.category is null then
    return new;
  end if;

  select tc.name into v_canon
  from public.treatment_categories tc
  where lower(btrim(tc.name)) = lower(btrim(new.category))
    and tc.is_active is true
  limit 1;

  if v_canon is not null and v_canon is distinct from new.category then
    if new.name is not distinct from new.category then
      new.name := v_canon;
    end if;
    new.category := v_canon;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_canonicalise_treatment_category on public.provider_treatments;

create trigger trg_canonicalise_treatment_category
  before insert or update on public.provider_treatments
  for each row execute function public.canonicalise_treatment_category();

-- ---------------------------------------------------------------------------
-- 2. Fix what is already stored.
--
--    The trigger above rewrites these as they pass through, so this UPDATE only
--    has to touch them. Idempotent: a second run matches nothing.
-- ---------------------------------------------------------------------------
update public.provider_treatments pt
   set category = tc.name,
       name     = case when pt.name is not distinct from pt.category then tc.name else pt.name end
  from public.treatment_categories tc
 where lower(btrim(tc.name)) = lower(btrim(pt.category))
   and tc.is_active is true
   and pt.category is distinct from tc.name;

insert into public.migration_findings (version, item, value)
select '0017', 'rows whose casing differs from canonical, after', count(*)::text
from public.provider_treatments pt
join public.treatment_categories tc
  on lower(btrim(tc.name)) = lower(btrim(pt.category))
where pt.category is distinct from tc.name;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0017', 'treatment_category_casing', 'a51deacd979cb7a38c2c1366cc54e23eb9cb303347874a8cd1ef02fbd71dc213');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — before and after, from the migration's own record ──────────
--
--   select item, value from public.migration_findings
--   where version = '0017' order by id;
--
--   'after' must be 0. The 'matching no active category at all' row should be
--   'none'; if it names something, those rows are invisible in both apps'
--   pickers and need a human decision.
--
-- ── BLOCK B — nothing disagrees with canonical any more ─────────────────
--
--   select pt.category as stored, tc.name as canonical,
--          count(*) as rows, count(distinct pt.provider_id) as providers
--   from public.provider_treatments pt
--   left join public.treatment_categories tc
--     on lower(btrim(tc.name)) = lower(btrim(pt.category))
--   group by pt.category, tc.name
--   order by (pt.category is distinct from tc.name) desc, rows desc;
--
-- ── BLOCK C — the trigger rewrites a bad insert. Rolls itself back. ──────
--
--   Expect: category and name both come back as the canonical spelling,
--   whatever case went in.
--
--   begin;
--     insert into public.provider_treatments (provider_id, name, category)
--     select id, 'sPrAy TaN', 'sPrAy TaN' from public.providers limit 1;
--
--     select name, category from public.provider_treatments
--      where lower(btrim(category)) = 'spray tan'
--      order by id desc limit 1;
--   rollback;
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

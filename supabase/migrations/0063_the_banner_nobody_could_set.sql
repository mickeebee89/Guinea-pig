-- ===========================================================================
-- 0063_the_banner_nobody_could_set
--
-- Drops providers.banner_url. Audit item 12.
--
-- ⚠️ APPLY THIS **AFTER** THE DEPLOY THAT REMOVES ITS READERS, AND AFTER THE
-- VIEW FILE HAS BEEN RE-RUN BY HAND. Sequenced exactly like 0055, and for the
-- same reason: dropping a column a deployed client still selects turns every
-- affected page into an error. The ASSERT below refuses to run until both are
-- true, so this cannot be applied early by accident.
--
-- ── WHY IT IS GOING ────────────────────────────────────
-- It was read in five places and written by NONE. There has never been a
-- control, on either client, to set a banner — so in the whole life of the
-- product the column has only ever been null, and mobile's branded placeholder
-- was the only branch that ever ran.
--
-- Same shape as providers.level (item 105): a field the app was designed
-- around and then never given a way to fill. Decided the same way, and with a
-- weaker case for keeping it than level had, because the argument for a banner
-- was aesthetic.
--
-- ── ⚠️ THIS IS NOT A DECISION AGAINST BANNERS ───────────────────
-- **A banner can be rebuilt, with moderation designed in from the start, if a
-- real stylist asks for one.** Nothing here forecloses that, and this comment
-- exists so the removal is not later read as "we decided against banners".
--
-- What was rejected was building an upload nobody had requested and then
-- owing it the moderation an image on an indexable public page needs — a
-- migration and a console queue, on top of the ones items 100 and 115 had just
-- finished, for a feature with no user behind it. If that user appears, the
-- work is: the column back, an upload beside AvatarUpload on the shop page,
-- and the media-review treatment 0060 gives the avatar.
--
-- ── THE VIEW HAD TO GO FIRST, AND BY HAND ─────────────────────
-- public_stylists selected p.banner_url, and **`create or replace view` cannot
-- drop a column** — the same wall item 105 hit. So the view must be DROPPED
-- and public-web-views.sql re-run by hand before this migration will pass its
-- ASSERT. That file is not applied by anything; see item 123.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'providers'
                   and column_name = 'banner_url') then
    raise exception '0063: providers.banner_url is already gone. This migration has run.';
  end if;

  -- ⚠️ THE GUARD THAT MATTERS. A view still selecting the column would be
  -- broken by the drop, and Postgres would refuse it anyway — but it would
  -- refuse with a dependency error that says nothing about what to do. This
  -- says what to do.
  if exists (
    select 1
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v on v.oid = r.ev_class
    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where d.refobjid = 'public.providers'::regclass
      and a.attname = 'banner_url'
      and v.relkind = 'v'
  ) then
    raise exception '0063: a view still selects providers.banner_url. DROP VIEW public.public_stylists and re-run supabase/public-web-views.sql by hand first (item 105 did the same).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE DROP
-- ---------------------------------------------------------------------------
alter table public.providers drop column banner_url;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0063', 'the_banner_nobody_could_set', 'ec2862f0d79fdc34a435b2562a3c58ffb1b6be733d6c47000c555a185abca36a');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   Both must be yes. The second will be NO until the view file is re-run.
--
--   select 'providers.banner_url still exists' as needs,
--          exists (select 1 from information_schema.columns
--                  where table_schema='public' and table_name='providers'
--                    and column_name='banner_url') as present
--   union all
--   select 'no view selects it any more',
--          not exists (
--            select 1 from pg_depend d
--            join pg_rewrite r on r.oid = d.objid
--            join pg_class v on v.oid = r.ev_class
--            join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
--            where d.refobjid = 'public.providers'::regclass
--              and a.attname = 'banner_url' and v.relkind = 'v');
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY — ⚠️ THE ORDER IS THE WHOLE POINT
--
--   1. Deploy site and mobile WITHOUT the readers. (Already committed.)
--   2. DROP VIEW public.public_stylists;
--      then re-run supabase/public-web-views.sql by hand.
--      ← THIS IS THE STEP NOBODY WILL BE REMINDED OF. `create or replace view`
--        cannot drop a column, so the file alone will not do it. Same as 105.
--   3. Preflight above — both rows yes.
--   4. Apply this migration.
--   5. node scripts/gen-supabase-types.mjs --applied 0063
--
--   Between 1 and 4 the column simply sits there unread, which is harmless.
--   There is no hurry, and nothing breaks if step 4 waits a week.
-- ===========================================================================
--
-- ── VERIFY — the shop page still renders, and nothing selects a ghost ────
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'providers'
--   order by column_name;
--
--   Expect no banner_url. Then open a stylist's public page on the website and
--   on the app: the web header starts at the avatar, and the app shows the
--   Cavy placeholder — which is what both have always shown, because the
--   column was never once populated.
-- ===========================================================================

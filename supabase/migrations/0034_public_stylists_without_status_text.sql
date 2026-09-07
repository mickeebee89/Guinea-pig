-- ===========================================================================
-- 0034_public_stylists_without_status_text
--
-- Migrate live status values into status_posts, and rebuild public_stylists
-- without the status_text column.
--
-- ⚠️ Apply 0031, 0032 and 0033 first.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  THIS IS THE ONE MIGRATION IN THE SEQUENCE THAT CAN BREAK SOMETHING LIVE.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `create or replace view` cannot drop a column, so removing status_text forces
-- `drop view` + `create view` — and A DROPPED VIEW DOES NOT KEEP ITS GRANTS.
-- `public_stylists` is granted to `anon`, which is how every logged-out visitor
-- and every search engine reads the site.
--
-- ── AND IT WOULD BE INVISIBLE, WHICH IS THIS PROJECT'S WHOLE PATTERN ────
-- Two things compound, and they are worth stating here rather than in a doc:
--
--   1. It does not error. site/lib/stylists.ts catches every failure — missing
--      view, RLS refusal, network blip — logs "query failed, returning none"
--      and returns []. The pages render 200 with their empty state.
--
--   2. That empty state is what they already render. The six treatment pages
--      are empty today because public_stylists requires a 40-character bio and
--      the published stylist has 13 (audit item 11).
--
-- So the broken state and the current CORRECT state are byte-for-byte
-- identical. Nothing would look wrong. The failure this project keeps finding —
-- a success signal that does not depend on the thing it claims — arrives here
-- in the one migration that can take a live surface down.
--
-- Hence the grant is verified from information_schema INSIDE this transaction,
-- and the transaction refuses to commit if anon cannot select. Recovery, if it
-- is ever needed anyway: docs/public-view-recovery.md.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ───────────────────────
-- IT DOES NOT DROP providers.status_text OR status_expires_at.
--
-- The August design listed the drop as part of this change, assuming the client
-- repoint had already happened. It has not. Three live surfaces still select
-- those columns FROM THE BASE TABLE, and dropping them breaks all three the
-- moment this commits:
--
--   site/lib/queries/dashboard.ts:171   the "What's on near you" feed
--   site/lib/queries/dashboard.ts:348   the nearby feed
--   mobile provider/[id].tsx:160        the shop page's pulsing status bar
--
-- The mobile one matters most: it is a shipped binary, so it cannot be fixed by
-- a deploy. The drop goes in 0035, after the clients read status_posts.
--
-- Removing status_text from the VIEW is safe now, and that was checked rather
-- than assumed: site/lib/stylists.ts selects CARD_COLUMNS, which is
-- 'id, slug, name, location, categories, rating, review_count, is_verified,
-- profile_pic_url' — no status_text. Only a stale field in
-- site/lib/supabase-public.ts's type mentions it, which is compile-time and
-- harmless.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — the view definition and its grants, BEFORE the drop.
--
-- 0012's pre-check ran after the fact and its baseline was lost permanently.
-- This is that lesson as a rule: the previous definition is recoverable from
-- the database afterwards, not only from git, and the grant list records what
-- must be true again when this finishes.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0034', 'public_stylists_viewdef_before',
       pg_get_viewdef('public.public_stylists'::regclass, true);

insert into public.migration_findings (version, item, value)
select '0034', 'grant_before_' || grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'public_stylists';

insert into public.migration_findings (version, item, value)
select '0034', 'status_text_to_migrate', count(*)::text
from public.providers
where nullif(btrim(coalesce(status_text, '')), '') is not null
  and (status_expires_at is null or status_expires_at > now());

-- ---------------------------------------------------------------------------
-- ASSERT — everything this depends on must be in place.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'status_posts'
  ) then
    raise exception '0034: status_posts is missing. Apply 0031 first.';
  end if;

  if not exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'public_stylist_status'
  ) then
    raise exception '0034: public_stylist_status is missing. Apply 0033 first.';
  end if;

  -- If anon cannot select the view NOW, this migration cannot prove it restored
  -- anything, and its final assert would pass against a pre-existing fault.
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'public_stylists'
      and grantee = 'anon' and privilege_type = 'SELECT'
  ) then
    raise exception
      '0034: anon does not currently have SELECT on public_stylists, so the '
      'public site is ALREADY dark. Fix that first (docs/public-view-recovery.md) '
      'so this migration is restoring a known-good state rather than a broken one.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Migrate live status values into status_posts.
-- ---------------------------------------------------------------------------
-- ── ONE do $$ BLOCK, AND THE REASON IS NOT THE ONE FIRST WRITTEN HERE ───
--
-- This said "THIS MIGRATION FAILED ONCE FOR THIS", describing a temp table that
-- vanished between statements. THAT ACCOUNT WAS WRONG, and the correction is
-- worth keeping because it was written into the framework's rules before anyone
-- checked it.
--
-- What actually happened, established from migration_findings.recorded_at:
-- every finding this migration wrote shares one timestamp to the microsecond,
-- so the version WITH the temp tables applied end to end, in one transaction,
-- successfully. Temp tables work fine when the whole file is pasted as one
-- unit, and `begin;` is atomic. The
--
--   ERROR: 42P01: relation "migrated_status" does not exist
--
-- came from a SEPARATE, PARTIAL paste — a selection that included the statement
-- reading the temp table but not the one creating it. Which is ordinary SQL
-- behaviour and says nothing about the editor.
--
-- The do $$ block STAYS, on a smaller and true claim: it is self-contained, so
-- it survives being re-run on its own while debugging, which a pair of
-- statements sharing a temp table does not. That is a real convenience. It is
-- not a correctness requirement, and pretending it was put a false rule into
-- scripts/migration-status.mjs for three turns.
--
-- The ids are captured in an array rather than matched back by body, because
-- 0032's strip-links trigger REWRITES new.body on insert — so any migrated
-- value containing a link is stored with different text than it was selected
-- with, and a body-based match would miss exactly those rows.
do $$
declare
  v_ids   uuid[];
  v_count int;
begin
  -- Only unexpired values: an expired status_text was already invisible, and
  -- migrating it would resurrect it for 48 hours.
  with ins as (
    insert into public.status_posts (provider_id, body, expires_at)
    select p.id,
           btrim(p.status_text),
           coalesce(p.status_expires_at, now() + interval '48 hours')
    from public.providers p
    where nullif(btrim(coalesce(p.status_text, '')), '') is not null
      and (p.status_expires_at is null or p.status_expires_at > now())
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from ins;

  v_count := coalesce(array_length(v_ids, 1), 0);

  insert into public.migration_findings (version, item, value)
  values ('0034', 'migrated_rows', v_count::text);

  -- What the screen decided, recorded BEFORE it is overridden below.
  insert into public.migration_findings (version, item, value)
  select '0034', 'migrated_screen_' || sp.moderation_status, count(*)::text
  from public.status_posts sp
  where sp.id = any(v_ids)
  group by sp.moderation_status;

  -- VISIBILITY IS PRESERVED, NOT RE-DECIDED. These values were already
  -- published under the old mechanism. Re-screening would silently unpublish
  -- content that is already public — and the word list is currently placeholder
  -- values where "hair" flags almost any legitimate post (item 17), so the
  -- screen would flag them for the wrong reason.
  update public.status_posts sp
  set moderation_status = 'approved',
      review_note = 'Migrated from providers.status_text by 0034 - already public '
                    'under the previous mechanism, so visibility was preserved '
                    'rather than re-decided.'
  where sp.id = any(v_ids);

  raise notice '0034: migrated % status_text value(s) into status_posts', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The view, rebuilt without status_text.
--
-- Faithful to the previous definition in every other respect —
-- supabase/public-web-views.sql:74-165 — and the before-image is in
-- migration_findings if a line here needs checking against it.
--
-- NOTE: there is deliberately no `last_modified` column. providers has no
-- created_at or updated_at, so the August design's unfiltered-max rule applies
-- to a column that does not exist yet. Do not add one here.
-- ---------------------------------------------------------------------------
drop view if exists public.public_stylists;

create view public.public_stylists
with (security_barrier = true) as
select
  p.id,

  coalesce(
    nullif(btrim(regexp_replace(lower(btrim(coalesce(p.name, ''))), '[^a-z0-9]+', '-', 'g'), '-'), ''),
    'stylist'
  ) || '-' || left(replace(p.id::text, '-', ''), 8)                     as slug,
  left(replace(p.id::text, '-', ''), 8)                                 as short_id,

  p.name,
  p.bio,
  p.region,

  nullif(btrim(coalesce(nullif(btrim(p.location_text), ''), p.location, '')), '')  as location,

  nullif(btrim(regexp_replace(
    lower(btrim(coalesce(nullif(btrim(p.location_text), ''), p.location, ''))),
    '[^a-z0-9]+', '-', 'g'), '-'), '')                                  as location_slug,

  p.profile_pic_url,
  p.banner_url,
  p.is_verified,
  p.level,

  -- status_text was here. It now lives in public_stylist_status (0033), which
  -- additionally requires approved + unexpired. Removing it is what forced the
  -- drop/create and the re-grant below.

  cats.categories,
  cats.category_slugs,

  nullif(p.rating, 0)                                                   as rating,
  coalesce(p.review_count, 0)                                           as review_count,

  exists (
    select 1 from public.availability a
    where a.provider_id = p.id and a.date >= current_date
  )                                                                     as has_open_slots

from public.providers p
cross join lateral (
  select
    coalesce(array_agg(distinct pt.category order by pt.category)
             filter (where pt.category is not null), array[]::text[])   as categories,
    coalesce(array_agg(distinct tc.slug order by tc.slug)
             filter (where tc.slug is not null), array[]::text[])       as category_slugs
  from public.provider_treatments pt
  left join public.treatment_categories tc
         on lower(btrim(tc.name)) = lower(btrim(pt.category))
        and tc.is_active is true
  where pt.provider_id = p.id
) cats
where p.is_published is true
  and coalesce(btrim(p.name), '') <> ''
  and length(btrim(coalesce(p.bio, ''))) >= 40
  and cardinality(cats.categories) >= 1
  and not exists (
    select 1 from public.users u
    where u.id = p.user_id and u.email like '%@seed.guineapig.invalid'
  );

-- ---------------------------------------------------------------------------
-- 3. The grants, reissued. This is the step the whole header is about.
-- ---------------------------------------------------------------------------
revoke all on public.public_stylists from public, anon, authenticated;
grant select on public.public_stylists to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. PROVE IT, INSIDE THE TRANSACTION.
--
-- Not a verify block afterwards. If the grant did not land, this rolls back and
-- the old view is still there — rather than committing a dark site and leaving
-- it to be noticed, which on these pages means never.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(r, ', ')
    into v_missing
  from unnest(array['anon', 'authenticated']) r
  where not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'public_stylists'
      and grantee = r and privilege_type = 'SELECT'
  );

  if v_missing is not null then
    raise exception
      '0034: public_stylists was rebuilt but SELECT is missing for: %. '
      'Rolling back — the old view is intact and the public site is unaffected. '
      'See docs/public-view-recovery.md.', v_missing;
  end if;

  -- The column must actually be gone, or the drop/create achieved nothing and
  -- 0035 will drop base columns the view still reads.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_stylists'
      and column_name = 'status_text'
  ) then
    raise exception '0034: public_stylists still exposes status_text. Rolling back.';
  end if;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0034', 'public_stylists_without_status_text', 'a5715336264ed422685331cc48d21ba4088090f64993e7199eb7e38ec82b54e4');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. The in-transaction assert already refused to commit
-- a missing grant, so these confirm the result rather than guard it.
--
-- ── BLOCK A — anon can still read, as anon ──────────────────────────────
--
--   The catalogue check is inside the migration. This is the other half: the
--   role actually working, not merely being listed.
--
--   begin;
--     set local role anon;
--     select count(*) from public.public_stylists;
--   rollback;
--
--   A number is a pass, INCLUDING 0 — the six treatment pages are empty today
--   for the item 11 bio-bar reason, and that has not changed. A permission
--   error is the failure.
--
-- ── BLOCK B — the before-image is recoverable ───────────────────────────
--
--   select value from public.migration_findings
--   where version = '0034' and item = 'public_stylists_viewdef_before';
--
--   The previous definition, from the database rather than from git. If a
--   column here turns out wrong, this is what to diff against.
--
-- ── BLOCK C — what the screen made of the migrated posts ────────────────
--
--   select item, value from public.migration_findings
--   where version = '0034' and item like 'migrated_%';
--
--   `status_text_to_migrate` is likely 0: nothing has ever written status_text,
--   which is why this feature is being built. If it IS 0, migrated_screen_* is
--   absent and that is correct, not a missing result.
--
--   Any `migrated_screen_pending` rows are posts the screen flagged and this
--   migration then approved anyway, because they were already public. Worth a
--   look — but remember item 17: the word list is placeholder values where
--   "hair" flags almost anything, so a flag today means very little.
--
--   `migrated_rows` must EQUAL `status_text_to_migrate`. If it is lower, the
--   insert dropped rows — which is the failure the id-based join exists to
--   prevent, since the strip-links trigger rewrites bodies containing links and
--   a body-based match would miss precisely those.
--
-- ── BLOCK D — the columns are STILL THERE, on purpose ───────────────────
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'providers'
--     and column_name in ('status_text', 'status_expires_at');
--
--   Expect BOTH. 0035 drops them, after the web dashboard and the mobile shop
--   page read status_posts instead. Dropping them now breaks a shipped mobile
--   binary, which no deploy can fix.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

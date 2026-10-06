-- ===========================================================================
-- 0087_the_badge_reads_the_column_that_is_written
--
-- Drops `providers.is_verified`. Item 176.
--
-- ⚠️ Apply 0086 first.
--
-- ⚠️⚠️ AND THIS IS THE LAST STEP OF FOUR. IN THIS ORDER, OR IT IS REFUSED.
--
--   1. Re-run `supabase/public-web-views.sql` by hand (FILE-OWNS that view).
--   2. Deploy site + mobile.
--   3. Confirm the two in-view stylists show a badge.
--   4. Apply this.
--
-- Step 4 before step 1 is not risky, it is **rejected**: PostgreSQL refuses to
-- drop a column a view depends on. The guard below says so in words first, so
-- the refusal arrives as a sentence rather than as a dependency error.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
-- There are two `is_verified` columns. `admin_decide_verification` writes
-- `users.is_verified`; `guard_users_protected_columns` protects it; it is true
-- for exactly the accounts that were approved.
--
-- **`providers.is_verified` defaults to false and NOTHING HAS EVER WRITTEN
-- IT.** Not the approval path, not `tg_user_verified_maybe_publish` (that sets
-- `is_published`), not any client. Measured 6 Oct 2026:
--
--     providers = 3   approved (users.is_verified) = 3   badges shown = 0
--
-- **The verified badge had never worked for anyone**, on a marketplace whose
-- proposition is that the stylist has been checked. Nine read sites across
-- three apps rendered it, including a "verified only" filter in the mobile
-- directory that could never match anything.
--
-- ── WHY DROP RATHER THAN REVOKE ────────────────────────────────────────────
-- It holds no information: `false` on every row, never true for anyone, so
-- there is nothing to preserve and no rollback value. Revoked-but-present
-- invites the repair — the next person who finds a badge missing sees a column
-- called `is_verified` and writes to it — and a revoke can be undone by a later
-- grant. **Dropping makes the mistake impossible rather than discouraged.**
--
-- ── ⚠️ THE READERS THAT COULD NOT MOVE TO THE VIEW, AND WHY ────────────────
-- Five of the nine read `public_stylists` and were fixed by the view alone.
-- Two read `providers` directly and CANNOT use the view:
--
--   * `site/lib/queries/browse.ts` needs latitude/longitude (distance),
--     is_published, and **user_id — which is what its block filter uses**.
--     The view withholds all three. Routing it through the view would silently
--     show blocked stylists again: an Apple Guideline 1.2 regression arriving
--     from a change about a badge.
--   * `site/lib/queries/stylist.ts` needs user_id and is_published.
--
--   And both are signed-in `(app)` surfaces, while `public_stylists` is
--   `security_invoker = false` and granted to anon — reading it from a
--   signed-in page would bypass RLS entirely.
--
-- They join `users` instead. ⚠️ That is not a second copy of a rule: what
-- rotted here was a second STORE that nobody updated, not a second READ. A
-- join holds nothing and cannot disagree with the column it reads.
--
-- ── ⚠️ A DEPENDENCY THIS UNCOVERED, RECORDED FOR 155 AND 156 ───────────────
-- `public_stylists` also selects `p.status_text` and `p.status_expires_at`.
-- Item 156 marks both "views only — drop them, 0034's deferred drop". **That
-- verdict is right that nothing writes them and wrong that the drop is free:**
-- it needs this same view changed first, in the same order, or it is refused.
-- Noted so the next person does not discover it by trying.
-- ===========================================================================
begin;

do $$
declare
  v_dep text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0086') then
    raise exception '0087: apply 0086 first.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'providers'
                    and column_name = 'is_verified') then
    raise exception '0087: providers.is_verified is already gone. This migration has run.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'users'
                    and column_name = 'is_verified') then
    raise exception '0087: users.is_verified does not exist, so there is nothing authoritative to drop in favour of. Nothing changed.';
  end if;

  -- ⚠️ THE ORDERING GUARD. Any view or rule still reading the column makes the
  -- drop illegal; this turns that into a sentence naming the step that was
  -- skipped, rather than a bare dependency error.
  v_dep := coalesce((
    select string_agg(distinct c.relname, ', ')
      from pg_depend d
      join pg_rewrite r on r.oid = d.objid
      join pg_class   c on c.oid = r.ev_class
     where d.refobjid = 'public.providers'::regclass
       and d.refobjsubid = (select a.attnum from pg_attribute a
                             where a.attrelid = 'public.providers'::regclass
                               and a.attname = 'is_verified')
       and d.classid = 'pg_rewrite'::regclass
  ), '');

  if v_dep <> '' then
    raise exception '0087: these still read providers.is_verified: %. Re-run supabase/public-web-views.sql by hand FIRST (it owns public_stylists — FILE-OWNS marker), then deploy site and mobile, then apply this. Nothing changed.', v_dep;
  end if;
end $$;

alter table public.providers drop column is_verified;

do $$
declare
  v_rows integer;
  v_badges integer;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'providers'
                and column_name = 'is_verified') then
    raise exception '0087: the column is still there after the drop. Rolled back.';
  end if;

  -- THE BOUNDS. The directory must not have lost anyone, and the badge must
  -- now be on for the approved stylists it covers.
  select count(*), count(*) filter (where is_verified)
    into v_rows, v_badges
    from public.public_stylists;

  if v_rows <> 2 then
    raise exception '0087: public_stylists returns % row(s); the preflight measured 2 on 6 Oct 2026. A badge fix that changes the directory''s size is the worse bug. Rolled back.', v_rows;
  end if;
  if v_badges <> 2 then
    raise exception '0087: % of 2 rows in public_stylists show a badge. Both are approved (users.is_verified true), so both should. Either the view was not re-run, or it was re-run from a copy that still reads the dropped column. Rolled back.', v_badges;
  end if;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0087', 'the_badge_reads_the_column_that_is_written', 'e712465c7d50a3d996145f0c4e75f0c7ef41b6790fe090458cb899b5cf67aacc');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN BEFORE THIS MIGRATION. Read-only.
--
--   select 'gate' as kind, 'booleans' as name,
--          '0086_applied=' || ((select count(*) from public.schema_migrations where version='0086') = 1)::text
--       || ' | column still there=' || exists(select 1 from information_schema.columns
--             where table_schema='public' and table_name='providers' and column_name='is_verified')::text
--       || ' | nothing reads it=' || (not exists (
--             select 1 from pg_depend d
--             join pg_rewrite r on r.oid = d.objid
--            where d.refobjid = 'public.providers'::regclass
--              and d.refobjsubid = (select a.attnum from pg_attribute a
--                                    where a.attrelid='public.providers'::regclass
--                                      and a.attname='is_verified')
--              and d.classid = 'pg_rewrite'::regclass))::text
--          as detail
--   union all
--   select 'view', 'rows / badges now',
--          (select count(*)::text from public.public_stylists) || ' rows, '
--       || (select count(*) filter (where is_verified)::text from public.public_stylists) || ' with a badge'
--   union all
--   select 'named', v.id::text, 'in_view=' || exists(select 1 from public.public_stylists s where s.id = v.id)::text
--       || ' badge=' || coalesce((select s.is_verified::text from public.public_stylists s where s.id = v.id), 'n/a')
--       || ' users.is_verified=' || coalesce(u.is_verified::text, 'null')
--     from (values ('49d40aae-a830-41d1-bca8-0fbdb2695455'::uuid),
--                  ('b604a402-0000-0000-0000-000000000000'::uuid)) as v(id)
--     left join public.providers p on p.id = v.id
--     left join public.users u on u.id = p.user_id
--   order by 1, 2;
--
--   EXPECT, AFTER steps 1–3 and before this migration:
--     · all three booleans true — `nothing reads it` is the one that matters,
--       and it is FALSE until public-web-views.sql has been re-run by hand.
--     · 2 rows, 2 with a badge. ⚠️ If it says 2 rows and 0 badges, the view has
--       NOT been re-run and applying this will be refused by the post-condition.
--
--   ⚠️ b604a402's full uuid is truncated in the audit record — substitute the
--   real one before running, or drop that row from the VALUES list. A probe
--   that silently matches nothing is worse than one that is not there.
-- ===========================================================================
--
-- ── VERIFY — ONE BLOCK, after applying ──────────────────────────────
--
--   The migration's own post-condition already asserts all three of these and
--   rolls back on any of them, so this is the record rather than the gate.
--
--   select 'column gone' as check_name,
--          (not exists (select 1 from information_schema.columns
--                        where table_schema='public' and table_name='providers'
--                          and column_name='is_verified'))::text as outcome
--   union all
--   select 'public_stylists row count (was 2 before)',
--          (select count(*)::text from public.public_stylists)
--   union all
--   select 'rows showing a badge (was 0 before)',
--          (select count(*) filter (where is_verified)::text from public.public_stylists)
--   union all
--   select 'the two in-view stylists, by id',
--          coalesce((select string_agg(s.id::text || '=' || s.is_verified::text, ', ' order by s.id::text)
--                      from public.public_stylists s), '(none)')
--   union all
--   select 'the third, 09c6d70c, direct — NOT in the view (item 183)',
--          coalesce((select u.is_verified::text
--                      from public.providers p join public.users u on u.id = p.user_id
--                     where p.id = '09c6d70c-8178-4923-80f2-8cf8e8102e21'), 'provider not found');
--
--   EXPECT: true · 2 · 2 · both ids `=true` · true.
--
--   ⚠️ THE THIRD IS ASSERTED DIRECTLY AND SEPARATELY, ON PURPOSE. 09c6d70c is
--   `is_published = true` and yet `in_view = false`: something in the view's
--   WHERE excludes it — a non-empty name, `bio_is_publishable(bio)`, or at
--   least one categorised treatment. **A stylist whose shop says live and who
--   appears in no public listing, with nothing telling her, is the same
--   silent-false-negative class as the badge and worse, because the badge is
--   cosmetic and this is her entire visibility.** Raised as item 183, not
--   fixed here. Asserting it through the view would have been asserting a
--   thing that is not true for a reason unrelated to this migration.
-- ===========================================================================

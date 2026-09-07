-- ===========================================================================
-- 0031_status_posts
--
-- The table behind "What's on near you". First of four: this is the shape and
-- the access rules, nothing else.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────
-- `providers.status_text` and `status_expires_at` are READ in four places —
-- both web dashboard feeds, the mobile shop page's pulsing status bar, and the
-- `public_stylists` view — and WRITTEN NOWHERE. No composer has ever existed,
-- so the feed has been empty since it shipped and always would have been. It
-- was read as "no inventory". Third render-site-with-no-writer after
-- providers.banner_url and patch_tests.
--
-- The design is not being invented now. It was settled in August and deferred:
-- web-phase-1-handover.md:309-380 has the table shape, the 48-hour lifetime,
-- fail-closed moderation, plain-text-only enforced server-side, and the
-- unfiltered last_modified rule. This migration builds the first part of it.
--
-- ── WHAT THE OTHER THREE DO, SO THIS ONE IS NOT READ ALONE ──────────────
--   0032  the two server-side guarantees: link stripping and the banned-word
--         auto-screen, both as triggers, because a composer-side check is
--         bypassed by calling PostgREST with the author's own token
--   0033  public_stylist_status — the anon-facing view: approved AND unexpired
--   0034  the cutover. Migrates live status_text values in, drops the two
--         columns, and rebuilds public_stylists without status_text.
--         ⚠️ 0034 is the one that can take the public site down. See audit
--         item 16: `create or replace view` cannot drop a column, a dropped
--         view loses its grants, and anon is how every logged-out visitor and
--         every search engine reads the site. It fails SILENTLY.
--
-- ── A STYLIST CAN SEE THEIR OWN PENDING POST ───────────────────────────
-- Settled here rather than in the client, because RLS is what makes it true.
--
-- A post held for review is INVISIBLE to everyone else, and must be VISIBLE to
-- its author, marked as pending. If the author could not see it, the composer
-- would clear on submit and leave them with no evidence they had written
-- anything — indistinguishable from the post having failed. That is the
-- fail-closed-fails-silent shape this project keeps removing: the safety
-- behaviour is right and the person is left guessing.
--
-- So `status_posts_read_own` is deliberately unfiltered by moderation_status
-- and unfiltered by expiry. An author sees their pending post, their rejected
-- post and their expired ones. Everyone else sees approved and unexpired only.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — the status_text baseline, captured NOW rather than in 0034.
--
-- 0034 migrates these values into the new table and then drops the columns.
-- Recording what is there at the START of the sequence means the before-figure
-- exists even if something goes wrong three migrations later.
--
-- This is 0012's lesson as a rule rather than a regret: its pre-check was run
-- after the fact and the baseline was lost permanently, which is why 0014 was
-- written to make measurement unskippable.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0031', 'providers_total', count(*)::text from public.providers;

insert into public.migration_findings (version, item, value)
select '0031', 'status_text_non_null', count(*)::text
from public.providers where nullif(btrim(coalesce(status_text, '')), '') is not null;

insert into public.migration_findings (version, item, value)
select '0031', 'status_text_unexpired', count(*)::text
from public.providers
where nullif(btrim(coalesce(status_text, '')), '') is not null
  and (status_expires_at is null or status_expires_at > now());

-- Every live value, one row each, so 0034's migration can be checked against
-- what was actually there rather than against a count.
insert into public.migration_findings (version, item, value)
select '0031', 'status_text_value_' || p.id::text,
       left(coalesce(p.status_text, ''), 200)
from public.providers p
where nullif(btrim(coalesce(p.status_text, '')), '') is not null;

-- ---------------------------------------------------------------------------
-- ASSERT — the columns this sequence migrates from must still exist.
--
-- Cheap, and the reason it is here is 0023: a migration written against a table
-- it had never read. If someone has already dropped these by hand, 0034 would
-- migrate nothing and report success.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(c, ', ')
    into v_missing
  from unnest(array['status_text', 'status_expires_at']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'providers' and column_name = c
  );

  if v_missing is not null then
    raise exception
      '0031: providers is missing %, which 0034 migrates from. If they were '
      'dropped by hand, the live values are gone and 0034 has nothing to move. '
      'Check migration_findings for 0031 before continuing.', v_missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.status_posts (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  body              text not null,

  created_at        timestamptz not null default now(),
  -- 48 hours, from the August design. Short on purpose: this is "two spaces
  -- free Thursday", not a profile field.
  expires_at        timestamptz not null default now() + interval '48 hours',

  -- FAIL CLOSED. Nothing reaches the open web without an explicit approval,
  -- and 'pending' is what the row holds until the 0032 screen has run — so a
  -- post is safe even in the window before any trigger fires.
  moderation_status text not null default 'pending'
                    check (moderation_status in ('pending', 'approved', 'rejected')),

  -- Set when a human decides. The stylist is told either way (the composer
  -- shows the state), so a rejection is visible rather than a silent expiry.
  reviewed_at       timestamptz,
  reviewed_by       uuid references auth.users(id) on delete set null,
  review_note       text
);

comment on table public.status_posts is
  'Ephemeral stylist updates, 48-hour lifetime. Supersedes providers.status_text '
  'and status_expires_at, which 0034 drops — leaving both live would recreate the '
  'location / location_text split exactly. Body is plain text, enforced by trigger '
  'in 0032 rather than by the composer, because a client check is bypassed by '
  'calling PostgREST with the author''s own token.';

comment on column public.status_posts.moderation_status is
  'pending | approved | rejected, matching the portfolio_items convention so the '
  'admin queue gains a tab rather than a new concept. Defaults to pending: fail '
  'closed, and it is what the row holds before the 0032 auto-screen has run.';

-- Unfiltered, and it must stay that way: it matches the last_modified aggregate
-- in public_stylists, which is max(created_at) over ALL rows with no status and
-- no expiry filter. Filtering either makes lastmod move backwards on a takedown.
create index if not exists status_posts_provider_created_idx
  on public.status_posts (provider_id, created_at desc);

-- The visible-posts read.
create index if not exists status_posts_visible_idx
  on public.status_posts (provider_id, expires_at desc)
  where moderation_status = 'approved';

-- ---------------------------------------------------------------------------
-- 2. Access.
-- ---------------------------------------------------------------------------
alter table public.status_posts enable row level security;

-- THE AUTHOR SEES EVERYTHING OF THEIR OWN. No moderation filter, no expiry
-- filter — see the header. A pending post the author cannot see is a post they
-- cannot tell apart from one that failed to save.
drop policy if exists status_posts_read_own on public.status_posts;
create policy status_posts_read_own
  on public.status_posts as permissive for select to authenticated
  using (exists (
    select 1 from public.providers p
    where p.id = status_posts.provider_id and p.user_id = auth.uid()
  ));

-- Everyone else, in the app: approved and unexpired only. The public/anon
-- surface is a separate view in 0033 and does not rely on this.
drop policy if exists status_posts_read_visible on public.status_posts;
create policy status_posts_read_visible
  on public.status_posts as permissive for select to authenticated
  using (moderation_status = 'approved' and expires_at > now());

-- Write your own, and only your own.
drop policy if exists status_posts_insert_own on public.status_posts;
create policy status_posts_insert_own
  on public.status_posts as permissive for insert to authenticated
  with check (exists (
    select 1 from public.providers p
    where p.id = status_posts.provider_id and p.user_id = auth.uid()
  ));

-- Delete your own — "the slot went" needs to be one tap, not a support email.
drop policy if exists status_posts_delete_own on public.status_posts;
create policy status_posts_delete_own
  on public.status_posts as permissive for delete to authenticated
  using (exists (
    select 1 from public.providers p
    where p.id = status_posts.provider_id and p.user_id = auth.uid()
  ));

-- NO author UPDATE policy, deliberately. Editing a body would need re-screening
-- and re-approval, and an approved post silently becoming different text is the
-- hole that makes the whole moderation step decorative. Delete and post again.

-- Admins review. Kept explicit rather than relying on a service-role path, so
-- the moderation tab in 0034's client work reads and writes as the admin.
drop policy if exists status_posts_admin_all on public.status_posts;
create policy status_posts_admin_all
  on public.status_posts as permissive for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, delete on public.status_posts to authenticated;
grant update (moderation_status, reviewed_at, reviewed_by, review_note)
  on public.status_posts to authenticated;   -- narrowed further by RLS to admins

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0031', 'status_posts', 'dd05630c68ebb506a9ddb64b7c6be84fff1cb05b5dd8596e4206fac4394bf1cd');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Written for the Supabase SQL editor: one
-- self-contained statement per check, guards satisfied where they apply.
--
-- ── BLOCK A — the baseline this sequence depends on ─────────────────────
--
--   select item, value from public.migration_findings
--   where version = '0031' order by item;
--
--   Note status_text_non_null and status_text_unexpired. 0034 migrates exactly
--   the unexpired ones, and this is the only record of what was there.
--
-- ── BLOCK B — a stylist sees their OWN pending post ─────────────────────
--
--   The rule settled in this migration. Paste the PROVIDER'S USER ID in both
--   places, and a providers.id belonging to them.
--
--   begin;
--     set local request.jwt.claims = '{"sub":"<PASTE-USER-ID>","role":"authenticated"}';
--     set local role authenticated;
--     insert into public.status_posts (provider_id, body)
--     values ('<PASTE-PROVIDERS-ID>'::uuid, 'Verify block B - rolled back');
--     select id, moderation_status, expires_at > now() as live
--       from public.status_posts where body like 'Verify block B%';
--   rollback;
--
--   Expect ONE row, moderation_status 'pending'. If it returns nothing, the
--   author cannot see their own held post and the composer will clear on submit
--   leaving them no evidence they wrote anything.
--
-- ── BLOCK C — nobody else can ───────────────────────────────────────────
--
--   Same insert, then read it as a DIFFERENT signed-in user. Use the model test
--   account b0df9c2f-02c5-4fef-afb0-9b184c3b9130.
--
--   begin;
--     insert into public.status_posts (provider_id, body, moderation_status)
--     values ('<PASTE-PROVIDERS-ID>'::uuid, 'Verify block C - rolled back', 'pending');
--     set local request.jwt.claims = '{"sub":"b0df9c2f-02c5-4fef-afb0-9b184c3b9130","role":"authenticated"}';
--     set local role authenticated;
--     select count(*) as should_be_zero from public.status_posts
--      where body like 'Verify block C%';
--   rollback;
--
--   Expect 0. A pending post visible to a model is the failure this table's
--   default exists to prevent.
--
-- ── BLOCK D — an author cannot edit an approved post ────────────────────
--
--   There is no author UPDATE policy, on purpose: an approved post silently
--   becoming different text would make the moderation step decorative.
--
--   begin;
--     insert into public.status_posts (provider_id, body, moderation_status)
--     values ('<PASTE-PROVIDERS-ID>'::uuid, 'Verify block D', 'approved');
--     set local request.jwt.claims = '{"sub":"<PASTE-USER-ID>","role":"authenticated"}';
--     set local role authenticated;
--     update public.status_posts set body = 'changed' where body = 'Verify block D';
--   rollback;
--
--   Expect UPDATE 0 — RLS matches no row for an author update. If it reports 1,
--   an approved post can be rewritten after review.
--
-- ── BLOCK E — 0032 has not run yet, and that is expected ────────────────
--
--   Nothing screens the body or strips links until 0032. A post inserted now
--   stays 'pending' for ever because no auto-screen exists to promote it. That
--   is correct at this point in the sequence and is why 0032 is not optional.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

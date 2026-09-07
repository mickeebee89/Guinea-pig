-- ===========================================================================
-- 0033_public_stylist_status
--
-- The anon-facing view of status posts: approved AND unexpired, nothing else.
--
-- ⚠️ Apply 0031 and 0032 first.
--
-- ── WHY A SEPARATE VIEW AND NOT RLS ─────────────────────────────────────
-- `status_posts` has an `authenticated` policy that already hides unapproved
-- and expired rows from members. This view exists for the OTHER audience: the
-- logged-out visitor and the search engine, who arrive as `anon` and are served
-- statically rendered pages.
--
-- Two audiences, two mechanisms, and the public one is deliberately the
-- narrower — it can only ever widen by someone editing this file, not by an
-- RLS policy elsewhere quietly changing shape.
--
-- ── WHY THIS ONE IS GRANTED WHEN ITS TWO SIBLINGS ARE NOT ───────────────
-- `public_stylist_portfolio` and `public_stylist_reviews` are written and
-- deliberately NOT granted, pending the §8 public-display consent work. This
-- one is granted, and the difference is whose data it is:
--
--   portfolio  photographs OF MODELS. Third parties, who consented to a
--              treatment and not to being published on the open web.
--   reviews    words written BY OTHER USERS about the stylist.
--   status     the stylist's OWN sentence about their OWN shop, written in a
--              composer that says it will be public.
--
-- So there is no third party whose consent is missing. If that ever stops being
-- true — a status post quoting a model, say — this grant needs revisiting with
-- the other two.
--
-- ── THE REVOKE IS NOT CEREMONIAL ────────────────────────────────────────
-- Supabase's default privileges grant SELECT to `anon` on a view the moment it
-- is created. So a view is public BEFORE any grant line in this file runs, and
-- the only way to be sure of what is exposed is to revoke everything first and
-- then grant back exactly what is intended. Copied from public-web-views.sql,
-- where the same note is written for the same reason.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — what this view reads must exist and mean what it says.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'status_posts'
  ) then
    raise exception '0033: public.status_posts does not exist. Apply 0031 first.';
  end if;

  -- 0032 is what makes 'approved' mean "screened", rather than "nobody has
  -- looked yet". Publishing approved rows before the screen exists would expose
  -- unscreened text to the open web.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.status_posts'::regclass
      and tgname = 'trg_status_post_screen'
  ) then
    raise exception
      '0033: trg_status_post_screen is missing. Apply 0032 first — without it '
      '''approved'' does not mean screened, and this view publishes to anon.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The view.
--
-- security_barrier matches public_stylists: it stops a caller's own WHERE
-- clause being evaluated before the view's own filters, which is how a
-- carefully written predicate can be tricked into leaking rows it excludes.
-- ---------------------------------------------------------------------------
drop view if exists public.public_stylist_status;

create view public.public_stylist_status
with (security_barrier = true) as
select
  sp.id,
  sp.provider_id,
  sp.body,
  sp.created_at,
  sp.expires_at
from public.status_posts sp
join public.providers p on p.id = sp.provider_id
where sp.moderation_status = 'approved'
  and sp.expires_at > now()
  -- The provider must be publishable in their own right. Without this a
  -- suspended or unpublished stylist keeps broadcasting to the open web
  -- through a surface nobody thinks of as their shop page.
  and p.is_published is true
  -- Seed accounts use the reserved .invalid TLD, which no real user can hold.
  -- Same guard as public_stylists, self-removing once teardown runs.
  and not exists (
    select 1 from public.users u
    where u.id = p.user_id and u.email like '%@seed.guineapig.invalid'
  );

comment on view public.public_stylist_status is
  'Anon-facing status posts: approved AND unexpired AND the provider is published. '
  'Deliberately narrower than the authenticated RLS path, and deliberately GRANTED '
  'where public_stylist_portfolio and public_stylist_reviews are not — a status post '
  'is the stylist''s own words about their own shop, so no third party''s consent is '
  'missing. Moderation columns are not exposed at all.';

-- ---------------------------------------------------------------------------
-- Grants. REVOKE first — see the header.
-- ---------------------------------------------------------------------------
revoke all on public.public_stylist_status from public, anon, authenticated;
grant select on public.public_stylist_status to anon, authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0033', 'public_stylist_status', '7430b8139d08cc8fe9a670c586ecbdebdd11f170c3a7178a0f6c6d2bdbfe8d1c');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ── BLOCK A — the grant actually landed ─────────────────────────────────
--
-- Read it from the catalogue rather than trusting that the grant line ran.
-- This is the habit that matters in 0034, where a missed grant takes the
-- public site down silently — practise it here where the cost is nil.
--
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'public_stylist_status'
--   order by grantee;
--
--   Expect SELECT for anon and for authenticated, and nothing else.
--
-- ── BLOCK B — only approved, unexpired, published rows are visible ──────
--
--   Four rows in, one row out. Paste a providers.id that IS published.
--
--   begin;
--     insert into public.status_posts (provider_id, body, moderation_status, expires_at)
--     values
--       ('<PASTE-PROVIDERS-ID>'::uuid, 'A visible one',  'approved', now() + interval '1 day'),
--       ('<PASTE-PROVIDERS-ID>'::uuid, 'B expired',      'approved', now() - interval '1 hour'),
--       ('<PASTE-PROVIDERS-ID>'::uuid, 'C pending',      'pending',  now() + interval '1 day'),
--       ('<PASTE-PROVIDERS-ID>'::uuid, 'D rejected',     'rejected', now() + interval '1 day');
--     select body from public.public_stylist_status where body like ANY (array['A %','B %','C %','D %']);
--   rollback;
--
--   Expect exactly 'A visible one'.
--
--   ⚠️ The inserts set moderation_status explicitly, which 0032's screen
--   OVERWRITES on insert — so B, C and D may not hold the status written here.
--   That does not affect what this block proves (only A should be visible under
--   every combination), but do not read the output as evidence about the screen.
--   Block D of 0032 is the check for that.
--
-- ── BLOCK C — an unpublished stylist does not broadcast ─────────────────
--
--   begin;
--     update public.providers set is_published = false where id = '<PASTE-PROVIDERS-ID>'::uuid;
--     insert into public.status_posts (provider_id, body, moderation_status)
--     values ('<PASTE-PROVIDERS-ID>'::uuid, 'E should be hidden', 'approved');
--     select count(*) as should_be_zero from public.public_stylist_status
--      where body like 'E %';
--   rollback;
--
--   Expect 0. A stylist whose shop is not published still has a status surface
--   without this, and it is not one anybody would think to check.
--
-- ── BLOCK D — anon really can read it ───────────────────────────────────
--
--   The grant is only half the answer; the view must also survive the anon role.
--
--   begin;
--     set local role anon;
--     select count(*) from public.public_stylist_status;
--   rollback;
--
--   Expect a number, not a permission error. A count of 0 is fine — there may
--   be no live posts — but an error means the public site would see nothing.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

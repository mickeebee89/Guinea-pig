-- ===========================================================================
-- 0105_the_floor_says_when_something_is_new
--
-- ⚠️ Apply 0104 first. One nullable column and one function. The Salon Floor
-- nav item gets a dot when somebody else has posted since you last opened it.
--
-- ── ⚠️ A DOT, NOT A COUNT, AND THE EXPIRY IS THE REASON ─────────────────
-- AppNav already says it of Messages: "a count also has to be right, and '3'
-- next to a list of four is a bug report". Messages can carry a number because
-- `read_at` is per-row and stable. A floor post EXPIRES AFTER 48 HOURS, so any
-- count rendered server-side can be wrong before the tap that follows it. A
-- dot is true as long as anything is new, which is the only claim that
-- survives the gap between render and arrival.
--
-- ── ⚠️⚠️ EXPIRY AND MODERATION ARE NOT RE-IMPLEMENTED HERE ──────────────
-- `status_posts_read_visible` is `moderation_status = 'approved' AND
-- expires_at > now()`, enforced by RLS on every read. The loader that uses
-- this column deliberately adds NO expires_at filter: a second copy of that
-- rule is a second thing to drift, which is audit item 192's whole shape.
--
-- ⚠️ BUT `status_posts_read_own` IS PERMISSIVE AND ORs IN, so a member always
-- sees their own posts, expired or not — and without an author filter, posting
-- something would dot yourself. The loader excludes `author_user_id = viewer`
-- for that reason, and that exclusion is NOT about privacy; it is about the
-- dot meaning "somebody else said something".
--
-- ⚠️⚠️ AND THERE IS A THIRD POLICY THE BRIEF DID NOT ACCOUNT FOR:
-- `status_posts_admin_all [PERMISSIVE] is_admin()`. An ADMIN sees every post,
-- expired and unapproved included, because that policy ORs in too. So for the
-- two admin accounts the dot can reflect a post no ordinary member can see.
-- Not filtered, deliberately — filtering would mean re-implementing the expiry
-- rule the paragraph above refuses to re-implement, and it affects two
-- accounts whose job is to see things other people cannot. Written down so it
-- is a known property rather than a surprise.
--
-- ── ⚠️ NULL MEANS "NEVER LOOKED", AND THAT IS THE OPPOSITE OF 0104 ──────
-- 0104's admin dots SEED a watermark at now() on first read, so a first load
-- is never a wall of dots over 52 users. This one does the reverse: a null
-- `salon_floor_seen_at` means every visible post is new.
--
-- The two are different on purpose, and the difference is the cost of being
-- wrong. There, a first load could have lit eleven items over data that was
-- always there. Here the worst case is ONE dot for a post less than 48 hours
-- old that she may already have seen — and erring toward drawing attention is
-- the entire point of a feature that exists to say "somebody is on the floor".
--
-- ── ⚠️⚠️ THE COLUMN MUST NOT JOIN users' WRITABLE LIST ──────────────────
-- 0088 revoked table-wide UPDATE on `public.users` and re-granted named
-- columns; 0099 extended that list from 8 to 10 for the postcode towns. Read
-- live, 24 Oct 2026, authenticated may UPDATE exactly: admin_district, bua,
-- first_name, instagram_handle, last_initial, latitude, longitude,
-- notification_preferences, postcode, profile_pic_url.
--
-- ✅ SO THIS COLUMN IS UNWRITABLE BY THE CLIENT WITHOUT THIS MIGRATION DOING
-- ANYTHING — `users` carries `authenticated=ardDxtm`, with no `w`. That is
-- 0088 still holding, not 0105 being careful, and the post-condition asserts
-- it precisely because the protection comes from somewhere else and could be
-- undone somewhere else.
--
-- ⚠️ The column IS readable: the table-level SELECT covers it, which the
-- layout needs in order to pass a watermark to the loader. Readable and not
-- writable is exactly the intended shape.
--
-- ⚠️ NOTHING IS CREATED THAT WOULD PICK UP DEFAULT PRIVILEGES. No table, no
-- view, no sequence. Had there been, Supabase's ALTER DEFAULT PRIVILEGES would
-- have granted arwdDxtm to anon, authenticated and service_role at creation —
-- that is what rolled 0104 back twice, and 0033 and 0077 before it.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0104') then
    raise exception '0105 needs 0104 applied first.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'salon_floor_seen_at'
  ) then
    raise exception '0105 adds users.salon_floor_seen_at and it already exists.';
  end if;
  if to_regprocedure('public.mark_salon_floor_seen()') is not null then
    raise exception '0105 expects the name mark_salon_floor_seen to be free.';
  end if;
  -- The premise of the whole design: the dot inherits RLS rather than
  -- restating it. If that policy is not there, the loader would need an
  -- expiry filter it deliberately does not have.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.status_posts'::regclass
      and polname = 'status_posts_read_visible'
  ) then
    raise exception '0105 assumes status_posts_read_visible enforces approval and '
      'expiry. It is not there, so the dot would show posts nobody can open.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The watermark. Nullable, no default — null is "never looked".
-- ---------------------------------------------------------------------------
alter table public.users add column salon_floor_seen_at timestamptz;

comment on column public.users.salon_floor_seen_at is
  'When this member last opened the Salon Floor. NULL means never, and every '
  'visible post is then new. Moved only by mark_salon_floor_seen() — the '
  'client has no UPDATE grant on this column and must not be given one.';

-- ---------------------------------------------------------------------------
-- 2. The only thing that may move it.
--
--    Mirrors admin_mark_activity_seen's guards: is_admin is not relevant here,
--    but the auth.uid() check is — a SECURITY DEFINER function with no caller
--    identity would otherwise write a row attributed to nobody, or to every
--    row if the where clause were ever loosened.
-- ---------------------------------------------------------------------------
create or replace function public.mark_salon_floor_seen()
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'mark_salon_floor_seen: no auth.uid(), so it could not be attributed'
      using errcode = '42501';
  end if;

  -- ⚠️ `where id = v_me` AND NOTHING ELSE. This runs as the owner, so the
  -- where clause is the only thing standing between one member's watermark and
  -- everybody's.
  update public.users set salon_floor_seen_at = now() where id = v_me;
end
$fn$;

comment on function public.mark_salon_floor_seen() is
  'Advance the calling member''s Salon Floor watermark to now(). The only '
  'writer of users.salon_floor_seen_at; the client has no grant on it.';

-- ⚠️ A NEW DEFINER FUNCTION STARTS AT EXECUTE TO PUBLIC. 0097's rule, and this
-- is the sixth time it has had to be written out.
revoke all on function public.mark_salon_floor_seen() from public;
revoke all on function public.mark_salon_floor_seen() from anon;
grant execute on function public.mark_salon_floor_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ⚠️⚠️ POST-CONDITION: THE END STATE, MEASURED.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'salon_floor_seen_at'
      and is_nullable = 'YES' and column_default is null
  ) then
    raise exception '0105: salon_floor_seen_at is missing, not nullable, or has a default. '
      'A default would make "never looked" indistinguishable from "looked at migration time".';
  end if;

  -- ⚠️⚠️ THE ASSERTION THAT MATTERS. It passes because 0088 revoked table-wide
  -- UPDATE on users, not because anything here granted or revoked — so it is
  -- checking an invariant owned by another migration, which is exactly the
  -- kind that goes quietly false.
  if has_column_privilege('authenticated', 'public.users', 'salon_floor_seen_at', 'UPDATE') then
    raise exception '0105: authenticated can UPDATE salon_floor_seen_at. Only '
      'mark_salon_floor_seen() may move a watermark, or a member can hide the dot '
      'from themselves or resurrect it at will.';
  end if;

  -- ✅ And it must stay READABLE, or the layout cannot pass it to the loader.
  if not has_column_privilege('authenticated', 'public.users', 'salon_floor_seen_at', 'SELECT') then
    raise exception '0105: authenticated cannot SELECT salon_floor_seen_at, so the dot '
      'has no watermark to measure against.';
  end if;

  -- The ten columns 0088 and 0099 named are still the ten, and this is not one.
  if (select string_agg(a.attname, ',' order by a.attname)
      from pg_attribute a, lateral aclexplode(a.attacl) x
      where a.attrelid = 'public.users'::regclass
        and x.grantee = 'authenticated'::regrole and x.privilege_type = 'UPDATE')
     <> 'admin_district,bua,first_name,instagram_handle,last_initial,latitude,'
        'longitude,notification_preferences,postcode,profile_pic_url' then
    raise exception '0105: the writable column list on users has changed. It should be '
      'the ten from 0088 and 0099, and salon_floor_seen_at must not be among them.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_salon_floor_seen'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
  ) then
    raise exception '0105: mark_salon_floor_seen is not SECURITY DEFINER with '
      'search_path public, pg_temp. 0094 undone.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_salon_floor_seen'
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0105: mark_salon_floor_seen still grants EXECUTE to PUBLIC. '
      'A null acl means the default is in force and is not the same state as a '
      'PUBLIC grantee.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
    where n.nspname = 'public' and p.proname = 'mark_salon_floor_seen'
      and a.grantee = 'anon'::regrole and a.privilege_type = 'EXECUTE'
  ) then
    raise exception '0105: anon can execute mark_salon_floor_seen.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0105', 'the_floor_says_when_something_is_new', '977ac95fecee3f9a76cf909ba5e18b6ee382e3e9436f970e1eae28f9e1b7765a');

commit;

notify pgrst, 'reload schema';

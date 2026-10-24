-- ===========================================================================
-- 0104_the_console_tells_me_what_is_new
--
-- ⚠️ Apply 0103 first. The admin console gets "something happened here" dots.
-- Three things: a created_at on availability, one table to remember what each
-- admin has already seen, and two functions to read and advance it.
--
-- ── ⚠️⚠️ THE 57 BACKFILLED availability TIMESTAMPS MEAN NOTHING ──────────
-- `availability` had no created_at at all (checked, 24 Oct 2026: id,
-- provider_id, date, start_time, end_time, active_treatments, is_taken,
-- price_pence, note). Adding one with `default now()` stamps every existing row
-- with THE MIGRATION'S OWN CLOCK — not when the stylist posted the slot, which
-- is not recorded anywhere and cannot be recovered.
--
-- ✅ THAT IS SAFE HERE ONLY BECAUSE OF THE FIRST-RUN RULE BELOW. The baseline
-- for an admin who has never looked is also seeded at now(), so 57 rows that
-- claim to have been created this second are already older than the watermark
-- and cannot show up as a flood of new slots. ⚠️ Anything else that ever reads
-- availability.created_at must know these 57 values are fiction. They are
-- usable as "before the console existed" and for nothing finer.
--
-- ── ⚠️ WHY A per-admin TABLE AND NOT A COLUMN ON `admins` ────────────────
-- Eleven keys, each with its own watermark and its own mute. A column per key
-- would be twenty-two columns and a migration every time a key is added; a
-- jsonb blob would make "advance exactly one key" a read-modify-write race
-- between two tabs. A row per (admin, key) makes advancing one key one upsert
-- that cannot disturb another.
--
-- ── ⚠️⚠️ THE FIRST-RUN RULE IS THE WHOLE DESIGN ─────────────────────────
-- An admin with no row for a key gets one seeded at now(), and that load
-- reports 0. It must NEVER count every row ever created: with 52 users and 46
-- messages, a first load would light every item at once and teach the reader
-- that the dots mean nothing. A dot has to mean "since you last looked", and on
-- the first look the honest answer is "nothing yet".
--
-- ⚠️ THE CONSEQUENCE IS THAT A READ FUNCTION WRITES. `admin_activity_counts`
-- is therefore VOLATILE, not STABLE — mislabelling it STABLE would let the
-- planner cache it within a statement and is a lie about what it does.
--
-- ── ⚠️ TWO KEYS DELIBERATELY IGNORE THE WATERMARK ────────────────────────
-- `verification` and `moderation` count what is OUTSTANDING, not what is new:
-- a pending ID check that an admin has looked at and not yet decided is still
-- work to do, and a dot that cleared on sight would be telling them the queue
-- was empty while somebody waited. They still get a row, because they still
-- need the mute.
--
-- ⚠️ `providers` COUNTS PUBLICATIONS, NOT SIGNUPS, because `providers` has no
-- created_at — only first_published_at (checked live). So this dot means "a
-- shop went live", which is the more interesting event anyway, but it is NOT
-- "a new stylist signed up". That one is `signup`, via users.created_at.
--
-- ⚠️⚠️ AND IT COUNTS THE FIRST PUBLICATION ONLY, EVER, PER SHOP.
-- `first_published_at` survives being unpublished: read live 24 Oct 2026, of 8
-- providers SIX carry a timestamp and only THREE are published right now —
-- Nhi @ SKINDUSTRY (23 Oct), Petra Pekarik and Flowers Mobile (both 24 Oct),
-- with Micky B, Mod and "testetstes" holding timestamps from August and
-- October while currently hidden. So a shop that goes live, is hidden, and
-- goes live again dots ONCE. "A shop came back" is not an event this key can
-- see, and nothing else records it.
--
-- ⚠️ ON THE FIRST LOAD IT STILL REPORTS 0, like every other key, because the
-- watermark seeds at now() and all six timestamps are in the past. That is the
-- first-run rule working, not the dot being dormant: the mechanism is live and
-- the next shop to publish lights it.
--
-- ── ⚠️ GRANTS ARE NAMED COLUMNS, NOT TABLE-WIDE ─────────────────────────
-- What the console actually needs, and nothing else:
--   SELECT                                   the settings page reads the mutes
--   INSERT (admin_user_id, key, muted)       first toggle creates the row
--   UPDATE (admin_user_id, key, muted)       a PostgREST upsert writes every
--                                            column it was given in the UPDATE
--                                            arm too, so all three are needed
--                                            for `.upsert()` to work at all
--
-- ⚠️ `last_seen_at` IS DELIBERATELY NOT GRANTED. It is the watermark, and the
-- only thing that may move it is `admin_mark_activity_seen`, which is SECURITY
-- DEFINER and therefore not bound by this grant. A client that could write it
-- could push it into the future and silently hide its own queue, or backdate it
-- and resurrect every dot — neither is a thing a toggle should be able to do by
-- sending one extra field.
--
-- ⚠️ AND A NEW COLUMN ON THIS TABLE WILL NOT BE COVERED. That is the point:
-- 0099 had to extend users' column grant from 8 to 10 for exactly this reason,
-- and a table-wide grant here would mean the next column is writable by the
-- client the moment it exists, without anyone deciding that.
--
-- ── ⚠️ THE KEY LIST IS A CHECK CONSTRAINT, NOT A CONVENTION ─────────────
-- Eleven keys. A client typo would otherwise insert a row for a key nothing
-- ever counts — a watermark that advances for a dot that never appears, which
-- looks exactly like the feature working.
-- ⚠️ 'activity' IS NOT ONE OF THEM, deliberately: the Activity page's own dot
-- is the sum of five of these, computed client-side. Giving it a key would make
-- it a twelfth watermark that disagreed with the five it is made of.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0103') then
    raise exception '0104 needs 0103 applied first.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0104 needs is_admin(); every function here gates on it.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'availability' and column_name = 'created_at'
  ) then
    raise exception '0104 adds availability.created_at and it already exists. '
      'Decide what the existing values mean before adding another.';
  end if;
  if to_regclass('public.admin_activity_seen') is not null then
    raise exception '0104 expects admin_activity_seen not to exist yet.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- (a) Something to sort slots by. See the header on what the 57 values mean.
-- ---------------------------------------------------------------------------
alter table public.availability
  add column created_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- (b) What each admin has already seen, per key.
-- ---------------------------------------------------------------------------
create table public.admin_activity_seen (
  admin_user_id uuid        not null references auth.users(id) on delete cascade,
  key           text        not null,
  last_seen_at  timestamptz not null default now(),
  muted         boolean     not null default false,
  primary key (admin_user_id, key),
  constraint admin_activity_seen_key_known check (key in (
    'users', 'providers', 'verification', 'moderation', 'reports', 'messages',
    'signup', 'slot', 'booking', 'photo', 'favourite'
  ))
);

comment on table public.admin_activity_seen is
  'One row per (admin, activity key): the watermark the dots are measured from '
  'and whether that dot is muted. last_seen_at moves only through '
  'admin_mark_activity_seen; the client may write muted and nothing else.';

alter table public.admin_activity_seen enable row level security;

-- ⚠️ ONE POLICY, THREE COMMANDS. Both halves are load-bearing and they are not
-- the same test: `admin_user_id = auth.uid()` stops an admin reading or moving
-- ANOTHER admin's watermark, and `is_admin()` stops a member who is not an
-- admin writing rows at all. Either alone leaves one of those open.
--
-- No DELETE policy, so nothing can remove a row: a deleted watermark would
-- re-seed at now() on the next read and silently skip everything in between.
create policy admin_activity_seen_own
  on public.admin_activity_seen
  as permissive
  for all
  to authenticated
  using (admin_user_id = auth.uid() and public.is_admin())
  with check (admin_user_id = auth.uid() and public.is_admin());

-- See the header: named columns, and last_seen_at is not among them.
grant select on public.admin_activity_seen to authenticated;
grant insert (admin_user_id, key, muted) on public.admin_activity_seen to authenticated;
grant update (admin_user_id, key, muted) on public.admin_activity_seen to authenticated;

-- ---------------------------------------------------------------------------
-- (c) Reading the counts, and advancing one watermark.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activity_counts()
returns table (key text, new_count integer, muted boolean)
language plpgsql
volatile                       -- it seeds missing rows. See the header.
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin_activity_counts: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_activity_counts: no auth.uid(), so it could not be attributed'
      using errcode = '42501';
  end if;

  -- THE FIRST-RUN RULE. Seed every missing key at now() BEFORE counting, so a
  -- first load measures against this instant and reports zero everywhere.
  -- ⚠️ `on conflict do nothing` rather than an upsert: a key that already has a
  -- watermark must not have it reset by the act of reading.
  insert into public.admin_activity_seen (admin_user_id, key)
  select v_admin, k
  from unnest(array[
    'users', 'providers', 'verification', 'moderation', 'reports', 'messages',
    'signup', 'slot', 'booking', 'photo', 'favourite'
  ]) as k
  on conflict (admin_user_id, key) do nothing;

  return query
  with seen as (
    select s.key, s.last_seen_at, s.muted
    from public.admin_activity_seen s
    where s.admin_user_id = v_admin
  )
  select sn.key,
         (case sn.key
            -- ⚠️ OUTSTANDING, NOT NEW. See the header.
            when 'verification' then
              (select count(*) from public.verification_requests vr where vr.status = 'pending')
            when 'moderation' then
              (select count(*) from public.users u
                where u.profile_pic_url is not null and u.profile_pic_reviewed_at is null)
            -- Everything below is "since you last looked".
            when 'users' then
              (select count(*) from public.users u where u.created_at > sn.last_seen_at)
            when 'signup' then
              (select count(*) from public.users u where u.created_at > sn.last_seen_at)
            -- ⚠️ PUBLICATIONS, not signups: providers has no created_at.
            when 'providers' then
              (select count(*) from public.providers p
                where p.first_published_at is not null and p.first_published_at > sn.last_seen_at)
            when 'reports' then
              (select count(*) from public.reports r where r.created_at > sn.last_seen_at)
            when 'messages' then
              (select count(*) from public.messages m where m.created_at > sn.last_seen_at)
            when 'slot' then
              (select count(*) from public.availability a where a.created_at > sn.last_seen_at)
            when 'booking' then
              (select count(*) from public.sessions se where se.created_at > sn.last_seen_at)
            when 'photo' then
              (select count(*) from public.model_photos mp where mp.created_at > sn.last_seen_at)
            when 'favourite' then
              (select count(*) from public.favourites f where f.created_at > sn.last_seen_at)
            else 0
          end)::integer as new_count,
         sn.muted
  from seen sn
  order by sn.key;
end
$fn$;

comment on function public.admin_activity_counts() is
  'Per-key "new since you last looked" counts for the calling admin. Seeds a '
  'missing watermark at now() and reports 0 for it, so a first load is never a '
  'wall of dots. verification and moderation report what is outstanding instead.';

-- Mirrors admin_mark_profile_pic_seen's guards: is_admin() first, then a
-- separate check that auth.uid() exists at all, because a DEFINER function with
-- no caller identity would write a row attributed to nobody.
create or replace function public.admin_mark_activity_seen(p_key text)
returns void
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin_mark_activity_seen: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_mark_activity_seen: no auth.uid(), so it could not be attributed'
      using errcode = '42501';
  end if;

  -- ⚠️ NO KEY WHITELIST HERE: the CHECK constraint on the table is the one
  -- place that decides, so a key added there needs no change in this function
  -- and a typo is refused by the database rather than by a second list that
  -- could drift from it.
  insert into public.admin_activity_seen (admin_user_id, key, last_seen_at)
  values (v_admin, p_key, now())
  on conflict (admin_user_id, key) do update set last_seen_at = now();
end
$fn$;

comment on function public.admin_mark_activity_seen(text) is
  'Advance this admin''s watermark for one key to now(). The only thing that '
  'may write last_seen_at — the client has no grant on that column.';

-- ⚠️ A NEW DEFINER FUNCTION STARTS AT EXECUTE TO PUBLIC. 0097, fifth time.
revoke all on function public.admin_activity_counts() from public;
revoke all on function public.admin_activity_counts() from anon;
grant execute on function public.admin_activity_counts() to authenticated;

revoke all on function public.admin_mark_activity_seen(text) from public;
revoke all on function public.admin_mark_activity_seen(text) from anon;
grant execute on function public.admin_mark_activity_seen(text) to authenticated;

-- ---------------------------------------------------------------------------
-- ⚠️⚠️ POST-CONDITION: THE END STATE, MEASURED.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_keys int;
  v_cols text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'availability'
      and column_name = 'created_at' and is_nullable = 'NO'
  ) then
    raise exception '0104: availability.created_at is missing or nullable.';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.admin_activity_seen'::regclass) then
    raise exception '0104: RLS is not enabled on admin_activity_seen.';
  end if;

  -- The key list is enforced, and it is the ELEVEN expected ones.
  select count(*) into v_keys from (
    select unnest(array[
      'users', 'providers', 'verification', 'moderation', 'reports', 'messages',
      'signup', 'slot', 'booking', 'photo', 'favourite']) as k
  ) q
  where position('''' || q.k || '''' in (
    select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.admin_activity_seen'::regclass
      and conname = 'admin_activity_seen_key_known')) > 0;
  if v_keys <> 11 then
    raise exception '0104: the key constraint does not name all eleven keys (found %).', v_keys;
  end if;
  if position('''activity''' in (
       select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.admin_activity_seen'::regclass
         and conname = 'admin_activity_seen_key_known')) > 0 then
    raise exception '0104: ''activity'' is in the key list. It is computed from the '
      'other five and must not have a watermark of its own.';
  end if;

  -- ⚠️ THE GRANT THAT MUST NOT EXIST. A client able to write last_seen_at could
  -- hide or resurrect its own dots, which is the one thing this design refuses.
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'admin_activity_seen'
      and column_name = 'last_seen_at' and grantee = 'authenticated'
  ) then
    raise exception '0104: authenticated has a column grant on last_seen_at.';
  end if;

  select string_agg(distinct column_name, ',' order by column_name) into v_cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'admin_activity_seen'
    and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE');
  if v_cols is distinct from 'admin_user_id,key,muted' then
    raise exception '0104: the writable columns are "%", expected "admin_user_id,key,muted".', v_cols;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_activity_counts', 'admin_mark_activity_seen')
      and (not p.prosecdef
           or array_to_string(p.proconfig, ',') <> 'search_path=public, pg_temp'
           or p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0104: a new function is not DEFINER with pg_temp last, or still '
      'grants EXECUTE to PUBLIC.';
  end if;

  -- ⚠️ VOLATILE, NOT STABLE. It writes, and the label has to say so.
  if (select p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_activity_counts') <> 'v' then
    raise exception '0104: admin_activity_counts is not VOLATILE, but it seeds rows.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0104', 'the_console_tells_me_what_is_new', '2f4cd1454a78871b9ba4a167f3aa6d3f1a51adf64b48c0eb37f69a40e9a66646');

commit;

notify pgrst, 'reload schema';

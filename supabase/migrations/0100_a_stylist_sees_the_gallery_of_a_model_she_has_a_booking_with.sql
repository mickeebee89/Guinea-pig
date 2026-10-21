-- ===========================================================================
-- 0100_a_stylist_sees_the_gallery_of_a_model_she_has_a_booking_with
--
-- ⚠️ Apply 0099 first. Audit item 217. NO DATA IS WRITTEN OR CHANGED: this
-- migration only narrows who may READ three tables.
--
-- Today every signed-in account can read every model photo, every model
-- attribute set and every photo category, bounded only by 0018's blocked-pair
-- rule. Measured live on 21 Oct 2026: a real model with no relationship to the
-- owner read all 11 photo rows. After this, five named accounts can read them
-- and nobody else can.
--
-- ── WHAT "ALLOWED" MEANS NOW: own row, OR admin, OR a shared session ───────
-- `/model/[id]` is the only cross-user reader in the live product
-- (`site/lib/queries/model.ts:140`), and it is only ever linked from a
-- relationship -- bookings, dashboard, messages, chat, her own profile. No
-- listing links to it.
--
-- ✅ ANY SESSION STATUS, AND THE REASON IS NOT A PREFERENCE. An application IS
-- a session: `create_session_with_consent` writes the row at 'pending'. So the
-- case that looked like it needed photos BEFORE any session -- a stylist
-- deciding whether to accept -- already has the join. And a COMPLETED session
-- is what a review is written against, so narrowing to active statuses would
-- empty the gallery for someone she has actually worked with. Any status keeps
-- every live flow working; nothing in the product reads these tables for a
-- stranger.
--
-- ⚠️ KEYED ON THE SESSION, NOT ON `users.role`. Item 215: two admin paths test
-- `role = 'provider'` and are routed around by `role = 'both'`. A stylist is
-- someone with a `providers` row joined to a session, so that is what is asked.
--
-- ── ⚠️⚠️ THE STORAGE HALF CANNOT BE DONE HERE. IT IS A DASHBOARD STEP ──────
-- The bucket is private and `model.ts:176` mints a signed URL per render with
-- the MEMBER's own client, so `storage.objects` RLS governs signing. The policy
-- `"model photos read"` is `using (bucket_id = 'model-photos')` for every
-- authenticated user -- the same `true` in a different place.
--
-- ⚠️ IT IS NOT OMITTED BY CHOICE. Measured 21 Oct 2026: `storage.objects` is
-- owned by `supabase_storage_admin`; `postgres` is NOT a member of it, NOBODY
-- is a member of it, and `postgres` is not a superuser (super=false,
-- bypassrls=true). Policy DDL on that table therefore FAILS from the SQL
-- editor and from the connector. Putting it in this file would roll the whole
-- migration back. The exact statements are below `commit;` for the Dashboard.
--
-- ⚠️ SO STATE THE POSTURE HONESTLY RATHER THAN THE INTENT. Until that step is
-- done the narrowing is INCOMPLETE. What it is not is broken: the object paths
-- come from `model_photos`, so a viewer this migration leaves with no rows has
-- no path to sign. What remains open is a path obtained some other way -- an
-- old message, a copied link, the one orphan object in the bucket (12 objects,
-- 11 rows). That is a smaller hole than the one being closed, and it is the
-- whole hole that is left.
--
-- ── ⚠️ THREE TABLES MOVE TOGETHER ─────────────────────────────────────────
-- `getModelProfile` reads `model_attributes`, `model_photos` and
-- `model_photo_categories` in one `Promise.all`. Narrowing one would leave a
-- page that renders photos it cannot group.
--
-- ⚠️ AND `model_photo_categories` IS THE AWKWARD ONE, TWICE OVER. `mpc_select`
-- is its ONLY select policy, so replacing it MUST carry an own-row clause or
-- the owner loses her own category names -- there is no FOR ALL policy behind
-- it as there is on the other two. And 0018 gave the blocked-pair RESTRICTIVE
-- policy to `model_attributes` and `model_photos` but NOT to it, so a blocked
-- stylist can read a blocked model's category names today. 0100 adds it.
--
-- ── ⚠️ AN ADDITION, FLAGGED RATHER THAN SLIPPED IN ────────────────────────
-- Step 5 revokes EXECUTE on `public.is_blocked_pair` from PUBLIC. Measured
-- today its ACL is `=X/postgres , postgres=X , authenticated=X , service_role=X`
-- -- the bare `=X` is the EXECUTE-TO-PUBLIC default still in force, which is
-- exactly what 0097 revoked on `nearby_models`. It is a SECURITY DEFINER
-- function over `blocks`, so the grant makes it a boolean oracle on who has
-- blocked whom. `is_admin()` does NOT carry it, so this is drift on one of the
-- pair, not the convention.
-- ⚠️ IT IS NOT PART OF ITEM 217'S SCOPE. It is one line, it cannot change
-- behaviour (`authenticated` holds an explicit grant either way), and it is in
-- the file because the alternative was leaving it found and not fixed. Delete
-- step 5 if it should travel separately.
--
-- ── ⚠️ LINE ENDINGS, MEASURED FOR THIS OBJECT AND CARRIED FROM NOTHING ────
-- Item 190: the Supabase SQL editor converts LF to CRLF on paste. The helper's
-- body is therefore built from `chr(10)` and asserted at md5
-- 2aebf5aa9852778a715ea36d857d9881, length 489, CR=0 LF=11. Those numbers were
-- computed for THIS body and are not comparable to any other object's.
-- (`is_blocked_pair`, for contrast, is live at CR=6 LF=6, length 201.)
--
-- ── WHAT CHANGES, NAMED RATHER THAN COUNTED ──────────────────────────────
-- EVERY member can read the 11 photo rows today. Five accounts can afterwards:
--   b0df9c2f  the owner
--   8788ed3d  the dedicated console admin
--   ff06d568  Micky B (admin, and also shares sessions)
--   517c2853  the provider test account -- accepted session
--   a923c7cc  a provider -- expired session
-- Everyone else, including aa2724a5, reads none. All 11 photos belong to test
-- accounts; no real member has uploaded one. That is a fact about today's
-- content, not a property of the arrangement.
--
-- ⚠️⚠️ AND THERE IS NO MEMBERSHIP COUNT ANYWHERE IN THIS FILE -- NOT IN AN
-- ASSERTION AND NOT IN THE PROSE. An earlier draft said "35 members"; a model
-- signed up at 18:29 on 21 Oct, between that sentence being written and being
-- read, and signups now arrive several times a day. A migration that asserts
-- how many members exist fails because a STRANGER acted, which is the worst
-- kind of red: correct code, rolled back, for a reason nobody can see in it.
-- The post-condition therefore names four viewers by id and says what each of
-- them sees. The 11 rows and the five readers are ours; the membership is not.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_missing text := '';
begin
  if not exists (select 1 from public.schema_migrations where version = '0099') then
    raise exception '0100 needs 0099 applied first.';
  end if;

  if to_regprocedure('public.is_admin()') is null then
    v_missing := v_missing || ' is_admin()';
  end if;
  if to_regprocedure('public.is_blocked_pair(uuid,uuid)') is null then
    v_missing := v_missing || ' is_blocked_pair(uuid,uuid)';
  end if;
  if to_regprocedure('auth.uid()') is null then
    v_missing := v_missing || ' auth.uid()';
  end if;
  if v_missing <> '' then
    raise exception '0100 needs these and they do not exist:%. The new policies would '
      'error at read time and hide every model photo.', v_missing;
  end if;

  -- Policy DDL requires ownership. Asked of the three tables rather than
  -- assumed, because the same question answered NO for storage.objects and
  -- that is the reason half of this change is a Dashboard step.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('model_photos','model_attributes','model_photo_categories')
      and not pg_has_role(current_user, c.relowner, 'USAGE')
  ) then
    raise exception '0100 cannot do policy DDL on one of its three tables: not the owner.';
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('model_photos','model_attributes','model_photo_categories')) <> 3 then
    raise exception '0100 expects all three tables to exist.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. One definition of "this stylist and this model have a booking".
--
--    Shaped on is_blocked_pair: SQL, STABLE, SECURITY DEFINER, search_path
--    ending in pg_temp (0094's invariant -- a new DEFINER function that omits
--    it reopens what 0094 closed across 41 functions).
--
--    SECURITY DEFINER so a policy can consult `sessions` and `providers`
--    without recursing into their own RLS as the caller.
--
--    auth.uid() inside a DEFINER function is the CALLER, not the owner. That
--    is the whole mechanism, and it is the same one 0018 relies on.
--
--    Keyed on `model_user_id`. Measured today: 40 sessions, model_user_id and
--    model_id both non-null on all 40 and disagreeing on none, and every
--    provider_id resolves to a providers row.
-- ---------------------------------------------------------------------------
do $mig$
declare
  -- ⚠️ BUILT FROM chr(10), SO THE PASTE CANNOT ALTER IT. 489 chars, LF only.
  v_body text :=
    '' ||
    chr(10) || '  -- ANY status, deliberately: a pending application IS a session, so a stylist' ||
    chr(10) || '  -- deciding on one already has the join; a completed one is what a review is' ||
    chr(10) || '  -- written against. Narrowing to active statuses breaks review and history.' ||
    chr(10) || '  select p_model_user_id is not null and auth.uid() is not null and exists (' ||
    chr(10) || '    select 1' ||
    chr(10) || '    from public.sessions s' ||
    chr(10) || '    join public.providers p on p.id = s.provider_id' ||
    chr(10) || '    where p.user_id = auth.uid()' ||
    chr(10) || '      and s.model_user_id = p_model_user_id' ||
    chr(10) || '  );' ||
    chr(10);
  v_len int;
  v_md5 text;
begin
  if length(v_body) <> 489 or md5(v_body) <> '2aebf5aa9852778a715ea36d857d9881' then
    raise exception '0100: the body literal is not the one this migration was written '
      'against (len % md5 %). Refusing to build a guard from text I cannot identify.',
      length(v_body), md5(v_body);
  end if;

  execute format(
    'create or replace function public.shares_session_with_model(p_model_user_id uuid) '
    'returns boolean language sql stable security definer '
    'set search_path to %L, %L as $f$%s$f$',
    'public', 'pg_temp', v_body);

  select length(p.prosrc), md5(p.prosrc) into v_len, v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'shares_session_with_model';

  if v_len <> 489 or v_md5 <> '2aebf5aa9852778a715ea36d857d9881' then
    raise exception '0100: what landed is not what was sent (len % md5 %). '
      'Item 190 -- the editor rewrote the line endings.', v_len, v_md5;
  end if;

  -- The shape matters as much as the text: an INVOKER function here would
  -- recurse into sessions RLS, and a missing pg_temp would be 0094 undone.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'shares_session_with_model'
      and p.prosecdef
      and p.provolatile = 's'
      and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
  ) then
    raise exception '0100: the helper landed with the wrong shape (definer/stable/search_path).';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 2. ⚠️ A NEW FUNCTION STARTS AT `EXECUTE TO PUBLIC`.
--
--    0097's lesson and 0099's repeat of it: the default ACL is EXECUTE TO
--    PUBLIC and a NULL proacl means that default is in force. The grants here
--    mirror is_admin(), which is the clean one of the two existing helpers.
-- ---------------------------------------------------------------------------
revoke all on function public.shares_session_with_model(uuid) from public;
revoke all on function public.shares_session_with_model(uuid) from anon;
grant execute on function public.shares_session_with_model(uuid) to authenticated;
grant execute on function public.shares_session_with_model(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The three reads stop being open.
--
--    Renamed from `*_select_auth` / `mpc_select`, because a policy called
--    "select_auth" that no longer means "any authenticated user" is a name
--    that misleads the next sweep. The old names are dropped by name, so the
--    change is visible in any diff of pg_policy.
--
--    Three escapes, each load-bearing and each the same as 0018's:
--      user_id = auth.uid()  her own gallery, editor and apply flow.
--      is_admin()            moderation reads photos to action reports.
--      shares_session...     the stylist she has a booking with.
-- ---------------------------------------------------------------------------
drop policy if exists model_photos_select_auth on public.model_photos;
create policy model_photos_select_scoped
  on public.model_photos for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.shares_session_with_model(user_id)
  );

drop policy if exists model_attributes_select_auth on public.model_attributes;
create policy model_attributes_select_scoped
  on public.model_attributes for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.shares_session_with_model(user_id)
  );

-- ⚠️ THE OWN-ROW CLAUSE IS NOT DECORATION HERE. mpc_select is the only SELECT
-- policy on this table -- mpc_insert/update/delete are own-row but none of
-- them grants a read. Without `user_id = auth.uid()` the owner would lose her
-- own category names the moment this lands.
drop policy if exists mpc_select on public.model_photo_categories;
create policy model_photo_categories_select_scoped
  on public.model_photo_categories for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.shares_session_with_model(user_id)
  );

-- ---------------------------------------------------------------------------
-- 4. The blocked-pair rule 0018 missed on the third table.
--
--    RESTRICTIVE, so it ANDs with the policy above rather than replacing it.
--    Identical in shape to model_photos_hide_blocked, deliberately: three
--    tables that are read together should refuse together.
-- ---------------------------------------------------------------------------
drop policy if exists model_photo_categories_hide_blocked on public.model_photo_categories;
create policy model_photo_categories_hide_blocked
  on public.model_photo_categories as restrictive for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or not public.is_blocked_pair(auth.uid(), user_id)
  );

-- ---------------------------------------------------------------------------
-- 5. ⚠️ AN ADDITION, NOT PART OF ITEM 217. See the header. Delete this block
--    if it should travel as its own migration.
--
--    is_blocked_pair still carries the EXECUTE-TO-PUBLIC default (`=X`). It is
--    SECURITY DEFINER over `blocks`, so that grant is a boolean oracle on who
--    has blocked whom. authenticated and service_role keep their explicit
--    grants, so nothing changes for any caller the app has.
-- ---------------------------------------------------------------------------
revoke execute on function public.is_blocked_pair(uuid, uuid) from public;
revoke execute on function public.is_blocked_pair(uuid, uuid) from anon;

-- ---------------------------------------------------------------------------
-- 6. ⚠️⚠️ POST-CONDITION: THE END STATE, MEASURED, NOT THE INTENT RESTATED.
--
--    0094's lesson, where a verify line stated an outcome it had not measured.
--    Two halves:
--      (a) the four new policies exist and NO permissive select policy with a
--          `true` qual survives on any of the three tables;
--      (b) the tables are then READ as four real members, with the role and
--          the JWT claim set, so RLS actually applies. postgres has
--          bypassrls=true, which is exactly why asserting as postgres would
--          prove nothing at all.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_open   int;
  v_new    int;
  v_other  int;
  v_owner  int;
  v_admin  int;
  v_shares int;
  k_shirin constant text := 'aa2724a5-8ed0-427a-86f4-ed9b3828ff39';
  k_owner  constant text := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
  k_admin  constant text := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
  k_prov   constant text := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
begin
  -- (a) no open read left, and all four new policies present.
  select count(*) into v_open
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('model_photos','model_attributes','model_photo_categories')
    and p.polcmd::text in ('r','*')
    and p.polpermissive
    and coalesce(pg_get_expr(p.polqual, p.polrelid, true), '') = 'true';
  if v_open <> 0 then
    raise exception '0100: % permissive select policies still read `true` on the three tables.', v_open;
  end if;

  select count(*) into v_new
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and p.polname in ('model_photos_select_scoped','model_attributes_select_scoped',
                      'model_photo_categories_select_scoped','model_photo_categories_hide_blocked');
  if v_new <> 4 then
    raise exception '0100: expected all four new policies, found %.', v_new;
  end if;

  -- (b) read it as four real members. auth.uid() prefers the singular claim
  -- GUC, so that one is blanked first or a stale value would decide the answer.
  perform set_config('request.jwt.claim.sub', '', true);

  perform set_config('request.jwt.claims', '{"sub":"' || k_shirin || '"}', true);
  perform set_config('role', 'authenticated', true);
  select (select count(*) from public.model_photos           where user_id <> k_shirin::uuid)
       + (select count(*) from public.model_attributes       where user_id <> k_shirin::uuid)
       + (select count(*) from public.model_photo_categories where user_id <> k_shirin::uuid)
    into v_other;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', '{"sub":"' || k_owner || '"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_owner from public.model_photos where user_id = k_owner::uuid;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', '{"sub":"' || k_admin || '"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_admin from public.model_photos where user_id = k_owner::uuid;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', '{"sub":"' || k_prov || '"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_shares from public.model_photos where user_id = k_owner::uuid;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', '', true);

  if v_other <> 0 then
    raise exception '0100: a member with no relationship still reads % rows across the three tables.', v_other;
  end if;
  if v_owner <> 11 then
    raise exception '0100: the owner reads % of her own 11 photos. The narrowing took her gallery.', v_owner;
  end if;
  if v_admin <> 11 then
    raise exception '0100: an admin reads % of 11 photos. Moderation cannot see the evidence.', v_admin;
  end if;
  if v_shares <> 11 then
    raise exception '0100: a stylist WITH a session reads % of 11 photos. The join is not working.', v_shares;
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0100', 'a_stylist_sees_the_gallery_of_a_model_she_has_a_booking_with', '8e41f7cb2d78d7a5b184c5c9d3c0117924dcc4fdb888f1f05f6745ec2330cde7');

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- PREFLIGHT -- ALREADY RUN. Measured against the live database on
-- 21 Oct 2026 through the Supabase connector in this chat, not by hand.
--
--   is_blocked_pair   SQL, STABLE, SECURITY DEFINER, search_path =
--                     'public','pg_temp'; body len 201, CR=6 LF=6;
--                     acl `=X/postgres , postgres=X , authenticated=X ,
--                     service_role=X`  <-- the bare =X is step 5's reason
--   is_admin          DEFINER, STABLE, search_path = public, pg_temp;
--                     acl carries NO PUBLIC grant
--   auth.uid()        STABLE, INVOKER; reads request.jwt.claim.sub first,
--                     then request.jwt.claims ->> 'sub'
--   shares_session_with_model, model_gallery_visible, has_session_with
--                     none of these names exists -- free
--   sessions          40 rows; provider_id non-null on 40 and resolving to a
--                     providers row on 40; model_user_id and model_id
--                     non-null on 40, disagreeing on 0
--   status CHECK      pending, accepted, declined, completed, cancelled,
--                     expired, not_held.  Live: accepted, cancelled,
--                     completed, declined, expired
--   model_photos      11 rows, ALL owned by b0df9c2f
--   storage objects   12 in bucket model-photos; folder[1] a valid uuid on
--                     12 of 12 and matching a model_photos.user_id on 12 of
--                     12; 1 object with no matching row (the orphan)
--   legacy paths      0 rows contain /object/public/ -- the lockdown backfill
--                     is clean, confirmed by Micky from the live data
--   buckets           model-photos false, verification-selfies false,
--                     portfolio-photos TRUE, profile-pics TRUE
--   owners            all three tables owned by postgres, RLS on, not forced
--   storage.objects   owned by supabase_storage_admin; postgres is NOT a
--                     member, NOBODY is a member, postgres super=false.
--                     Policy DDL there would fail -- hence the Dashboard step
--   public_profiles   defined as `select id, first_name, last_initial,
--                     profile_pic_url, instagram_handle from users` with NO
--                     where clause. ⚠️ THE ROW COUNT IS NOT RECORDED HERE --
--                     see below
--
-- ⚠️⚠️ A CORRECTION TO A CORRECTION, AND THE REASON THE COUNT IS GONE.
-- Item 217 said 36 members. Writing 0100 I read 35 and "corrected" 217 to 35.
-- Micky then read 36 again: ayesha.254@hotmail.com signed up as a model at
-- 18:29 on 21 Oct 2026, after 0100 was written. 36 was right, 35 was right,
-- and 36 is right again -- three true readings of a number that moves.
--
-- ⚠️ SO THE FAULT WAS NOT THE ARITHMETIC. It was treating a live population as
-- a fact about the system, in a file whose checksum is locked and whose
-- assertions can roll back a correct migration. Nothing here counts members
-- any more. Everything this file asserts is either structural or named by id.
-- ===========================================================================

-- ===========================================================================
-- ⚠️⚠️ THE OTHER HALF -- DASHBOARD ONLY. 0100 IS NOT FINISHED WITHOUT IT.
--
-- This CANNOT go in the migration: storage.objects is owned by
-- supabase_storage_admin and nothing can SET ROLE to it. Do it in
-- Storage -> Policies -> model-photos, editing the existing "model photos
-- read" policy (SELECT, target role `authenticated`) to this USING clause:
--
--   bucket_id = 'model-photos'
--   and (
--     (storage.foldername(name))[1] = auth.uid()::text
--     or public.is_admin()
--     or case
--          when (storage.foldername(name))[1] ~*
--               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--          then public.shares_session_with_model(((storage.foldername(name))[1])::uuid)
--          else false
--        end
--   )
--
-- ⚠️ WHY A `case` AND NOT JUST `AND`. The folder name is text and the helper
-- takes uuid, so it must be cast -- and a cast of a non-uuid folder raises
-- 22P02, which in a policy means the read FAILS rather than returns nothing.
-- AND does not promise left-to-right evaluation; `case` does, by definition.
-- All 12 objects have a valid uuid folder today, so the regex guards a future
-- object, not a present one.
--
-- ⚠️ `(storage.foldername(name))[1]` IS THE OWNER, not a convention being
-- assumed: the existing "model photos upload" and "model photos delete"
-- policies both enforce `= auth.uid()::text`, and all 12 objects satisfy it.
-- ===========================================================================

-- ===========================================================================
-- VERIFY -- ONE PASTE. Prints 8 rows, then either finishes silently or
-- RAISES. A raise is the failure; silence after the rows is the pass.
-- ===========================================================================
-- select '1. helper exists, right shape' as check,
--        coalesce((select 'definer=' || p.prosecdef::text || ' volatility=' || p.provolatile::text
--                  || ' search_path=' || array_to_string(p.proconfig, ',')
--                  || ' len=' || length(p.prosrc) || ' md5=' || md5(p.prosrc)
--                  || case when p.prosecdef and p.provolatile = 's'
--                            and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
--                            and length(p.prosrc) = 489
--                            and md5(p.prosrc) = '2aebf5aa9852778a715ea36d857d9881'
--                          then '  PASS' else '  FAIL' end
--                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                  where n.nspname = 'public' and p.proname = 'shares_session_with_model'),
--                 'FAIL -- the helper does not exist') as result
-- union all
-- select '2. helper acl has no PUBLIC grant',
--        coalesce((select case when p.proacl is null
--                              then 'FAIL -- null acl means EXECUTE TO PUBLIC'
--                              when exists (select 1 from aclexplode(p.proacl) a
--                                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
--                              then 'FAIL -- PUBLIC holds EXECUTE: ' || array_to_string(p.proacl, ' , ')
--                              else 'PASS -- ' || array_to_string(p.proacl, ' , ') end
--                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                  where n.nspname = 'public' and p.proname = 'shares_session_with_model'),
--                 'FAIL -- no such function')
-- union all
-- select '3. is_blocked_pair PUBLIC grant gone (step 5)',
--        (select case when p.proacl is null then 'FAIL -- null acl means EXECUTE TO PUBLIC'
--                     when exists (select 1 from aclexplode(p.proacl) a
--                                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
--                     then 'FAIL -- PUBLIC still holds EXECUTE: ' || array_to_string(p.proacl, ' , ')
--                     else 'PASS -- ' || array_to_string(p.proacl, ' , ') end
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and p.proname = 'is_blocked_pair')
-- union all
-- select '4. the four new policies',
--        (select coalesce(string_agg(c.relname || '.' || p.polname, ', ' order by p.polname), '(none)')
--                || case when count(*) = 4 then '  PASS' else '  FAIL -- expected 4, got ' || count(*) end
--         from pg_policy p join pg_class c on c.oid = p.polrelid
--         where p.polname in ('model_photos_select_scoped','model_attributes_select_scoped',
--                             'model_photo_categories_select_scoped','model_photo_categories_hide_blocked'))
-- union all
-- select '5. the three old open policies gone',
--        (select case when count(*) = 0 then 'PASS -- none remain'
--                     else 'FAIL -- still present: ' || string_agg(p.polname, ', ') end
--         from pg_policy p
--         where p.polname in ('model_photos_select_auth','model_attributes_select_auth','mpc_select'))
-- union all
-- select '6. no permissive select still reading true',
--        (select case when count(*) = 0 then 'PASS -- 0 open reads on the three tables'
--                     else 'FAIL -- ' || string_agg(c.relname || '.' || p.polname, ', ') end
--         from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
--         where n.nspname = 'public'
--           and c.relname in ('model_photos','model_attributes','model_photo_categories')
--           and p.polcmd::text in ('r','*') and p.polpermissive
--           and coalesce(pg_get_expr(p.polqual, p.polrelid, true), '') = 'true')
-- union all
-- select '7. MODELLED, NOT MEASURED -- who the predicate says keeps access',
--        -- ⚠️ NAMED, NOT COUNTED. An earlier draft printed "of N members"; N
--        -- moves every time somebody signs up, so it told you nothing you
--        -- could act on and read like a claim about the change.
--        (select 'accounts keeping access: '
--                || string_agg(left(id::text,8) || '=' || k, ', ' order by id) filter (where k > 0)
--         from (select u.id,
--                 (select count(*) from public.model_photos mp
--                   where mp.user_id = u.id
--                      or exists (select 1 from public.admins a where a.user_id = u.id)
--                      or exists (select 1 from public.sessions s join public.providers p on p.id = s.provider_id
--                                  where p.user_id = u.id and s.model_user_id = mp.user_id)) as k
--               from public.users u) q)
-- union all
-- select '8. THE STORAGE HALF -- done in the Dashboard, or not yet',
--        coalesce((select case when pg_get_expr(p.polqual, p.polrelid, true)
--                                = '(bucket_id = ''model-photos''::text)'
--                              then 'STILL OPEN -- every authenticated user can sign any path; '
--                                   'the Dashboard step above has not been done'
--                              else 'NARROWED -- ' || pg_get_expr(p.polqual, p.polrelid, true) end
--                  from pg_policy p where p.polrelid = 'storage.objects'::regclass
--                    and p.polname = 'model photos read'),
--                 'ABSENT -- no policy named "model photos read" on storage.objects');
--
-- do $v$
-- declare
--   v_other int; v_owner int; v_admin int; v_shares int;
--   k_shirin constant text := 'aa2724a5-8ed0-427a-86f4-ed9b3828ff39';
--   k_owner  constant text := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
-- begin
--   perform set_config('request.jwt.claim.sub', '', true);
--
--   perform set_config('request.jwt.claims', '{"sub":"' || k_shirin || '"}', true);
--   perform set_config('role', 'authenticated', true);
--   select (select count(*) from public.model_photos           where user_id <> k_shirin::uuid)
--        + (select count(*) from public.model_attributes       where user_id <> k_shirin::uuid)
--        + (select count(*) from public.model_photo_categories where user_id <> k_shirin::uuid)
--     into v_other;
--   perform set_config('role', 'postgres', true);
--
--   perform set_config('request.jwt.claims', '{"sub":"' || k_owner || '"}', true);
--   perform set_config('role', 'authenticated', true);
--   select count(*) into v_owner from public.model_photos where user_id = k_owner::uuid;
--   perform set_config('role', 'postgres', true);
--
--   perform set_config('request.jwt.claims', '{"sub":"ff06d568-8936-45fa-ad5f-0b88c150ec30"}', true);
--   perform set_config('role', 'authenticated', true);
--   select count(*) into v_admin from public.model_photos where user_id = k_owner::uuid;
--   perform set_config('role', 'postgres', true);
--
--   perform set_config('request.jwt.claims', '{"sub":"517c2853-50bb-4e8f-87fe-d79311bc37c0"}', true);
--   perform set_config('role', 'authenticated', true);
--   select count(*) into v_shares from public.model_photos where user_id = k_owner::uuid;
--   perform set_config('role', 'postgres', true);
--
--   perform set_config('request.jwt.claims', '', true);
--
--   if v_other <> 0 or v_owner <> 11 or v_admin <> 11 or v_shares <> 11 then
--     raise exception 'VERIFY FAILED -- stranger=% (want 0), owner=% admin=% stylist=% (want 11 each)',
--       v_other, v_owner, v_admin, v_shares;
--   end if;
-- end $v$;

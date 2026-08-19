-- ===========================================================================
-- 0019_verification_selfie_path_is_your_own
--
-- A verification selfie must live under your own user id, and a verification
-- request may only point at a selfie under the user id it belongs to.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── THE FAILURE THIS PREVENTS ─────────────────────────────────────────────
-- The ID check is a person comparing a selfie against a profile photo. If the
-- selfie a reviewer opens is not the applicant's, the check passes on the
-- strength of somebody else's face — and the account it approves is the one
-- that supplied the wrong path.
--
-- That is the worst outcome this system has, because everything downstream
-- treats "verified" as settled. A model weighs it when deciding whether to be
-- alone with a stranger.
--
-- ── TWO HALVES, AND THE OBVIOUS FIX ONLY CLOSES ONE ───────────────────────
-- 1. STORAGE. The INSERT policy is called "users upload own verification
--    selfie" and does not enforce "own":
--
--      with_check: (bucket_id = 'verification-selfies')
--
--    Both sibling buckets already do it properly:
--
--      model photos upload      … AND (storage.foldername(name))[1] = auth.uid()::text
--      portfolio photos upload  … AND (storage.foldername(name))[1] = auth.uid()::text
--
--    So any authenticated user could write to any path in the bucket.
--
-- 2. THE ROW. Closing (1) alone is NOT enough, and this is the half that
--    matters. vr_user_policy is `FOR ALL`, so a user writes their own
--    verification_requests.selfie_url freely. Stopping them uploading INTO
--    someone else's folder does nothing about pointing at a path already there.
--    The reviewer opens whatever the row names.
--
--    Hence a RESTRICTIVE policy tying selfie_url to the row's own user_id.
--
-- Keyed to user_id rather than auth.uid() deliberately: admins update these
-- rows to set status and notes, and the row keeps the applicant's path. Against
-- auth.uid() every admin approval would fail.
--
-- ── STILL NOT EXPLOITABLE TODAY, AND THAT IS NOT THE POINT ────────────────
-- There is no user-facing SELECT on the bucket (only "admins read verification
-- selfies"), so it cannot be listed, and paths carry a millisecond timestamp so
-- they cannot be guessed. This was hardening, not an incident.
--
-- It is done now because piece 4 of the web setup path adds a SECOND client
-- writing to that bucket, and the moment to fix a policy is before the number
-- of writers grows.
--
-- ── WHAT IS NOT ADDED ─────────────────────────────────────────────────────
-- No UPDATE or DELETE policy for users on the bucket. Uploads use unique
-- filenames so nothing is ever overwritten, and deletion belongs to the
-- purge-selfies cron running as service_role. Granting either would widen the
-- surface for no caller that exists.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0019') then
    raise exception 'Migration 0019 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE, per 0014.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0019', 'objects in verification-selfies', count(*)::text
from storage.objects where bucket_id = 'verification-selfies';

insert into public.migration_findings (version, item, value)
select '0019', 'objects whose first path segment is not a uuid', count(*)::text
from storage.objects
where bucket_id = 'verification-selfies'
  and (
    array_length(storage.foldername(name), 1) is null
    or (storage.foldername(name))[1] !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  );

insert into public.migration_findings (version, item, value)
select '0019', 'verification_requests rows whose selfie_url is not under their own user_id',
       count(*)::text
from public.verification_requests
where selfie_url is not null
  and selfie_url not like (user_id::text || '/%');

-- ---------------------------------------------------------------------------
-- NORMALISE the legacy rows, so the assert below has nothing to catch.
--
-- The first run of this migration aborted on four rows, all from 7-8 July, all
-- of this shape:
--
--   https://<project>.supabase.co/storage/v1/object/public/verification-selfies/
--     <user_id>/selfie-<timestamp>.jpg
--
-- Note `/object/public/` — these date from when the bucket was public. It is
-- private now, so those URLs do not resolve for anyone: the path is the only
-- usable form, which is why storage-lockdown.sql moved the column to paths and
-- photoUrls.ts signs at render time.
--
-- Each URL already contains its own user_id, so the conversion is a strip
-- rather than a guess. split_part on the bucket marker rather than a character
-- offset: the project ref would silently change the offset and quietly corrupt
-- every row.
--
-- All four were `approved`, so no admin would have touched them again and the
-- policy would never actually have blocked anything. Converting anyway — four
-- rows that silently cannot be updated is the same latent shape as the fault
-- this migration exists to close, and "harmless because nobody goes there" is
-- the reasoning that made the treatments bug wait a month.
-- ---------------------------------------------------------------------------
update public.verification_requests
   set selfie_url = split_part(selfie_url, '/verification-selfies/', 2)
 where selfie_url is not null
   and selfie_url not like (user_id::text || '/%')
   and selfie_url like '%/verification-selfies/%'
   -- Only when the strip actually lands under the row's own user_id. Anything
   -- else is not a legacy URL and must survive to trip the assert.
   and split_part(selfie_url, '/verification-selfies/', 2) like (user_id::text || '/%');

insert into public.migration_findings (version, item, value)
select '0019', 'legacy full-URL rows converted to paths, remaining after', count(*)::text
from public.verification_requests
where selfie_url is not null
  and selfie_url not like (user_id::text || '/%');

-- ---------------------------------------------------------------------------
-- ASSERT, per 0014.
--
-- The row policy below rejects any write whose selfie_url is not under the
-- row's user_id. The conversion above handles the known legacy shape; this
-- catches anything it could not, rather than letting a reviewer discover it
-- when they cannot approve someone.
-- ---------------------------------------------------------------------------
do $$
declare v_legacy integer;
begin
  select count(*) into v_legacy
  from public.verification_requests
  where selfie_url is not null
    and selfie_url not like (user_id::text || '/%');

  if v_legacy > 0
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0019 found % verification_requests row(s) whose selfie_url is not under their own '
      'user_id (legacy full URLs). The new policy would block admins from approving them. '
      'Look at those rows first, then re-run with: '
      'set local cavy.migration_override = ''yes'';', v_legacy;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Storage: the policy finally enforces the "own" its name claims.
--
--    Path shape is `${userId}/selfie-${timestamp}.jpg`, so foldername[1] is the
--    uploader's id — the same shape the two sibling buckets check.
-- ---------------------------------------------------------------------------
drop policy if exists "users upload own verification selfie" on storage.objects;

create policy "users upload own verification selfie"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'verification-selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 2. The row: a request may only name a selfie belonging to its own user.
--
--    RESTRICTIVE, so it ANDs with vr_user_policy and the two admin policies
--    rather than replacing any of them.
--
--    `using (true)` because this has nothing to say about reads or deletes — it
--    exists to constrain what a write may claim. WITH CHECK is the half that
--    does the work, on INSERT and UPDATE.
-- ---------------------------------------------------------------------------
drop policy if exists vr_selfie_path_matches_user on public.verification_requests;

create policy vr_selfie_path_matches_user
  on public.verification_requests as restrictive for all to authenticated
  using (true)
  with check (
    selfie_url is null
    or selfie_url like (user_id::text || '/%')
  );

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0019', 'verification_selfie_path_is_your_own', 'f8797e3ff5f303718ed2c643f5cebf231894d16e80adbe0664005a8d955929d9');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — the numbers this migration recorded ────────────────────────
--
--   select item, value from public.migration_findings
--   where version = '0019' order by id;
--
-- ── BLOCK B — both policies are in place, and the row one is RESTRICTIVE ─
--
--   select tablename, policyname, permissive, cmd
--   from pg_policies
--   where policyname in ('users upload own verification selfie',
--                        'vr_selfie_path_matches_user');
--
--   The storage one is PERMISSIVE (it is the only INSERT grant, so it must be).
--   The verification_requests one must be RESTRICTIVE — permissive there would
--   GRANT writes rather than narrow them, and looks almost identical.
--
-- ── BLOCK C — the predicate itself. Rolls itself back. ──────────────────
--
--   Runs as service_role, which bypasses RLS, so this checks the PREDICATE
--   rather than the policy.
--
--   begin;
--     select ('11111111-1111-1111-1111-111111111111/selfie-1.jpg'
--             like ('22222222-2222-2222-2222-222222222222' || '/%')) as should_be_false,
--            ('11111111-1111-1111-1111-111111111111/selfie-1.jpg'
--             like ('11111111-1111-1111-1111-111111111111' || '/%')) as should_be_true;
--   rollback;
--
-- ── BLOCK D — THE REAL PROOF IS IN THE APP ──────────────────────────────
--
--   Verification is provider pay-first, so use the provider test account:
--     1. submit a selfie from the app — it must still upload and appear in the
--        admin verification queue
--     2. approve it from the admin console — an admin UPDATE must still work,
--        which is exactly what keying the check to user_id rather than
--        auth.uid() exists to allow
--
--   If (2) fails, the row policy is keyed wrongly and admins cannot approve
--   anyone. That is the failure mode to watch for.
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

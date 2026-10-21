-- ============================================================================
-- STORAGE LOCKDOWN — model-photos bucket → private + signed URLs
-- ----------------------------------------------------------------------------
-- WHY
--   The model_photos TABLE is RLS-protected (see rls-lockdown.sql), but the image
--   FILES lived in a PUBLIC storage bucket served via getPublicUrl — anyone with a
--   file URL could view a model's booking photos with no login. This makes the
--   bucket PRIVATE and switches the app to short-lived signed URLs so only the owner
--   and a stylist viewing them (authenticated) can load an image.
--
-- BUCKET STATUS (confirmed via storage.buckets before/after):
--   model-photos          public -> PRIVATE (this file)
--   verification-selfies  already private  (untouched)
--   portfolio-photos      public           (out of scope)
--   profile-pics          public           (out of scope)
--
-- APP SIDE (already shipped): the DB now stores the object PATH, not a public URL.
--   mobile/src/lib/photoUrls.ts mints signed URLs at render time (tolerant of legacy
--   full-URL rows). Read sites sign before render: model/[id].tsx, model-profile.tsx,
--   apply-session.tsx. Write sites store up.path.
--
-- NOTE: model-photos already had owner-scoped INSERT ("model photos upload") and
--   DELETE ("model photos delete") policies on storage.objects. No UPDATE is needed
--   (uploads use unique random filenames). The ONLY missing piece was a SELECT policy,
--   which is required for createSignedUrl to work once the bucket is private.
-- ============================================================================


-- 1. Allow authenticated users to sign (read) any model-photos object.
--    Parity with the model_photos TABLE policy (a stylist viewing a model may see
--    their gallery). POST-LAUNCH hardening: narrow to "stylist in an active booking".
create policy "model photos read"
  on storage.objects for select to authenticated
  using (bucket_id = 'model-photos');


-- 2. Backfill: convert stored full public URLs -> bare object paths.
--    (Hygiene — the app's signing helper tolerates both, so this is not required for
--    correctness, but it keeps the data consistent with what the app now writes.)
update model_photos
set photo_url = regexp_replace(photo_url, '^.*/object/public/model-photos/', '')
where photo_url like '%/object/public/model-photos/%';

update sessions
set photo_urls = (
  select array_agg(regexp_replace(u, '^.*/object/public/model-photos/', ''))
  from unnest(photo_urls) u)
where exists (select 1 from unnest(photo_urls) u where u like '%/object/public/model-photos/%');


-- 3. Flip the bucket private. After this, /object/public/model-photos/... returns 400
--    (previously-cached CDN entries may serve until they expire, but no new anon read
--    succeeds and the app uses signed URLs, never the public path).
update storage.buckets set public = false where id = 'model-photos';


-- ============================================================================
-- VERIFY (anon):
--   Bogus path -> "Bucket not found" (private) instead of "Object not found" (public):
--     curl .../object/public/model-photos/__nope__/x.jpg
--   Real object with cache-buster -> HTTP 400:
--     curl '.../object/public/model-photos/<path>?cb=<rand>'
--   Device (bucket private): owner gallery, stylist cross-view, apply-flow picker, and a
--   fresh upload all still render (via signed URLs). verification-selfies still private.
--
-- FOLLOW-UPS (separate):
--   * sessions.photo_urls is written but not yet rendered for the stylist — the
--     application-photo viewer is a pending feature; it must sign via photoUrls.ts.
--   * Decide separately whether portfolio-photos / profile-pics should be private.
-- ============================================================================

-- ============================================================================
-- ⚠️⚠️ AMENDMENT, 21 Oct 2026 — "POST-LAUNCH HARDENING" IS NOW DUE. ITEM 217.
--
-- The policy above says, in its own comment, *POST-LAUNCH hardening: narrow to
-- "stylist in an active booking"*. That was written when no real member
-- existed. There are 35 now, and the deferral outlived its condition with
-- nothing watching for it — the same shape as audit item 205.
--
-- Measured on 21 Oct 2026: a real model with no relationship to the owner read
-- all 11 model_photos rows. Migration 0100 narrows the three TABLES
-- (model_photos, model_attributes, model_photo_categories) to
--   own row OR is_admin() OR public.shares_session_with_model(user_id)
-- where that helper is true when a session in ANY status joins the viewer's
-- providers row to the model. An application IS a session at 'pending', so a
-- stylist deciding on one already qualifies; a completed one is what a review
-- is written against.
--
-- ⚠️⚠️ THIS HALF CANNOT BE A MIGRATION, AND THAT IS MEASURED, NOT ASSUMED.
-- storage.objects is owned by supabase_storage_admin. postgres is NOT a member
-- of it, NOBODY is a member of it, and postgres is not a superuser
-- (super=false, bypassrls=true) — so policy DDL here fails from the SQL editor
-- and from the connector alike. Which also means the `create policy` above
-- cannot have been run from the SQL editor; it was almost certainly made
-- through Storage → Policies. This file is the record of a decision, not a
-- runnable script, and that was already true before this amendment.
--
-- THE REPLACEMENT CLAUSE — apply in Storage → Policies → model-photos, editing
-- "model photos read" (SELECT, role `authenticated`):
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
-- ⚠️ A `case`, NOT A BARE `AND`: the folder name is text and the helper takes
-- uuid, and a cast of a non-uuid folder raises 22P02 — inside a policy that
-- means the read FAILS rather than returning nothing. AND does not promise
-- left-to-right evaluation; `case` does. All 12 objects carry a valid uuid
-- folder today, so the regex guards a future object, not a present one.
--
-- ⚠️ WHETHER THIS IS LIVE IS NOT RECORDED HERE, DELIBERATELY. A status line in
-- a file is the thing that goes stale. Row 8 of 0100's VERIFY block reads the
-- live policy and reports STILL OPEN or NARROWED.
--
-- ⚠️ STILL OUT OF SCOPE, AND NOW WRITTEN UP RATHER THAN LEFT AS A FOLLOW-UP
-- LINE: portfolio-photos and profile-pics are still public buckets. See audit
-- item 218 for the full chain — it is larger than this one and is deliberately
-- NOT folded into 0100, because making profile-pics private means signing a
-- profile picture at every call site.
-- ============================================================================

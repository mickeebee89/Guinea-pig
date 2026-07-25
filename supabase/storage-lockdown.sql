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

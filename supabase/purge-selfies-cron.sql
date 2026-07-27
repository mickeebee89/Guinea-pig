-- ============================================================================
-- Schedule the verification-selfie retention purge
-- ----------------------------------------------------------------------------
-- Makes the privacy policy's 90-day retention promise actually happen. Calls the
-- purge-selfies edge function once a day; that function does the real work
-- (see supabase/functions/purge-selfies/index.ts).
--
-- Run the steps in order. Steps 1-2 are one-off setup.
-- ============================================================================

-- 1. Extensions. pg_cron schedules, pg_net makes the outbound HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the shared secret so it isn't inlined in the job definition (which is
--    world-readable to anyone who can query cron.job). Generate a random value —
--    it must MATCH the CRON_SECRET set on the edge function:
--      npx supabase secrets set CRON_SECRET=<the same value>
--
--    Replace both placeholders below before running.
select vault.create_secret('<YOUR-RANDOM-CRON-SECRET>', 'cron_secret_purge_selfies');

-- 3. The daily job — 03:15 UTC, outside UK peak either side of BST.
select cron.schedule(
  'purge-verification-selfies',
  '15 3 * * *',
  $$
  select net.http_post(
    url     := 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/purge-selfies',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      -- TWO auth layers, both required:
      --   Authorization -> Supabase's gateway verifies a JWT before the function
      --      runs at all. Without it you get UNAUTHORIZED_NO_AUTH_HEADER and your
      --      code never executes. The publishable/anon key is enough here; it only
      --      gets you past the gateway, it grants nothing (the function itself
      --      uses the service role internally).
      --   x-cron-secret -> the function's own check, which is what actually
      --      authorises the purge.
      'Authorization',  'Bearer sb_publishable_g-YDwagWoZBMvrBoZPQmYQ_VXfWZ40T',
      'x-cron-secret',  (select decrypted_secret from vault.decrypted_secrets
                          where name = 'cron_secret_purge_selfies')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- VERIFY / OPERATE
--
-- Dry run first — shows what WOULD be deleted without touching anything.
-- PowerShell (avoids curl's quote-escaping on Windows):
--   $anon   = 'sb_publishable_g-YDwagWoZBMvrBoZPQmYQ_VXfWZ40T'
--   $secret = '<YOUR-RANDOM-CRON-SECRET>'
--   Invoke-RestMethod -Method Post -Uri 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/purge-selfies' -Headers @{ Authorization = "Bearer $anon"; 'x-cron-secret' = $secret } -ContentType 'application/json' -Body '{"dryRun":true}'
--   -> { wouldPurge: N, breakdown: { approved, rejected, abandoned } }
--
-- BOTH headers are required: Authorization gets past Supabase's JWT gateway,
-- x-cron-secret is the function's own authorisation.
--
-- Is it scheduled?      select * from cron.job;
-- Did it run?           select * from cron.job_run_details
--                       where jobid = (select jobid from cron.job
--                                      where jobname = 'purge-verification-selfies')
--                       order by start_time desc limit 10;
-- What did it purge?    select * from admin_audit_log
--                       where action = 'selfie_retention_purge'
--                       order by created_at desc;
--
-- Unschedule:           select cron.unschedule('purge-verification-selfies');
--
-- ⚠️ Only publish the 90-day sentence in the privacy policy once a real run has
--    completed and the audit entries are appearing. Until then the number is a
--    promise nothing keeps.
-- ============================================================================

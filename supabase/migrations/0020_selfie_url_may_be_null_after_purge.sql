-- ===========================================================================
-- 0020_selfie_url_may_be_null_after_purge
--
-- Lets the retention purge finish. verification_requests.selfie_url is NOT NULL
-- and purge-selfies sets it to null, so the job has never been able to complete
-- a single deletion.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHAT IS ACTUALLY BROKEN ───────────────────────────────────────────────
-- The privacy policy publishes a 90-day retention period for identity
-- verification selfies. purge-selfies removes the storage object, then nulls
-- selfie_url. The second step throws 23502 every time, on every row, always —
-- so the central operation of a published data-protection commitment is
-- forbidden by the schema.
--
-- Nothing has been over-retained YET: the clock runs from reviewed_at, the
-- oldest rows are 7-8 July 2026, and the first selfie becomes eligible around
-- 5 October 2026. This was found roughly six weeks before the first breach.
-- Full account in selfie-retention-never-worked.md.
--
-- ── WHY DROPPING THE CONSTRAINT IS THE RIGHT FIX ──────────────────────────
-- Two places already treat null as the correct post-purge state. The schema is
-- the only thing that disagrees:
--
--   admin/app/verification/page.tsx:52
--     if (!r.selfie_url) return [r.id, ''] as const     -- renders "No photo"
--
--   migration 0019, vr_selfie_path_matches_user
--     selfie_url is null or selfie_url like (user_id::text || '/%')
--
-- The column genuinely IS optional once the object is gone. NOT NULL was
-- asserting a fact the product contradicts.
--
-- Rejected: a sentinel value ('purged') keeps the constraint but would be
-- re-selected by the purge query for ever, and violates 0019's policy so no
-- client could write it. Deleting the row destroys the record of a safety
-- decision, removes the reviewed_at the retention clock reads, and contradicts
-- 0004's principle that moderation evidence survives.
--
-- ── THE ROWS THIS ALSO REPAIRS ────────────────────────────────────────────
-- A row whose selfie_url names an object that no longer exists is lying about
-- what it holds. At least one exists now: the storage delete succeeded before
-- the null threw, so the object is gone and the reference is not. That state is
-- self-perpetuating — every subsequent run re-selects the row, removes an
-- already-absent key, fails the null again, and reports success to cron.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0020') then
    raise exception 'Migration 0020 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE, per 0014.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0020', 'verification_requests rows with a selfie_url', count(*)::text
from public.verification_requests where selfie_url is not null;

insert into public.migration_findings (version, item, value)
select '0020', 'rows whose object no longer exists (stranded)', count(*)::text
from public.verification_requests vr
where vr.selfie_url is not null
  and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'verification-selfies' and o.name = vr.selfie_url
  );

insert into public.migration_findings (version, item, value)
select '0020', 'selfies eligible for purge today', count(*)::text
from public.verification_requests
where selfie_url is not null
  and (
    (status in ('approved','rejected') and reviewed_at < now() - interval '90 days')
    or (status = 'pending' and created_at < now() - interval '90 days')
  );

-- ---------------------------------------------------------------------------
-- ASSERT, per 0014.
--
-- Sanity brake, same idea as 0005's: if EVERY row with a selfie_url looks
-- stranded, the far more likely explanation is that this query cannot see
-- storage.objects properly — not that every object has vanished. Nulling them
-- all on that basis would destroy every remaining reference in the table.
-- ---------------------------------------------------------------------------
do $$
declare v_total integer; v_stranded integer;
begin
  select count(*) into v_total
  from public.verification_requests where selfie_url is not null;

  select count(*) into v_stranded
  from public.verification_requests vr
  where vr.selfie_url is not null
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'verification-selfies' and o.name = vr.selfie_url
    );

  if v_total > 0 and v_stranded = v_total
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0020 would null EVERY selfie reference (% of %). That is far more likely to mean '
      'storage.objects is not visible to this query than that every object is gone. '
      'Check before proceeding, then re-run with: '
      'set local cavy.migration_override = ''yes'';', v_stranded, v_total;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The fix.
-- ---------------------------------------------------------------------------
alter table public.verification_requests
  alter column selfie_url drop not null;

-- ---------------------------------------------------------------------------
-- 2. Repair references to objects that are already gone.
--
--    Only rows whose object genuinely no longer exists. A row still pointing at
--    a real object is left completely alone — this is not a purge and must not
--    become one.
-- ---------------------------------------------------------------------------
update public.verification_requests vr
   set selfie_url = null
 where vr.selfie_url is not null
   and not exists (
     select 1 from storage.objects o
     where o.bucket_id = 'verification-selfies' and o.name = vr.selfie_url
   );

insert into public.migration_findings (version, item, value)
select '0020', 'stranded rows remaining, after', count(*)::text
from public.verification_requests vr
where vr.selfie_url is not null
  and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'verification-selfies' and o.name = vr.selfie_url
  );

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0020', 'selfie_url_may_be_null_after_purge', '881537546645fc873fc942cc272081610a11476473c680ab1c6ca0c01e62fc2c');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — the numbers this migration recorded ────────────────────────
--
--   select item, value from public.migration_findings
--   where version = '0020' order by id;
--
--   'stranded rows remaining, after' must be 0.
--
-- ── BLOCK B — the column really is nullable now ─────────────────────────
--
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'verification_requests'
--     and column_name = 'selfie_url';
--
--   Expect is_nullable = 'YES'.
--
-- ── BLOCK C — THE ONE THAT MATTERS: the purge can now complete ──────────
--
--   This is not SQL. Re-run the manual proof, in order:
--
--     1. Submit a selfie from /verify or the app (test account).
--     2. Age it:
--          update public.verification_requests
--             set status = 'approved', reviewed_at = now() - interval '100 days'
--           where id = '<the new row id>';
--        Run the SELECT first and confirm it matches exactly one row.
--     3. Dry run -> must report wouldPurge: 1. Stop if it does not.
--     4. Real run -> expect { ok: true, purged: 1 } with NO auditWriteFailed.
--     5. Confirm: the object is gone from storage, selfie_url IS NULL, and a
--        row exists in admin_audit_log with action 'selfie_retention_purge'.
--
--   Only step 5 demonstrates the published 90-day promise can be kept. Until it
--   passes, that sentence remains unproven — as purge-selfies-cron.sql:73 said
--   before any of this: "Only publish the 90-day sentence in the privacy policy
--   once a real run has completed and the audit entries are appearing."
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

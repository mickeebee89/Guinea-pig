-- ===========================================================================
-- 0037_verification_reviewer_backfill_with_provenance
--
-- Fill in the reviewer for the verification requests reviewed before the
-- console ever wrote one — and make it impossible to mistake a reconstructed
-- reviewer for a recorded one.
--
-- ── WHAT THE DATA SAID, 10 Sep 2026 ────────────────────────────────────
-- 25 reviewed requests, reviewed_by NULL on all 25 (audit item 34). Every one
-- is cleanly attributable from admin_audit_log:
--
--   reviewed_total 25 · attributable 25 · conflicting_admins 0
--   audit_rows_all_anonymous 0 · no_audit_row 0
--
-- So the record existed all along and was never written to the column meant to
-- hold it: 25 decisions, every one traceable, none recorded where anyone would
-- look.
--
-- ── ⚠️ THE CONDITION THIS MIGRATION EXISTS TO MEET ──────────────────────
-- Micky approved the backfill on one condition: a backfilled reviewer must be
-- VISIBLY distinguishable from a recorded one, not just noted in a migration
-- header. Otherwise in six months "reconstructed from the audit log" reads as
-- "an admin approved this" — the over-certain record this audit exists to
-- remove.
--
-- So provenance is a COLUMN, not a comment:
--
--   reviewed_by_source   'recorded'       — the console wrote the reviewer at
--                                            the moment of the decision
--                        'reconstructed'  — inferred afterwards from
--                                            admin_audit_log by this migration
--
-- and a CHECK makes the pair structural: a reviewer can never exist without a
-- stated source, and a source never without a reviewer.
--
-- ⚠️ THIS MIGRATION ALONE DOES NOT MEET THE CONDITION. It stores the
-- distinction; nothing displays it yet. The condition is met when the console
-- shows a reconstructed reviewer differently from a recorded one, which is the
-- console change that follows this migration. Written here so "0037 applied"
-- cannot be read as "done".
--
-- ── WHAT COUNTS AS ATTRIBUTABLE ─────────────────────────────────────────
-- Strictly: every verification_approve / verification_reject audit row for the
-- request names the SAME admin, and none has a NULL admin_id. One distinct
-- admin, no anonymous rows. Anything looser is a guess and is left NULL.
--
-- Checked again at apply time rather than trusted from the query above. If a
-- request has been reviewed since, it is included on the same strict terms; if
-- anything has become ambiguous, it is skipped, and VERIFY BLOCK B shows it.
--
-- ── NO AUDIT ROW FOR THE BACKFILL ITSELF ────────────────────────────────
-- A migration has no auth.uid(), so an admin_audit_log row for this run would
-- carry admin_id NULL — the unattributed row 0035 refuses to write. The
-- provenance column records what was inferred, and schema_migrations records
-- when and by what.
--
-- ── ORDER ───────────────────────────────────────────────────────────────
--   1. 0036 (applied 10 Sep) — reviewed_by → auth.users
--   2. this migration
--   3. THEN the console change: write reviewed_by and reviewed_by_source =
--      'recorded' together, and show reconstructed reviewers as such.
-- The console must not ship before this: it would write a column that does not
-- exist yet, and PostgREST would fail the whole approval.
-- The console as it stands today writes neither column, which the paired CHECK
-- permits, so applying this does not break it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare
  v_to_backfill integer;
  v_orphans     integer;
begin
  -- 0036 must be in place: the backfill writes admin ids that may have no
  -- public.users row, and the old key would refuse them.
  if not exists (
    select 1 from pg_constraint c
    where c.conname   = 'verification_requests_reviewed_by_fkey'
      and c.conrelid  = 'public.verification_requests'::regclass
      and c.confrelid = 'auth.users'::regclass
  ) then
    raise exception '0037: reviewed_by does not reference auth.users. Apply 0036 first.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verification_requests'
      and column_name = 'reviewed_by_source'
  ) then
    raise exception '0037: reviewed_by_source already exists — is this a second run?';
  end if;

  -- How many rows the strict rule will fill, reported before anything is written.
  select count(*) into v_to_backfill
  from public.verification_requests vr
  join (
    select l.details ->> 'request_id' as request_id
    from public.admin_audit_log l
    where l.action in ('verification_approve', 'verification_reject')
    group by l.details ->> 'request_id'
    having count(distinct l.admin_id) = 1
       and count(*) filter (where l.admin_id is null) = 0
  ) m on m.request_id = vr.id::text
  where vr.reviewed_at is not null and vr.reviewed_by is null;

  -- Every admin id the backfill would write must exist in auth.users, or the
  -- UPDATE fails on the new key halfway through. Checked here so the failure
  -- is a sentence rather than an FK error.
  select count(*) into v_orphans
  from public.admin_audit_log l
  where l.action in ('verification_approve', 'verification_reject')
    and l.admin_id is not null
    and not exists (select 1 from auth.users u where u.id = l.admin_id);

  if v_orphans > 0 then
    raise exception
      '0037: % verification audit row(s) name an admin_id that no longer exists in auth.users. '
      'Backfilling those would fail the new foreign key. Resolve before applying.', v_orphans;
  end if;

  raise notice '0037: % reviewed request(s) will be given a reconstructed reviewer.', v_to_backfill;
end $$;

alter table public.verification_requests
  add column reviewed_by_source text;

-- Any reviewer already present was written by something other than this
-- backfill. As of 10 Sep there are none — the console has never written the
-- column — but if one appears between now and applying, it is labelled for what
-- it is rather than swept in with the reconstructed ones.
update public.verification_requests
set reviewed_by_source = 'recorded'
where reviewed_by is not null;

-- The backfill, on the strict rule described in the header.
update public.verification_requests vr
set reviewed_by        = m.admin_id,
    reviewed_by_source = 'reconstructed'
from (
  select l.details ->> 'request_id'        as request_id,
         min(l.admin_id::text)::uuid       as admin_id   -- one distinct value; min just picks it
  from public.admin_audit_log l
  where l.action in ('verification_approve', 'verification_reject')
  group by l.details ->> 'request_id'
  having count(distinct l.admin_id) = 1
     and count(*) filter (where l.admin_id is null) = 0
) m
where m.request_id = vr.id::text
  and vr.reviewed_at is not null
  and vr.reviewed_by is null;

alter table public.verification_requests
  add constraint verification_requests_reviewed_by_source_check
  check (reviewed_by_source in ('recorded', 'reconstructed'));

-- The structural half of Micky's condition. A reviewer cannot exist without a
-- stated source, and a source cannot exist without a reviewer — so no future
-- writer can add a reviewer and leave its provenance to be assumed.
alter table public.verification_requests
  add constraint verification_requests_reviewed_by_source_paired
  check ((reviewed_by is null) = (reviewed_by_source is null));

comment on column public.verification_requests.reviewed_by_source is
  'How reviewed_by was obtained. ''recorded'': written by the console at the moment '
  'of the decision. ''reconstructed'': inferred on 10 Sep 2026 by migration 0037 '
  'from admin_audit_log, for requests reviewed before the console wrote reviewed_by '
  'at all. A reconstructed reviewer is an inference, not a record, and must be '
  'displayed as one. Paired with reviewed_by by CHECK. Audit item 34.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0037', 'verification_reviewer_backfill_with_provenance', 'b686d8bc6f37bdacdd81efed45a093f544d8f870981d724928ee2bc5c1490936');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ── BLOCK A — the column and both constraints exist ─────────────────────
--
--   select conname, pg_get_constraintdef(oid) as definition
--   from pg_constraint
--   where conrelid = 'public.verification_requests'::regclass
--     and conname like 'verification_requests_reviewed_by%'
--   order by conname;
--
--   Expect three: the _fkey (→ auth.users), _source_check, _source_paired.
--
-- ── BLOCK B — every reviewed request now has a reviewer and a source ────
--
--   select count(*) filter (where reviewed_at is not null)                              as reviewed_total,
--          count(*) filter (where reviewed_by_source = 'reconstructed')                  as reconstructed,
--          count(*) filter (where reviewed_by_source = 'recorded')                       as recorded,
--          count(*) filter (where reviewed_at is not null and reviewed_by is null)       as still_unattributed
--   from public.verification_requests;
--
--   Expect reconstructed 25, recorded 0, still_unattributed 0 — or more
--   reconstructed if requests were reviewed between the attribution query and
--   applying. still_unattributed above 0 is a request that became ambiguous and
--   was deliberately left NULL.
--
-- ── BLOCK C — who, per the reconstruction ───────────────────────────────
--
--   select left(reviewed_by::text, 8) as admin, reviewed_by_source, count(*)
--   from public.verification_requests
--   where reviewed_by is not null
--   group by 1, 2
--   order by 3 desc;
--
--   Should account for the 25 between ff06d568 and 8788ed3d.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs --stamp
--   node scripts/migration-status.mjs
-- ===========================================================================

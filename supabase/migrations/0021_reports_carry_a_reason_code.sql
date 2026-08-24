-- ===========================================================================
-- 0021_reports_carry_a_reason_code
--
-- Give every report a machine-readable category, and give the moderation queue
-- a memory that outlives both the report and the account.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── WHY A CODE AND NOT JUST THE FREE TEXT ────────────────────────────────
-- Community Guidelines (`legal.ts:683`) promise a child-safety route: "report
-- any account or message in one tap inside the app". Until now `reports.reason`
-- was a NOT NULL free-text box, so reaching that route meant a distressed person
-- finding the right words. It also meant nothing downstream could tell a
-- child-safety report from a spam report, so the queue treated them alike.
--
-- The client now offers eight fixed reasons. `reason` still carries the human
-- label so every existing admin surface keeps working unchanged, and legacy
-- rows keep their free text. `reason_code` is the new machine half.
--
-- The CHECK constraint is the point. Three separate apps (mobile, site, admin)
-- have no workspace linkage and each carry their own copy of the list. A copy
-- that drifts gets a constraint violation on insert rather than quietly writing
-- a category nothing recognises.
--
-- ── WHY THE HISTORY IS KEYED ON THE EMAIL HASH ───────────────────────────
-- The requirement is that a child-safety flag SURVIVES resolution: if a report
-- is closed and the same person is reported again, the history matters more
-- than the individual report.
--
-- `reported_id` cannot carry that. Migration 0004 made it ON DELETE SET NULL
-- precisely so reports outlive accounts, so keying history on it loses the
-- subject at exactly the moment the trail matters most — and loses it again for
-- anyone who deletes and re-registers.
--
-- `reported_email_hash` is the durable identity 0004 created for this, and it
-- is already the ban-evasion signal. So the history keys on it. Same reasoning,
-- same column, second use.
--
-- ── WHY AN RPC RATHER THAN A VIEW ────────────────────────────────────────
-- The aggregate spans every report ever filed, including ones the caller did
-- not file. That is admin-only data, so the admin check is written into the
-- function body where it can be read, rather than inherited from whatever
-- policy happens to be on `reports` today.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
-- No backfill of `reason_code` on existing rows. Guessing a category from free
-- text would put a made-up child-safety flag on the queue, and a flag that
-- might be invented is worse than an absent one. Legacy rows read
-- "Uncategorised" and sort by date, which is what they have always done.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — before-figures, recorded whether or not the assert fires.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0021', 'reports_total', count(*)::text from public.reports;

insert into public.migration_findings (version, item, value)
select '0021', 'reports_missing_reported_email_hash', count(*)::text
from public.reports where reported_email_hash is null;

insert into public.migration_findings (version, item, value)
select '0021', 'reports_missing_reporter_email_hash', count(*)::text
from public.reports where reporter_email_hash is null;

-- ---------------------------------------------------------------------------
-- ASSERT — the durable identity must actually be present.
--
-- The whole persistence guarantee rests on reported_email_hash being filled on
-- every row by trg_report_subjects. If any row is missing it, the queue's
-- memory has holes we would not otherwise notice: that subject's child-safety
-- history silently reads as zero. Better to find out here than to build a
-- priority queue on top of a lossy key.
--
-- Bypass, only after looking at what is actually missing:
--   set local cavy.migration_override = 'yes';
-- ---------------------------------------------------------------------------
do $$
declare v_missing int;
begin
  select count(*) into v_missing from public.reports where reported_email_hash is null;
  if v_missing > 0
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0021 expected every report to carry reported_email_hash, found % without one. '
      'The child-safety history keys on that column, so those subjects would have no '
      'history at all. Look at migration_findings for version 0021, then re-run with: '
      'set local cavy.migration_override = ''yes'';', v_missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The category.
--
-- Nullable on purpose: legacy rows predate the list and must not be guessed at.
-- The CHECK tolerates NULL and rejects anything outside the eight.
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists reason_code text;

alter table public.reports
  drop constraint if exists reports_reason_code_check;

alter table public.reports
  add constraint reports_reason_code_check check (
    reason_code is null or reason_code in (
      'child_safety',
      'unwanted_sexual',
      'wont_take_no',
      'unsafe_in_person',
      'threats_abuse',
      'impersonation',
      'spam_scam',
      'other'
    )
  );

comment on column public.reports.reason_code is
  'Machine-readable category from the fixed client list. NULL on rows filed '
  'before 0021 — never guessed from free text. The CHECK is what stops three '
  'unlinked client codebases drifting apart silently; `reason` still holds the '
  'human label and `details` the optional free text.';

-- Partial index: the queue asks "has this subject ever been reported for child
-- safety", which is a lookup by hash over a small slice of the table.
create index if not exists reports_child_safety_subject_idx
  on public.reports (reported_email_hash)
  where reason_code = 'child_safety';

-- ---------------------------------------------------------------------------
-- 2. The queue's memory.
--
-- One row per durable subject identity, counting every report ever filed
-- against it — open, resolved, dismissed, and against deleted accounts alike.
-- Status is deliberately not filtered: a closed child-safety report is the
-- exact thing that must still show.
-- ---------------------------------------------------------------------------
drop function if exists public.report_subject_history();

create function public.report_subject_history()
returns table (
  reported_email_hash   text,
  child_safety_reports  bigint,
  last_child_safety_at  timestamptz,
  total_reports         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Written here rather than inherited from a table policy so the gate is
  -- visible to anyone reading the function.
  if not public.is_admin() then
    raise exception 'report_subject_history is admin-only';
  end if;

  return query
  select
    r.reported_email_hash,
    count(*) filter (where r.reason_code = 'child_safety')           as child_safety_reports,
    max(r.created_at) filter (where r.reason_code = 'child_safety')  as last_child_safety_at,
    count(*)                                                         as total_reports
  from public.reports r
  where r.reported_email_hash is not null
  group by r.reported_email_hash;
end $$;

comment on function public.report_subject_history() is
  'Admin-only. Report history per durable subject identity (reported_email_hash, '
  'migration 0004), across every status and including deleted accounts. Backs the '
  'moderation queue''s child-safety flag, which must persist after a report is '
  'resolved — the history is the signal, not the individual report.';

revoke execute on function public.report_subject_history() from public;
grant   execute on function public.report_subject_history() to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0021', 'reports_carry_a_reason_code', 'c7e20c652b6f69b542dae271a1e3d8d46659573a61b49ffaa1e7b13c4af91bbf');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Nothing below the footer affects the checksum.
--
-- ── BLOCK A — the constraint actually refuses a drifted client ───────────
--
--   begin;
--     insert into public.reports (reporter_id, reported_id, reason, reason_code)
--     values (null, null, 'x', 'not_a_real_code');
--   rollback;
--
--   Expect 23514 check_violation. If this inserts, the CHECK is missing and
--   three codebases can drift apart without anyone noticing.
--
-- ── BLOCK B — the history is admin-only ─────────────────────────────────
--
--   As a non-admin (anon key, signed in as a member):
--     select * from public.report_subject_history();
--   Expect: 'report_subject_history is admin-only'.
--
-- ── BLOCK C — a resolved child-safety report still shows ────────────────
--
--   The whole point of the column. Run as service_role:
--
--   select reported_email_hash, child_safety_reports, total_reports
--   from public.report_subject_history();
--
--   Then close a child-safety report (status = 'resolved') and run it again.
--   child_safety_reports must NOT move. If it drops, a filter on status has
--   crept in and the flag stops persisting — which is the requirement.
--
-- ── BLOCK D — what the queue does with it ───────────────────────────────
--
--   In the admin console, Reports:
--     1. a child-safety report sorts above older reports of any other reason
--     2. it carries a visible flag
--     3. after resolving it, file a SPAM report against the same person — the
--        new report must still carry the flag and still sort to the top,
--        because the subject's history is what is being flagged, not the row
--
--   (3) is the test that distinguishes this from a per-row label.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================

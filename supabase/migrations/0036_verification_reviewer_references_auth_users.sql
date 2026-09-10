-- ===========================================================================
-- 0036_verification_reviewer_references_auth_users
--
-- Point verification_requests.reviewed_by at auth.users, so the column CAN be
-- written for every admin — and record why it has never been written at all.
--
-- ── WHAT WAS FOUND, 9–10 Sep 2026 ──────────────────────────────────────
-- 25 of 25 reviewed verification requests have reviewed_at set and reviewed_by
-- NULL. Nobody can say who approved any identity check on this platform, and
-- identity approval is the decision that lets a stranger into someone's home.
--
-- ── ⚠️ THE CAUSE IS NOT THE FOREIGN KEY ─────────────────────────────────
-- Audit item 34 first described this column as "may be unwritable", because it
-- references public.users and the dedicated console admin is deliberately never
-- an app user. That was a hypothesis, and the code disproves it as the cause:
--
--   admin/app/verification/page.tsx:94   approve  → status, notes, reviewed_at
--   admin/app/verification/page.tsx:140  reject   → status, notes, reviewed_at
--
-- Neither has EVER included reviewed_by. The column was not refused; it was
-- never asked for. So nothing failed, nothing logged, and no error could ever
-- have surfaced it. By contrast admin/app/moderation/page.tsx does write
-- reviewed_by — for status posts, the lower-stakes decision.
--
-- ── WHY THIS MIGRATION IS STILL NEEDED ───────────────────────────────────
-- The foreign key becomes the cause the moment the console starts writing the
-- column. reviewed_by references public.users(id); the primary admin is a
-- console-only account with an auth.users row and, by design, possibly no
-- public.users row. Writing its id would violate the key, and because
-- reviewed_by sits in the same UPDATE as status, the whole approval would fail.
--
-- auth.users is the right target and already the convention for the same fact
-- elsewhere: admin_audit_log.admin_id → auth.users, reports.reviewed_by →
-- auth.users.
--
-- ── ⚠️ ORDER ─────────────────────────────────────────────────────────────
--   1. apply this migration
--   2. THEN deploy the console change that writes reviewed_by
-- The console deploys from main on push. Shipping step 2 first would make
-- verification approval fail for the primary admin.
--
-- ── WHY EXISTING DATA CANNOT VIOLATE THE NEW KEY ─────────────────────────
-- Every value today is NULL (25 of 25 reviewed, and unreviewed rows are NULL by
-- definition). And even a non-null value would be a public.users id, which
-- users_id_auth_users_fkey guarantees is also an auth.users id. The re-added
-- constraint validates against rows that cannot fail it.
--
-- ── ON DELETE NO ACTION, DELIBERATELY ────────────────────────────────────
-- ⚠️ The two reviewer keys that already reference auth.users DISAGREE on this
-- (read from pg_constraint, 10 Sep 2026):
--
--   reports.reviewed_by       → auth.users   no ON DELETE  (NO ACTION)
--   status_posts.reviewed_by  → auth.users   ON DELETE SET NULL   ← 0031
--
-- 0031 chose SET NULL for status posts, which expire in 48 hours and carry no
-- lasting consequence. Identity approval is the opposite case, so this follows
-- reports and admin_audit_log.admin_id rather than 0031. The inconsistency is
-- recorded in audit item 34 rather than fixed here.
--
-- Deleting an admin account must not be a way
-- to erase who approved an identity check; this is evidence, and the audit log
-- beside it is retained six years. CLAUDE.md already says the dedicated admin's
-- auth user is never deleted. If an admin who has reviewed requests ever does
-- need removing, that is a decision to make with this constraint in front of
-- you, not a side effect.
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
-- No backfill of the 25. admin_audit_log may hold the attribution —
-- logAction() records admin_id and details.request_id for verification_approve
-- and verification_reject — but it discarded its own insert errors until
-- 8 Sep, and a re-approval writes a second row. Whether any of the 25 can be
-- attributed is a question for the data, answered before anything is written.
-- A backfilled reviewer is an inference, not a record, and if it happens it has
-- to say so.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — replacing the constraint we think we are replacing.
-- Read from pg_constraint on 8 Sep 2026: verification_requests_reviewed_by_fkey,
-- FOREIGN KEY (reviewed_by) REFERENCES users(id), no ON DELETE clause.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'verification_requests'
      and column_name = 'reviewed_by' and data_type = 'uuid'
  ) then
    raise exception '0036: verification_requests.reviewed_by is missing or not uuid.';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conname   = 'verification_requests_reviewed_by_fkey'
      and c.conrelid  = 'public.verification_requests'::regclass
      and c.contype   = 'f'
      and c.confrelid = 'public.users'::regclass
  ) then
    raise exception
      '0036: verification_requests_reviewed_by_fkey does not reference public.users. '
      'Either it has already been repointed (is this a second run?) or it has been '
      'changed by hand. Read pg_constraint before going further.';
  end if;
end $$;

alter table public.verification_requests
  drop constraint verification_requests_reviewed_by_fkey;

-- Same name, new target. NO ACTION on delete — see the header.
alter table public.verification_requests
  add constraint verification_requests_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users (id);

comment on column public.verification_requests.reviewed_by is
  'The admin who approved or rejected this request (auth.users id). References '
  'auth.users rather than public.users because the primary admin is a '
  'console-only account. Was never written by the console before 10 Sep 2026: '
  'every request reviewed before then has reviewed_at set and reviewed_by NULL. '
  'Audit item 34.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0036', 'verification_reviewer_references_auth_users', '6ec4c6d61dafcc20776989267d68a5d3f238615265764fae7fd6c2c5ab0a3dc7');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ── BLOCK A — the key now points at auth.users ──────────────────────────
--
--   select conname,
--          confrelid::regclass      as references_table,
--          pg_get_constraintdef(oid) as definition
--   from pg_constraint
--   where conrelid = 'public.verification_requests'::regclass
--     and contype  = 'f'
--   order by conname;
--
--   Expect verification_requests_reviewed_by_fkey → auth.users, and
--   verification_requests_user_id_fkey still → users. No ON DELETE on the
--   reviewer key.
--
-- ── BLOCK B — the gap is unchanged, and should be ───────────────────────
--
--   This migration makes the column writable. It writes nothing. Until the
--   console change ships, this still reads 25 of 25 (or more, if requests were
--   reviewed in between). Worth running precisely so that nobody reads
--   "0036 applied" as "reviewers are recorded".
--
--   select count(*) filter (where reviewed_at is not null and reviewed_by is null)
--            as reviewed_but_unattributed,
--          count(*) filter (where reviewed_at is not null) as reviewed_total
--   from public.verification_requests;
--
-- ── BLOCK C — after the console change, on the next real review ─────────
--
--   select id, status, reviewed_at, left(reviewed_by::text, 8) as reviewer
--   from public.verification_requests
--   where reviewed_at is not null
--   order by reviewed_at desc
--   limit 3;
--
--   Expect the newest row to carry a reviewer. The older ones stay NULL.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs --stamp
--   node scripts/migration-status.mjs
-- ===========================================================================

-- ===========================================================================
-- 0004_reports_survive_account_deletion
--
-- FIXES A LIVE HOLE: deleting your account destroys every report filed
-- ABOUT you.
--
-- WHAT BREAKS TODAY
--   delete_account_data collects report ids by
--     reporter_id = p_user OR reported_id = p_user OR session_id = any(...)
--   (account-deletion-fix.sql:303) and deletes them all (:327). The
--   `reported_id` arm is the problem: those are other people's complaints about
--   the deleting user, and deletion is available to anyone, on demand, from
--   Settings.
--
--   So the exit route from a moderation problem is to delete the account and
--   re-register. moderation_actions survives that — it keeps target_email_hash
--   explicitly as the ban-evasion signal — but the underlying complaints do
--   not, which leaves an admin able to see that action was taken and unable to
--   see what for.
--
--   This is the same evidence destruction that account-deletion-fix.sql closed
--   for session_consents and moderation_actions on 8 Aug. Reports were missed
--   because the RPC deletes them for a good reason too — a user's OWN reports
--   are their data — and the two arms of that OR were never separated.
--
--   It is also the surface Apple Guideline 1.2 actually checks: an app carrying
--   user-generated content must let users report it AND be able to act on those
--   reports.
--
-- ── WHY SET NULL AND NOT THE PATTERN ALREADY IN THE REPO ───────────────────
--   account-deletion-fix.sql severed the FKs on session_consents and
--   moderation_actions, keeping the uuid as a dangling correlation key. That
--   cannot be reused here.
--
--   admin/app/reports/page.tsx:60-61 reads the moderation queue with PostgREST
--   embedded joins:
--       reporter:users!reporter_id(...), reported:users!reported_id(...)
--   PostgREST resolves embeds from foreign-key metadata. Without the constraint
--   it does not degrade to nulls — it stops recognising the relationship and
--   the request errors, so the queue goes dark. Severing would trade one broken
--   moderation surface for another.
--
--   SET NULL keeps the constraint, so the embed keeps working and returns null
--   for a deleted party. The page already tolerates exactly that: fullName()
--   handles a null join (page.tsx:33) and warn/suspend/ban already refuse when
--   reported?.id is missing (:86). Both were written for RLS-hidden rows and
--   work unchanged here.
--
-- ── THE INVARIANT IS REPLACED, NOT DROPPED ─────────────────────────────────
--   reporter_id and reported_id are NOT NULL today, so SET NULL is illegal
--   until that is dropped. Dropping it alone would permit a report with no
--   subject at all, which is worse than what we started with.
--
--   So the guarantee moves: reporter_email_hash and reported_email_hash become
--   NOT NULL. The trigger populates them from public.users at insert, which
--   means a report naming nobody cannot be inserted — the lookup finds no user,
--   the hash comes back null, and NOT NULL rejects the row. The uuid can then
--   only become null via the SET NULL cascade, by which point identity is
--   already recorded.
--
--   Net effect: "every report knows who it is about" goes from holding until
--   the subject deletes their account, to holding permanently.
--
-- ── ⚠ GAP 1: RETENTION. Reports are not covered by any purge. ──────────────
--   Reports belong in the same six-year family as session_consents and
--   moderation_actions (Limitation Act 1980, contract claims in England &
--   Wales). This migration does NOT enforce that, deliberately, and the
--   omission is worth understanding rather than inheriting:
--
--     * There is no purge job yet. account-deletion-fix.sql:379 already flags
--       one as "still to build" for consents and moderation. WHEN IT IS BUILT
--       IT MUST COVER reports TOO — created_at + 6 years — or reports become
--       the one record type with no expiry at all, which is a worse
--       data-protection position than the one this file fixes.
--     * No append-only guard is added here. seed/teardown.mjs:184 and :202
--       delete reports on purpose, and a retention trigger would break the seed
--       teardown tool. That conflict needs its own answer (most likely: the
--       guard exempts nothing and teardown stops deleting reports, since seed
--       reports reference seed users who are going anyway).
--
--   Retaining a de-identified report about a deleted user rests on UK GDPR
--   Art. 17(3)(e) — establishment, exercise or defence of legal claims — plus
--   the safety legitimate interest. Same basis as the consent records. The
--   privacy policy has to say so; see the follow-up list below.
--
-- ── ⚠ GAP 2: evidence_urls is unused, NOT handled. ─────────────────────────
--   reports.evidence_urls exists and is empty across all three live reports, so
--   this migration does nothing about it. Unused today is not the same as
--   handled.
--
--   IF EVIDENCE UPLOADS ARE EVER WIRED UP, check where the objects live first.
--   The delete-account edge function wipes four buckets under the user's own
--   folder — verification-selfies, profile-pics, model-photos,
--   portfolio-photos. If evidence is stored under `${reporterId}/…` in any of
--   them, this migration retains the report and the edge function destroys its
--   attachments, which is a half-measure that reads as a fix. Evidence should
--   go in a bucket the account-deletion path does not touch.
--
-- ── FOLLOW-UP AFTER APPLYING ───────────────────────────────────────────────
--   * admin/app/reports/page.tsx — select the four new columns and fall back to
--     them. The page survives without this, but shows "Not visible" for a
--     deleted party when it now has the name. It also lets the page tell apart
--     two cases it currently conflates: stored name + null embed means deleted;
--     both null means RLS-hidden. The "isn't visible to you" message is wrong
--     for the first.
--   * The privacy policy and cavybeauty.com/delete-account both need the
--     retained-reports sentence. This makes the "what gets deleted" clause
--     answerable for the first time — it is on the phase-2 blocker list
--     precisely because "everything" would have been false.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0004') then
    raise exception 'Migration 0004 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Durable subject identity, both sides.
--
--    Name as the app already displays it, plus SHA-256 of the lowercased email.
--    The hash verifies a claim — a claimant supplies their address, we hash it
--    and compare — without keeping a contactable identifier for six years, and
--    it matches a re-registration of the same address, which the uuid never
--    would once it is nulled.
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists reporter_name       text,
  add column if not exists reporter_email_hash text,
  add column if not exists reported_name       text,
  add column if not exists reported_email_hash text;

comment on column public.reports.reported_email_hash is
  'SHA-256 of lower(email) of the reported party at the time of the report. '
  'Survives that account being deleted, when reported_id is nulled. Also the '
  'ban-evasion signal, matching moderation_actions.target_email_hash.';

comment on column public.reports.reporter_email_hash is
  'SHA-256 of lower(email) of the reporter. Survives that account being '
  'deleted. A report keeps its provenance even when the reporter has gone.';

-- ---------------------------------------------------------------------------
-- 2. Populate at insert, in a trigger rather than app code.
--
--    The app cannot forget, and a report written without identity would be
--    unusable later — which is the whole failure being fixed.
--
--    BEFORE INSERT only, matching set_moderation_subject(). Deliberately not
--    BEFORE UPDATE: the SET NULL cascade added in section 5 is an update, and a
--    trigger that re-derived identity there would look up a user that no longer
--    exists. The `is null` guards make that harmless either way, but the
--    narrower trigger cannot be got wrong at all.
-- ---------------------------------------------------------------------------
create or replace function public.set_report_subjects()
returns trigger language plpgsql security definer
set search_path to 'public', 'extensions' as $$
begin
  if new.reporter_name is null or new.reporter_email_hash is null then
    select
      nullif(btrim(coalesce(u.first_name, '')
             || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
      encode(digest(lower(btrim(u.email)), 'sha256'), 'hex')
      into new.reporter_name, new.reporter_email_hash
    from public.users u where u.id = new.reporter_id;
  end if;

  if new.reported_name is null or new.reported_email_hash is null then
    select
      nullif(btrim(coalesce(u.first_name, '')
             || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
      encode(digest(lower(btrim(u.email)), 'sha256'), 'hex')
      into new.reported_name, new.reported_email_hash
    from public.users u where u.id = new.reported_id;
  end if;

  return new;
end $$;

revoke all on function public.set_report_subjects() from public, anon;

drop trigger if exists trg_report_subjects on public.reports;
create trigger trg_report_subjects
  before insert on public.reports
  for each row execute function public.set_report_subjects();

-- ---------------------------------------------------------------------------
-- 3. Backfill, then prove it is complete.
--
--    Every existing report has live users — today's NOT NULL foreign keys
--    guarantee it — so this must reach 100%. Section 4 depends on that, and the
--    check below refuses rather than letting a NOT NULL failure explain it in a
--    less useful way.
-- ---------------------------------------------------------------------------
update public.reports r
   set reporter_name = nullif(btrim(coalesce(u.first_name, '')
         || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
       reporter_email_hash = encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex')
  from public.users u
 where u.id = r.reporter_id and r.reporter_email_hash is null;

update public.reports r
   set reported_name = nullif(btrim(coalesce(u.first_name, '')
         || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
       reported_email_hash = encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex')
  from public.users u
 where u.id = r.reported_id and r.reported_email_hash is null;

do $$
declare n int;
begin
  select count(*) into n from public.reports
   where reporter_email_hash is null or reported_email_hash is null;
  if n > 0 then
    raise exception
'Backfill incomplete: % report(s) still have no subject hash.

That should be impossible while reporter_id and reported_id are NOT NULL
foreign keys, so it means one of them points at a public.users row that is
gone — which would be its own bug worth understanding before continuing.

  select id, reporter_id, reported_id from public.reports
   where reporter_email_hash is null or reported_email_hash is null;', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The replacement invariant.
--
--    This is what makes dropping NOT NULL on the uuids safe in section 5. It
--    must come first: with these NOT NULL, a report naming nobody is rejected
--    at insert, because the trigger's lookup returns null for an unknown user.
-- ---------------------------------------------------------------------------
alter table public.reports
  alter column reporter_email_hash set not null,
  alter column reported_email_hash set not null;

-- ---------------------------------------------------------------------------
-- 5. The foreign keys.
--
--    Names are discovered and REUSED rather than invented. PostgREST's embed
--    hint in admin/app/reports/page.tsx is written against the column
--    (users!reporter_id), which is stable either way — but the moderation queue
--    is not the place to find out I was wrong about that.
--
--    session_id is included and is NOT optional. The RPC currently deletes
--    reports (line 327) before sessions (:328), so the ordering hides the fact
--    that reports reference sessions at all. Once section 6 stops deleting
--    reports, a NO ACTION session FK would abort `delete from public.sessions`
--    and break account deletion outright — the exact failure this file exists
--    to prevent, reintroduced by the fix for it.
-- ---------------------------------------------------------------------------
do $$
declare
  n_reporter text; p_reporter oid;
  n_reported text; p_reported oid;
  n_session  text; p_session  oid;
begin
  select con.conname, con.confrelid into n_reporter, p_reporter
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
   where con.contype = 'f' and con.conrelid = 'public.reports'::regclass
     and att.attname = 'reporter_id';

  select con.conname, con.confrelid into n_reported, p_reported
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
   where con.contype = 'f' and con.conrelid = 'public.reports'::regclass
     and att.attname = 'reported_id';

  select con.conname, con.confrelid into n_session, p_session
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
   where con.contype = 'f' and con.conrelid = 'public.reports'::regclass
     and att.attname = 'session_id';

  if n_reporter is null or n_reported is null or n_session is null then
    raise exception
'Expected foreign keys on reports.reporter_id, .reported_id and .session_id.
Found: reporter=%, reported=%, session=%.
Nothing has been changed.',
      coalesce(n_reporter, 'MISSING'), coalesce(n_reported, 'MISSING'),
      coalesce(n_session, 'MISSING');
  end if;

  if p_reporter <> 'public.users'::regclass
     or p_reported <> 'public.users'::regclass
     or p_session  <> 'public.sessions'::regclass then
    raise exception
'Foreign keys point somewhere unexpected: reporter -> %, reported -> %, session -> %.
Expected public.users, public.users, public.sessions. Nothing has been changed.',
      p_reporter::regclass::text, p_reported::regclass::text, p_session::regclass::text;
  end if;

  execute format('alter table public.reports drop constraint %I', n_reporter);
  execute format('alter table public.reports drop constraint %I', n_reported);
  execute format('alter table public.reports drop constraint %I', n_session);

  alter table public.reports alter column reporter_id drop not null;
  alter table public.reports alter column reported_id drop not null;

  execute format(
    'alter table public.reports add constraint %I foreign key (reporter_id) '
    'references public.users(id) on delete set null', n_reporter);
  execute format(
    'alter table public.reports add constraint %I foreign key (reported_id) '
    'references public.users(id) on delete set null', n_reported);
  execute format(
    'alter table public.reports add constraint %I foreign key (session_id) '
    'references public.sessions(id) on delete set null', n_session);

  raise notice 'reports FKs recreated as ON DELETE SET NULL: %, %, %',
    n_reporter, n_reported, n_session;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Stop deleting reports.
--
--    v_report_ids and its delete are gone entirely. Everything they were doing
--    is now covered by the two SET NULLs in section 5:
--      reporter_id / reported_id  -> nulled when the user goes
--      session_id                 -> nulled when the session goes
--
--    reviewed_by keeps being nulled by hand: it points at auth.users, not
--    public.users, so section 5 does not reach it, and it records WHICH ADMIN
--    reviewed the report rather than who it is about.
--
--    Everything else is byte-for-byte the function from
--    account-deletion-fix.sql. The ONLY changes are the report handling and the
--    returned counts.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account_data(p_user uuid)
returns jsonb language plpgsql security definer
set search_path to 'public' as $$
declare
  v_provider_ids     uuid[];
  v_session_ids      uuid[];
  v_reports_retained int;
  v_result           jsonb;
begin
  if p_user is null then
    raise exception 'delete_account_data requires a user id';
  end if;

  select coalesce(array_agg(id), '{}') into v_provider_ids
    from public.providers where user_id = p_user;

  select coalesce(array_agg(distinct id), '{}') into v_session_ids
    from public.sessions
   where model_user_id = p_user
      or model_id = p_user
      or provider_id = any(v_provider_ids);

  -- Counted BEFORE the delete below, because that is what nulls the pointers.
  -- Afterwards this query would return zero and the count would look like a
  -- deletion rather than a retention.
  select count(*) into v_reports_retained
    from public.reports
   where reporter_id = p_user or reported_id = p_user;

  -- Preserve the audit trail; drop only the pointers into deleted rows.
  update public.admin_audit_log set target_user_id     = null where target_user_id     = p_user;
  update public.admin_audit_log set target_provider_id = null where target_provider_id = any(v_provider_ids);
  update public.admin_audit_log set target_session_id  = null where target_session_id  = any(v_session_ids);
  update public.verification_requests set reviewed_by  = null where reviewed_by        = p_user;

  -- reports.reviewed_by is NO ACTION -> auth.users and blocks the auth delete
  -- where this user reviewed someone else's report as an admin.
  update public.reports set reviewed_by = null where reviewed_by = p_user;

  delete from public.reviews       where reviewer_id = p_user
                                      or reviewee_id = p_user
                                      or session_id  = any(v_session_ids);
  delete from public.messages      where sender_id  = p_user or session_id = any(v_session_ids);
  delete from public.notifications where user_id    = p_user or session_id = any(v_session_ids);
  delete from public.sessions      where id = any(v_session_ids);
  delete from public.providers     where user_id = p_user;

  -- Deleting this row is what nulls reports.reporter_id / .reported_id. It is
  -- also still explicit rather than left to a cascade from auth.users: keeping
  -- it here keeps the whole database side in ONE transaction that can roll
  -- back, which a cascade fired from GoTrue could not.
  delete from public.users where id = p_user;

  v_result := jsonb_build_object(
    'providers',        cardinality(v_provider_ids),
    'sessions',         cardinality(v_session_ids),
    'reports_retained', v_reports_retained);
  return v_result;
end $$;

revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;
-- service_role only: the edge function verifies the caller's JWT and passes
-- their own id. Never callable directly by a client.

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0004', 'reports_survive_account_deletion', 'd07e0fe643905bcda2166e35ccacfc2b78b17fa295e71f75870eff76189d50ce');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- WRITTEN FOR THE SUPABASE SQL EDITOR: only the LAST result set of a run is
-- returned, and temp objects do not survive between runs. So each block below
-- is ONE paste ending in exactly one select, and anything a check must carry
-- across statements lives in a plpgsql variable rather than a temp table.
--
-- No block needs an outer begin/rollback. Every check that writes does so
-- inside a subtransaction forced to roll back by raising, so no test row can
-- survive and there is no cleanup to forget. plpgsql variables are not
-- transactional, so what a check observed survives its own rollback.
--
-- ── BLOCK A — shape ────────────────────────────────────────────────────────
--
--   select att.attname,
--          att.attnotnull as not_null,
--          case con.confdeltype
--            when 'n' then 'SET NULL'
--            when 'a' then 'NO ACTION'
--            when 'c' then 'CASCADE'
--            else coalesce(con.confdeltype::text, '—')
--          end as on_delete
--   from pg_attribute att
--   left join pg_constraint con
--          on con.conrelid = att.attrelid
--         and con.contype  = 'f'
--         and att.attnum   = any(con.conkey)
--   where att.attrelid = 'public.reports'::regclass
--     and att.attname in ('reporter_id','reported_id','session_id',
--                         'reporter_email_hash','reported_email_hash')
--   order by att.attname;
--
--   Expect the three id columns SET NULL and nullable, both hash columns
--   NOT NULL.
--
--
-- ── BLOCK B — every report has identity on both sides ──────────────────────
--
--   select count(*) filter (where reporter_email_hash is null
--                              or reported_email_hash is null) as missing_identity,
--          count(*) as total
--   from public.reports;
--
--   Expect missing_identity = 0. It cannot be otherwise while the NOT NULL
--   constraints hold — this checks they are still there.
--
--
-- ── BLOCK C — the behaviour this migration exists for ──────────────────────
-- Deletes a real user who is party to a real report, then rolls it all back.
-- Paste from `create or replace` to the final select as ONE run.
--
--   create or replace function pg_temp.verify_0004()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_report uuid; v_uid uuid;
--     v_before int;  v_after int;
--     v_reported uuid; v_name text; v_hash text; v_session uuid; v_status text;
--     v_rpc jsonb;
--     v_survived text := 'not reached';
--     v_counts   text := 'not reached';
--     v_nullrep  text := 'not reached';
--   begin
--     select r.id, r.reported_id into v_report, v_uid
--       from public.reports r
--      where r.reported_id is not null
--      limit 1;
--
--     if v_report is null then
--       v_survived := 'skipped — no report with a live reported_id to test with';
--       v_counts   := 'skipped';
--     else
--       select count(*) into v_before from public.reports;
--
--       begin
--         v_rpc := public.delete_account_data(v_uid);
--
--         -- Read the report back BY ID. Reading it back by reported_id would
--         -- find nothing and look exactly like the row having been deleted,
--         -- which is the confusion this check exists to resolve.
--         select r.reported_id, r.reported_name, r.reported_email_hash,
--                r.session_id, r.status
--           into v_reported, v_name, v_hash, v_session, v_status
--           from public.reports r where r.id = v_report;
--
--         select count(*) into v_after from public.reports;
--         raise exception 'ROLLBACK_ME';
--       exception when others then
--         if sqlerrm <> 'ROLLBACK_ME' then
--           v_survived := 'could not test — ' || left(sqlerrm, 90);
--         end if;
--       end;
--
--       if v_survived = 'not reached' then
--         v_survived := case
--           when v_hash is null or v_name is null
--             then 'PROBLEM: the report lost its subject identity'
--           when v_reported is not null
--             then 'PROBLEM: reported_id was not nulled'
--           else 'survived — reported_id NULL, name ' || v_name
--                || ', hash ' || left(v_hash, 8) || '…, status ' || v_status
--                || ', session_id ' || coalesce(v_session::text, 'NULL')
--           end;
--         v_counts := case when v_before = v_after
--           then 'unchanged at ' || v_after || ' — nothing was deleted'
--           else 'PROBLEM: ' || v_before || ' before, ' || v_after || ' after' end;
--       end if;
--     end if;
--
--     -- The replacement invariant: a report naming nobody must be impossible.
--     begin
--       insert into public.reports (reporter_id, reported_id, reason, status)
--       values (null, null, 'invariant-test', 'open');
--       v_nullrep := 'PROBLEM: accepted a report with no subject';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm <> 'ROLLBACK_ME' then
--         v_nullrep := 'rejected as expected — ' || left(sqlerrm, 90);
--       end if;
--     end;
--
--     check_name := 'report survives its subject being deleted'; outcome := v_survived; return next;
--     check_name := 'total report count';                       outcome := v_counts;   return next;
--     check_name := 'report with no subject is rejected';       outcome := v_nullrep;  return next;
--     check_name := 'delete_account_data returned';             outcome := coalesce(v_rpc::text, '—'); return next;
--   end $f$;
--
--   select * from pg_temp.verify_0004();
--
-- Expect no row containing PROBLEM, and the last row to show
-- reports_retained >= 1.
--
--
-- ── BLOCK D — the whole deletion path still completes, for EVERY account ───
-- This migration changes delete_account_data, so the all-accounts pass proved
-- BEFORE it was applied says nothing about the code now running. Re-run it.
-- Paste as ONE run.
--
--   create or replace function pg_temp.dryrun_delete_all()
--   returns table(email text, result text, code text)
--   language plpgsql as $f$
--   declare u record;
--   begin
--     for u in select us.id, us.email from public.users us order by us.email loop
--       begin
--         perform public.delete_account_data(u.id);
--         raise exception 'DRYRUN_OK';
--       exception when others then
--         email := u.email;
--         if sqlerrm = 'DRYRUN_OK' then result := 'ok'; code := '';
--         else result := sqlerrm; code := sqlstate; end if;
--         return next;
--       end;
--     end loop;
--   end $f$;
--
--   select * from pg_temp.dryrun_delete_all() order by (result = 'ok'), email;
--
-- Every row must read 'ok'; failures sort to the top. Each account is tested in
-- its own subtransaction, so one account's deletes cannot mask the next one's
-- blocker, and nothing persists.
-- ===========================================================================

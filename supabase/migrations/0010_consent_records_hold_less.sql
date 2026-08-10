-- ===========================================================================
-- 0010_consent_records_hold_less
--
-- Stops collecting IP address and device info on consent records, and makes
-- those records fully immutable as a result.
--
-- ── WHY THEY WERE COLLECTED, AND WHY THAT REASONING DOES NOT HOLD ─────────
-- READ THIS BEFORE ADDING THEM BACK. The instinct that a consent record should
-- carry provenance is a reasonable one, and it is why the columns were created
-- in 0001 in the first place. It was examined properly on 9 Aug 2026 and
-- rejected, for reasons that are about evidence rather than convenience:
--
--   1. THE CONTESTED FACT IS *WHAT* WAS AGREED, NOT WHERE FROM. Someone
--      disputing a consent is disputing the wording they were shown. That is
--      answered exactly by content_hash — a SHA of the document body — plus
--      consent_version and the denormalised acknowledgements. An IP address
--      does not touch the question.
--
--   2. AN IP DOES NOT IDENTIFY A PERSON. CGNAT, mobile carriers, shared salon
--      wifi, VPNs. Against "that was not me", the stronger evidence already
--      exists: create_session_with_consent refuses outright when auth.uid() is
--      null, so the record cannot be written without a verified session.
--
--   3. DEVICE INFO IS SELF-REPORTED AND UNATTESTED. It is whatever the client
--      chose to send, so in the adversarial case — the only case where it would
--      matter — it proves nothing.
--
--   4. IT WOULD HAVE BEEN ASYMMETRIC. Only a server-rendered web page can see
--      an IP; a mobile client structurally cannot. Since nearly every booking
--      happens in the app, populating it on web would build a two-tier record
--      whose weaker tier is the one that matters most — and then require the
--      privacy policy to explain that.
--
--   5. UK GDPR Art. 5(1)(c), data minimisation. An IP address is personal data.
--      "There is a column for it" is precisely the reasoning minimisation
--      exists to refuse.
--
-- ⚠ FLAGGED FOR THE SOLICITOR, alongside the Article 9 questions in
--   site/content/legal.ts §7. A lawyer may weigh the evidential value
--   differently, and if they do this is a small migration to reverse. The
--   decision is recorded here with its reasoning precisely so it can be
--   argued with rather than rediscovered.
--
-- ── WHAT IT WAS ACTUALLY DOING: NOTHING ──────────────────────────────────
-- ip_address was never written by anything. create_session_with_consent does
-- not set it and no trigger does. device_info is a parameter the mobile app has
-- never passed. Both are null on every row that exists, which means:
--   * the published privacy policy described data that was not held (corrected
--     in the same change as migration 0009), and
--   * 0005's 12-month scrub has been scrubbing empty columns since the day it
--     shipped.
--
-- ── THE PART WORTH PROTECTING: FULL IMMUTABILITY ─────────────────────────
-- guard_session_consents currently permits exactly ONE update — nulling those
-- two columns for the scrub. Removing the need removes the exception, and the
-- record becomes append-only with no permitted edit path at all.
--
-- That is a stronger guarantee than "immutable except for one narrow case",
-- and the reason is not theoretical: a permitted edit path tends to become a
-- used one. The narrow case is where the next exception gets argued for.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0010') then
    raise exception 'Migration 0010 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Refuse if the premise is wrong.
--
--    This whole migration rests on both columns being empty. If they are not,
--    something has started writing them since this was scoped and dropping the
--    columns would destroy real records — so stop and say so rather than
--    proceed on a stale assumption.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.session_consents
   where ip_address is not null or device_info is not null;
  if n > 0 then
    raise exception
'Refusing to drop: % consent record(s) actually hold an ip_address or device_info.

This migration assumes both columns have never been populated, which was true
on 9 Aug 2026. Something now writes them. Understand what before continuing —
dropping the columns would destroy data that a live code path is creating.

  select id, agreed_at, ip_address, device_info from public.session_consents
   where ip_address is not null or device_info is not null;', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. create_session_with_consent stops taking and writing device_info.
--
--    The parameter is REMOVED rather than left accepted-and-ignored. A
--    parameter that silently does nothing is the trap this project keeps
--    paying for: the next caller passes device_info, believes it is recorded,
--    and it is not.
--
--    Removing a parameter needs drop + create; CREATE OR REPLACE cannot change
--    a signature. Both happen inside this transaction, so there is no window
--    where the function is missing. The mobile app passes 15 named arguments
--    and never passed p_device_info, so its calls are unaffected.
--
--    Everything else is migration 0009's captured body, unchanged.
-- ---------------------------------------------------------------------------
drop function if exists public.create_session_with_consent(
  uuid, uuid, date, time without time zone, time without time zone,
  timestamp with time zone, integer, uuid, text, text, text[],
  uuid, integer, text, jsonb, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.create_session_with_consent(p_provider_id uuid, p_availability_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_scheduled_at timestamp with time zone, p_duration_minutes integer, p_treatment_id uuid, p_location_type text, p_note text, p_photo_urls text[], p_consent_document_id uuid, p_consent_version integer, p_content_hash text, p_acknowledgements jsonb, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_me         uuid := auth.uid();
  v_session_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if p_consent_document_id is null or p_content_hash is null or p_acknowledgements is null then
    raise exception 'Consent is required to book' using errcode = '23502';
  end if;

  -- The booking. A 23505 from sessions_active_slot_uniq is deliberately NOT
  -- caught: it propagates unchanged so the app's slot-race branch still fires.
  insert into public.sessions (
    provider_id, model_user_id, model_id, availability_id,
    date, start_time, end_time, scheduled_at, duration_minutes,
    treatment_id, location_type, note, photo_urls, status
  ) values (
    p_provider_id, v_me, v_me, p_availability_id,
    p_date, p_start_time, p_end_time, p_scheduled_at, p_duration_minutes,
    p_treatment_id, p_location_type, p_note, p_photo_urls, 'pending'
  )
  returning id into v_session_id;

  -- The consent. Any failure here aborts the whole function, so the booking
  -- above is rolled back with it. There is no path to a confirmed booking
  -- without a consent record.
  insert into public.session_consents (
    session_id, user_id, category_id,
    consent_document_id, consent_version, content_hash,
    acknowledgements, agreed_at
  ) values (
    v_session_id, v_me, p_category_id,
    p_consent_document_id, p_consent_version, p_content_hash,
    p_acknowledgements, now()
  );

  return v_session_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Fully append-only. No permitted update at all.
-- ---------------------------------------------------------------------------
create or replace function public.guard_session_consents()
returns trigger language plpgsql
set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' then
    -- There is no longer any legitimate edit. The single exception that used to
    -- live here — nulling ip_address and device_info for the 12-month scrub —
    -- went with the columns in migration 0010.
    raise exception 'session_consents is immutable'
      using errcode = '42501';
  end if;

  -- DELETE, permitted only once retention has run. Unchanged.
  if old.agreed_at > now() - interval '6 years' then
    raise exception
      'session_consents is append-only until its 6-year retention expires (agreed_at %)', old.agreed_at
      using errcode = '42501';
  end if;
  return old;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. The purge loses its scrub step.
--
--    Byte-for-byte 0005's function with the 12-month block removed. The
--    six-year deletions, the sanity brake and the retention_runs record are
--    untouched.
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_purge(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_started  timestamptz := clock_timestamp();
  v_results  jsonb := '{}'::jsonb;
  v_ok       boolean := true;
  r          record;
  n          bigint;
  v_total    bigint;
begin
  -- The 12-month ip/device scrub that used to run here is gone with the
  -- columns (migration 0010). It had never had anything to scrub.

  -- ── 6-year deletions ─────────────────────────────────────────────────────
  for r in
    select * from (values
      ('session_consents',   'agreed_at',  '6 years'),
      ('moderation_actions', 'created_at', '6 years'),
      ('reports',            'created_at', '6 years')
    ) as t(tbl, col, keep)
  loop
    begin
      execute format('select count(*) from public.%I where %I < now() - interval %L',
                     r.tbl, r.col, r.keep) into n;
      execute format('select count(*) from public.%I', r.tbl) into v_total;

      if n > 0 and n = v_total then
        v_ok := false;
        v_results := v_results || jsonb_build_object(
          r.tbl || '_deleted', 0,
          r.tbl || '_refused',
          format('would delete all %s row(s) — boundary is not filtering, refused', v_total));
      elsif n = 0 then
        v_results := v_results || jsonb_build_object(r.tbl || '_deleted', 0);
      elsif p_dry_run then
        v_results := v_results || jsonb_build_object(r.tbl || '_would_delete', n);
      else
        execute format('delete from public.%I where %I < now() - interval %L',
                       r.tbl, r.col, r.keep);
        get diagnostics n = row_count;
        v_results := v_results || jsonb_build_object(r.tbl || '_deleted', n);
      end if;
    exception when others then
      v_ok := false;
      v_results := v_results || jsonb_build_object(
        r.tbl || '_error', sqlerrm, r.tbl || '_sqlstate', sqlstate);
    end;
  end loop;

  insert into public.retention_runs (dry_run, ok, duration_ms, results)
  values (
    p_dry_run,
    v_ok,
    (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
    v_results);

  return jsonb_build_object('ok', v_ok, 'dry_run', p_dry_run) || v_results;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The columns.
--
--    Last, so nothing still references them when they go.
-- ---------------------------------------------------------------------------
alter table public.session_consents
  drop column if exists ip_address,
  drop column if exists device_info;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0010', 'consent_records_hold_less', 'dc277b8cfd04b0140c1d3d7bacc88a3e5fb1bb62229d03f024e46ce33e254e61');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- One paste per block, each ending in one select. See 0000.
--
-- ── BLOCK A — the columns are gone, the rest of the record is not ─────────
--
--   select column_name
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'session_consents'
--   order by ordinal_position;
--
--   Expect no ip_address and no device_info. Expect content_hash,
--   consent_version, acknowledgements, agreed_at, subject_name and
--   subject_email_hash all still present — those are the record.
--
--
-- ── BLOCK B — immutable, and still deletable only after retention ─────────
-- Everything rolls back. Paste as ONE run.
--
--   create or replace function pg_temp.verify_0010()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare
--     v_id uuid;
--     v_update text := 'not reached';
--     v_delete text := 'not reached';
--   begin
--     select id into v_id from public.session_consents limit 1;
--     if v_id is null then
--       check_name := 'no consent records to test with'; outcome := 'skipped';
--       return next; return;
--     end if;
--
--     begin
--       update public.session_consents set consent_version = consent_version where id = v_id;
--       v_update := 'PROBLEM: an update was accepted';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm = 'ROLLBACK_ME' then null;
--       elsif sqlstate = '42501' then v_update := 'refused — correct, no edit path remains';
--       else v_update := 'refused by ' || sqlstate || ': ' || left(sqlerrm, 60);
--       end if;
--     end;
--
--     begin
--       delete from public.session_consents where id = v_id;
--       v_delete := 'PROBLEM: a recent record was deletable';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm = 'ROLLBACK_ME' then null;
--       elsif sqlstate = '42501' then v_delete := 'refused until 6 years — correct';
--       else v_delete := 'refused by ' || sqlstate || ': ' || left(sqlerrm, 60);
--       end if;
--     end;
--
--     check_name := 'consent record cannot be edited'; outcome := v_update; return next;
--     check_name := 'recent record cannot be deleted'; outcome := v_delete; return next;
--   end $f$;
--
--   select * from pg_temp.verify_0010();
--
--
-- ── BLOCK C — the purge still runs, without the scrub key ─────────────────
--
--   select public.run_retention_purge(true);
--
--   Expect no session_consents_scrubbed key, and the three *_deleted keys as
--   before. ok true.
--
--
-- ── BLOCK D — booking still works end to end ──────────────────────────────
-- The function signature changed, so this is the one that matters. Run the
-- 0007 Block C harness (pg_temp.dryrun_delete_all) too — nothing here should
-- affect account deletion, and that is worth re-establishing rather than
-- assuming.
--
--   select pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'create_session_with_consent';
--
--   Expect 16 arguments, ending p_category_id uuid — no p_device_info.
--
-- THEN BOOK SOMETHING FROM THE PHONE. The mobile app passes 15 named
-- arguments and never passed p_device_info, so it should be unaffected — but
-- "should be" is exactly the claim worth testing, and a broken booking flow is
-- not something to discover from a support email.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
--
-- Apply, verify, THEN run this. It compares every file against
-- public.schema_migrations and reports PENDING, DRIFTED, ORPHAN or SUPERSEDED.
--
-- It is the last step because it is the one that catches what the verify
-- blocks above cannot: a migration that was written and committed but never
-- actually run. That happened to 0009 -- it existed only as a file for a day,
-- and it was noticed by eye rather than by anything checking. A check that
-- depends on someone noticing is not a check.
--
-- Needs SUPABASE_SERVICE_ROLE_KEY in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
-- ===========================================================================

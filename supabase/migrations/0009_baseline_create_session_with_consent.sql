-- SUPERSEDED BY 0010
-- ===========================================================================
-- 0009_baseline_create_session_with_consent
--
-- ⚠⚠ DO NOT RUN THIS FILE. IT WAS NEVER APPLIED, AND APPLYING IT NOW WOULD
--    BREAK BOOKING. ⚠⚠
--
-- This is not merely redundant. Running it is actively harmful, and the reason
-- is not obvious from reading it:
--
--   * It contains CREATE OR REPLACE for the SEVENTEEN-argument signature,
--     the one ending `p_device_info jsonb`.
--   * Migration 0010 dropped that function and created a SIXTEEN-argument one
--     without p_device_info, and dropped session_consents.device_info with it.
--   * Postgres treats a different argument list as a DIFFERENT FUNCTION. So
--     this would not replace anything — it would create a second overload
--     alongside 0010's, and that overload still inserts into
--     session_consents.device_info, a column that no longer exists.
--
--   Any call that resolved to the 17-argument overload would fail at runtime,
--   on the booking path, with an error naming a column nobody would expect to
--   still be referenced.
--
-- WHY IT WAS NEVER APPLIED: it was written as a step-0 capture on 9 Aug 2026
-- and committed before it had been run. The collect-neither decision arrived
-- the same day, 0010 was written against its body, and 0010 was applied
-- instead. 0010's `drop function if exists` names the full 17-argument
-- signature explicitly, so it removed the live function whether or not this
-- had ever run — which is why the database is correct and only the record was
-- wrong.
--
-- IT IS KEPT, NOT DELETED, because it is the only place the function's
-- ORIGINAL definition is recorded — including the p_device_info parameter and
-- the device_info insert that 0010's reasoning refers to. Deleting it would
-- leave 0010 arguing with something no longer readable.
--
-- scripts/migration-status.mjs reads the SUPERSEDED BY line above and reports
-- this as superseded rather than pending — but ONLY once 0010 has actually
-- applied. If 0010 were ever rolled back, this reverts to PENDING and starts
-- asking to be run again, which is correct: at that point the 17-argument
-- function would be the right one.
--
-- ── WHAT FOLLOWS IS THE ORIGINAL FILE, UNCHANGED ─────────────────────────
--
-- A CAPTURE, NOT A CHANGE.
--
-- create_session_with_consent exists in the live database and in no repo file.
-- Its only record anywhere was the call site at
-- mobile/src/app/(app)/apply-session.tsx:512, which shows the parameter names it
-- passes and nothing about what the function does — not the atomicity it
-- guarantees, not which constraint raises 23505, not that it refuses to run
-- unsigned.
--
-- The body below is reproduced EXACTLY as pg_get_functiondef returned it on
-- 9 Aug 2026, including its own comments. Nothing is renamed, reordered,
-- reformatted or improved. A baseline that differs from what is running is
-- worse than no baseline: it looks authoritative and is wrong, which is the
-- failure this repo has already paid for three times (supabase/*.sql
-- documenting a third of the schema; an aggregate designed around a rating
-- trigger that already existed; a seed teardown blocked by a patch_tests table
-- nothing knew about).
--
-- Applying this is a no-op against the current database. Its whole purpose is
-- that public.schema_migrations finally contains the function slice 3 is about
-- to build on.
--
-- ── WHAT THE BODY GUARANTEES, FOR THE RECORD ──────────────────────────────
--   * SECURITY INVOKER (no `security definer`), so it runs as the caller and
--     RLS applies to both inserts. It is not a privilege escalation path.
--   * Refuses when auth.uid() is null — 42501.
--   * Refuses without consent document id, content hash and acknowledgements —
--     23502. Consent is not optional at the database level, not merely in the UI.
--   * ONE transaction. If the session_consents insert fails, the sessions
--     insert is rolled back with it. There is no path to a booking with no
--     consent record.
--   * 23505 from sessions_active_slot_uniq is deliberately NOT caught, so the
--     client's slot-race branch still fires. Any web client must preserve that.
--   * model_user_id AND model_id are both set to auth.uid(). Two columns, one
--     value — the duplication documented in CLAUDE.md.
--
-- ⚠ Two parameters have defaults and the mobile app passes NEITHER:
--   p_category_id and p_device_info. Consequences are real but are NOT fixed
--   here — see the note raised alongside this migration. This file records
--   what runs; it does not argue with it.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0009') then
    raise exception 'Migration 0009 has already been applied (see public.schema_migrations)';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.create_session_with_consent(p_provider_id uuid, p_availability_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_scheduled_at timestamp with time zone, p_duration_minutes integer, p_treatment_id uuid, p_location_type text, p_note text, p_photo_urls text[], p_consent_document_id uuid, p_consent_version integer, p_content_hash text, p_acknowledgements jsonb, p_category_id uuid DEFAULT NULL::uuid, p_device_info jsonb DEFAULT NULL::jsonb)
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
    acknowledgements, agreed_at, device_info
  ) values (
    v_session_id, v_me, p_category_id,
    p_consent_document_id, p_consent_version, p_content_hash,
    p_acknowledgements, now(), p_device_info
  );

  return v_session_id;
end $function$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0009', 'baseline_create_session_with_consent', '0f1129d4b39c74313043b826d92008a60407eeb94b2612e05cb633e3792d2db4');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- One paste, ending in one select. This is a baseline, so the thing worth
-- proving is that applying it changed NOTHING.
--
-- ── BLOCK A — the signature is what this file recorded ────────────────────
--
--   select pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef                               as security_definer,
--          p.prorettype::regtype::text               as returns
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'create_session_with_consent';
--
--   Expect 17 arguments, security_definer false, returns uuid.
--
--
-- ── BLOCK B — the body still refuses the two things it must ───────────────
-- Both calls roll back. Paste as ONE run.
--
--   create or replace function pg_temp.verify_0009()
--   returns table(check_name text, outcome text)
--   language plpgsql as $f$
--   declare v_consent text := 'not reached';
--   begin
--     -- Consent is required. Called with nulls for the three consent fields,
--     -- it must raise 23502 rather than write a booking.
--     begin
--       perform public.create_session_with_consent(
--         gen_random_uuid(), null, current_date, '09:00', '10:00', now(), 60,
--         null, 'salon', null, null, null, null, null, null);
--       v_consent := 'PROBLEM: a booking with no consent was accepted';
--       raise exception 'ROLLBACK_ME';
--     exception when others then
--       if sqlerrm = 'ROLLBACK_ME' then null;
--       elsif sqlstate = '23502' then
--         v_consent := 'refused without consent — correct';
--       else
--         v_consent := 'refused by ' || sqlstate || ': ' || left(sqlerrm, 70);
--       end if;
--     end;
--
--     check_name := 'booking without consent is refused'; outcome := v_consent;
--     return next;
--   end $f$;
--
--   select * from pg_temp.verify_0009();
--
-- In the SQL editor auth.uid() is null, so the "Not signed in" 42501 guard may
-- fire before the consent check. Either outcome proves the function refuses;
-- the row says which guard answered rather than pretending it was the one
-- being aimed at.
-- ===========================================================================

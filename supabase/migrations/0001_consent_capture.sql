-- ===========================================================================
-- 0001_consent_capture
--
-- Makes per-treatment consent an actual record instead of a screen.
--
-- WHAT IS BROKEN TODAY
--   ConsentGate.tsx shows five items and a tickbox, then calls onAccept() and
--   persists nothing. session_consents is empty, and nothing anywhere in the
--   app writes it. So the app asks people to agree to a treatment and keeps no
--   evidence that they did — the obligation without the protection.
--
-- WHAT THIS ADDS
--   1. A consent_documents row carrying the five items VERBATIM from the
--      component, so nothing users see changes in this work. Inserted only if
--      the table is empty.
--   2. create_session_with_consent(): the booking and its consent row in ONE
--      transaction. Either both exist or neither does.
--
-- WHY AN RPC AND NOT TWO INSERTS
--   session_consents.session_id is NOT NULL, so consent can only be written
--   after the booking exists. Two round trips means a window where the booking
--   is confirmed and the consent insert fails — a confirmed treatment with no
--   record of consent, which is precisely the hole being closed. A compensating
--   delete narrows that window; it does not close it.
--
-- WHY security INVOKER, NOT DEFINER
--   Deliberate. Every existing guarantee keeps applying: the model can only
--   insert a session as themselves, the RESTRICTIVE blocked-user and
--   suspended-user policies still fire, and session_consents.sc_insert still
--   requires user_id = auth.uid(). A definer function would quietly bypass all
--   of that. The caller's own permissions are exactly the right ones here.
--
-- 23505 SLOT RACE — PRESERVED
--   The partial unique index sessions_active_slot_uniq still rejects a second
--   active booking for the same provider+date+start_time. This function does
--   NOT catch it. The exception propagates with SQLSTATE 23505 unchanged, so
--   apply-session.tsx's `if (sessionErr?.code === '23505')` branch — the
--   "That time was just booked" nudge — behaves exactly as before.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0001') then
    raise exception 'Migration 0001 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Seed the consent document — VERBATIM from ConsentGate.tsx.
--
--    Only if the table is empty. If a document already exists, this is skipped
--    and a notice says so; adding a competing version silently is how two
--    copies of one thing start diverging.
--
--    acknowledgements is the tickable list. Each item gets its own tick in the
--    UI and its own entry in session_consents.acknowledgements — never
--    pre-ticked, per the original design.
--
--    content_hash is computed by the existing trg_consent_hash trigger over
--    title + body + acknowledgements, so it covers exactly what is rendered.
-- ---------------------------------------------------------------------------
do $$
declare v_existing int;
begin
  select count(*) into v_existing from public.consent_documents;

  if v_existing > 0 then
    raise notice 'consent_documents already has % row(s) — seed skipped', v_existing;
  else
    insert into public.consent_documents (version, title, body, acknowledgements, is_active)
    values (
      1,
      'Before you apply',
      'Please read and agree to the following before sending your application.',
      '[
        {
          "key": "photo_sharing",
          "icon": "images-outline",
          "title": "Photo sharing",
          "body": "Any photos you attach will be shared with the provider to help them prepare your treatment."
        },
        {
          "key": "treatment_photos",
          "icon": "camera-outline",
          "title": "Photos of your treatment",
          "body": "Most stylists are building a portfolio, so expect to be asked for before-and-after photos — that is usually why a treatment is free or discounted. They should ask you first, and you can say no."
        },
        {
          "key": "profile_visibility",
          "icon": "person-outline",
          "title": "Profile visibility",
          "body": "Your name and profile picture will be visible to the provider when you apply."
        },
        {
          "key": "attendance",
          "icon": "calendar-outline",
          "title": "Attendance commitment",
          "body": "By applying you agree to attend or cancel at least 24 hours in advance."
        },
        {
          "key": "community_standards",
          "icon": "heart-outline",
          "title": "Community standards",
          "body": "You agree to treat providers with respect and follow our community guidelines."
        }
      ]'::jsonb,
      true
    );
    raise notice 'seeded consent_documents v1 with 5 acknowledgements';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Booking + consent, atomically.
--
--    The consent fields are passed in as RENDERED, not looked up here. If the
--    gate showed v1 and v2 became active while the user was reading, the record
--    must say v1 — what they actually agreed to. Looking up the active document
--    at write time is the bug this signature exists to prevent.
-- ---------------------------------------------------------------------------
create or replace function public.create_session_with_consent(
  -- the booking
  p_provider_id         uuid,
  p_availability_id     uuid,
  p_date                date,
  p_start_time          time,
  p_end_time            time,
  p_scheduled_at        timestamptz,
  p_duration_minutes    integer,
  p_treatment_id        uuid,
  p_location_type       text,
  p_note                text,
  p_photo_urls          text[],
  -- the consent, exactly as shown on screen
  p_consent_document_id uuid,
  p_consent_version     integer,
  p_content_hash        text,
  p_acknowledgements    jsonb,
  p_category_id         uuid    default null,
  p_device_info         jsonb   default null
)
returns uuid
language plpgsql
-- INVOKER on purpose — see the header. Do not change to DEFINER.
security invoker
set search_path to 'public'
as $$
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
end $$;

revoke all on function public.create_session_with_consent(
  uuid, uuid, date, time, time, timestamptz, integer, uuid, text, text, text[],
  uuid, integer, text, jsonb, uuid, jsonb) from public, anon;

grant execute on function public.create_session_with_consent(
  uuid, uuid, date, time, time, timestamptz, integer, uuid, text, text, text[],
  uuid, integer, text, jsonb, uuid, jsonb) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0001', 'consent_capture', 'b0b5ba42b4193733ceca1cbde83bc5761f7a8a73c4f36191e1ea4cba39a87109');

commit;

notify pgrst, 'reload schema';

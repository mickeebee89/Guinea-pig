-- ===========================================================================
-- 0001_consent_capture
--
-- Makes per-treatment consent an actual record instead of a screen.
--
-- WHAT IS BROKEN TODAY
--   ConsentGate.tsx shows five hardcoded items and a single tickbox, calls
--   onAccept() and persists nothing. session_consents is empty and nothing in
--   the app writes it — the obligation without the protection.
--
--   Worse: an ACTIVE consent_documents v1 has existed since 9 June 2026
--   carrying a risk disclosure (providers are learners, may not be qualified,
--   treatments carry risks, plus a medical-suitability tick), and nothing has
--   ever rendered it. The document that mattered was the one nobody saw.
--
-- WHAT THIS ADDS
--   1. consent_documents v2, combining v1's risk disclosure with the two real
--      commitments from the screen. Five ticks, three informational notices.
--      v1 is deactivated. This deliberately changes what users see — they gain
--      the risk disclosure — and is the one place the "nothing users see
--      changes" rule was relaxed on purpose.
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
-- 1. consent_documents v2 — the two halves, combined.
--
--    WHAT THIS FOUND. An active v1 has existed since 9 June 2026 carrying a
--    RISK DISCLOSURE: providers are learners, may not be qualified, treatments
--    carry risks, plus a medical-suitability tick that pairs with patch_tests.
--    Nothing ever rendered it. Meanwhile ConsentGate.tsx showed five hardcoded
--    HOUSE RULES — photos, visibility, attendance, respect.
--
--    They are not two versions of one document. They are two documents, and
--    the one that was never shown is the one that matters: nobody booking a
--    treatment has ever been told, at the point of consent, that the person
--    performing it may be unqualified.
--
--    v2 keeps v1's disclosure verbatim as the body, promotes the two genuine
--    commitments from the screen to ticks, and keeps the three purely
--    informational items as untickable cards so the screen still says what it
--    said. That deliberately CHANGES what users see — they gain the risk
--    disclosure. It is the one place the "nothing users see changes" rule was
--    relaxed on purpose.
--
--    "Guinea Pig" becomes "Cavy" in the body, matching the rebrand already
--    applied to Terms, Privacy and Community Guidelines. Substance untouched.
--
--    SHAPE. Every item carries requires_tick. true items render as tick rows
--    and are recorded individually in session_consents.acknowledgements; false
--    items render as the informational cards. Both live in acknowledgements so
--    that content_hash — computed by trg_consent_hash over title + body +
--    acknowledgements — covers everything actually on screen, not just the
--    tickable part.
--
--    Never pre-ticked, per the original design.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.consent_documents where version = 2) then
    raise notice 'consent_documents v2 already exists — skipped';
  else
    -- Exactly one active document at a time. v1 stays for the record; nothing
    -- references it (session_consents is empty), it was simply never used.
    update public.consent_documents set is_active = false where is_active;

    insert into public.consent_documents (version, title, body, acknowledgements, is_active)
    values (
      2,
      'Before you apply',
      'Cavy connects you with people who are practising their skills. Providers on this platform are learners and may not be professionally qualified. Treatments carry normal risks, including reactions, irritation or unsatisfactory results. Cavy is a platform that introduces members to each other and does not provide treatments itself.',
      '[
        {
          "key": "unqualified",
          "requires_tick": true,
          "text": "I understand the provider is practising and may not be qualified"
        },
        {
          "key": "voluntary_risk",
          "requires_tick": true,
          "text": "I am booking voluntarily and accept the normal risks of a practice treatment"
        },
        {
          "key": "age_and_health",
          "requires_tick": true,
          "text": "I am 18 or over and have no condition that makes this treatment unsafe for me"
        },
        {
          "key": "attendance",
          "requires_tick": true,
          "text": "I will attend, or cancel at least 24 hours in advance"
        },
        {
          "key": "community_standards",
          "requires_tick": true,
          "text": "I will treat providers with respect and follow the community guidelines"
        },
        {
          "key": "photo_sharing",
          "requires_tick": false,
          "icon": "images-outline",
          "title": "Photo sharing",
          "body": "Any photos you attach will be shared with the provider to help them prepare your treatment."
        },
        {
          "key": "treatment_photos",
          "requires_tick": false,
          "icon": "camera-outline",
          "title": "Photos of your treatment",
          "body": "Most stylists are building a portfolio, so expect to be asked for before-and-after photos — that is usually why a treatment is free or discounted. They should ask you first, and you can say no."
        },
        {
          "key": "profile_visibility",
          "requires_tick": false,
          "icon": "person-outline",
          "title": "Profile visibility",
          "body": "Your name and profile picture will be visible to the provider when you apply."
        }
      ]'::jsonb,
      true
    );
    raise notice 'inserted consent_documents v2 (5 ticks, 3 notices); v1 deactivated';
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
values ('0001', 'consent_capture', 'dc1789d78cceb479d317c535d2d9199ec4172bc1923d89dee372c7b3059b6180');

commit;

notify pgrst, 'reload schema';

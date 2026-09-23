-- ===========================================================================
-- 0051_consent_v3_adds_the_patch_test
--
-- Consent document v3: v2's six items, plus a sixth tick about patch tests.
-- Audit item 81. Wording decided by Micky, 23 Sep 2026.
--
-- ⚠️ Apply 0050 first.
--
-- ── WHY A NEW VERSION AND NOT AN EDIT ───────────────────────────────────
-- set_consent_hash() is BEFORE INSERT **OR UPDATE** (snapshot :433). Editing
-- v2's wording would recompute v2's hash in place, and every session_consents
-- row already recorded against v2 would stop matching the document it points
-- at. The rows would be right and the document would have moved. So a wording
-- change is always a new version. v2 is never touched except to deactivate it.
--
-- ⚠️ AND THAT DEACTIVATION RE-RUNS THE HASH TRIGGER, WHICH IS SAFE — but only
-- because it is safe by accident of arithmetic, so it is said out loud: the
-- trigger recomputes from title || body || acknowledgements, and setting
-- is_active changes none of those, so the recomputed hash is byte-identical.
-- Verify Block C proves it rather than trusting it.
--
-- ── WHAT IS NEW ─────────────────────────────────────────────────────────
-- One tick, keyed `patch_test`, positioned immediately after `age_and_health`
-- because it is the other health item. Position is a decision, not a detail:
-- the hash covers the array, order included.
--
-- Everything else is v2 VERBATIM — the same title, the same body, the same
-- five ticks, the same three notices with their icons and paragraphs.
--
-- ── WHERE THE WORDING CAME FROM ─────────────────────────────────────────
-- site/lib/site.ts:97 (the public treatment pages) and
-- mobile/src/app/(app)/apply-session.tsx:1007 (the checkbox this replaces).
-- Two deliberate departures from both:
--   * the A&E line is dropped. True and right on a marketing page; wrong in a
--     document someone ticks under mild time pressure.
--   * "if my stylist says it's needed", not "where it is needed" — Micky's
--     change, and the better one: a model cannot judge whether a patch test is
--     required and the stylist can, so the tick must not ask her to.
--
-- ── WHAT THIS REPLACES ──────────────────────────────────────────────────
-- A checkbox on mobile's confirm screen whose value was never persisted. It
-- gated the Send button and then vanished — state, not evidence. After this,
-- the same agreement is an acknowledgement in session_consents: keyed, worded,
-- hashed, append-only, kept six years. The mobile checkbox comes out next, or
-- the model is asked twice and the weaker copy is the one gating the button.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare v_active integer;
begin
  if to_regclass('public.consent_documents') is null then
    raise exception '0051: public.consent_documents is missing.';
  end if;

  -- Without the trigger the insert below would store a NULL hash, and a
  -- consent record whose hash is null proves nothing at all.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.consent_documents'::regclass
      and tgname = 'trg_consent_hash' and tgenabled = 'O'
  ) then
    raise exception
      '0051: trg_consent_hash is missing or disabled. The hash would not be computed, and the document would be unusable as evidence.';
  end if;

  if exists (select 1 from public.consent_documents where version = 3) then
    raise exception '0051: a version 3 already exists. Read it before applying — this migration would create a second one.';
  end if;

  select count(*) into v_active from public.consent_documents where is_active;
  if v_active <> 1 then
    raise exception
      '0051: expected exactly 1 active consent document, found %. Applications read "the active document" and more than one makes that ambiguous.', v_active;
  end if;

  if not exists (select 1 from public.consent_documents where version = 2 and is_active) then
    raise exception '0051: v2 is not the active document. Read what is active before replacing it.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. v2 STEPS DOWN. It is not deleted: it is the only place the wording that
--    existing consents were given against survives in full.
-- ---------------------------------------------------------------------------
update public.consent_documents set is_active = false where is_active;

-- ---------------------------------------------------------------------------
-- 2. v3. The hash is NOT supplied — trg_consent_hash computes it, over
--    title || body || acknowledgements::text, and that is the number every
--    consent recorded from now on will carry.
--
--    Dollar-quoted, so the apostrophe in "it's needed" needs no escaping. A
--    doubled quote inside a consent document is one typo away from changing
--    the text a person agreed to.
-- ---------------------------------------------------------------------------
insert into public.consent_documents (version, title, body, acknowledgements, is_active)
values (
  3,
  'Before you apply',
  $body$Cavy connects you with people who are practising their skills. Providers on this platform are learners and may not be professionally qualified. Treatments carry normal risks, including reactions, irritation or unsatisfactory results. Cavy is a platform that introduces members to each other and does not provide treatments itself.$body$,
  $json$[
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
      "key": "patch_test",
      "requires_tick": true,
      "text": "I understand some treatments need an allergy patch test at least 48 hours beforehand, and I will not go ahead without one if my stylist says it's needed"
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
  ]$json$::jsonb,
  true
);

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0051', 'consent_v3_adds_the_patch_test', 'f0da27401272078ad8c8262a09b928f17e724d73350478ae93e0d10ed43201e2');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   1. Apply this migration.
--   2. Blocks A to E below, one at a time.
--   3. Reload the app: `npx expo start -c --dev-client`. Mobile fetches the
--      ACTIVE document and renders every tick it finds, so it shows six with
--      no app change. Until step 4 it ALSO shows its own patch-test checkbox,
--      so the model is asked twice for one turnaround.
--   4. Remove that checkbox (apply-session.tsx:994-1008) AND its condition on
--      the Send button (:1052-1053), or the button can never enable.
--
--   Nothing in site/ changes: the web renders whatever the active document
--   says, six ticks or five.
-- ===========================================================================
--
-- ── BLOCK A — exactly one active document, and it is v3. Read-only ──────
--
--   select
--     (select count(*) from public.consent_documents where is_active)                    as active_docs,
--     (select version  from public.consent_documents where is_active)                    as active_version,
--     (select is_active from public.consent_documents where version = 2)                 as v2_still_active,
--     (select jsonb_array_length(acknowledgements) from public.consent_documents where version = 3) as items,
--     (select count(*) from public.consent_documents c,
--        jsonb_array_elements(c.acknowledgements) a
--       where c.version = 3 and (a->>'requires_tick')::boolean)                          as ticks,
--     (select count(*) from public.consent_documents c,
--        jsonb_array_elements(c.acknowledgements) a
--       where c.version = 3 and not (a->>'requires_tick')::boolean)                      as notices;
--
--   Expect: 1, 3, false, 9, 6, 3.
--   active_docs of 2 is the one to stop on: both clients read "the active
--   document" and would pick whichever sorted first.
--
-- ── BLOCK B — the new tick, word for word, in the right place. Read-only ─
--
--   select ord, a->>'key' as key, (a->>'requires_tick')::boolean as tick,
--          coalesce(a->>'text', a->>'title') as heading,
--          a->>'body' as body
--   from public.consent_documents c,
--        jsonb_array_elements(c.acknowledgements) with ordinality t(a, ord)
--   where c.version = 3
--   order by ord;
--
--   Expect patch_test at position 4, immediately after age_and_health, reading
--   "…and I will not go ahead without one if my stylist says it's needed".
--   ⚠️ Read the three notices' `body` values too. They must be present and
--   full: a notice is a heading AND a paragraph, and the hash covers both.
--
-- ── BLOCK C — ⭐ EXISTING CONSENTS ARE UNTOUCHED. Read-only ─────────────
--
-- The point of a new version rather than an edit. Every consent already
-- recorded must still point at the document it was given against, with its own
-- hash matching that document's hash TODAY — including v2's, which was
-- re-hashed by the deactivation above and must have come out identical.
--
--   select
--     sc.consent_version,
--     count(*)                                                  as consents,
--     count(*) filter (where sc.content_hash = d.content_hash)  as hash_still_matches,
--     count(*) filter (where sc.content_hash <> d.content_hash) as hash_has_moved
--   from public.session_consents sc
--   join public.consent_documents d on d.id = sc.consent_document_id
--   group by sc.consent_version
--   order by sc.consent_version;
--
--   hash_has_moved MUST be 0 on every row. Anything else means a document was
--   edited under records that already referred to it, and those records can no
--   longer prove what they were given.
--
--   No rows at all means no consent has ever been recorded — true if nobody
--   has applied. That is not a pass; it is nothing to measure, and Block E
--   is then the only real check.
--
-- ── BLOCK D — the hash is the trigger's, not a leftover. Read-only ──────
--
--   select
--     version,
--     length(content_hash)                                                   as hash_len,
--     content_hash = encode(digest(coalesce(title,'') || coalesce(body,'')
--                    || coalesce(acknowledgements::text,''), 'sha256'), 'hex') as hash_is_current,
--     (select content_hash from public.consent_documents where version = 2)
--       = (select content_hash from public.consent_documents where version = 3) as v2_v3_same_hash
--   from public.consent_documents
--   order by version;
--
--   Expect hash_len 64 and hash_is_current true on EVERY row, and
--   v2_v3_same_hash false. Two versions sharing a hash would mean the new tick
--   never made it into the document.
--
--   (`digest` lives in the extensions schema; if this errors on the name,
--   qualify it as extensions.digest — set_consent_hash itself runs with
--   search_path 'public','extensions'.)
--
-- ── BLOCK E — a member can actually read it. Rolls itself back ─────────
--
-- cd_read is "to authenticated using (true)", so this should be unremarkable —
-- but the whole flow fails closed if it is not, and "the document loads" has
-- never been tested as anyone other than the owner.
--
--   do $$
--   declare v_me uuid; v_version int; v_ticks int;
--   begin
--     select id into v_me from public.users limit 1;
--     execute format('set local role authenticated');
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_me, 'role', 'authenticated')::text);
--
--     select c.version,
--            (select count(*) from jsonb_array_elements(c.acknowledgements) a
--              where (a->>'requires_tick')::boolean)
--       into v_version, v_ticks
--     from public.consent_documents c where c.is_active;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nread as an ordinary member: version %, % tick(s)', v_version, v_ticks;
--   end $$;
--
--   Expect version 3 and 6 ticks. A null version means RLS hid the document
--   from a signed-in member, and nobody could apply.

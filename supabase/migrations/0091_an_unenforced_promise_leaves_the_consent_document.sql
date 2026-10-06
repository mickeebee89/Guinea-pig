-- ===========================================================================
-- 0091_an_unenforced_promise_leaves_the_consent_document
--
-- Item 185. Consent document v4: v3's nine entries minus `attendance`.
--
-- ⚠️ Apply 0090 first.
--
-- ── WHAT COMES OUT, AND THE ARGUMENT FOR IT ────────────────────────────────
-- v3's fifth tick: *"I will attend, or cancel at least 24 hours in advance"*.
--
-- Micky's first reason was *"a box with no consequence attached trains people to
-- tick without reading, which devalues the acknowledgements that carry legal
-- weight."* ⚠️ **That reason is true and it is not the one in this header,
-- because it proves too much** — it would also catch item 6.
--
-- **The argument that actually distinguishes them** (Micky, 6 Oct 2026):
--
--   Items 1 to 4 are ACKNOWLEDGEMENTS OF RISK — they record that she UNDERSTOOD
--   something. Items 5 and 6 are PROMISES — they record that she UNDERTOOK
--   something. Of the two promises, 6 is ENFORCED: breaking the community
--   guidelines leads to warn, suspend or ban through _admin_apply_user_action.
--   5 is enforced by NOTHING AT ALL.
--
-- So this is not "remove the box with no consequence". It is that **one of two
-- promises has a mechanism behind it and the other does not**, and an unenforced
-- promise sitting beside five enforced or legally weighted items is what teaches
-- people to tick without reading.
--
-- ⚠️ NO-SHOW POLICY IS A SEPARATE DECISION, to be made when there are real
-- bookings to reason from. **Do not invent a penalty to justify restoring the
-- box.** If a policy ever exists, it arrives as v5 with a tick that names it.
--
-- ── ⚠️⚠️ A NEW VERSION, NEVER AN EDIT, AND WHAT "NEVER AN EDIT" MEANS EXACTLY ─
-- `set_consent_hash()` is BEFORE INSERT **OR UPDATE** on `consent_documents`
-- (schema-snapshot-2026-08-08.sql:189 and :433), computing
--
--     sha256(coalesce(title,'') || coalesce(body,'') || coalesce(acknowledgements::text,''))
--
-- So editing v3's wording would recompute v3's hash IN PLACE, and every
-- `session_consents` row already recorded against v3 would stop matching the
-- document it points at. The rows would be right and the document would have
-- moved. **A wording change is always a new version.**
--
-- ⚠️ "NEVER AN UPDATE TO v3" IS IMPRECISE AND THE PRECISION MATTERS, because
-- taken literally it makes the deactivation impossible. The rule is: **never an
-- UPDATE to v3's `title`, `body` or `acknowledgements`.** The `is_active` UPDATE
-- is REQUIRED, and it re-runs the hash trigger — which is safe *only* because
-- the hash covers exactly those three fields and `is_active` is none of them.
-- 0051 worked this out and called it "safe by accident of arithmetic". **It is
-- asserted below rather than inherited.**
--
-- ── ⚠️⚠️ WHY THAT ASSERTION IS LOAD-BEARING AND NOT TIDINESS ────────────────
-- A model mid-wizard holds v3's id, version and hash, loaded before the switch.
-- At submit, `reReadConsentDocument` (site/lib/queries/consent.ts:227) re-reads
-- **BY ID** — never by `is_active`, deliberately, rule 3 of that file's header:
-- *"A version going active while someone reads would record consent to text they
-- never saw."* It then compares `doc.contentHash !== shownHash` and returns
-- `reason: 'moved'` on a mismatch. `create_session_with_consent` null-checks its
-- three consent parameters and inserts them unvalidated against `is_active`.
--
-- ✅ **So she records v3, which is correct — v3 is what she read and ticked — and
-- nothing refuses her.** Confirmed by reading all three, 6 Oct 2026.
--
-- ⚠️ **BUT IF THE `is_active` UPDATE MOVED v3's HASH, EVERY MID-WIZARD MODEL
-- WOULD GET `'moved'` AND BE REFUSED AT SUBMIT.** 0051's "safe by arithmetic" is
-- the only thing standing between this migration and a wave of refusals, which
-- is why the hash is captured before and compared after.
--
-- ── ✅ NOTHING CACHES THE ACTIVE DOCUMENT, CHECKED ─────────────────────────
-- No `cache` / `revalidate` / `unstable_` wrapper in `site/lib/queries/consent.ts`
-- (its own rule 5 is "DO NOT CACHE"), and `next build` lists
-- `ƒ /stylist/[id]/apply` — **Dynamic, server-rendered on demand**, as a build
-- fact rather than as a comment. The switch takes effect on the next request.
--
-- ── ⚠️ ITEM 190 ASSESSED AND THE ANSWER IS "SAFE, FOR TWO SPECIFIC REASONS" ──
-- The SQL editor converts LF to CRLF on paste, and this migration's hash is
-- computed from text in that paste. It is nonetheless paste-safe:
--
--   1. `title` and `body` are each a SINGLE LINE, so they contain no newline for
--      a conversion to reach.
--   2. the acknowledgements arrive as a `$json$…$json$` literal cast to **jsonb**,
--      and jsonb PARSES then re-renders — so whitespace between tokens, CRLF
--      included, is normalised away before `acknowledgements::text` is hashed.
--
-- ⚠️ Stated as an assessment with its reasons rather than as reassurance, because
-- the same paste WOULD corrupt a hash computed over a multi-line `text` column,
-- and the next person writing one of those needs to know which of these two
-- properties they are relying on. Neither is a general guarantee.
--
-- ── ⚠️ AN EXPOSURE THIS SITS NEXT TO, NOT FIXED HERE ───────────────────────
-- `consent_documents` has **no immutability guard**. `session_consents` has one
-- (`trg_lock_consents`, BEFORE DELETE OR UPDATE), and `consent_documents` has
-- only `cd_write`: `for ALL to authenticated using (is_admin()) with check
-- (is_admin())`. **So an admin can UPDATE a document's body from a client**, which
-- would recompute its hash and silently invalidate every `session_consents` row
-- pointing at it. The only thing preventing it today is that no UI does it.
-- Raised separately rather than bundled; this migration simply must not rely on
-- v3 staying put by luck, and the post-condition below is what does not.
--
-- ── ⚠️ THERE IS NO UNIQUE CONSTRAINT ON `version`, AND THIS FILE ASSUMES NONE ─
-- Not in any migration, and `consent_documents`' DDL is in no migration and no
-- snapshot — the same pre-0000 population as `public.sessions` (item 189). So
-- whether one exists live is unknown from here.
--
-- Every assertion in this migration that reads "where version = N" therefore
-- COUNTS FIRST and refuses by name on anything but one row, because plpgsql's
-- `select … into` takes the first row of several SILENTLY.
--
-- ⚠️ THE CONSTRAINT ITSELF IS ITEM 195, NOT THIS MIGRATION, and the reason is
-- that the correct key is a design question rather than hygiene:
-- `consent_documents` carries a `category_id`. If per-category documents are
-- intended — and the column exists for some reason — then the key is
-- `(category_id, version)` and a global unique on `version` would be WRONG and
-- would have to be dropped again. Adding the wrong constraint inside a data
-- migration is worse than adding none.
--
-- ── DEPLOY ─────────────────────────────────────────────────────────────────
--   1. Preflight.
--   2. Apply this.
--   3. Deploy site/ with the fixtures.ts change that ships in the same commit.
--      ⚠️ NOT a cosmetic follow-up: lib/demo/fixtures.ts:484 says of its own copy
--      "Version 3 EXACTLY as migration 0051 inserts it … The demo must show the
--      terms the product actually asks people to agree to; inventing plausible
--      ones would be the one thing this file must never do." Left at v3 it shows
--      a tick production no longer asks for — the file's own prohibition. Demo
--      mode is local-only (DEMO_MODE=1 fails a build or a Vercel deploy, item
--      69), so this is a fidelity rule, not a production risk.
--   4. No types regeneration: no column changes.
-- ===========================================================================
begin;

do $mig$
declare
  v_active   integer;
  v_v3_hash  text;
  v_entries  integer;
  v_ticks    integer;
  v_att      integer;
  v_rows3    integer;
  v_expected text := '0a04dd74a9313f384822bfbfa60a59bf264e4a6c5795d3bba58424b2a5696085';
begin
  if not exists (select 1 from public.schema_migrations where version = '0090') then
    raise exception '0091: apply 0090 first.';
  end if;

  -- (a) EXACTLY ONE ACTIVE DOCUMENT, AND IT IS v3. Two would mean the client's
  -- `.eq('is_active', true).maybeSingle()` is already returning whichever row
  -- Postgres felt like, which is a bigger problem than this migration.
  select count(*) into v_active from public.consent_documents where is_active;
  if v_active <> 1 then
    raise exception '0091: % document(s) are active; expected exactly 1. The client selects the active document with maybeSingle(), so more than one is already indeterminate. Nothing changed.', v_active;
  end if;
  if not exists (select 1 from public.consent_documents where is_active and version = 3) then
    raise exception '0091: the active document is not version 3. This migration was written against v3. Read the versions before applying. Nothing changed.';
  end if;

  if exists (select 1 from public.consent_documents where version = 4) then
    raise exception '0091: a version 4 already exists. This migration has run, or someone added one by hand. Nothing changed.';
  end if;

  -- (b) v3 MUST BE THE DOCUMENT THIS MIGRATION WAS WRITTEN FROM. Its hash is
  -- the whole of title + body + acknowledgements, so one comparison covers all
  -- three: v4 carries title and body over verbatim, and if v3's text is not what
  -- was read on 6 Oct 2026 then "verbatim" means something else.
  -- ⚠⚠ ONE ROW PER VERSION IS ASSERTED, NOT ASSUMED. There is NO unique
  -- constraint on `version` anywhere in this repo, and consent_documents' DDL is
  -- in no migration and no snapshot (same pre-0000 population as public.sessions,
  -- item 189). With two v3 rows, every `select … into … where version = 3` below
  -- would take one of them SILENTLY — plpgsql's `into` does not raise on multiple
  -- rows. Item 195 covers the constraint itself.
  select count(*) into v_rows3 from public.consent_documents where version = 3;
  if v_rows3 <> 1 then
    raise exception '0091: there are % rows at version 3; expected exactly 1. Nothing in this schema stops duplicates (no unique constraint on version — item 195), and every read below would silently pick one. Nothing changed.', v_rows3;
  end if;

  select content_hash into v_v3_hash from public.consent_documents where version = 3;
  if v_v3_hash <> v_expected then
    raise exception '%', '0091: v3''s content_hash is ' || v_v3_hash
      || ' but this migration was written against ' || v_expected
      || '. Its title, body or acknowledgements have changed since 6 Oct 2026, so the v4 row below would not be v3-minus-one-tick. Re-read v3 and rewrite this file. Nothing changed.';
  end if;

  -- (c) AND THE SHAPE, SO A WRONG-BUT-SAME-HASH IMPOSSIBILITY IS NOT THE ONLY
  -- THING CHECKED. Nine entries, six tickable, `attendance` present exactly once.
  select jsonb_array_length(acknowledgements) into v_entries
    from public.consent_documents where version = 3;
  select count(*) into v_ticks
    from public.consent_documents d,
         jsonb_array_elements(d.acknowledgements) e
   where d.version = 3 and (e->>'requires_tick')::boolean;
  select count(*) into v_att
    from public.consent_documents d,
         jsonb_array_elements(d.acknowledgements) e
   where d.version = 3 and e->>'key' = 'attendance';

  if v_entries <> 9 or v_ticks <> 6 or v_att <> 1 then
    raise exception '%', '0091: v3 has ' || v_entries || ' entries, ' || v_ticks
      || ' tickable and ' || v_att || ' entry keyed `attendance`; expected 9, 6 and 1. Nothing changed.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- VERSION 4
--
-- ⚠️ content_hash IS NOT SUPPLIED, AND MUST NOT BE. `trg_consent_hash` computes
-- it BEFORE INSERT. A value written here would be silently overwritten, which is
-- the better failure but still a lie in the source.
--
-- ⚠️ EVERYTHING EXCEPT THE REMOVED ENTRY IS v3's LIVE TEXT, taken from
-- `acknowledgements::text` read out of the database on 6 Oct 2026 — not retyped
-- from 0051, and not reflowed. The em-dash in `treatment_photos` and the
-- apostrophe in `patch_test`'s "stylist says it's needed" are v3's own.
--
-- ⚠️ ARRAY ORDER IS PART OF THE HASH. The remaining eight keep v3's order
-- exactly; `community_standards` moves from position 6 to position 5 only
-- because position 5 was removed.
-- ---------------------------------------------------------------------------
insert into public.consent_documents (version, title, body, acknowledgements, is_active)
values (
  4,
  'Before you apply',
  $body$Cavy connects you with people who are practising their skills. Providers on this platform are learners and may not be professionally qualified. Treatments carry normal risks, including reactions, irritation or unsatisfactory results. Cavy is a platform that introduces members to each other and does not provide treatments itself.$body$,
  $json$[
    {"key": "unqualified", "requires_tick": true,
     "text": "I understand the provider is practising and may not be qualified"},
    {"key": "voluntary_risk", "requires_tick": true,
     "text": "I am booking voluntarily and accept the normal risks of a practice treatment"},
    {"key": "age_and_health", "requires_tick": true,
     "text": "I am 18 or over and have no condition that makes this treatment unsafe for me"},
    {"key": "patch_test", "requires_tick": true,
     "text": "I understand some treatments need an allergy patch test at least 48 hours beforehand, and I will not go ahead without one if my stylist says it's needed"},
    {"key": "community_standards", "requires_tick": true,
     "text": "I will treat providers with respect and follow the community guidelines"},
    {"key": "photo_sharing", "requires_tick": false, "icon": "images-outline",
     "title": "Photo sharing",
     "body": "Any photos you attach will be shared with the provider to help them prepare your treatment."},
    {"key": "treatment_photos", "requires_tick": false, "icon": "camera-outline",
     "title": "Photos of your treatment",
     "body": "Most stylists are building a portfolio, so expect to be asked for before-and-after photos — that is usually why a treatment is free or discounted. They should ask you first, and you can say no."},
    {"key": "profile_visibility", "requires_tick": false, "icon": "person-outline",
     "title": "Profile visibility",
     "body": "Your name and profile picture will be visible to the provider when you apply."}
  ]$json$::jsonb,
  true
);

-- ⚠️ THIS IS AN UPDATE TO v3 AND IT IS THE ONE THAT IS ALLOWED. It touches
-- neither title, body nor acknowledgements, so `trg_consent_hash` recomputes the
-- same value. The post-condition proves that rather than trusting it.
update public.consent_documents set is_active = false where version = 3;

comment on table public.consent_documents is
  'Versioned consent documents. ⚠️ A WORDING CHANGE IS ALWAYS A NEW VERSION, NEVER AN EDIT: '
  'set_consent_hash() is BEFORE INSERT OR UPDATE and recomputes content_hash from title || body || '
  'acknowledgements, so editing a row in place would move its hash and every session_consents row '
  'pointing at it would stop matching the document it names — retroactively misrepresenting what '
  'past members agreed to, with no gap to notice. The ONLY sanctioned UPDATE is is_active, which is '
  'in none of the three hashed fields. ⚠️ Never supply content_hash on insert; the trigger owns it. '
  'v4 (0091) removed the `attendance` tick: of v3''s two promises, community_standards is enforced '
  'through _admin_apply_user_action and attendance was enforced by nothing.';

do $mig$
declare
  v_active    integer;
  v_v3_now    text;
  v_v4_hash   text;
  v_entries   integer;
  v_ticks     integer;
  v_att       integer;
  v_carried   integer;
  v_consents  integer;
  v_untouched integer;
  v_rows3     integer;
  v_rows4     integer;
  v_a3        jsonb;
  v_a4        jsonb;
  v_expected  text := '0a04dd74a9313f384822bfbfa60a59bf264e4a6c5795d3bba58424b2a5696085';
begin
  -- ⚠️⚠️ THE ONE THAT IS LOAD-BEARING. If the is_active UPDATE moved v3's hash,
  -- every model mid-wizard gets reason 'moved' from reReadConsentDocument and is
  -- REFUSED AT SUBMIT. 0051 reasoned this safe; this asserts it.
  select content_hash into v_v3_now from public.consent_documents where version = 3;
  if v_v3_now <> v_expected then
    raise exception '%', '0091: THE is_active UPDATE MOVED v3''s HASH, from '
      || v_expected || ' to ' || v_v3_now
      || '. Every model mid-wizard would be refused at submit with reason ''moved'', and every '
      || 'historical session_consents row would stop matching v3. Rolled back.';
  end if;

  -- Exactly one active, and it is v4.
  select count(*) into v_active from public.consent_documents where is_active;
  if v_active <> 1 then
    raise exception '0091: % document(s) are active after the switch; expected exactly 1. Rolled back.', v_active;
  end if;
  if not exists (select 1 from public.consent_documents where is_active and version = 4) then
    raise exception '0091: the active document is not version 4. Rolled back.';
  end if;

  -- v4's shape: eight entries, five tickable, no `attendance`.
  select jsonb_array_length(acknowledgements), content_hash into v_entries, v_v4_hash
    from public.consent_documents where version = 4;
  select count(*) into v_ticks
    from public.consent_documents d, jsonb_array_elements(d.acknowledgements) e
   where d.version = 4 and (e->>'requires_tick')::boolean;
  select count(*) into v_att
    from public.consent_documents d, jsonb_array_elements(d.acknowledgements) e
   where d.version = 4 and e->>'key' = 'attendance';

  if v_entries <> 8 or v_ticks <> 5 or v_att <> 0 then
    raise exception '%', '0091: v4 has ' || v_entries || ' entries, ' || v_ticks
      || ' tickable and ' || v_att || ' keyed `attendance`; expected 8, 5 and 0. Rolled back.';
  end if;

  -- ⚠️⚠️ THE DIFF IS EXACTLY ONE ELEMENT, ASSERTED RATHER THAN DESCRIBED. The
  -- count checks above are not enough on their own: v4 could have eight entries,
  -- five tickable and no `attendance` while one of the remaining eight had been
  -- REWORDED, and every other assertion here would pass. This compares v3's array
  -- with the attendance element removed against v4's array, as jsonb — so it
  -- proves "v3 minus one entry", in order, to the character, without needing a
  -- literal copy of the text to compare against.
  -- ⚠️ TWO FAULTS FIXED HERE AFTER IT WAS FIRST WRITTEN, both Micky's, both the
  -- same class — an assertion that depended on something it did not state:
  --
  -- (i) `t.e->>'key' <> 'attendance'` is NULL for an entry with NO `key` field,
  --     and NULL is not true, so a keyless entry was dropped from the expected
  --     array ALONGSIDE attendance. The count check would have caught the
  --     asymmetric case, which is exactly the problem: the assertion relied on a
  --     DIFFERENT check to mean what it said. `coalesce(…, '')` makes it
  --     self-contained.
  --
  -- (ii) `from consent_documents a3, consent_documents a4 where version = 3 and
  --      version = 4` assumed one row per version. With two, the cross join
  --      returns several rows and the `if` fails with a subquery error instead of
  --      the message written for it. The counts are now asserted first and the
  --      arrays read into variables, so a duplicate produces a NAMED refusal.
  select count(*) into v_rows3 from public.consent_documents where version = 3;
  select count(*) into v_rows4 from public.consent_documents where version = 4;
  if v_rows3 <> 1 or v_rows4 <> 1 then
    raise exception '0091: % row(s) at version 3 and % at version 4; expected exactly 1 each. Nothing in this schema prevents duplicates (item 195). Rolled back.', v_rows3, v_rows4;
  end if;

  select acknowledgements into v_a3 from public.consent_documents where version = 3;
  select acknowledgements into v_a4 from public.consent_documents where version = 4;

  if (select jsonb_agg(t.e order by t.ord)
        from jsonb_array_elements(v_a3) with ordinality as t(e, ord)
       where coalesce(t.e->>'key', '') <> 'attendance')
     is distinct from v_a4 then
    raise exception '0091: v4''s acknowledgements are NOT v3''s with the `attendance` entry removed. The counts match but something else was reworded, reordered or lost. Rolled back.';
  end if;

  -- ⚠️ TITLE AND BODY CARRIED OVER, PROVED BY COMPARING THE TWO ROWS rather than
  -- by asserting a literal — a literal here would be a third copy of the text.
  select count(*) into v_carried
    from public.consent_documents a, public.consent_documents b
   where a.version = 3 and b.version = 4
     and a.title = b.title and a.body = b.body;
  if v_carried <> 1 then
    raise exception '0091: v4''s title or body is not byte-identical to v3''s. Only the acknowledgements were meant to change. Rolled back.';
  end if;

  -- The hash must have MOVED between versions, and must look computed.
  if v_v4_hash = v_expected then
    raise exception '0091: v4''s hash equals v3''s, which is impossible if an acknowledgement was removed — so the acknowledgements did not change. Rolled back.';
  end if;
  if v_v4_hash is null or v_v4_hash !~ '^[0-9a-f]{64}$' then
    raise exception '%', '0091: v4''s content_hash is ' || coalesce(v_v4_hash, 'null')
      || ', not 64 hex characters. trg_consent_hash did not run, or is not on this table. Rolled back.';
  end if;

  -- ⚠️ EVERY EXISTING CONSENT STILL POINTS AT THE DOCUMENT IT NAMED. This is the
  -- whole purpose: six years of records must keep matching their own text.
  select count(*) into v_consents
    from public.session_consents sc
    join public.consent_documents d on d.id = sc.consent_document_id
   where sc.content_hash <> d.content_hash;
  if v_consents <> 0 then
    raise exception '0091: % session_consents row(s) no longer match the content_hash of the document they point at. Rolled back.', v_consents;
  end if;

  -- THE CONTROL: versions 1 and 2 are named by nothing in this migration and
  -- must be exactly as they were — inactive, and still present.
  select count(*) into v_untouched
    from public.consent_documents where version in (1, 2) and not is_active;
  if v_untouched <> 2 then
    raise exception '0091: expected 2 inactive documents at versions 1 and 2, found %. This migration names neither. Rolled back.', v_untouched;
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0091', 'an_unenforced_promise_leaves_the_consent_document', 'ddff66f6cb8e5d9bf6394b28945f8742fb6ad99c158e9e61b0b6d94907d3ce91');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN BEFORE THIS MIGRATION. Read-only, one block.
--
--   select 'a. versions' as part, ('v' || d.version::text) as name,
--          'active=' || d.is_active::text
--       || ' | title=' || d.title
--       || ' | hash=' || d.content_hash
--       || ' | entries=' || jsonb_array_length(d.acknowledgements)::text
--       || ' | tickable=' || (select count(*) from jsonb_array_elements(d.acknowledgements) e
--                              where (e->>'requires_tick')::boolean)::text as detail
--     from public.consent_documents d
--   union all
--   select 'b. gate', 'v3 is the only active one',
--          ((select count(*) from public.consent_documents where is_active) = 1
--           and exists (select 1 from public.consent_documents where is_active and version = 3))::text
--   union all
--   select 'c. gate', 'v3 hash matches what 0091 was written from',
--          ((select content_hash from public.consent_documents where version = 3)
--           = '0a04dd74a9313f384822bfbfa60a59bf264e4a6c5795d3bba58424b2a5696085')::text
--   union all
--   select 'd. gate', 'no version 4 yet',
--          (not exists (select 1 from public.consent_documents where version = 4))::text
--   union all
--   select 'e. the hash trigger exists',
--          'trg_consent_hash on consent_documents',
--          (exists (select 1 from pg_trigger t
--                    where t.tgrelid = 'public.consent_documents'::regclass
--                      and t.tgname = 'trg_consent_hash' and not t.tgisinternal))::text
--   union all
--   select 'f. existing consents', 'rows, and how many already mismatch their document',
--          (select count(*)::text from public.session_consents)
--       || ' row(s), '
--       || (select count(*)::text from public.session_consents sc
--             join public.consent_documents d on d.id = sc.consent_document_id
--            where sc.content_hash <> d.content_hash)
--       || ' mismatched'
--   union all
--   select 'g. gate', '0090 applied',
--          ((select count(*) from public.schema_migrations where version = '0090') = 1)::text
--    order by 1, 2;
--
--   EXPECT: (a) three rows, v3 active with 9 entries and 6 tickable ·
--           (b) true · (c) true · (d) true · (e) true ·
--           (f) any count, with **0 mismatched** · (g) true.
--
--   ⚠️ IF (e) IS FALSE, STOP. Without trg_consent_hash the insert below writes a
--   NULL content_hash and v4 would be a document no consent could ever verify
--   against. The post-condition catches it, but knowing first is cheaper.
--
--   ⚠️ IF (f) REPORTS ANY MISMATCH, STOP AND DO NOT APPLY. A consent row that
--   already disagrees with its document means a document was edited in place at
--   some point, and that is a six-year-record problem which outranks this change.
--   The post-condition asserts 0, so applying would simply roll back — but the
--   finding is the point, not the rollback.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY — ONE BLOCK, after applying. Read-only; nothing to roll back. ───
--
-- ⚠️ IT NEEDS NO IMPERSONATION, AND THAT IS WORTH SAYING. 0090's verify was
-- wrong five times, and every fault was the block asking a question of a party
-- that could not answer it honestly — the owner who saw too much, the caller who
-- saw nothing, the admin who saw everything, a fixture row that was correctly
-- contested. **`cd_read` is `for SELECT to authenticated using (true)`, so every
-- authenticated identity reads every document identically.** There is no seat to
-- get wrong here, so none is taken: this block reads as the owner and asserts
-- only facts that are the same for everyone.
--
-- It is also READ-ONLY, so unlike every other verify in this ledger it does not
-- end in a deliberate rollback — there is nothing to undo.
--
--   select 'v' || d.version::text as version,
--          d.is_active,
--          jsonb_array_length(d.acknowledgements)                       as entries,
--          (select count(*) from jsonb_array_elements(d.acknowledgements) e
--            where (e->>'requires_tick')::boolean)                      as tickable,
--          (select count(*) from jsonb_array_elements(d.acknowledgements) e
--            where e->>'key' = 'attendance')                            as attendance,
--          left(d.content_hash, 16)                                     as hash_16,
--          (select count(*) from public.session_consents sc
--            where sc.consent_document_id = d.id)                       as consents_pointing_here
--     from public.consent_documents d
--    order by d.version;
--
--   EXPECT, four rows:
--     v1  false  …                                        (untouched)
--     v2  false  …                                        (untouched)
--     v3  false  9 entries  6 tickable  1 attendance  hash 0a04dd74a9313f38
--     v4  TRUE   8 entries  5 tickable  0 attendance  hash <new>
--
--   ⚠️ v3's hash MUST still read 0a04dd74a9313f38. That is the whole of the
--   mid-wizard guarantee: reReadConsentDocument re-reads BY ID and compares the
--   hash it was shown, so a moved v3 hash refuses every model who loaded the
--   document before the switch — at submit, after she has filled in seven steps.
--
--   ⚠️ v3's `consents_pointing_here` must be whatever it was before and must NOT
--   be 0 if it was not 0. Those rows are the six-year record; the point of a new
--   version is that they keep pointing at the text they actually agreed to.
--
--   And one read that needs a signed-in client rather than SQL: open the apply
--   wizard as an ordinary model and confirm the consent step shows FIVE ticks and
--   no attendance line. The database says what is active; only the client proves
--   what she is shown.
-- ===========================================================================

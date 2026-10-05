-- ===========================================================================
-- 0086_a_booking_cannot_exist_without_a_consent_record
--
-- Item 148. Four parts, one migration, because any two of them applied alone
-- leaves either a hole open or booking broken.
--
-- ⚠️ Apply 0085 first.
--
-- ⚠️⚠️ NOTHING TO DEPLOY. The RPC's signature is unchanged and no client in any
-- of the three apps inserts into `sessions` (swept 5–6 Oct 2026, four
-- spellings). So unlike 0077 and 0083 there is no apply-versus-deploy window
-- to get the wrong way round. Clients keep sending `p_duration_minutes`; it
-- simply stops being read.
--
-- ── WHAT WAS MEASURED, NOT ARGUED ──────────────────────────────────────────
-- Block B, 6 Oct 2026, as the model test account under
-- `set local role authenticated`, against the whole 26-column insertable
-- surface. **Fifteen columns took the caller's hostile value:**
--
--   id (caller-chosen)   status = ACCEPTED        model_id (someone else's)
--   not_held_model_at    not_held_provider_at     completed_at
--   cancelled_at         cancelled_by             cancellation_reason
--   model_note           created_at (backdated)   materials_cost
--   currency_code        duration_minutes         price_pence
--
-- **So a member could create a booking already marked accepted, attributed to
-- a different member, backdated ninety days, with both not-held timestamps
-- already set, and no consent record.** A row born claiming the appointment did
-- not happen — which is the shape 0070 exists to prevent on the UPDATE path,
-- arriving instead at birth, where no guard looked.
--
-- `date`, `start_time`, `end_time` and `scheduled_at` were correctly forced
-- back to the slot's real values by 0065, which is the precedent this follows.
--
-- ⚠️ AND `price_pence` WAS NOT AMBIGUOUS AFTER ALL. Both of us hedged on it
-- because a zero-priced treatment would look the same. Reading
-- `tg_session_price_snapshot` settles it: its own comment says *"Fills only a
-- NULL."* The caller's `0` therefore STOOD. It is unguarded today, and the
-- grant below is what closes it — the column arrives NULL and the snapshot
-- fills it.
--
-- ── PART 1 — THE SLOT ALREADY OWNS THIS DECISION, SO IT TAKES TWO MORE ─────
-- `model_id` and `duration_minutes` survive a column-scoped grant on their own,
-- because the RPC supplies both and so both must stay granted. Rather than add
-- a fourth mechanism, they move into the trigger that already exists to say the
-- caller does not decide: `tg_session_slot_authority`, whose own comment is
-- *"THE CALLER'S VALUES ARE DISCARDED, not compared."*
--
--   `model_id` follows `model_user_id` — NOT `auth.uid()`. The INSERT policy
--   already constrains `model_user_id` to `auth.uid()`, so deriving from it
--   closes the residue exactly, and keeps working for admin tooling and the
--   service role where `auth.uid()` is null. Nothing is left unconstrained.
--
--   `duration_minutes` is derived from the slot's own end minus start, which is
--   arithmetically what both clients already compute from the same two values.
--   Same number, one source.
--
-- ⚠️ THIS FALSIFIES A SENTENCE IN 0065, WHICH CANNOT BE CORRECTED IN PLACE.
-- 0065's function comment reads *"p_duration_minutes is the one time-related
-- value a caller still decides."* After this it decides nothing. An applied
-- migration's prose is checksum-locked, so 0065's file keeps the old sentence;
-- the function COMMENT is replaced below, because that is the copy anybody
-- actually reads from the database.
--
-- ── PART 2 — THE RPC NAMES SEVEN COLUMNS INSTEAD OF FOURTEEN ───────────────
-- The live body already inserts NULL into the four time columns as dead
-- arguments. The same reasoning retires five more:
--
--   `status` is NOT NULL DEFAULT 'pending' — omitting it yields exactly what
--   the RPC sets today.
--   `model_id` and `duration_minutes` are NOT NULL with no default, but part 1
--   fills them BEFORE INSERT, which is checked before NOT NULL. The existing
--   code proves that pattern works: it inserts explicit NULL into
--   `scheduled_at`, also NOT NULL with no default, and succeeds.
--
-- ⚠️ SIGNATURE UNCHANGED, for the reason 0065 and 0058 both record: a changed
-- argument list means a new overload and a coordinated client deploy for no
-- behavioural gain. `p_duration_minutes` joins the four already-dead
-- arguments.
--
-- ── PART 3 — THE GRANT, WHICH IS WHAT ACTUALLY REFUSES ─────────────────────
-- `revoke insert` then `grant insert (seven columns)`. Column privileges are
-- checked against the statement's TARGET LIST, not against what triggers
-- write, so parts 1 and 2's triggers keep working untouched.
--
-- **Nineteen of twenty-six columns come off the grant**, including all fifteen
-- the measurement found reachable.
--
-- ⚠️ `model_user_id` STAYS GRANTED and that is correct, not an oversight: the
-- policy `auth.uid() = model_user_id` is what constrains it. The grant decides
-- which columns may be NAMED; the policy decides what may be in them.
--
-- ── PART 4 — AND THE PART A GRANT CANNOT DO ────────────────────────────────
-- ⚠️ THE SEVEN GRANTED COLUMNS ARE PRECISELY SUFFICIENT TO CREATE A BOOKING
-- WITH NO CONSENT ROW. Block B measured that too: the nine-column insert stood,
-- and both hostile rows had `consents=0`. Taking columns away cannot fix it,
-- because the legitimate booking names the same columns.
--
-- So a deferred constraint trigger. The RPC writes session and consent in one
-- transaction, so it passes; a bare direct insert fails at COMMIT.
--
-- **The precedent is the RPC's own comment**, which has claimed since 0001:
-- *"There is no path to a confirmed booking without a consent record."* This
-- makes that sentence true — the same way 0079 made 0070's not-held comment
-- true rather than narrowing it.
--
-- ⚠️⚠️ AND IT IS TRUE OF ROWS CREATED FROM 0086 ONWARD, NOT OF THE TABLE.
-- **29 sessions already have no consent row**, counted 6 Oct 2026: accepted 1,
-- cancelled 14, completed 11, declined 3, the newest created 25 July 2026 and
-- none pending. They predate the consent RPC.
--
-- They are deliberately left alone. Backfilling a consent nobody gave would be
-- fabrication — `cleanup-consentless-test-sessions.sql` settled that principle
-- on 8 Aug 2026 in its own words — and this trigger is INSERT-only, so it never
-- looks at them.
--
-- **The guarantee is scoped by naming the 29, not by weakening the sentence.**
-- Anywhere this invariant is stated it reads *"a booking created from 0086
-- onward"*. `site/content/legal.ts:833` already does the same thing for its own
-- consent claim, scoping it to "only true from 8 Aug".
--
-- ⚠️ WHAT THE 29 SHOW AND WHAT THEY DO NOT. Nothing consentless has been
-- inserted on this database since 25 July. That is evidence nobody has used
-- this path — **not** evidence the path was closed. Block B demonstrated on
-- 6 Oct that it was open the whole time.
--
-- ⚠️⚠️ THE CLAIM IS BOUNDED TO THE MECHANISM, AND THE WORDING IS DELIBERATE.
-- This guarantees a consent **RECORD EXISTS**. It does NOT guarantee consent
-- was given: a member can insert a session and a self-made consent row in the
-- same transaction and satisfy it completely. **Say "consent record", never
-- "consent".** Making the row genuine — `content_hash` matching a real
-- `consent_documents` row, `acknowledgements` matching the version, `agreed_at`
-- not in the future — is item 167, and column grants cannot help there because
-- a forger names the same columns.
--
-- ⚠️ INSERT ONLY. DO NOT WIDEN IT TO UPDATE OR DELETE. `run_retention_purge`
-- (0005) deletes consents at six years while sessions survive, so an
-- UPDATE-or-DELETE-coverage version of this trigger would start refusing on
-- lawfully purged history. The invariant is about how a booking is BORN.
--
-- ── WHY NOT SECURITY DEFINER ON THE RPC, WHICH WOULD CLOSE MORE ────────────
-- Revoking INSERT entirely and making the RPC DEFINER would close everything in
-- one move. It would also re-express `sessions_insert_not_blocked`,
-- `sessions_not_suspended` and `sessions_applicant_is_eligible` as function
-- code, which is the anti-pattern this series has spent a week undoing. 0077's
-- warning against DEFINER-ising this function stands for that reason as well as
-- its own.
-- ===========================================================================
begin;

do $$
declare
  v_slot text;
  v_rpc  text;
  v_bad  integer;
  v_orph integer;
begin
  if not exists (select 1 from public.schema_migrations where version = '0085') then
    raise exception '0086: apply 0085 first.';
  end if;

  -- Comments stripped for every "is it there" question: 0068's guard read a
  -- function's own prose and reported a change as already made.
  v_slot := regexp_replace(
              pg_get_functiondef('public.tg_session_slot_authority()'::regprocedure),
              '--[^' || chr(10) || ']*', '', 'g');
  v_rpc := regexp_replace(
             pg_get_functiondef(
               'public.create_session_with_consent(uuid,uuid,date,time,time,timestamptz,integer,uuid,text,text,text[],uuid,integer,text,jsonb,uuid)'::regprocedure),
             '--[^' || chr(10) || ']*', '', 'g');

  if v_slot not like '%new.scheduled_at := v_starts%' then
    raise exception '0086: the live tg_session_slot_authority is not 0065''s version. Read it with pg_get_functiondef before replacing it. Nothing changed.';
  end if;
  if v_slot like '%new.duration_minutes :=%' then
    raise exception '0086: tg_session_slot_authority already derives duration_minutes. This migration has run.';
  end if;
  if v_rpc not like '%model_id%' or v_rpc not like '%''pending''%' then
    raise exception '0086: the live create_session_with_consent does not name model_id and status as expected, so it is not the body this migration was written against. Read it before replacing it. Nothing changed.';
  end if;
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.sessions'::regclass
                and tgname = 'session_needs_consent_record') then
    raise exception '0086: the consent constraint trigger already exists. This migration has run.';
  end if;

  -- ⚠️ A FUTURE SLOT WHOSE END IS NOT AFTER ITS START would make the derived
  -- duration zero or negative, and part 1 refuses that. A real booking attempt
  -- would then fail on data that exists today, so this refuses to apply instead.
  select count(*) into v_bad
    from public.availability av
   where av.end_time <= av.start_time
     and (av.date + av.start_time) > now() at time zone 'Europe/London';
  if v_bad > 0 then
    raise exception '0086: % future availability row(s) have end_time <= start_time, so a derived duration would be zero or negative and part 1 would refuse a legitimate booking on them. Fix the slots first. Nothing changed.', v_bad;
  end if;

  -- Informational, and it must not be read as a problem: the constraint below
  -- is INSERT-only, so sessions that already lack a consent row are untouched.
  select count(*) into v_orph
    from public.sessions s
   where not exists (select 1 from public.session_consents c where c.session_id = s.id);
  raise notice '0086: % existing session(s) have no consent row; the new constraint is INSERT-only and does not touch them.', v_orph;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE SLOT TAKES TWO MORE COLUMNS
--
-- Reproduced from 0065's body with three additions and nothing else changed:
-- the two assignments, and the end-after-start guard that makes the derived
-- duration trustworthy rather than merely computed.
-- ---------------------------------------------------------------------------
create or replace function public.tg_session_slot_authority()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a        record;
  v_starts timestamptz;
  v_mins   integer;
begin
  if new.availability_id is null then
    raise exception 'A booking must say which slot it is for.'
      using errcode = 'CV003';
  end if;

  select av.provider_id, av.date, av.start_time, av.end_time
    into a
  from public.availability av
  where av.id = new.availability_id
  for update;

  if not found then
    raise exception 'That slot no longer exists.'
      using errcode = 'CV003';
  end if;

  if new.provider_id is distinct from a.provider_id then
    raise exception 'That slot belongs to a different stylist.'
      using errcode = 'CV003';
  end if;

  v_starts := (a.date + a.start_time) at time zone 'Europe/London';

  if v_starts <= now() then
    raise exception 'That appointment has already started — please choose another time.'
      using errcode = 'CV003';
  end if;

  -- ⚠️ ADDED 0086. A slot that does not run forwards cannot carry a booking,
  -- and without this the derived duration below would be zero or negative.
  v_mins := (extract(epoch from (a.end_time - a.start_time)) / 60)::integer;
  if v_mins <= 0 then
    raise exception 'That slot does not run forwards, so it cannot be booked.'
      using errcode = 'CV003';
  end if;

  -- ⚠️ THE CALLER'S VALUES ARE DISCARDED, not compared. A mismatch is not an
  -- error to report, it is a value to ignore: the row is the fact.
  new.date         := a.date;
  new.start_time   := a.start_time;
  new.end_time     := a.end_time;
  new.scheduled_at := v_starts;

  -- ⚠️ ADDED 0086 (item 148). Both were measured as caller-settable on 6 Oct:
  -- a member set model_id to another member's id while model_user_id stayed
  -- their own, and claimed one minute against an hour-long slot.
  --
  -- model_id follows model_user_id rather than auth.uid(): the INSERT policy
  -- already constrains model_user_id to auth.uid(), so this inherits that
  -- constraint exactly, and it keeps working for admin tooling and the service
  -- role, where auth.uid() is null.
  --
  -- ⚠️⚠️ BOTH ASSIGNMENTS ARE UNCONDITIONAL, AND THAT IS THE WHOLE POINT.
  -- tg_session_price_snapshot "fills only a NULL" — which is exactly why
  -- price_pence stayed caller-settable until it was measured on 6 Oct, three
  -- months after 0052 was written to protect it. A fill-if-null here would
  -- leave the column grant as the ONLY thing preventing an override, and a
  -- grant is one `grant insert (…)` away from being widened by someone who has
  -- not read this file.
  --
  -- ⚠️ model_user_id IS NULLABLE (read from the types generated live at 0083),
  -- so an unconditional assignment could null a NOT NULL column on an insert
  -- that names neither. It is refused explicitly rather than quietly falling
  -- back: a booking with no member is not a thing to repair by guessing, and a
  -- named refusal is better than a NOT NULL violation naming a column the
  -- caller never mentioned.
  if new.model_user_id is null then
    raise exception 'A booking must say which member it is for.'
      using errcode = 'CV003';
  end if;

  new.model_id         := new.model_user_id;
  new.duration_minutes := v_mins;

  return new;
end $$;

comment on function public.tg_session_slot_authority() is
  'BEFORE INSERT on sessions: takes date, start_time, end_time, scheduled_at, duration_minutes and '
  'model_id from the availability row and the booking''s own model_user_id, and refuses a slot that '
  'has already started or does not run forwards (SQLSTATE CV003, Europe/London). None of the six is '
  'supplied by a client, for the same reason price_pence is not (0052). ⚠️ SUPERSEDES 0065''s comment '
  'that "p_duration_minutes is the one time-related value a caller still decides" — since 0086 it '
  'decides nothing. A trigger rather than a check inside create_session_with_consent because "model '
  'can create session" is a permissive INSERT policy, so a member can insert a session row directly. '
  '0065, extended by 0086. Audit items 133 and 148.';

-- ---------------------------------------------------------------------------
-- 2. THE RPC NAMES SEVEN COLUMNS
--
-- Reproduced from the live body with the insert's target list narrowed and
-- nothing else changed. Still INVOKER, still `search_path = public`: the
-- member's own grant is what lets her book, which is the constraint that makes
-- this migration shaped the way it is.
-- ---------------------------------------------------------------------------
create or replace function public.create_session_with_consent(
  p_provider_id uuid, p_availability_id uuid, p_date date,
  p_start_time time without time zone, p_end_time time without time zone,
  p_scheduled_at timestamp with time zone, p_duration_minutes integer,
  p_treatment_id uuid, p_location_type text, p_note text, p_photo_urls text[],
  p_consent_document_id uuid, p_consent_version integer, p_content_hash text,
  p_acknowledgements jsonb, p_category_id uuid default null::uuid)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
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
  --
  -- ⚠️ SEVEN COLUMNS SINCE 0086, down from fourteen, and the ones NOT named are
  -- the point: `authenticated` holds INSERT on exactly these seven, so no
  -- member can name any other — measured on 6 Oct as fifteen columns a member
  -- could set, including status, model_id, both not_held stamps and price.
  --
  --   date / start_time / end_time / scheduled_at   session_slot_authority (0065)
  --   model_id / duration_minutes                   session_slot_authority (0086)
  --   status                                        NOT NULL DEFAULT 'pending'
  --   price_pence                                   session_price_snapshot (0052)
  --
  -- p_date, p_start_time, p_end_time, p_scheduled_at and p_duration_minutes are
  -- all DEAD ARGUMENTS. They stay in the signature so no client needs a deploy.
  insert into public.sessions (
    provider_id, model_user_id, availability_id,
    treatment_id, location_type, note, photo_urls
  ) values (
    p_provider_id, v_me, p_availability_id,
    p_treatment_id, p_location_type, p_note, p_photo_urls
  )
  returning id into v_session_id;

  -- The consent. Any failure here aborts the whole function, so the booking
  -- above is rolled back with it.
  --
  -- ⚠️ SINCE 0086 THIS IS ALSO WHAT MAKES THE SESSION LEGAL. The deferred
  -- constraint refuses, at COMMIT, any session created from 0086 onward that
  -- has no consent row — so the sentence this function has carried since 0001,
  -- "there is no path to a confirmed booking without a consent record", is
  -- enforced rather than asserted. ⚠️ For NEW rows: 29 sessions predating the
  -- consent RPC have none and are left alone, because backfilling a consent
  -- nobody gave would be fabrication.
  insert into public.session_consents (
    session_id, user_id, category_id,
    consent_document_id, consent_version, content_hash,
    acknowledgements, agreed_at
  ) values (
    v_session_id, v_me, p_category_id,
    p_consent_document_id, p_consent_version, p_content_hash,
    p_acknowledgements, now()
  );

  -- ⚠️ ADDED 0077 (item 144). The stylist is told HERE, in the transaction that
  -- made the booking, instead of by a best-effort insert the client ran
  -- afterwards and logged on failure. An application nobody is told about is
  -- the same silence as a booking that never saved.
  --
  -- ⚠️⚠️ THIS LINE WAS MISSING FROM 0086's FIRST DRAFT AND THE PREFLIGHT DIFF
  -- CAUGHT IT. Reproducing a live body by hand dropped it, which would have
  -- silently reverted stage A of item 144: bookings would still be created and
  -- no stylist would ever be told. Nothing would have failed. That is the third
  -- time in this repo a hand-reproduced function body would have eaten a line,
  -- and it is why the preflight dumps the running definition.
  perform public.notify_session_applied(v_session_id);

  return v_session_id;
end $function$;

comment on function public.create_session_with_consent(uuid, uuid, date, time without time zone, time without time zone, timestamp with time zone, integer, uuid, text, text, text[], uuid, integer, text, jsonb, uuid) is
  'Creates a pending session and its consent record in one transaction. ⚠️ p_date, p_start_time, '
  'p_end_time, p_scheduled_at and p_duration_minutes are DEAD ARGUMENTS — passed and ignored. The '
  'insert names only the SEVEN columns `authenticated` holds INSERT on since 0086; everything else '
  'is set by session_slot_authority, session_price_snapshot or a column default. They remain in the '
  'signature only to avoid a new overload and a coordinated client deploy. 0001, 0065, 0077, 0086.';

-- ---------------------------------------------------------------------------
-- 3. THE GRANT
--
-- Same shape as 0079's `grant update (status)`, and for the same reason: a
-- revoked grant refuses earlier and more loudly than a policy that matches no
-- rows. `anon` gets nothing back — booking requires auth.uid() regardless.
-- ---------------------------------------------------------------------------
revoke insert on public.sessions from authenticated;
revoke insert on public.sessions from anon;

grant insert (provider_id, model_user_id, availability_id,
              treatment_id, location_type, note, photo_urls)
  on public.sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE CONSENT RECORD BECOMES AN INVARIANT
--
-- ⚠️ SECURITY DEFINER IS REQUIRED, NOT STYLISTIC. The trigger reads
-- `session_consents`; as INVOKER, that table's RLS could hide a row that does
-- exist and the trigger would refuse a legitimate booking.
--
-- ⚠️ A DEFERRED CONSTRAINT FIRES AT COMMIT, which is why the verify block uses
-- `set constraints all immediate` — otherwise the refusal waits for a commit a
-- rolled-back test never reaches, and the test reports the insert as having
-- stood. See scripts/migration-status.mjs.
-- ---------------------------------------------------------------------------
create or replace function public.tg_session_needs_consent_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.session_consents c
                  where c.session_id = new.id) then
    raise exception 'A booking cannot exist without a consent record. Book through create_session_with_consent, which writes the booking and the consent together.'
      using errcode = 'CV005';
  end if;
  return null;
end $$;

comment on function public.tg_session_needs_consent_record() is
  '⚠️ Scoped to rows created from 0086 onward, NOT to the table: 29 sessions already had no '
  'consent row when this was added (newest 25 Jul 2026, none pending), and they are left alone '
  'because backfilling a consent nobody gave would be fabrication. '
  '⚠️ Guarantees a consent RECORD EXISTS — NOT that consent was given. A member can insert a '
  'session and a self-made consent row in one transaction and satisfy this completely; making the '
  'row genuine is audit item 167, and column grants cannot help there because a forger names the '
  'same columns. Deferred to COMMIT so create_session_with_consent''s two inserts both count. '
  '⚠️ INSERT ONLY — do not widen to UPDATE or DELETE: run_retention_purge deletes consents at six '
  'years while sessions survive, and a wider version would refuse on lawfully purged history. '
  'SQLSTATE CV005. 0086, audit item 148.';

create constraint trigger session_needs_consent_record
  after insert on public.sessions
  deferrable initially deferred
  for each row execute function public.tg_session_needs_consent_record();

-- ---------------------------------------------------------------------------
-- 5. POST-CONDITIONS — BOTH HALVES
--
-- Half one: the hole is shut. Half two: ⚠️ THE BOUNDS. A member must still be
-- able to name the seven columns a booking needs, and must still be able to
-- read and update their own sessions. A migration that revoked all of
-- `sessions` would satisfy every "is it shut" check here.
-- ---------------------------------------------------------------------------
do $$
declare
  v_granted text;
  v_want    text := 'availability_id, location_type, model_user_id, note, photo_urls, provider_id, treatment_id';
begin
  v_granted := (select string_agg(cp.column_name, ', ' order by cp.column_name)
                  from information_schema.column_privileges cp
                 where cp.table_schema = 'public' and cp.table_name = 'sessions'
                   and cp.grantee = 'authenticated' and cp.privilege_type = 'INSERT');

  if coalesce(v_granted, '') is distinct from v_want then
    raise exception '0086: authenticated holds INSERT on [%] but should hold exactly [%]. Rolled back.',
      coalesce(v_granted, '(none)'), v_want;
  end if;

  if has_table_privilege('anon', 'public.sessions', 'INSERT') then
    raise exception '0086: anon can still INSERT into sessions. Rolled back.';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.sessions'::regclass
                    and tgname = 'session_needs_consent_record'
                    and tgdeferrable and tginitdeferred) then
    raise exception '0086: the consent constraint trigger is missing, or is not DEFERRABLE INITIALLY DEFERRED — in which case create_session_with_consent''s own booking would be refused before it writes the consent row. Rolled back.';
  end if;

  -- THE BOUNDS.
  if not has_table_privilege('authenticated', 'public.sessions', 'SELECT') then
    raise exception '0086: authenticated lost SELECT on sessions — nobody could see their own bookings. Rolled back.';
  end if;
  if not has_table_privilege('service_role', 'public.sessions', 'INSERT') then
    raise exception '0086: service_role lost INSERT on sessions. Rolled back.';
  end if;
  if regexp_replace(
       pg_get_functiondef('public.tg_session_slot_authority()'::regprocedure),
       '--[^' || chr(10) || ']*', '', 'g') not like '%new.duration_minutes := v_mins%' then
    raise exception '0086: the slot authority does not derive duration_minutes, so the RPC omitting it would hit a NOT NULL violation on every booking. Rolled back.';
  end if;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0086', 'a_booking_cannot_exist_without_a_consent_record', 'fa08787f4a8a77189f41ea67cf8a863f5c7e9a23491a611955644d0101429b16');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- ⚠️⚠️ AND IT IS A GATE, NOT A FORMALITY. Parts 1 and 2 REPRODUCE two live
-- function bodies from the repo, which is exactly what 0083's header criticised
-- 0077 for. The two `body` rows below dump what is actually running, so the
-- reproduction can be DIFFED against it before anything is replaced. **Do not
-- apply until that diff is confirmed clean** — a live edit nobody recorded
-- would otherwise be silently reverted, on the booking path.
--
--   select 'gate' as kind, 'booleans' as name,
--          '0085_applied='   || ((select count(*) from public.schema_migrations where version = '0085') = 1)::text
--       || ' slot_is_0065s=' || (regexp_replace(pg_get_functiondef('public.tg_session_slot_authority()'::regprocedure), '--[^' || chr(10) || ']*', '', 'g') like '%new.scheduled_at := v_starts%')::text
--       || ' slot_not_done=' || (regexp_replace(pg_get_functiondef('public.tg_session_slot_authority()'::regprocedure), '--[^' || chr(10) || ']*', '', 'g') not like '%new.duration_minutes :=%')::text
--       || ' constraint_absent=' || (not exists (select 1 from pg_trigger where tgrelid = 'public.sessions'::regclass and tgname = 'session_needs_consent_record'))::text
--       || ' auth_can_insert_now=' || has_table_privilege('authenticated', 'public.sessions', 'INSERT')::text
--          as detail
--   union all
--   select 'data', 'future slots that do not run forwards',
--          (select count(*)::text from public.availability av
--            where av.end_time <= av.start_time
--              and (av.date + av.start_time) > now() at time zone 'Europe/London')
--   union all
--   select 'data', 'existing sessions with no consent row',
--          (select count(*)::text from public.sessions s
--            where not exists (select 1 from public.session_consents c where c.session_id = s.id))
--   union all
--   select 'grant', 'authenticated INSERT columns today',
--          coalesce((select string_agg(cp.column_name, ', ' order by cp.column_name)
--                      from information_schema.column_privileges cp
--                     where cp.table_schema = 'public' and cp.table_name = 'sessions'
--                       and cp.grantee = 'authenticated' and cp.privilege_type = 'INSERT'), '(none)')
--   union all
--   select 'body', 'tg_session_slot_authority',
--          pg_get_functiondef('public.tg_session_slot_authority()'::regprocedure)
--   union all
--   select 'body', 'create_session_with_consent',
--          pg_get_functiondef('public.create_session_with_consent(uuid,uuid,date,time,time,timestamptz,integer,uuid,text,text,text[],uuid,integer,text,jsonb,uuid)'::regprocedure)
--   order by 1, 2;
--
--   EXPECT: all five booleans true. `future slots that do not run forwards`
--   MUST be 0 — part 1 refuses such a slot, so a non-zero count means this
--   would break a legitimate booking on data that exists today, and the guard
--   refuses to apply.
--
--   `existing sessions with no consent row` is INFORMATIONAL and a non-zero
--   count is NOT a problem: part 4 is INSERT-only and does not touch them. The
--   pre-8-Aug-2026 ones were cleaned up by
--   supabase/cleanup-consentless-test-sessions.sql; anything else is a measured
--   fact worth knowing before an invariant is declared.
-- ===========================================================================
--
-- ── VERIFY — ONE BLOCK. This is Block B's text, unchanged, with post-fix
--    expectations. It was written with `set constraints all immediate` already
--    in both halves SO THAT THIS WOULD NOT BE A REWRITE.
--
--   ⚠️ WHY THAT LINE IS IN BOTH HALVES AND NOT JUST THE HOSTILE ONE. A deferred
--   constraint fires at COMMIT, and this block ends in `raise exception` and
--   `rollback`. Without forcing the check:
--     · the hostile half would report a hole as CLOSED (the refusal never fires)
--     · the bounds half would report a BREAK as fine (the RPC's own pending
--       check never fires either)
--   Same fault, opposite signs. Micky, 6 Oct 2026.
--
--   ⚠️ REFUSALS ARE CLASSIFIED BY MESSAGE, NEVER BY TIMING OR SQLSTATE.
--   `set constraints all immediate` persists for the rest of the transaction,
--   so after (b) runs it a consent violation in (d) fires AT the insert — and a
--   timing-based test would misread that as a grant refusal.
--
--   begin;
--   do $v$
--   declare
--     v_model   uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_other   uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_prov    uuid;  v_treat uuid;
--     v_slot    uuid;  v_slot2 uuid;  v_slot3 uuid;
--     v_day     date := current_date + 40;
--     v_id      uuid;  v_id2 uuid;
--     v_sent_id uuid := '00000000-0000-4000-8000-000000000148';
--     v_back    timestamptz := now() - interval '90 days';
--     v_row     public.sessions;
--     v_free    text := '';
--     v_ok      boolean;
--     v_rpc     uuid;
--     v_doc_id  uuid; v_doc_ver integer; v_doc_hash text; v_doc_ack jsonb;
--     v_set     text[] := array[
--       'id','provider_id','model_id','model_user_id','availability_id','treatment_id',
--       'date','start_time','end_time','scheduled_at','duration_minutes','location_type',
--       'status','note','model_note','photo_urls','price_pence','materials_cost',
--       'currency_code','created_at','cancelled_at','cancelled_by','cancellation_reason',
--       'completed_at','not_held_model_at','not_held_provider_at'];
--     r_a text := 'not run';  r_b text := 'not run';  r_c text := 'not run';
--     r_d text := 'not run';  r_e text := 'not run';  r_f text := 'not run';
--   begin
--     begin
--       r_a := coalesce((select 'NOT SET BY THIS BLOCK: ' || string_agg(c.column_name, ', ')
--                          from information_schema.columns c
--                         where c.table_schema = 'public' and c.table_name = 'sessions'
--                           and not (c.column_name = any (v_set))),
--                       'every column of sessions is set by this block')
--           || ' | table has ' || (select count(*)::text from information_schema.columns
--                                   where table_schema = 'public' and table_name = 'sessions')
--           || ', block sets ' || array_length(v_set, 1)::text;
--     exception when others then r_a := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       -- ⚠️ array[v_treat], NOT array[v_treat::text]. availability.active_treatments
--       -- is uuid[], and the first run of this block failed every fixture on
--       -- `is of type uuid[] but expression is of type text[]` — which left all
--       -- three slots NULL, so (b) never inserted and (d) and (f) failed on a
--       -- null availability_id rather than on the grant or the constraint.
--       -- (f) then read "real booking is broken", which was an artefact.
--       --
--       -- ⚠️ THE GENERATED TYPES COULD NOT HAVE TOLD ME: they render both
--       -- text[] and uuid[] as string[]. A live-derived source that erases the
--       -- distinction you need is not a source for that question.
--       if not public.model_may_apply(v_model) then
--         raise exception 'INELIGIBLE: model_may_apply(%) is false, so the apply gate refuses every insert below with CV003 and the whole block proves nothing. Re-verify the account first.', v_model;
--       end if;
--       v_prov := (select p.id from public.providers p
--                    join public.provider_treatments t on t.provider_id = p.id
--                   order by (p.is_published is true) desc, p.id limit 1);
--       v_treat := (select t.id from public.provider_treatments t
--                    where t.provider_id = v_prov order by t.id limit 1);
--       if v_prov is null or v_treat is null then
--         raise exception 'NO FIXTURE: no provider with a treatment exists.';
--       end if;
--       insert into public.availability (provider_id, date, start_time, end_time, active_treatments, is_taken)
--       values (v_prov, v_day,     '10:00', '11:00', array[v_treat], false) returning id into v_slot;
--       insert into public.availability (provider_id, date, start_time, end_time, active_treatments, is_taken)
--       values (v_prov, v_day + 1, '10:00', '11:00', array[v_treat], false) returning id into v_slot2;
--       insert into public.availability (provider_id, date, start_time, end_time, active_treatments, is_taken)
--       values (v_prov, v_day + 2, '10:00', '11:00', array[v_treat], false) returning id into v_slot3;
--     exception when others then
--       r_b := 'FIXTURES FAILED: ' || sqlerrm;
--     end;
--
--     begin
--       if r_b like 'FIXTURES FAILED%' then
--         r_b := r_b;
--       else
--         perform set_config('request.jwt.claims',
--           json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--         execute 'set local role authenticated';
--         v_ok := false;
--         begin
--           insert into public.sessions (
--             id, provider_id, model_id, model_user_id, availability_id, treatment_id,
--             date, start_time, end_time, scheduled_at, duration_minutes, location_type,
--             status, note, model_note, photo_urls, price_pence, materials_cost,
--             currency_code, created_at, cancelled_at, cancelled_by, cancellation_reason,
--             completed_at, not_held_model_at, not_held_provider_at)
--           values (
--             v_sent_id, v_prov, v_other, v_model, v_slot, v_treat,
--             current_date + 1, '23:00', '23:30', now(), 1, 'provider',
--             'accepted', 'HOSTILE', 'HOSTILE', array['hostile'], 0, 0,
--             'XXX', v_back, now(), v_other, 'HOSTILE',
--             now(), now(), now());
--           v_ok := true;
--           execute 'set constraints all immediate';
--           r_b := 'THE INSERT STOOD — nothing refused it, at statement time or constraint time.';
--         exception when others then
--           r_b := case
--             when sqlerrm ilike '%permission denied%' then 'refused by the GRANT: ' || sqlerrm
--             when sqlerrm ilike '%consent%'           then 'refused by the CONSENT CONSTRAINT: ' || sqlerrm
--             when sqlstate = 'CV003'                  then 'refused by a CV003 GATE — READ IT, it may not be the one you want (apply gate, slot authority and the new null-member guard all raise CV003): ' || sqlerrm
--             else 'refused by something else: ' || sqlstate || ' ' || sqlerrm end
--             || ' | insert had succeeded first: ' || coalesce(v_ok::text, 'false');
--         end;
--         execute 'reset role';
--       end if;
--     exception when others then r_b := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       v_id := (select s.id from public.sessions s where s.availability_id = v_slot);
--       if v_id is null then
--         r_c := 'no row references slot 1 — nothing was inserted, so there is nothing to compare.';
--       else
--         v_row := (select s from public.sessions s where s.id = v_id);
--         if v_row.id = v_sent_id                   then v_free := v_free || ' id(caller-chosen)'; end if;
--         if v_row.status = 'accepted'              then v_free := v_free || ' status=ACCEPTED'; end if;
--         if v_row.model_id = v_other               then v_free := v_free || ' model_id(someone-else)'; end if;
--         if v_row.not_held_model_at is not null    then v_free := v_free || ' not_held_model_at'; end if;
--         if v_row.not_held_provider_at is not null then v_free := v_free || ' not_held_provider_at'; end if;
--         if v_row.completed_at is not null         then v_free := v_free || ' completed_at'; end if;
--         if v_row.cancelled_at is not null         then v_free := v_free || ' cancelled_at'; end if;
--         if v_row.cancelled_by = v_other           then v_free := v_free || ' cancelled_by'; end if;
--         if v_row.cancellation_reason = 'HOSTILE'  then v_free := v_free || ' cancellation_reason'; end if;
--         if v_row.model_note = 'HOSTILE'           then v_free := v_free || ' model_note'; end if;
--         if v_row.created_at < now() - interval '30 days' then v_free := v_free || ' created_at(backdated)'; end if;
--         if v_row.materials_cost = 0               then v_free := v_free || ' materials_cost'; end if;
--         if v_row.currency_code = 'XXX'            then v_free := v_free || ' currency_code'; end if;
--         if v_row.duration_minutes = 1             then v_free := v_free || ' duration_minutes'; end if;
--         r_c := 'UNGUARDED:' || coalesce(nullif(v_free, ''), ' none')
--             || ' || trigger-covered, STORED: date=' || coalesce(v_row.date::text, 'null')
--             || ' start=' || coalesce(v_row.start_time::text, 'null')
--             || ' end=' || coalesce(v_row.end_time::text, 'null')
--             || ' scheduled_at=' || coalesce(v_row.scheduled_at::text, 'null')
--             || ' price_pence=' || coalesce(v_row.price_pence::text, 'null')
--             || ' duration=' || coalesce(v_row.duration_minutes::text, 'null')
--             || ' model_id=' || coalesce(v_row.model_id::text, 'null')
--             || ' (slot was ' || v_day::text || ' 10:00-11:00; SENT '
--             || (current_date + 1)::text || ' 23:00-23:30, price 0, duration 1)';
--       end if;
--     exception when others then r_c := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       v_ok := false;
--       begin
--         -- ⚠️ EXACTLY THE SEVEN COLUMNS THAT REMAIN GRANTED, AND THAT IS WHY.
--         -- An earlier draft named nine, including model_id and
--         -- duration_minutes — which 0086 revokes. Post-fix that insert is
--         -- refused by the GRANT, so the CONSENT CONSTRAINT is never reached
--         -- and the one section that proves part 4 proves nothing while
--         -- looking like a pass. Seven works pre-fix AND post-fix, which is
--         -- what makes this the same text with different expectations.
--         insert into public.sessions (provider_id, model_user_id, availability_id,
--                                      treatment_id, location_type, note, photo_urls)
--         values (v_prov, v_model, v_slot3, v_treat, 'provider', 'seven-column', null);
--         v_ok := true;
--         execute 'set constraints all immediate';
--         r_d := 'THE SEVEN-COLUMN INSERT STOOD — a consentless booking is creatable.';
--       exception when others then
--         r_d := case
--           when sqlerrm ilike '%consent%'           then 'refused by the CONSENT CONSTRAINT: ' || sqlerrm
--           when sqlerrm ilike '%permission denied%' then 'refused by the GRANT: ' || sqlerrm
--           else 'refused by something else: ' || sqlstate || ' ' || sqlerrm end
--           || ' | insert had succeeded first: ' || coalesce(v_ok::text, 'false');
--       end;
--       execute 'reset role';
--     exception when others then r_d := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       v_id2 := (select s.id from public.sessions s where s.availability_id = v_slot3);
--       r_e := 'slot1 row: ' || coalesce(v_id::text, 'none')
--           || ' consents=' || coalesce((select count(*)::text from public.session_consents c
--                                         where c.session_id = v_id), 'n/a')
--           || ' | slot3 row: ' || coalesce(v_id2::text, 'none')
--           || ' consents=' || coalesce((select count(*)::text from public.session_consents c
--                                         where c.session_id = v_id2), 'n/a')
--           || ' — any row above with consents=0 is a six-year record that cannot be backfilled.';
--     exception when others then r_e := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     begin
--       v_doc_id   := (select d.id from public.consent_documents d where d.is_active limit 1);
--       v_doc_ver  := (select d.version from public.consent_documents d where d.id = v_doc_id);
--       v_doc_hash := (select d.content_hash from public.consent_documents d where d.id = v_doc_id);
--       v_doc_ack  := (select d.acknowledgements from public.consent_documents d where d.id = v_doc_id);
--       if v_doc_id is null then
--         r_f := 'NO ACTIVE CONSENT DOCUMENT — the bounds half cannot run.';
--       elsif v_slot2 is null then
--         -- ⚠️ SAY SO RATHER THAN FAILING. On 6 Oct a fixture failure left this
--         -- null and the section reported "real booking is broken", which was an
--         -- artefact. A section that cannot run must say that, not report the
--         -- worst outcome it knows how to print.
--         r_f := 'NOT RUN — no slot, so this would have failed for a reason unrelated to 0086.';
--       else
--         -- ⚠⚠ BACK TO DEFERRED FIRST, AND THIS IS NOT BELT-AND-BRACES.
--         -- `set constraints all immediate` PERSISTS for the rest of the
--         -- transaction, and section (d) issues one. Post-fix, (d)'s insert
--         -- SUCCEEDS at statement level and the refusal comes from its own
--         -- `set constraints` — so the mode may still be IMMEDIATE here. The RPC
--         -- inserts the session BEFORE the consent row, so an immediate check
--         -- fires in that gap and this section reports "real booking is broken"
--         -- when nothing is wrong. Whether a subtransaction abort reverts the
--         -- mode is not something to assume, so it is set explicitly.
--         execute 'set constraints all deferred';
--         perform set_config('request.jwt.claims',
--           json_build_object('sub', v_model::text, 'role', 'authenticated')::text, true);
--         execute 'set local role authenticated';
--         v_rpc := public.create_session_with_consent(
--           v_prov, v_slot2, v_day + 1, '10:00', '11:00',
--           (v_day + 1)::timestamptz + interval '10 hours', 60,
--           v_treat, 'provider', '148 bounds — rolled back', '{}',
--           v_doc_id, v_doc_ver, v_doc_hash, v_doc_ack);
--         execute 'set constraints all immediate';
--         execute 'reset role';
--         r_f := 'REAL BOOKING SURVIVES BOTH HALVES: session ' || v_rpc::text
--             || ', consent rows ' || (select count(*)::text from public.session_consents c
--                                       where c.session_id = v_rpc)
--             || ', duration ' || (select duration_minutes::text from public.sessions where id = v_rpc)
--             || ', model_id=model_user_id ' || (select (model_id = model_user_id)::text
--                                                  from public.sessions where id = v_rpc)
--             || ', stylist notified ' || (select count(*)::text from public.notifications n
--                                           where n.session_id = v_rpc and n.type = 'session_applied')
--             || ', and its deferred checks were forced immediate rather than left pending.';
--       end if;
--     exception when others then
--       r_f := 'BOUNDS HALF FAILED — real booking is broken: ' || sqlstate || ' ' || sqlerrm;
--     end;
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || '(a) coverage        : ' || r_a || chr(10)
--       || '(b) 26-column insert: ' || r_b || chr(10)
--       || '(c) which columns   : ' || r_c || chr(10)
--       || '(d) 7-column insert : ' || r_d || chr(10)
--       || '(e) consent records : ' || r_e || chr(10)
--       || '(f) bounds          : ' || r_f;
--   end $v$;
--   rollback;
--
--   POST-FIX EXPECTATIONS (the pre-fix run of 6 Oct 2026 is in brackets):
--
--     (a) every column set, 26 and 26.                      [same]
--     (b) refused by the GRANT: permission denied for column ...
--                                                           [THE INSERT STOOD]
--     (c) no row references slot 1.                         [15 columns UNGUARDED]
--     (d) refused by the CONSENT CONSTRAINT: A booking cannot exist without a
--         consent record ...                                [THE SEVEN-COLUMN
--                                                            INSERT STOOD]
--     (e) slot1 none, slot3 none.                           [both consents=0]
--     (f) REAL BOOKING SURVIVES BOTH HALVES, consent rows 1, duration 60,
--         model_id=model_user_id true.                      [same, no duration
--                                                            or model_id check]
--
--   ⚠️ (f) IS THE SECTION THAT MATTERS MOST HERE, not (b) or (d). Those two
--   prove the hole is shut; (f) proves booking still works, and it is the only
--   section that would notice if the RPC's narrowed insert hit a NOT NULL
--   violation because part 1's derivation did not land. `duration 60` and
--   `model_id=model_user_id true` are the two new assertions, and they are the
--   two columns part 1 took over.
-- ===========================================================================
